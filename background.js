import {
  buildExpiryIso,
  clearPresence,
  ensureBuiltInConfig,
  ensureValidSession,
  extractTabInfo,
  getDefaultPrivacySettings,
  getPrivacySettings,
  hasCompleteProfile,
  purgeExpiredHistory,
  recordHistory,
  setLocalStore,
  upsertPresence
} from './supabase.js';

const HEARTBEAT_ALARM = 'connectme-heartbeat';
const PURGE_ALARM = 'connectme-purge';
const LAST_TRACKED_TAB_KEY = 'connectme-last-tracked';
const PRESENCE_EXPIRY_MS = 3 * 60 * 1000;

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
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

    if (!privacy.consentGranted || !tabInfo) {
      await clearPresence().catch(() => null);
      return;
    }

    const nowIso = new Date().toISOString();
    const { [LAST_TRACKED_TAB_KEY]: lastTracked } = await chrome.storage.local.get(LAST_TRACKED_TAB_KEY);

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

        await setLocalStore({
          [LAST_TRACKED_TAB_KEY]: {
            siteIdentifier,
            trackedAt: nowIso
          }
        });
      }
    }

    if (shouldSharePresence(privacy, profile)) {
      await upsertPresence({
        domain: tabInfo.domain,
        path: tabInfo.path,
        full_url: tabInfo.url,
        page_title: tab?.title || tabInfo.title,
        last_seen: nowIso,
        expires_at: new Date(Date.now() + PRESENCE_EXPIRY_MS).toISOString()
      }).catch(() => null);
    } else {
      await clearPresence().catch(() => null);
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

chrome.tabs.onActivated.addListener(async () => {
  await trackActiveContext('tab-activated');
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === 'complete') {
    await trackActiveContext('tab-updated');
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
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
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
