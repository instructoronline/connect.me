import {
  buildExpiryIso,
  clearPresence,
  ensureValidSession,
  extractTabInfo,
  getDefaultPrivacySettings,
  getPrivacySettings,
  purgeExpiredHistory,
  recordHistory,
  setLocalStore,
  upsertPresence
} from './supabase.js';

const HEARTBEAT_ALARM = 'connectme-heartbeat';
const PURGE_ALARM = 'connectme-purge';
const LAST_TRACKED_TAB_KEY = 'lastTrackedSite';
const PRESENCE_FRESHNESS_MS = 2 * 60 * 1000;

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function trackActiveContext(reason = 'heartbeat') {
  try {
    const session = await ensureValidSession();
    if (!session?.user) {
      await clearPresence().catch(() => null);
      return;
    }

    let privacy;
    try {
      privacy = await getPrivacySettings();
    } catch (_error) {
      privacy = getDefaultPrivacySettings();
    }

    if (!privacy.consentGranted) {
      await clearPresence().catch(() => null);
      return;
    }

    const tab = await getActiveTab();
    const tabInfo = extractTabInfo(tab?.url);
    if (!tabInfo) {
      await clearPresence().catch(() => null);
      return;
    }

    const nowIso = new Date().toISOString();
    const storage = await chrome.storage.local.get(LAST_TRACKED_TAB_KEY);
    const lastTracked = storage[LAST_TRACKED_TAB_KEY];

    if (privacy.trackingEnabled && privacy.historyMode !== 'none') {
      const granularity = privacy.historyMode;
      const siteIdentifier = granularity === 'full_url' ? tabInfo.url : granularity === 'path' ? `${tabInfo.domain}${tabInfo.path}` : tabInfo.domain;
      const shouldWriteHistory = !lastTracked || lastTracked.siteIdentifier !== siteIdentifier || reason === 'tab-changed';
      if (shouldWriteHistory) {
        await recordHistory({
          domain: tabInfo.domain,
          path: granularity === 'domain' ? null : tabInfo.path,
          full_url: granularity === 'full_url' ? tabInfo.url : null,
          page_title: tab?.title || tabInfo.title,
          tracked_scope: granularity,
          visited_at: nowIso,
          expires_at: buildExpiryIso(privacy.retentionUnit, privacy.retentionValue)
        }).catch(() => null);
        await setLocalStore({
          [LAST_TRACKED_TAB_KEY]: {
            siteIdentifier,
            updatedAt: nowIso
          }
        });
      }
    }

    const shouldSharePresence = privacy.presenceSharingEnabled && !privacy.invisibleModeEnabled;
    if (shouldSharePresence) {
      await upsertPresence({
        domain: tabInfo.domain,
        path: tabInfo.path,
        full_url: tabInfo.url,
        page_title: tab?.title || tabInfo.title,
        last_seen: nowIso,
        expires_at: new Date(Date.now() + PRESENCE_FRESHNESS_MS).toISOString()
      }).catch(() => null);
    } else {
      await clearPresence().catch(() => null);
    }
  } catch (_error) {
    // Service worker should remain resilient when the user has not configured Supabase yet.
  }
}

async function initialize() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(PURGE_ALARM, { periodInMinutes: 30 });
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
  await trackActiveContext('tab-changed');
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    await trackActiveContext('tab-changed');
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
  return false;
});
