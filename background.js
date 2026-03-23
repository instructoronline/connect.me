import {
  buildExpiryIso,
  clearPresence,
  ensureBuiltInConfig,
  ensureValidSession,
  extractTabInfo,
  getDefaultPrivacySettings,
  getPrivacySettings,
  sanitizeTabInfoForPrivacy,
  hasCompleteProfile,
  purgeExpiredHistory,
  recordHistory,
  setLocalStore,
  upsertPresence
} from './supabase.js';

const HEARTBEAT_ALARM = 'connectme-heartbeat';
const PURGE_ALARM = 'connectme-purge';
const LAST_TRACKED_TAB_KEY = 'connectme-last-tracked';
const ACTIVE_CONTEXT_KEY = 'connectme-active-context';
const PRESENCE_EXPIRY_MS = 3 * 60 * 1000;
const DESKTOP_WINDOW_URL = chrome.runtime.getURL('desktop.html');
const DESKTOP_WINDOW_BOUNDS = {
  width: 1280,
  height: 920
};
const MIN_EXTENSION_WINDOW_WIDTH = 420;
const MIN_EXTENSION_WINDOW_HEIGHT = 700;

let lastFocusedBrowserWindowId = null;

function isTrackableTab(tab) {
  return Boolean(tab?.id && Number.isInteger(tab.windowId) && extractTabInfo(tab.url));
}

async function getWindowType(windowId) {
  if (!Number.isInteger(windowId)) {
    return null;
  }

  try {
    const windowInfo = await chrome.windows.get(windowId);
    return windowInfo?.type || null;
  } catch (_error) {
    return null;
  }
}

async function rememberBrowserWindow(windowId, reason) {
  const windowType = await getWindowType(windowId);
  if (windowType === 'normal') {
    lastFocusedBrowserWindowId = windowId;
    logStructured('log', '[Connect.Me] Remembered browser window', { windowId, reason });
    return true;
  }
  return false;
}

async function getPreferredTrackableTab() {
  const activeTabs = await chrome.tabs.query({ active: true });
  const trackableTabs = activeTabs.filter(isTrackableTab);

  if (!trackableTabs.length) {
    return null;
  }

  if (Number.isInteger(lastFocusedBrowserWindowId)) {
    const preferredTab = trackableTabs.find((tab) => tab.windowId === lastFocusedBrowserWindowId);
    if (preferredTab) {
      return preferredTab;
    }
  }

  for (const tab of trackableTabs) {
    const windowType = await getWindowType(tab.windowId);
    if (windowType === 'normal') {
      lastFocusedBrowserWindowId = tab.windowId;
      return tab;
    }
  }

  return null;
}

async function findDesktopWorkspaceTab() {
  const tabs = await chrome.tabs.query({ url: DESKTOP_WINDOW_URL });
  if (!tabs.length) {
    return null;
  }

  let fallbackTab = null;

  for (const tab of tabs) {
    if (!Number.isInteger(tab.windowId)) {
      continue;
    }

    try {
      const windowInfo = await chrome.windows.get(tab.windowId);
      if (windowInfo?.type === 'popup') {
        return { tab, windowInfo };
      }

      if (!fallbackTab) {
        fallbackTab = { tab, windowInfo };
      }
    } catch (_error) {
      // Ignore stale window references and continue scanning.
    }
  }

  return fallbackTab;
}

function getNormalizedWorkspaceBounds(windowInfo, requestedBounds = DESKTOP_WINDOW_BOUNDS) {
  const normalizedWidth = Math.max(
    MIN_EXTENSION_WINDOW_WIDTH,
    windowInfo?.width || 0,
    requestedBounds?.width || 0
  );
  const normalizedHeight = Math.max(
    MIN_EXTENSION_WINDOW_HEIGHT,
    windowInfo?.height || 0,
    requestedBounds?.height || 0
  );

  return {
    width: normalizedWidth,
    height: normalizedHeight
  };
}

function shouldForceWorkspaceReopen(windowInfo) {
  if (!windowInfo) {
    return false;
  }

  return Boolean(
    windowInfo.state === 'minimized' ||
    windowInfo.width < MIN_EXTENSION_WINDOW_WIDTH ||
    windowInfo.height < MIN_EXTENSION_WINDOW_HEIGHT
  );
}

async function ensureWorkspaceWindowBounds(windowInfo, tabId, requestedBounds = DESKTOP_WINDOW_BOUNDS) {
  if (!windowInfo?.id) {
    return null;
  }

  const normalizedBounds = getNormalizedWorkspaceBounds(windowInfo, requestedBounds);
  const needsResize =
    windowInfo.state !== 'normal' ||
    windowInfo.width !== normalizedBounds.width ||
    windowInfo.height !== normalizedBounds.height ||
    !windowInfo.focused;

  if (needsResize) {
    await chrome.windows.update(windowInfo.id, {
      focused: true,
      state: 'normal',
      width: normalizedBounds.width,
      height: normalizedBounds.height
    });
  }

  const refreshedWindow = await chrome.windows.get(windowInfo.id);
  const stillTooSmall = shouldForceWorkspaceReopen(refreshedWindow);

  if (!stillTooSmall) {
    if (Number.isInteger(tabId)) {
      await chrome.tabs.update(tabId, { active: true });
    }

    return {
      reopened: false,
      windowInfo: refreshedWindow
    };
  }

  logStructured('warn', '[Connect.Me] Workspace window reopened after tiny restore', {
    previousWindowId: windowInfo.id,
    restoredBounds: {
      width: refreshedWindow.width,
      height: refreshedWindow.height,
      state: refreshedWindow.state
    },
    fallbackBounds: normalizedBounds
  });

  const recreatedWindow = Number.isInteger(tabId)
    ? await chrome.windows.create({
        tabId,
        type: 'popup',
        focused: true,
        width: normalizedBounds.width,
        height: normalizedBounds.height
      })
    : await chrome.windows.create({
        url: DESKTOP_WINDOW_URL,
        type: 'popup',
        focused: true,
        width: normalizedBounds.width,
        height: normalizedBounds.height
      });

  return {
    reopened: true,
    windowInfo: recreatedWindow
  };
}

async function focusDesktopWorkspace(windowId, tabId, requestedBounds = DESKTOP_WINDOW_BOUNDS) {
  const currentWindow = await chrome.windows.get(windowId);
  return ensureWorkspaceWindowBounds(currentWindow, tabId, requestedBounds);
}

async function openDesktopWorkspaceWindow() {
  const existingWorkspace = await findDesktopWorkspaceTab();
  if (existingWorkspace?.windowInfo?.id) {
    if (existingWorkspace.windowInfo.type !== 'popup' && Number.isInteger(existingWorkspace.tab?.id)) {
      const movedWindow = await chrome.windows.create({
        tabId: existingWorkspace.tab.id,
        type: 'popup',
        focused: true,
        width: DESKTOP_WINDOW_BOUNDS.width,
        height: DESKTOP_WINDOW_BOUNDS.height
      });
      const enforcedWindow = await ensureWorkspaceWindowBounds(
        movedWindow,
        movedWindow?.tabs?.[0]?.id || existingWorkspace.tab.id,
        DESKTOP_WINDOW_BOUNDS
      );

      return {
        reused: true,
        reopened: enforcedWindow?.reopened || false,
        windowId: enforcedWindow?.windowInfo?.id || movedWindow?.id || null,
        tabId: enforcedWindow?.windowInfo?.tabs?.[0]?.id || movedWindow?.tabs?.[0]?.id || existingWorkspace.tab.id
      };
    }

    const enforcedWindow = await focusDesktopWorkspace(
      existingWorkspace.windowInfo.id,
      existingWorkspace.tab?.id,
      DESKTOP_WINDOW_BOUNDS
    );
    return {
      reused: true,
      reopened: enforcedWindow?.reopened || false,
      windowId: enforcedWindow?.windowInfo?.id || existingWorkspace.windowInfo.id,
      tabId: enforcedWindow?.windowInfo?.tabs?.[0]?.id || existingWorkspace.tab?.id || null
    };
  }

  const createdWindow = await chrome.windows.create({
    url: DESKTOP_WINDOW_URL,
    type: 'popup',
    focused: true,
    width: DESKTOP_WINDOW_BOUNDS.width,
    height: DESKTOP_WINDOW_BOUNDS.height
  });

  const enforcedWindow = await ensureWorkspaceWindowBounds(
    createdWindow,
    createdWindow?.tabs?.[0]?.id || null,
    DESKTOP_WINDOW_BOUNDS
  );

  return {
    reused: false,
    reopened: enforcedWindow?.reopened || false,
    windowId: enforcedWindow?.windowInfo?.id || createdWindow?.id || null,
    tabId: enforcedWindow?.windowInfo?.tabs?.[0]?.id || createdWindow?.tabs?.[0]?.id || null
  };
}

function stringifyForLog(value) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function logStructured(level, message, payload) {
  const logger = console[level] || console.log;
  if (payload === undefined) {
    logger(message);
    return;
  }
  logger(`${message} ${stringifyForLog(payload)}`);
}

async function broadcastMessage(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (_error) {
    // Ignore when no popup listener is currently connected.
  }
}

async function persistActiveContext(tabInfo, reason, privacy = getDefaultPrivacySettings(), extras = {}) {
  const scoped = sanitizeTabInfoForPrivacy(tabInfo, privacy);
  const payload = tabInfo
    ? {
        domain: scoped?.domain || tabInfo?.domain || null,
        path: scoped?.path || null,
        url: scoped?.url || null,
        title: tabInfo?.title || scoped?.title || null,
        trackedDisplayUrl: scoped?.trackedDisplayUrl || scoped?.domain || tabInfo?.domain || null,
        requestedHistoryMode: scoped?.requestedHistoryMode || privacy?.historyMode || 'domain',
        effectiveHistoryMode: scoped?.effectiveHistoryMode || 'domain',
        privacyDescription: scoped?.privacyDescription || 'Only the domain is visible because detailed tracking is currently off.',
        detectedAt: new Date().toISOString(),
        reason,
        ...extras
      }
    : {
        domain: null,
        path: null,
        url: null,
        title: null,
        trackedDisplayUrl: null,
        requestedHistoryMode: privacy?.historyMode || 'domain',
        effectiveHistoryMode: 'domain',
        privacyDescription: 'No supported website is currently active.',
        detectedAt: new Date().toISOString(),
        reason,
        ...extras
      };

  await setLocalStore({ [ACTIVE_CONTEXT_KEY]: payload });
  logStructured('log', '[Connect.Me] Background current-site state updated', payload);
  return payload;
}

async function notifyClients(reason, tabInfo, extras = {}, privacy = getDefaultPrivacySettings()) {
  const context = await persistActiveContext(tabInfo, reason, privacy, extras);
  await broadcastMessage({
    type: 'ACTIVE_CONTEXT_CHANGED',
    reason,
    context,
    ...extras
  });

  if (extras?.topSitesRefresh) {
    logStructured('log', '[Connect.Me] Top-sites refresh trigger', { reason, context });
    await broadcastMessage({ type: 'TOP_SITES_REFRESH_REQUESTED', reason });
  }
}

function shouldTrackHistory(privacy) {
  return Boolean(privacy?.consentGranted && privacy?.trackingEnabled && privacy?.historyMode !== 'none');
}

function shouldSharePresence(privacy, profile) {
  return Boolean(
    privacy?.consentGranted &&
    privacy?.presenceSharingEnabled &&
    !privacy?.invisibleModeEnabled &&
    hasCompleteProfile(profile)
  );
}

async function getTrackingTarget() {
  const tab = await getPreferredTrackableTab();
  if (!tab) {
    return { tab: null, tabInfo: null };
  }

  return {
    tab,
    tabInfo: extractTabInfo(tab.url)
  };
}

async function trackActiveContext(reason = 'heartbeat') {
  try {
    const session = await ensureValidSession();
    if (!session?.user) {
      await clearPresence().catch(() => null);
      await notifyClients(reason, null, { topSitesRefresh: true, presenceCleared: true, sessionMissing: true }, getDefaultPrivacySettings());
      return;
    }

    let privacy = getDefaultPrivacySettings();
    try {
      privacy = await getPrivacySettings();
    } catch (_error) {
      privacy = getDefaultPrivacySettings();
    }

    const profile = session.user.user_metadata?.connectme_profile || null;
    const { tab, tabInfo } = await getTrackingTarget();
    const nowIso = new Date().toISOString();
    const { [LAST_TRACKED_TAB_KEY]: lastTracked } = await chrome.storage.local.get(LAST_TRACKED_TAB_KEY);
    const previousDomain = lastTracked?.domain || null;
    const currentDomain = tabInfo?.domain || null;
    const domainChanged = previousDomain !== currentDomain;

    if (domainChanged) {
      logStructured('log', '[Connect.Me] Detected domain change', {
        reason,
        previousDomain,
        currentDomain,
        tabId: tab?.id || null,
        windowId: tab?.windowId || null
      });
    }

    if (!tabInfo) {
      await clearPresence().catch(() => null);
      await setLocalStore({
        [LAST_TRACKED_TAB_KEY]: {
          ...lastTracked,
          domain: null,
          siteIdentifier: null,
          trackedAt: nowIso
        }
      });
      logStructured('warn', '[Connect.Me] Current-site cleared because no supported browser tab was found', { reason });
      await notifyClients(reason, null, { topSitesRefresh: true, presenceCleared: true, cleared: true }, privacy);
      return;
    }

    if (!privacy.consentGranted) {
      await clearPresence().catch(() => null);
      await setLocalStore({
        [LAST_TRACKED_TAB_KEY]: {
          ...lastTracked,
          domain: currentDomain,
          siteIdentifier: null,
          trackedAt: nowIso
        }
      });
      await notifyClients(reason, tabInfo, { topSitesRefresh: true, presenceCleared: true, consentMissing: true }, privacy);
      return;
    }

    if (shouldTrackHistory(privacy)) {
      const siteIdentifier =
        privacy.historyMode === 'full_url'
          ? tabInfo.url
          : privacy.historyMode === 'path'
            ? `${tabInfo.domain}${tabInfo.path}`
            : tabInfo.domain;

      const shouldWrite = !lastTracked || lastTracked.siteIdentifier !== siteIdentifier || reason !== 'heartbeat';

      if (shouldWrite) {
        await recordHistory({
          domain: tabInfo.domain,
          path: privacy.historyMode === 'domain' ? null : tabInfo.path,
          full_url: privacy.historyMode === 'full_url' ? tabInfo.url : null,
          page_title: tab?.title || tabInfo.title,
          tracked_scope: privacy.historyMode,
          visited_at: nowIso,
          expires_at: buildExpiryIso(privacy.retentionUnit, privacy.retentionValue)
        }).catch(() => null);
      }

      await setLocalStore({
        [LAST_TRACKED_TAB_KEY]: {
          domain: tabInfo.domain,
          siteIdentifier,
          trackedAt: nowIso,
          tabId: tab?.id || null,
          windowId: tab?.windowId || null
        }
      });
    } else {
      await setLocalStore({
        [LAST_TRACKED_TAB_KEY]: {
          domain: tabInfo.domain,
          siteIdentifier: null,
          trackedAt: nowIso,
          tabId: tab?.id || null,
          windowId: tab?.windowId || null
        }
      });
    }

    if (shouldSharePresence(privacy, profile)) {
      const scopedTabInfo = sanitizeTabInfoForPrivacy(tabInfo, privacy);
      const presencePayload = {
        domain: tabInfo.domain,
        path: scopedTabInfo?.path || null,
        full_url: scopedTabInfo?.url || null,
        page_title: tab?.title || tabInfo.title,
        last_seen: nowIso,
        expires_at: new Date(Date.now() + PRESENCE_EXPIRY_MS).toISOString()
      };

      logStructured('log', '[Connect.Me] Presence update payload', { reason, presencePayload });
      await upsertPresence(presencePayload).catch(() => null);
      await notifyClients(reason, tabInfo, { topSitesRefresh: true, presenceUpdated: true }, privacy);
      return;
    }

    await clearPresence().catch(() => null);
    await notifyClients(reason, tabInfo, { topSitesRefresh: true, presenceCleared: true }, privacy);
  } catch (error) {
    logStructured('error', '[Connect.Me] Background trackActiveContext failed', {
      reason,
      message: error?.message || String(error)
    });
  }
}

function scheduleAlarms() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(PURGE_ALARM, { periodInMinutes: 15 });
}

async function initialize() {
  await ensureBuiltInConfig();
  scheduleAlarms();
  await purgeExpiredHistory().catch(() => null);
  await trackActiveContext('startup');
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    await trackActiveContext('heartbeat');
  }

  if (alarm.name === PURGE_ALARM) {
    await purgeExpiredHistory().catch(() => null);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const remembered = await rememberBrowserWindow(activeInfo.windowId, 'tab-activated');
  logStructured('log', '[Connect.Me] Active tab change', { ...activeInfo, rememberedBrowserWindow: remembered });
  await trackActiveContext('tab-activated');
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active || (!isTrackableTab(tab) && !changeInfo.url)) {
    return;
  }

  await rememberBrowserWindow(tab.windowId, 'tab-updated');
  logStructured('log', '[Connect.Me] Active tab updated', {
    tabId,
    status: changeInfo.status || null,
    url: changeInfo.url || tab?.url || null,
    windowId: tab?.windowId || null
  });
  await trackActiveContext(changeInfo.url ? 'domain-updated' : 'tab-updated');
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const remembered = await rememberBrowserWindow(windowId, 'window-focus');
  logStructured('log', '[Connect.Me] Window focus changed', { windowId, rememberedBrowserWindow: remembered });
  await trackActiveContext('window-focus');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TRACK_NOW') {
    trackActiveContext(message.reason || 'manual')
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'CLEAR_PRESENCE') {
    clearPresence()
      .then(async () => {
        logStructured('warn', '[Connect.Me] Presence clear/reset event requested', { reason: message.reason || 'presence-cleared' });
        await trackActiveContext(message.reason || 'presence-cleared');
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_ACTIVE_CONTEXT') {
    chrome.storage.local.get(ACTIVE_CONTEXT_KEY)
      .then((result) => sendResponse({ ok: true, context: result?.[ACTIVE_CONTEXT_KEY] || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'REFRESH_TOP_SITES') {
    logStructured('log', '[Connect.Me] Top-sites refresh trigger', { reason: message.reason || 'manual' });
    broadcastMessage({ type: 'TOP_SITES_REFRESH_REQUESTED', reason: message.reason || 'manual' })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'OPEN_DESKTOP_WINDOW') {
    openDesktopWorkspaceWindow()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
