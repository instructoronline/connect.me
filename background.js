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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
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

async function focusDesktopWorkspace(windowId, tabId) {
  const updateWindow = chrome.windows.update(windowId, { focused: true, state: 'normal' });
  const updateTab = Number.isInteger(tabId) ? chrome.tabs.update(tabId, { active: true }) : Promise.resolve(null);
  await Promise.all([updateWindow, updateTab]);
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

      return {
        reused: true,
        windowId: movedWindow?.id || null,
        tabId: movedWindow?.tabs?.[0]?.id || existingWorkspace.tab.id
      };
    }

    await focusDesktopWorkspace(existingWorkspace.windowInfo.id, existingWorkspace.tab?.id);
    return {
      reused: true,
      windowId: existingWorkspace.windowInfo.id,
      tabId: existingWorkspace.tab?.id || null
    };
  }

  const createdWindow = await chrome.windows.create({
    url: DESKTOP_WINDOW_URL,
    type: 'popup',
    focused: true,
    width: DESKTOP_WINDOW_BOUNDS.width,
    height: DESKTOP_WINDOW_BOUNDS.height
  });

  return {
    reused: false,
    windowId: createdWindow?.id || null,
    tabId: createdWindow?.tabs?.[0]?.id || null
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

async function persistActiveContext(tabInfo, reason, privacy = getDefaultPrivacySettings()) {
  const scoped = sanitizeTabInfoForPrivacy(tabInfo, privacy);
  const payload = {
    domain: scoped?.domain || tabInfo?.domain || null,
    path: scoped?.path || null,
    url: scoped?.url || null,
    title: tabInfo?.title || scoped?.title || null,
    trackedDisplayUrl: scoped?.trackedDisplayUrl || scoped?.domain || tabInfo?.domain || null,
    requestedHistoryMode: scoped?.requestedHistoryMode || privacy?.historyMode || 'domain',
    effectiveHistoryMode: scoped?.effectiveHistoryMode || 'domain',
    privacyDescription: scoped?.privacyDescription || 'Only the domain is visible because detailed tracking is currently off.',
    detectedAt: new Date().toISOString(),
    reason
  };

  await setLocalStore({ [ACTIVE_CONTEXT_KEY]: payload });
  return payload;
}

async function notifyPopupRefresh(reason, tabInfo, extras = {}, privacy = getDefaultPrivacySettings()) {
  const context = await persistActiveContext(tabInfo, reason, privacy);
  logStructured('log', '[Connect.Me] Popup refresh trigger', { reason, context, extras });
  await broadcastMessage({
    type: 'ACTIVE_CONTEXT_CHANGED',
    reason,
    context,
    ...extras
  });
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

async function trackActiveContext(reason = 'heartbeat') {
  try {
    const session = await ensureValidSession();
    if (!session?.user) {
      await clearPresence().catch(() => null);
      await notifyPopupRefresh(reason, null, { topSitesRefresh: true, presenceCleared: true }, getDefaultPrivacySettings());
      return;
    }

    let privacy = getDefaultPrivacySettings();
    try {
      privacy = await getPrivacySettings();
    } catch (_error) {
      privacy = getDefaultPrivacySettings();
    }

    const profile = session.user.user_metadata?.connectme_profile || null;
    const tab = await getActiveTab();
    const tabInfo = extractTabInfo(tab?.url);
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

    if (!privacy.consentGranted || !tabInfo) {
      await clearPresence().catch(() => null);
      await setLocalStore({
        [LAST_TRACKED_TAB_KEY]: {
          ...lastTracked,
          domain: currentDomain,
          siteIdentifier: null,
          trackedAt: nowIso
        }
      });
      await notifyPopupRefresh(reason, tabInfo, { topSitesRefresh: true, presenceCleared: true }, privacy);
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
          trackedAt: nowIso
        }
      });
    } else {
      await setLocalStore({
        [LAST_TRACKED_TAB_KEY]: {
          domain: tabInfo.domain,
          siteIdentifier: null,
          trackedAt: nowIso
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
      await notifyPopupRefresh(reason, tabInfo, { topSitesRefresh: true, presenceUpdated: true }, privacy);
    } else {
      await clearPresence().catch(() => null);
      await notifyPopupRefresh(reason, tabInfo, { topSitesRefresh: true, presenceCleared: true }, privacy);
    }
  } catch (_error) {
    // Avoid breaking the service worker if Supabase is temporarily unavailable.
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
  logStructured('log', '[Connect.Me] Active tab change', activeInfo);
  await trackActiveContext('tab-activated');
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || typeof changeInfo.url === 'string')) {
    logStructured('log', '[Connect.Me] Active tab updated', {
      tabId,
      status: changeInfo.status || null,
      url: changeInfo.url || tab?.url || null
    });
    await trackActiveContext(changeInfo.url ? 'domain-updated' : 'tab-updated');
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    logStructured('log', '[Connect.Me] Window focus changed', { windowId });
    await trackActiveContext('window-focus');
  }
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
        await notifyPopupRefresh(message.reason || 'presence-cleared', null, { topSitesRefresh: true, presenceCleared: true });
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
