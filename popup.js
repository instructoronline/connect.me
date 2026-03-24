import {
  buildScopedSiteContext,
  clearPresence,
  connectCurrentUserToLearningModule,
  diagnoseLearningModulesBackend,
  deleteAccountData,
  deleteHistory,
  ensureBuiltInConfig,
  ensureValidSession,
  extractTabInfo,
  fetchActiveUsersForDomain,
  fetchLearningModuleConnectedUsers,
  fetchLearningModuleConnectionsForCurrentUser,
  fetchLearningModules,
  fetchPendingLearningModuleConnectionsForCurrentUser,
  fetchTopSites,
  fetchUsersOnTopSite,
  getCachedUser,
  getCurrentUser,
  getDefaultPrivacySettings,
  getPrivacySettingsRecord,
  getProfile,
  getPublicProfile,
  getRetentionOptions,
  hasCompleteProfile,
  normalizeProfileVisibility,
  normalizeRetentionSelection,
  parseRetentionSelection,
  readConfig,
  saveUserMetadataProfileSnapshot,
  syncPendingLearningModuleConnectionsForCurrentUser,
  signIn,
  signOut,
  signUp,
  updatePresenceSharingPreference,
  uploadProfileImage,
  upsertPrivacySettings,
  upsertProfile
} from './supabase.js';
import { privacyHtml } from './privacy.js';
import { renderRichText } from './math-renderer.js';
import { getStarterLearningModules } from './learning-modules.js';

const HISTORY_MODE_OPTIONS = [
  { value: 'none', label: 'Store no history' },
  { value: 'domain', label: 'Domain only (recommended)' },
  { value: 'path', label: 'Domain and path' },
  { value: 'full_url', label: 'Full URL' }
];

const POPUP_MIN_WIDTH = 420;

function enforcePopupWidth() {
  if (typeof document === 'undefined' || isDesktopWorkspace) {
    return;
  }

  const widthValue = `${POPUP_MIN_WIDTH}px`;
  document.documentElement.style.width = widthValue;
  document.documentElement.style.minWidth = widthValue;
  document.body.style.width = widthValue;
  document.body.style.minWidth = widthValue;

  const shell = document.querySelector('.popup-dashboard');
  if (shell) {
    shell.style.width = '100%';
    shell.style.minWidth = `calc(${widthValue} - 36px)`;
  }
}

const UI_TEXT = {
  topSiteDetailSubheading: "Currently active users on the selected website. URL detail below reflects each user's privacy scope.",
  desktopLaunchError: 'Unable to open the full desktop version right now.'
};

function createFormState(retentionSelection = '') {
  const normalizedSelection = retentionSelection ? normalizeRetentionSelection(retentionSelection) : null;
  return {
    retentionSelection: normalizedSelection?.machineValue || normalizedSelection?.displayLabel || '',
    parsedRetention: retentionSelection ? parseRetentionSelection(retentionSelection) : null,
    lastError: ''
  };
}

const state = {
  user: null,
  profile: null,
  privacy: getDefaultPrivacySettings(),
  hasSavedPrivacySettings: false,
  learningModules: [],
  learningModulesLoading: false,
  learningModulesError: '',
  learningModulesStatus: {
    source: 'boot',
    phase: 'booting',
    contentState: 'booting',
    backendState: 'booting',
    backendAvailability: 'checking',
    authActionState: 'signed_out',
    persistenceAvailable: false,
    setupRequired: false,
    statusBadge: 'Booting…',
    statusTone: 'neutral',
    statusMessage: 'Preparing Learning Modules…',
    fallbackDetail: '',
    errorMessage: ''
  },
  learningModulesLoadCycle: 0,
  learningModuleBackendDiagnostics: null,
  learningModulesLiveFailure: null,
  expandedLearningModules: new Set(),
  expandedLearningTopics: new Set(),
  expandedLearningModuleUsers: new Set(),
  moduleConnectionIds: new Set(),
  pendingModuleConnectionIds: new Set(),
  pendingLocalModuleConnectionIds: new Set(),
  learningModuleUsersBySlug: new Map(),
  learningModuleUsersLoading: new Set(),
  learningModuleUsersErrors: new Map(),
  activeLearningView: 'moduleList',
  activeModuleId: '',
  activeTopicIndex: 0,
  activeCardIndex: 0,
  activeSubcardIndex: 0,
  learningModuleCompleted: false,
  formState: {
    consent: createFormState(),
    settings: createFormState(),
    dataControls: createFormState()
  },
  presenceAvailability: {
    canUsePresenceToggle: false,
    canViewPresenceData: false,
    note: 'Enable presence sharing to see active members on this site.'
  },
  tabInfo: null,
  topSites: [],
  detailDomain: null,
  pendingAvatar: null,
  refreshVersion: 0,
  topSitesPollId: null,
  activeUsersRequestId: 0,
  topSitesRequestId: 0,
  detailUsersRequestId: 0,
  contextRefreshId: null,
  refreshTimerId: null,
  refreshPromise: null,
  refreshQueuedReason: null,
  caches: {
    activeUsers: new Map(),
    topSites: { data: null, fetchedAt: 0 },
    detailUsers: new Map()
  },
  lastRenderedDomain: '',
  lastTopSitesSignature: '',
  lastPresenceSignature: '',
  lastProfileSummarySignature: '',
  lastLearningModulesStatusSignature: '',
  lastLearningModulesListSignature: '',
  lastProfileFormSignature: '',
  lastProfileWorkspaceSignature: '',
  lastDataControlsSignature: '',
  lastCurrentSiteSummarySignature: '',
  lastActiveUsersSignature: '',
  lastSupabaseDiagnosticsSignature: '',
  learningModulesInitialized: false,
  lastLearningModulesUserId: '',
  profileDrawerOpen: false,
  isNavExpanded: false,
  activeSection: 'currentSiteTab',
  supabaseDiagnostics: null
};

const els = {};
const isDesktopWorkspace = document.body.classList.contains('desktop-body');
const ACTIVE_CONTEXT_STORAGE_KEY = 'connectme-active-context';
const CONTEXT_FALLBACK_REFRESH_MS = isDesktopWorkspace ? 12000 : 15000;
const WORKSPACE_LABEL = isDesktopWorkspace ? 'Desktop' : 'Popup';
const APP_INITIALIZING_CLASS = 'app-initializing';

const SHARED_CARD_DEBUG_ENABLED = false;
const FETCH_TTL_MS = {
  activeUsers: 12000,
  topSites: 18000,
  detailUsers: 12000
};
const REFRESH_DEBOUNCE_MS = 120;
const POLL_INTERVAL_MS = isDesktopWorkspace ? 45000 : 60000;

const DESKTOP_NAV_WIDTH = {
  collapsed: 'clamp(72px, 6vw, 88px)',
  expanded: 'clamp(220px, 22vw, 272px)'
};

const learningModuleFlatCardCache = new Map();

function setUiInitializationState(isReady) {
  // Fix: keep desktop shell hidden until async auth/state hydration finishes to prevent login-state flicker.
  document.body.classList.toggle(APP_INITIALIZING_CLASS, !isReady);
}

function $(id) {
  return document.getElementById(id);
}

function stringifyForLog(value) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
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

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function buildLearningModuleUuidLookup() {
  return new Map((state.learningModules || [])
    .filter((module) => module?.slug && isUuidLike(module?.db_id || module?.id))
    .map((module) => [module.slug, module.db_id || module.id]));
}

function resolveLearningModuleUuid(moduleId = '', moduleSlug = '') {
  const lookup = buildLearningModuleUuidLookup();
  const directUuid = isUuidLike(moduleId) ? moduleId : '';
  const mappedUuid = moduleSlug ? (lookup.get(moduleSlug) || '') : '';
  return {
    resolvedUuid: directUuid || mappedUuid || '',
    moduleUuidBySlug: lookup
  };
}

function hasLiveUuidForEveryRenderedModule(modules = []) {
  if (!Array.isArray(modules) || !modules.length) {
    return false;
  }
  return modules.every((module) => isUuidLike(module?.db_id || module?.id));
}

function formatActiveUserLabel(count) {
  const safeCount = Number(count) || 0;
  return `${safeCount} active user${safeCount === 1 ? '' : 's'}`;
}

function renderActiveUserBadge(count) {
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  const userLabel = safeCount === 1 ? 'user' : 'users';
  const ariaLabel = formatActiveUserLabel(safeCount);

  return `
    <span class="badge active-user-badge" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(ariaLabel)}">
      <span class="active-user-badge-count">${escapeHtml(String(safeCount))}</span>
      <span class="active-user-badge-text">active</span>
      <span class="active-user-badge-text">${userLabel}</span>
    </span>
  `;
}

function formatHistoryModeLabel(mode) {
  switch (mode) {
    case 'full_url':
      return 'Full URL';
    case 'path':
      return 'Domain and path';
    case 'none':
      return 'No stored history';
    default:
      return 'Domain only';
  }
}

function getCurrentSiteScope() {
  return buildScopedSiteContext(state.tabInfo, state.privacy);
}

function maskValue(value = '', { start = 8, end = 6 } = {}) {
  const stringValue = String(value || '').trim();
  if (!stringValue) {
    return 'Unavailable';
  }
  if (stringValue.length <= start + end + 3) {
    return `${stringValue.slice(0, Math.max(0, start))}•••`;
  }
  return `${stringValue.slice(0, start)}•••${stringValue.slice(-end)}`;
}

function maskUrlPreview(url = '') {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${maskValue(parsed.hostname, { start: 6, end: 8 })}`;
  } catch (_error) {
    return maskValue(url, { start: 6, end: 8 });
  }
}

function buildInfoTile(label, value, note = '', tone = '') {
  const pillTone = tone ? `pill ${tone}` : 'pill';
  const resolvedValue = tone ? `<span class="${pillTone}">${escapeHtml(value)}</span>` : `<span class="info-tile-value">${escapeHtml(value)}</span>`;
  return `
    <article class="info-tile">
      <span class="info-tile-label">${escapeHtml(label)}</span>
      ${tone ? resolvedValue : `<span class="info-tile-value">${escapeHtml(value)}</span>`}
      ${note ? `<span class="info-tile-note">${escapeHtml(note)}</span>` : ''}
    </article>
  `;
}

function getPresenceVisibilityScopeText() {
  if (!state.user) {
    return 'Signed out';
  }
  if (state.privacy.invisibleModeEnabled) {
    return 'Invisible mode';
  }
  if (!state.privacy.presenceSharingEnabled) {
    return 'Hidden from others';
  }
  return 'Visible to active members on the same domain';
}

async function confirmDangerousAction(message) {
  return window.confirm(message);
}

function renderCurrentSiteUrlSummary() {
  const scoped = getCurrentSiteScope();
  const signature = JSON.stringify({
    domain: scoped?.domain || '',
    pathDisplay: scoped?.pathDisplay || '',
    fullUrl: scoped?.fullUrl || '',
    canShowPath: Boolean(scoped?.canShowPath),
    canShowFullUrl: Boolean(scoped?.canShowFullUrl),
    privacyDescription: scoped?.privacyDescription || ''
  });
  if (state.lastCurrentSiteSummarySignature === signature) {
    return;
  }
  state.lastCurrentSiteSummarySignature = signature;

  if (!scoped) {
    els.currentSitePrivacyNote.textContent = 'Open a supported website to view current site details.';
    els.currentSiteUrlSummary.innerHTML = '<div class="empty-state">Open a supported website to view current site details.</div>';
    if (els.copyCurrentUrlButton) {
      els.copyCurrentUrlButton.disabled = true;
    }
    return;
  }

  const rows = [
    `<div class="url-row"><span class="url-label">Tracking scope</span><code class="url-value">${escapeHtml(formatHistoryModeLabel(state.privacy.historyMode))}</code></div>`,
    `<div class="url-row"><span class="url-label">Domain</span><code class="url-value">${escapeHtml(scoped.domain)}</code></div>`
  ];

  if (scoped.canShowPath) {
    rows.push(`<div class="url-row"><span class="url-label">Domain + path</span><code class="url-value break-anywhere">${escapeHtml(scoped.pathDisplay)}</code></div>`);
  }

  if (scoped.canShowFullUrl) {
    rows.push(`<div class="url-row"><span class="url-label">Full URL</span><code class="url-value break-anywhere">${escapeHtml(scoped.fullUrl)}</code></div>`);
  }

  if (!scoped.canShowPath && !scoped.canShowFullUrl) {
    rows.push('<div class="callout subtle small-text">For extra URL detail, enable a broader history scope in Settings or Consent.</div>');
  }

  els.currentSitePrivacyNote.textContent = scoped.privacyDescription;
  els.currentSiteUrlSummary.innerHTML = rows.join('');
  if (els.copyCurrentUrlButton) {
    els.copyCurrentUrlButton.disabled = false;
    els.copyCurrentUrlButton.dataset.copyValue = scoped.displayUrl;
  }
}

function renderTrackedPageDetail(user) {
  const fullUrl = String(user?.full_url || '').trim();
  const path = String(user?.path || '').trim();
  const domain = String(user?.domain || '').trim();
  if (!domain && !path && !fullUrl) {
    return '';
  }

  const rows = [`<div class="url-row compact"><span class="url-label">Domain</span><code class="url-value">${escapeHtml(domain || 'Unavailable')}</code></div>`];
  if (path) {
    rows.push(`<div class="url-row compact"><span class="url-label">Domain + path</span><code class="url-value break-anywhere">${escapeHtml(`${domain}${path}`)}</code></div>`);
  }
  if (fullUrl) {
    rows.push(`<div class="url-row compact"><span class="url-label">Full URL</span><code class="url-value break-anywhere">${escapeHtml(fullUrl)}</code></div>`);
  }

  return `<div class="tracked-page-card"><div class="muted small-text">Visible tracked page detail</div>${rows.join('')}</div>`;
}

function bumpRefreshVersion() {
  state.refreshVersion += 1;
  return state.refreshVersion;
}

function isStaleRefresh(version) {
  return version !== state.refreshVersion;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCardTypeLabel(cardType = 'concept') {
  return String(cardType || 'concept')
    .split('-')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function getFlattenedModuleCards(module) {
  if (!module?.id) {
    return [];
  }

  const signature = `${module.id}:${(module.topics || []).map((topic) => `${topic.id}:${(topic.cards || []).length}`).join('|')}`;
  const cached = learningModuleFlatCardCache.get(module.id);
  if (cached?.signature === signature) {
    return cached.flatCards;
  }

  const flatCards = (module.topics || []).flatMap((topic, topicIndex) => getLearningModuleTopicCards(topic).map((card, cardIndex) => ({
    topic,
    card,
    topicIndex,
    cardIndex
  })));

  learningModuleFlatCardCache.set(module.id, { signature, flatCards });
  return flatCards;
}

function getModuleConnectionDisplay(moduleId) {
  const queued = state.pendingLocalModuleConnectionIds.has(moduleId);
  const connected = state.moduleConnectionIds.has(moduleId) && !queued;
  return {
    connected,
    queued,
    isSaved: connected || queued
  };
}

function renderChevronIcon() {
  return `
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M5.5 7.5 10 12l4.5-4.5" />
    </svg>
  `;
}

function renderConnectionIcon() {
  return `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M8.5 8.5h-1a4.5 4.5 0 0 0 0 9h3" />
      <path d="M15.5 8.5h1a4.5 4.5 0 1 1 0 9h-3" />
      <path d="M9 12h6" />
      <path d="m10 9 2 3-2 3" />
      <path d="m14 9-2 3 2 3" />
    </svg>
  `;
}

function renderModuleUserAvatar(user = {}) {
  if (user?.avatar_url) {
    return `<img class="avatar avatar-small" src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(user.public_name || 'Connected user')} avatar" />`;
  }

  const initials = String(user?.public_name || 'Connect.Me member')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'CM';

  return `<div class="avatar avatar-small">${escapeHtml(initials)}</div>`;
}

function setStatus(message, type = 'info') {
  if (!message) {
    els.statusBanner.textContent = '';
    els.statusBanner.className = 'status-banner hidden';
    return;
  }
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner ${type}`;
}

async function openDesktopWorkspace() {
  const desktopUrl = chrome.runtime.getURL('desktop.html');

  try {
    if (chrome.runtime?.sendMessage) {
      const response = await chrome.runtime.sendMessage({
        type: 'OPEN_DESKTOP_WINDOW',
        reason: isDesktopWorkspace ? 'desktop-relaunch' : 'popup-launch'
      });

      if (response?.ok) {
        return true;
      }

      throw new Error(response?.error || UI_TEXT.desktopLaunchError);
    }

    if (chrome.windows?.create) {
      await chrome.windows.create({
        url: desktopUrl,
        type: 'popup',
        focused: true,
        width: 1280,
        height: 920
      });
      return true;
    }

    const popupWindow = window.open(
      desktopUrl,
      '_blank',
      'popup=yes,noopener,width=1280,height=920'
    );
    if (popupWindow) {
      return true;
    }

    window.location.href = desktopUrl;
    return true;
  } catch (error) {
    logStructured('error', '[Connect.Me] Desktop workspace launch failed', {
      message: error?.message || String(error),
      desktopUrl
    });
    setStatus(error?.message || UI_TEXT.desktopLaunchError, 'error');
    return false;
  }
}

function setInlineValidation(message = '') {
  els.privacyValidationMessage.textContent = message;
  els.privacyValidationMessage.classList.toggle('hidden', !message);
  if (message) {
    els.privacyValidationMessage.classList.remove('subtle');
    els.privacyValidationMessage.classList.add('error');
  } else {
    els.privacyValidationMessage.classList.add('subtle');
    els.privacyValidationMessage.classList.remove('error');
  }
}

function getRetentionSelectionFromSavedPrivacy(privacy = state.privacy) {
  return `${privacy.retentionValue}|${privacy.retentionUnit}`;
}

function computePresenceAvailability(privacy = state.privacy, profile = state.profile, user = state.user) {
  const loggedIn = Boolean(user);
  const profileComplete = hasCompleteProfile(profile);
  const consentSaved = Boolean(privacy?.consentGranted);
  const presencePreferenceSaved = Boolean(privacy?.presenceSharingEnabled);
  const invisibleModeEnabled = Boolean(privacy?.invisibleModeEnabled);

  let note = 'Enable presence sharing to see active members on this site.';
  if (!loggedIn) {
    note = 'Log in to use live presence features.';
  } else if (!consentSaved) {
    note = 'Save consent settings before presence can begin.';
  } else if (!profileComplete) {
    note = 'Finish your full profile to enable presence sharing.';
  } else if (invisibleModeEnabled) {
    note = 'Invisible Mode is on. You can browse without appearing to other users.';
  } else if (!presencePreferenceSaved) {
    note = 'Presence sharing is currently off.';
  } else {
    note = 'Presence sharing is on. Only currently active users are shown.';
  }

  return {
    loggedIn,
    consentSaved,
    profileComplete,
    presencePreferenceSaved,
    invisibleModeEnabled,
    canUsePresenceToggle: Boolean(loggedIn && consentSaved && profileComplete),
    canViewPresenceData: Boolean(loggedIn && consentSaved && profileComplete && presencePreferenceSaved && !invisibleModeEnabled),
    note
  };
}

function updatePresenceAvailability() {
  state.presenceAvailability = computePresenceAvailability();
  logStructured('log', '[Connect.Me] Presence availability updated', state.presenceAvailability);
}

function getRetentionSelectionSnapshot(select) {
  const selectedOption = select?.selectedOptions?.[0] || null;
  return {
    value: select?.value ?? '',
    label: selectedOption?.textContent?.trim() || '',
    selected: selectedOption
      ? {
          value: selectedOption.value ?? select?.value ?? '',
          label: selectedOption.textContent?.trim() || ''
        }
      : null
  };
}

function formatRetentionSelectionForMessage(selection) {
  const normalized = normalizeRetentionSelection(selection);
  return normalized.displayLabel || normalized.machineValue || 'empty selection';
}

function syncFormState(source, selection, { clearValidation = false } = {}) {
  const normalizedSelection = normalizeRetentionSelection(selection);
  const parsedRetention = parseRetentionSelection(selection);
  state.formState[source] = {
    ...state.formState[source],
    retentionSelection: normalizedSelection.machineValue || normalizedSelection.displayLabel || '',
    parsedRetention,
    lastError: parsedRetention ? '' : state.formState[source]?.lastError || ''
  };

  logStructured('log', '[Connect.Me] Retention form state synced', {
    source,
    rawSelection: selection,
    normalizedSelection,
    parsedRetention
  });

  if (parsedRetention) {
    setFormError(source, '');
  }

  if (clearValidation && parsedRetention) {
    setInlineValidation('');
  }

  return parsedRetention;
}

function setFormError(source, message = '') {
  state.formState[source] = {
    ...state.formState[source],
    lastError: message
  };
}

function populateSelect(select, options, selectedValue) {
  select.innerHTML = '';
  options.forEach((option) => {
    const el = document.createElement('option');
    const value = option.machineValue ?? option.value ?? '';
    el.value = value;
    el.textContent = option.label;
    el.selected = value === selectedValue;
    select.appendChild(el);
  });
}

function normalizeContextToTabInfo(context) {
  if (!context?.domain) {
    return null;
  }

  const derived = context.url ? extractTabInfo(context.url) : null;
  return {
    url: context.url || derived?.url || '',
    domain: context.domain || derived?.domain || '',
    path: context.path || derived?.path || '/',
    title: context.title || derived?.title || context.domain,
    privacyDescription: context.privacyDescription || null,
    effectiveHistoryMode: context.effectiveHistoryMode || null,
    requestedHistoryMode: context.requestedHistoryMode || null,
    trackedDisplayUrl: context.trackedDisplayUrl || context.domain,
    detectedAt: context.detectedAt || null
  };
}

async function readStoredActiveContext() {
  const result = await chrome.storage.local.get(ACTIVE_CONTEXT_STORAGE_KEY);
  return result?.[ACTIVE_CONTEXT_STORAGE_KEY] || null;
}

async function getCurrentTabInfo() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' });
    if (response?.ok) {
      const fromBackground = normalizeContextToTabInfo(response.context);
      if (fromBackground) {
        return fromBackground;
      }
    }
  } catch (error) {
    logStructured('warn', `[Connect.Me] ${WORKSPACE_LABEL} current-site fetch fell back to storage`, { message: error?.message || String(error) });
  }

  const storedContext = normalizeContextToTabInfo(await readStoredActiveContext().catch(() => null));
  if (storedContext) {
    return storedContext;
  }

  try {
    await chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: isDesktopWorkspace ? 'desktop-fallback-sync' : 'popup-fallback-sync' });
    const retriedContext = normalizeContextToTabInfo(await readStoredActiveContext().catch(() => null));
    if (retriedContext) {
      return retriedContext;
    }
  } catch (error) {
    logStructured('warn', `[Connect.Me] ${WORKSPACE_LABEL} fallback site refresh failed`, { message: error?.message || String(error) });
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  const fallbackTab = activeTabs.find((tab) => extractTabInfo(tab?.url));
  return extractTabInfo(fallbackTab?.url);
}

function getInitials(profile) {
  const first = profile?.first_name?.[0] || 'C';
  const last = profile?.last_name?.[0] || 'M';
  return `${first}${last}`.toUpperCase();
}

function parseVisibilityValue(value) {
  return String(value) === 'true';
}

function getDisplayName(profile, { fallback = 'Connect.Me member' } = {}) {
  const firstName = String(profile?.first_name || '').trim();
  const lastName = String(profile?.last_name || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || firstName || lastName || fallback;
}

function renderAvatar(profile, size = 'medium') {
  if (profile?.avatar_url) {
    return `<img class="avatar avatar-${size}" src="${escapeHtml(profile.avatar_url)}" alt="${escapeHtml(getDisplayName(profile, { fallback: 'User' }))} avatar" />`;
  }
  return `<div class="avatar avatar-${size}">${escapeHtml(getInitials(profile))}</div>`;
}

function renderProfilePrompt() {
  if (!state.user) {
    els.profilePrompt.textContent = 'Complete your full profile before using community presence features.';
    return;
  }
  els.profilePrompt.textContent = hasCompleteProfile(state.profile)
    ? 'Your profile is complete. You can update it any time.'
    : 'Your profile is incomplete. Presence sharing stays disabled until all required profile fields are completed.';
}

function setProfileDrawerOpen(nextOpen) {
  if (!isDesktopWorkspace || !els.profileDrawer || !els.profileDrawerBackdrop || !els.profilePanel) {
    return;
  }

  const loggedIn = Boolean(state.user);
  const shouldOpen = Boolean(nextOpen && loggedIn);
  state.profileDrawerOpen = shouldOpen;

  els.profileDrawer.classList.toggle('is-open', shouldOpen);
  els.profileDrawer.setAttribute('aria-hidden', String(!shouldOpen));
  els.profileDrawerBackdrop.classList.toggle('is-visible', shouldOpen);
  els.profileDrawerBackdrop.setAttribute('aria-hidden', String(!shouldOpen));
  els.profilePanel.classList.toggle('hidden', !loggedIn);
  document.body.classList.toggle('drawer-open', shouldOpen);

  if (els.dashboardShell) {
    if (shouldOpen) {
      els.dashboardShell.setAttribute('inert', '');
      els.dashboardShell.setAttribute('aria-hidden', 'true');
    } else {
      els.dashboardShell.removeAttribute('inert');
      els.dashboardShell.removeAttribute('aria-hidden');
    }
  }
}

function renderAuthState() {
  const loggedIn = Boolean(state.user);
  els.authPanel.classList.toggle('hidden', loggedIn);
  els.consentPanel.classList.toggle('hidden', !loggedIn || state.hasSavedPrivacySettings);

  if (els.editProfileButton) {
    els.editProfileButton.classList.toggle('hidden', !loggedIn);
  }
  if (els.profileSummaryEditButton) {
    els.profileSummaryEditButton.classList.toggle('hidden', !loggedIn);
  }
  if (els.editProfileSectionButton) {
    els.editProfileSectionButton.classList.toggle('hidden', !loggedIn);
  }
  if (els.editProfileFromDataControls) {
    els.editProfileFromDataControls.classList.toggle('hidden', !loggedIn);
  }

  if (isDesktopWorkspace) {
    setProfileDrawerOpen(loggedIn && state.profileDrawerOpen);
    return;
  }

  els.profilePanel.classList.toggle('hidden', !loggedIn);
}

function renderProfileForm() {
  const visibility = normalizeProfileVisibility(state.profile || {});
  const formSignature = JSON.stringify({
    userId: state.user?.id || '',
    firstName: state.profile?.first_name || '',
    lastName: state.profile?.last_name || '',
    placeOfWork: state.profile?.place_of_work || '',
    education: state.profile?.education || '',
    currentLocation: state.profile?.current_location || '',
    headline: state.profile?.headline || '',
    bio: state.profile?.bio || '',
    avatarUrl: state.profile?.avatar_url || '',
    avatarPath: state.profile?.avatar_path || '',
    visibility
  });
  if (state.lastProfileFormSignature === formSignature) {
    return;
  }
  state.lastProfileFormSignature = formSignature;

  els.firstName.value = state.profile?.first_name || '';
  els.lastName.value = state.profile?.last_name || '';
  els.placeOfWork.value = state.profile?.place_of_work || '';
  els.education.value = state.profile?.education || '';
  els.currentLocation.value = state.profile?.current_location || '';
  els.headline.value = state.profile?.headline || '';
  els.bio.value = state.profile?.bio || '';
  els.shareAvatar.value = String(visibility.share_avatar);
  els.shareFirstName.value = String(visibility.share_first_name);
  els.shareLastName.value = String(visibility.share_last_name);
  els.sharePlaceOfWork.value = String(visibility.share_place_of_work);
  els.shareEducation.value = String(visibility.share_education);
  els.shareCurrentLocation.value = String(visibility.share_current_location);
  els.shareBio.value = String(visibility.share_bio);
  const nextAvatarMarkup = renderAvatar(state.profile, 'large');
  if (els.avatarPreview.dataset.renderedAvatar !== nextAvatarMarkup) {
    els.avatarPreview.innerHTML = nextAvatarMarkup;
    els.avatarPreview.dataset.renderedAvatar = nextAvatarMarkup;
  }
  renderProfilePrompt();
}

function renderProfileSummary() {
  const summarySignature = JSON.stringify({
    userId: state.user?.id || '',
    profile: state.profile || null
  });
  if (state.lastProfileSummarySignature === summarySignature) {
    return;
  }
  state.lastProfileSummarySignature = summarySignature;

  if (!state.user) {
    els.selfProfileSummary.innerHTML = '<div class="empty-state">Sign in to view your profile.</div>';
    return;
  }
  if (!state.profile) {
    els.selfProfileSummary.innerHTML = '<div class="empty-state">Create your profile to unlock presence and community features.</div>';
    return;
  }

  const complete = hasCompleteProfile(state.profile);
  els.selfProfileSummary.innerHTML = `
    <div class="user-card self-card">
      <div class="user-row">
        ${renderAvatar(state.profile, 'medium')}
        <div>
          <strong>${escapeHtml(state.profile.first_name)} ${escapeHtml(state.profile.last_name)}</strong>
          <div class="muted">${escapeHtml(state.profile.headline || `${state.profile.place_of_work} · ${state.profile.education}`)}</div>
        </div>
      </div>
      <div class="detail-grid">
        <span><strong>Work:</strong> ${escapeHtml(state.profile.place_of_work)}</span>
        <span><strong>Education:</strong> ${escapeHtml(state.profile.education)}</span>
        <span><strong>Location:</strong> ${escapeHtml(state.profile.current_location)}</span>
      </div>
      <p>${escapeHtml(state.profile.bio || 'No bio added yet.')}</p>
      <div class="visibility-list muted small-text">
        <span>Public avatar: ${state.profile?.share_avatar ? 'Share' : 'Not share'}</span>
        <span>Public first name: ${state.profile?.share_first_name ? 'Share' : 'Not share'}</span>
        <span>Public last name: ${state.profile?.share_last_name ? 'Share' : 'Not share'}</span>
        <span>Public work: ${state.profile?.share_place_of_work ? 'Share' : 'Not share'}</span>
        <span>Public education: ${state.profile?.share_education ? 'Share' : 'Not share'}</span>
        <span>Public location: ${state.profile?.share_current_location ? 'Share' : 'Not share'}</span>
        <span>Public bio: ${state.profile?.share_bio ? 'Share' : 'Not share'}</span>
      </div>
      <span class="pill ${complete ? 'success' : 'warning'}">${complete ? 'Profile complete' : 'Profile incomplete'}</span>
    </div>
  `;
}

function renderDomainBadge() {
  const domain = state.tabInfo?.domain || 'No website detected';
  if (els.currentDomainBadge) {
    els.currentDomainBadge.textContent = domain;
  }
  if (els.desktopDomainMetric) {
    els.desktopDomainMetric.textContent = domain;
  }
}

function renderPresenceControls() {
  updatePresenceAvailability();
  const availability = state.presenceAvailability;
  const presencePreferenceSaved = Boolean(state.privacy.presenceSharingEnabled);

  els.presenceQuickToggle.checked = presencePreferenceSaved;
  els.presenceSharingInline.checked = presencePreferenceSaved;
  els.presenceSharingEnabled.checked = presencePreferenceSaved;
  els.invisibleModeEnabled.checked = Boolean(state.privacy.invisibleModeEnabled);

  els.presenceQuickToggle.disabled = !availability.canUsePresenceToggle;
  els.presenceSharingInline.disabled = !availability.canUsePresenceToggle;

  els.presenceStateNote.textContent = availability.note;
}

function renderPrivacySettingsForm() {
  els.trackingConsent.checked = Boolean(state.privacy.consentGranted);
  els.trackingEnabled.checked = Boolean(state.privacy.trackingEnabled);
  els.presenceSharingEnabled.checked = Boolean(state.privacy.presenceSharingEnabled);
  els.invisibleModeEnabled.checked = Boolean(state.privacy.invisibleModeEnabled);
  populateSelect(els.historyMode, HISTORY_MODE_OPTIONS, state.privacy.historyMode);
  populateSelect(els.retentionSelect, getRetentionOptions(), getRetentionSelectionFromSavedPrivacy());
  syncFormState('settings', els.retentionSelect.value, { clearValidation: true });
}

function renderDataControlsForm() {
  if (!isDesktopWorkspace || !els.dataControlsForm) {
    return;
  }

  els.dataTrackingEnabled.checked = Boolean(state.privacy.trackingEnabled);
  els.dataPresenceSharingEnabled.checked = Boolean(state.privacy.presenceSharingEnabled);
  els.dataInvisibleModeEnabled.checked = Boolean(state.privacy.invisibleModeEnabled);
  populateSelect(els.dataHistoryMode, HISTORY_MODE_OPTIONS, state.privacy.historyMode);
  populateSelect(els.dataRetentionSelect, getRetentionOptions(), getRetentionSelectionFromSavedPrivacy());
  syncFormState('dataControls', els.dataRetentionSelect.value, { clearValidation: true });
  els.dataControlsValidationMessage.textContent = '';
  els.dataControlsValidationMessage.classList.add('hidden');
}

function renderConsentForm() {
  populateSelect(els.consentHistoryMode, HISTORY_MODE_OPTIONS, state.privacy.historyMode || 'domain');
  populateSelect(els.consentRetention, getRetentionOptions(), getRetentionSelectionFromSavedPrivacy());
  els.consentTrackingEnabled.checked = Boolean(state.privacy.trackingEnabled);
  els.consentPresenceEnabled.checked = Boolean(state.privacy.presenceSharingEnabled);
  els.consentInvisibleMode.checked = Boolean(state.privacy.invisibleModeEnabled);
  syncFormState('consent', els.consentRetention.value, { clearValidation: true });
}

function renderPrivacyTab() {
  els.privacyPolicyContent.innerHTML = privacyHtml;
}

async function runSupabaseDiagnostics({ reason = 'manual', recheckConfig = false } = {}) {
  if (!isDesktopWorkspace || !els.supabaseProjectStatus) {
    return;
  }

  const config = recheckConfig ? await ensureBuiltInConfig() : await readConfig();
  let authSettings = null;
  let diagnosticsState = 'success';
  let diagnosticsMessage = 'Supabase client configuration is available.';

  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      method: 'GET',
      headers: { apikey: config.anonKey }
    });

    if (!response.ok) {
      throw new Error(`Auth settings request failed (${response.status})`);
    }

    authSettings = await response.json();
  } catch (error) {
    diagnosticsState = 'warning';
    diagnosticsMessage = error.message || 'Unable to reach Supabase right now.';
  }

  let sessionState = 'Signed out';
  let provider = 'Unavailable';
  let persistence = 'No active session';

  try {
    const session = await ensureValidSession();
    if (session?.access_token) {
      sessionState = 'Active session';
      provider = state.user?.app_metadata?.provider || state.user?.identities?.[0]?.provider || 'email';
      persistence = session.refresh_token ? 'Refresh token stored locally' : 'Session only';
    }
  } catch (error) {
    sessionState = 'Session check failed';
    provider = 'Unavailable';
    persistence = error.message || 'Unable to verify session persistence';
  }

  state.supabaseDiagnostics = {
    checkedAt: new Date().toISOString(),
    reason,
    configPresent: Boolean(config.url && config.anonKey),
    authEnabled: authSettings ? 'Enabled' : 'Unknown',
    diagnosticsState,
    diagnosticsMessage,
    maskedUrl: maskUrlPreview(config.url),
    anonKeyPresent: Boolean(config.anonKey),
    maskedAnonKey: maskValue(config.anonKey, { start: 10, end: 6 }),
    sessionState,
    provider,
    persistence
  };

  renderSupabaseConfiguration();
}

function renderSupabaseConfiguration() {
  if (!isDesktopWorkspace || !els.supabaseProjectStatus) {
    return;
  }

  const diagnostics = state.supabaseDiagnostics || {
    checkedAt: '',
    configPresent: false,
    authEnabled: 'Unknown',
    diagnosticsState: 'warning',
    diagnosticsMessage: 'Diagnostics have not been run yet.',
    maskedUrl: 'Unavailable',
    anonKeyPresent: false,
    maskedAnonKey: 'Unavailable',
    sessionState: 'Signed out',
    provider: 'Unavailable',
    persistence: 'No active session'
  };
  const diagnosticsSignature = JSON.stringify({ diagnostics, userEmail: state.user?.email || '' });
  if (state.lastSupabaseDiagnosticsSignature === diagnosticsSignature) {
    return;
  }
  state.lastSupabaseDiagnosticsSignature = diagnosticsSignature;

  const tableMarkup = [
    buildInfoTile('profiles', 'Configured', 'Stores public profile fields and visibility flags.'),
    buildInfoTile('active_presence', 'Configured', 'Used for live presence / active session style tracking.'),
    buildInfoTile('browsing_history', 'Configured', 'Stores history according to consent and retention settings.'),
    buildInfoTile('user_privacy_settings', 'Configured', 'Acts as the consent and privacy settings record.'),
    buildInfoTile('learning_modules', 'Configured', 'Stores seeded learning-module metadata.'),
    buildInfoTile('learning_module_topics', 'Configured', 'Stores ordered topics for each learning module.'),
    buildInfoTile('learning_module_cards', 'Configured', 'Stores ordered guided lesson cards and structured content for each topic.'),
    buildInfoTile('learning_module_connections', 'Configured', 'Stores user-to-module assignments with duplicate prevention.'),
    buildInfoTile('top_active_sites', 'Derived view', 'Aggregates currently active domains.'),
    buildInfoTile('shared_sites / site_visibility', 'Not in current build', 'No separate shared-sites table is defined in the shipped schema.')
  ].join('');

  els.supabaseProjectStatus.innerHTML = [
    buildInfoTile('Project connection', diagnostics.configPresent ? 'Configured' : 'Disconnected', diagnostics.configPresent ? 'Built-in project details are available to the extension.' : 'Required Supabase configuration is missing.', diagnostics.configPresent ? 'success' : 'error'),
    buildInfoTile('Project URL preview', diagnostics.maskedUrl, 'Shown in masked form only.'),
    buildInfoTile('Anon key present', diagnostics.anonKeyPresent ? 'Yes' : 'No', diagnostics.anonKeyPresent ? diagnostics.maskedAnonKey : 'No anon key could be loaded.', diagnostics.anonKeyPresent ? 'success' : 'error'),
    buildInfoTile('Auth enabled', diagnostics.authEnabled, 'Derived from the Supabase Auth settings endpoint.', diagnostics.authEnabled === 'Enabled' ? 'success' : 'warning')
  ].join('');

  els.supabaseDiagnosticsStatus.innerHTML = [
    buildInfoTile('Client initialization', diagnostics.diagnosticsState === 'success' ? 'Healthy' : 'Needs attention', diagnostics.diagnosticsMessage, diagnostics.diagnosticsState === 'success' ? 'success' : 'warning'),
    buildInfoTile('Last checked', diagnostics.checkedAt ? new Date(diagnostics.checkedAt).toLocaleString() : 'Not checked yet', 'Use the buttons above to refresh or retest the backend.'),
    buildInfoTile('Readable state', diagnostics.diagnosticsState === 'success' ? 'Connection check passed' : 'Connection check returned an error', diagnostics.reason ? `Trigger: ${diagnostics.reason}` : '')
  ].join('');

  els.supabaseTablesOverview.innerHTML = tableMarkup;
  els.supabaseStorageOverview.innerHTML = [
    buildInfoTile('avatars bucket', 'Expected', 'Profile images upload to the public avatars bucket.'),
    buildInfoTile('Additional buckets', 'None detected', 'No other storage buckets are referenced by the current workspace code.')
  ].join('');

  els.supabaseAuthSummary.innerHTML = [
    buildInfoTile('Current user session', diagnostics.sessionState, state.user?.email ? `User: ${state.user.email}` : 'Sign in to see session-backed state.'),
    buildInfoTile('Provider type', diagnostics.provider, 'Derived from the active user session when available.'),
    buildInfoTile('Login persistence', diagnostics.persistence, 'Sessions are stored locally and refreshed when possible.')
  ].join('');

  els.supabaseEnvStatus.innerHTML = [
    buildInfoTile('Built-in config URL', diagnostics.configPresent ? 'Present' : 'Missing', 'This build uses extension-bundled configuration rather than runtime environment injection.', diagnostics.configPresent ? 'success' : 'error'),
    buildInfoTile('Built-in anon key', diagnostics.anonKeyPresent ? 'Present' : 'Missing', 'The key is masked in the UI and never shown in plaintext.', diagnostics.anonKeyPresent ? 'success' : 'error'),
    buildInfoTile('Runtime secrets', 'Protected', 'No sensitive Supabase values are rendered in plaintext in the workspace UI.')
  ].join('');
}

function renderProfileWorkspaceSection() {
  if (!isDesktopWorkspace || !els.profileWorkspaceSummary) {
    return;
  }
  const workspaceSignature = JSON.stringify({
    userId: state.user?.id || '',
    profile: state.profile || null
  });
  if (state.lastProfileWorkspaceSignature === workspaceSignature) {
    return;
  }
  state.lastProfileWorkspaceSignature = workspaceSignature;

  if (!state.user) {
    els.profileWorkspaceSummary.innerHTML = '<div class="empty-state">Sign in to open your profile editor and review field readiness.</div>';
    els.profileVisibilitySummary.innerHTML = '<div class="empty-state">Visibility settings appear after sign-in.</div>';
    return;
  }

  const complete = hasCompleteProfile(state.profile);
  const visibility = normalizeProfileVisibility(state.profile || {});
  const profileSummaryTiles = [
    buildInfoTile('Profile status', complete ? 'Complete' : 'Incomplete', complete ? 'Your profile is ready for presence sharing.' : 'Add any missing required fields or avatar to finish setup.', complete ? 'success' : 'warning'),
    buildInfoTile('Display name', state.profile?.display_name || `${state.profile?.first_name || ''} ${state.profile?.last_name || ''}`.trim() || 'Not set', 'Shown according to your visibility choices.'),
    buildInfoTile('Avatar uploaded', state.profile?.avatar_url ? 'Yes' : 'No', state.profile?.avatar_url ? 'Avatar is available in the avatars bucket.' : 'Upload an avatar to complete your profile.', state.profile?.avatar_url ? 'success' : 'warning')
  ].join('');
  els.profileWorkspaceSummary.innerHTML = `<div class="info-grid">${profileSummaryTiles}</div>`;

  const visibilityTiles = [
    buildInfoTile('Avatar', visibility.share_avatar ? 'Public' : 'Private'),
    buildInfoTile('First name', visibility.share_first_name ? 'Public' : 'Private'),
    buildInfoTile('Last name', visibility.share_last_name ? 'Public' : 'Private'),
    buildInfoTile('Work', visibility.share_place_of_work ? 'Public' : 'Private'),
    buildInfoTile('Education', visibility.share_education ? 'Public' : 'Private'),
    buildInfoTile('Location', visibility.share_current_location ? 'Public' : 'Private'),
    buildInfoTile('Bio', visibility.share_bio ? 'Public' : 'Private')
  ].join('');
  els.profileVisibilitySummary.innerHTML = visibilityTiles;
}

function renderDataControlsSection() {
  if (!isDesktopWorkspace || !els.dataPresenceSummary) {
    return;
  }
  const dataControlsSignature = JSON.stringify({
    userId: state.user?.id || '',
    domain: state.tabInfo?.domain || '',
    privacy: state.privacy,
    profile: state.profile || null,
    presenceNote: state.presenceAvailability?.note || ''
  });
  if (state.lastDataControlsSignature === dataControlsSignature) {
    return;
  }
  state.lastDataControlsSignature = dataControlsSignature;

  const retentionLabel = normalizeRetentionSelection(`${state.privacy.retentionValue}|${state.privacy.retentionUnit}`).displayLabel || `${state.privacy.retentionValue} ${state.privacy.retentionUnit}`;

  els.dataPresenceSummary.innerHTML = [
    buildInfoTile('Presence sharing', state.privacy.presenceSharingEnabled ? 'Enabled' : 'Disabled', state.presenceAvailability.note, state.privacy.presenceSharingEnabled ? 'success' : 'warning'),
    buildInfoTile('Current active site', state.tabInfo?.domain || 'No website detected', 'Active site detail respects your tracking scope.'),
    buildInfoTile('Visibility scope', getPresenceVisibilityScopeText(), 'Invisible Mode overrides visible presence sharing.')
  ].join('');

  els.dataConsentSummary.innerHTML = [
    buildInfoTile('Explicit consent', state.privacy.consentGranted ? 'Granted' : 'Not granted', state.privacy.consentGranted ? 'Consent has been saved for this account.' : 'Save consent before tracking or presence can run.', state.privacy.consentGranted ? 'success' : 'warning'),
    buildInfoTile('Tracking state', state.privacy.trackingEnabled ? 'On' : 'Off', `History scope: ${formatHistoryModeLabel(state.privacy.historyMode)}`),
    buildInfoTile('Consent timestamps', 'Not yet stored', 'This build does not currently persist consent timestamps in the shipped schema.')
  ].join('');

  const visibility = normalizeProfileVisibility(state.profile || {});
  els.dataProfileSummary.innerHTML = [
    buildInfoTile('Public fields', Object.values(visibility).filter(Boolean).length ? `${Object.values(visibility).filter(Boolean).length} shared` : 'None shared', 'Use Edit Profile to change what others can see.'),
    buildInfoTile('Profile completeness', hasCompleteProfile(state.profile) ? 'Ready for presence' : 'Needs attention', hasCompleteProfile(state.profile) ? 'Required profile fields are complete.' : 'Complete required fields and upload an avatar.', hasCompleteProfile(state.profile) ? 'success' : 'warning'),
    buildInfoTile('Quick link', 'Open Edit Profile', 'Use the button above to open the profile drawer.')
  ].join('');

  els.dataRetentionSummary.innerHTML = [
    buildInfoTile('Retention window', retentionLabel, 'Expired browsing history is purged according to the selected retention period.'),
    buildInfoTile('Stored data', state.privacy.trackingEnabled ? 'History + presence preferences' : 'Presence preferences only', 'Connect.Me stores only the data needed for enabled features.'),
    buildInfoTile('Destructive actions', 'Require confirmation', 'Clear, reset, and delete actions never run silently.')
  ].join('');
}

function getLearningModulesStatus() {
  return state.learningModulesStatus || {
    source: 'boot',
    phase: 'booting',
    contentState: 'booting',
    backendState: 'booting',
    backendAvailability: 'checking',
    authActionState: state.user ? 'signed_in' : 'signed_out',
    persistenceAvailable: false,
    setupRequired: false,
    statusBadge: 'Booting…',
    statusTone: 'neutral',
    statusMessage: 'Preparing Learning Modules…',
    fallbackDetail: '',
    errorMessage: ''
  };
}

function setLearningModulesLoadingStatus({ message = 'Loading learning modules and reconciling live Supabase content.' } = {}) {
  const hasVisibleModules = Array.isArray(state.learningModules) && state.learningModules.length > 0;
  state.learningModulesStatus = {
    source: hasVisibleModules ? 'preloaded' : 'loading',
    phase: hasVisibleModules ? 'reconciling_live_rows' : 'loading_content',
    contentState: hasVisibleModules ? 'reconciling_live_rows' : 'loading_content',
    backendState: hasVisibleModules ? 'reconciling_live_rows' : 'loading_content',
    backendAvailability: 'checking',
    authActionState: state.user ? 'signed_in' : 'signed_out',
    persistenceAvailable: hasVisibleModules ? getLearningModulesStatus().persistenceAvailable : false,
    setupRequired: false,
    statusBadge: hasVisibleModules ? 'Reconciling' : 'Loading modules…',
    statusTone: 'neutral',
    statusMessage: message,
    fallbackDetail: '',
    errorMessage: ''
  };
}

function markLearningModulesLiveFailure({
  message = 'Supabase is currently unavailable.',
  detail = '',
  errorMessage = '',
  setupRequired = false,
  operation = ''
} = {}) {
  state.learningModulesLiveFailure = {
    message,
    detail,
    errorMessage,
    setupRequired: Boolean(setupRequired),
    operation,
    occurredAt: new Date().toISOString()
  };
}

function clearLearningModulesLiveFailure() {
  state.learningModulesLiveFailure = null;
}

function renderLearningModulesStatus() {
  const status = getLearningModulesStatus();
  const statusSignature = JSON.stringify({
    badge: status.statusBadge || '',
    tone: status.statusTone || '',
    message: status.statusMessage || '',
    detail: status.fallbackDetail || '',
    setupRequired: Boolean(status.setupRequired),
    persistenceAvailable: Boolean(status.persistenceAvailable),
    backendAvailability: status.backendAvailability || 'checking'
  });
  // Fix: avoid flicker by skipping redundant status DOM writes when poll cycles do not change backend state.
  if (state.lastLearningModulesStatusSignature === statusSignature) {
    renderLearningModuleBackendDiagnostics();
    return;
  }
  state.lastLearningModulesStatusSignature = statusSignature;

  if (els.learningModulesStatusBadge) {
    els.learningModulesStatusBadge.textContent = status.statusBadge || 'Supabase synced';
    const badgeToneClass = status.statusTone === 'success'
      ? 'success'
      : status.statusTone === 'error'
        ? 'error'
        : status.statusTone === 'warning'
          ? 'warning'
          : '';
    els.learningModulesStatusBadge.className = ['badge', badgeToneClass].filter(Boolean).join(' ');
  }

  if (els.learningModulesStatusCallout) {
    const backendAvailable = status.backendAvailability === 'available';
    const backendChecking = status.backendAvailability === 'checking';
    const tone = backendAvailable ? 'subtle' : status.setupRequired ? 'info' : 'subtle';
    const actionCopy = backendAvailable
      ? 'Connecting a module requires sign-in and only exposes safe public-facing user identity details.'
      : backendChecking
        ? 'Checking Supabase sync readiness now. Learning modules remain available while this finishes.'
        : status.setupRequired
          ? 'Apply the Learning Modules migration to enable Supabase syncing, topic seeding, and saved connections.'
          : 'You can still browse all starter modules now, and Connect Me will queue local saves until Supabase is reachable again.';

    els.learningModulesStatusCallout.className = `callout ${tone}`;
    els.learningModulesStatusCallout.innerHTML = `
      <strong>${escapeHtml(status.statusMessage || 'Learning Modules are available.')}</strong>
      <div class="small-text">${escapeHtml(status.fallbackDetail || actionCopy)}</div>
      ${status.fallbackDetail ? `<div class="small-text">${escapeHtml(actionCopy)}</div>` : ''}
    `;
  }

  renderLearningModuleBackendDiagnostics();
}

function getLearningModuleDiagnosticsTone(check = {}) {
  if (check.status === 'ok') {
    return 'success';
  }
  if (check.status === 'skipped') {
    return 'warning';
  }
  return 'error';
}

function renderLearningModuleBackendDiagnostics() {
  if (!isDesktopWorkspace || !els.learningModulesBackendDiagnostics) {
    return;
  }

  const diagnostics = state.learningModuleBackendDiagnostics;
  if (!diagnostics) {
    els.learningModulesBackendDiagnostics.innerHTML = '<div class="empty-state">Backend diagnostics will appear after Learning Modules are loaded.</div>';
    return;
  }

  const cards = (diagnostics.checks || []).map((check) => buildInfoTile(
    check.label,
    check.ok ? 'Pass' : check.status === 'skipped' ? 'Skipped' : 'Fail',
    `${check.requiredFor}. ${check.message}`,
    getLearningModuleDiagnosticsTone(check)
  )).join('');

  const moduleStatus = getLearningModulesStatus();
  const backendAvailability = moduleStatus.backendAvailability || 'checking';
  const summaryTone = backendAvailability === 'available'
    ? 'success'
    : moduleStatus.backendState === 'auth_pending'
      ? 'warning'
      : backendAvailability === 'unavailable'
        ? 'error'
        : 'warning';
  const summaryText = backendAvailability === 'available'
    ? 'Sync backend ready'
    : moduleStatus.backendState === 'auth_pending'
      ? 'Awaiting sign-in'
      : backendAvailability === 'checking'
        ? 'Checking sync readiness'
        : moduleStatus.setupRequired
          ? 'Setup required'
          : 'Backend unavailable';
  const detailText = diagnostics.failingRequirement
    ? `Blocking requirement: ${diagnostics.failingRequirement}`
    : diagnostics.summary;

  els.learningModulesBackendDiagnostics.innerHTML = [
    buildInfoTile('Learning Modules backend status', summaryText, detailText, summaryTone),
    buildInfoTile('Last checked', diagnostics.checkedAt ? new Date(diagnostics.checkedAt).toLocaleString() : 'Unknown', 'Updated automatically during Learning Modules refreshes.'),
    cards
  ].join('');
}

async function refreshLearningModuleBackendDiagnostics({ reason = 'load-learning-modules' } = {}) {
  if (!isDesktopWorkspace) {
    return null;
  }

  if (!state.user) {
    // Fix: do not mark backend unavailable before login; auth-gated diagnostics are intentionally deferred.
    state.learningModuleBackendDiagnostics = {
      checkedAt: new Date().toISOString(),
      reason,
      persistenceAvailable: true,
      setupRequired: false,
      failingRequirement: '',
      summary: 'Waiting for sign-in before running authenticated Learning Modules checks.',
      checks: [
        {
          key: 'learning_modules_auth_gate',
          label: 'Learning Modules backend diagnostics',
          requiredFor: 'Root cause detection',
          ok: true,
          status: 'skipped',
          message: 'Skipped until a signed-in user session is available.'
        }
      ]
    };
    state.learningModulesStatus = {
      ...getLearningModulesStatus(),
      backendState: 'auth_pending',
      backendAvailability: 'checking',
      persistenceAvailable: false
    };
    renderLearningModulesSection();
    renderLearningModuleBackendDiagnostics();
    return state.learningModuleBackendDiagnostics;
  }

  try {
    state.learningModulesStatus = {
      ...getLearningModulesStatus(),
      backendState: 'checking',
      backendAvailability: 'checking',
      persistenceAvailable: false
    };
    await ensureBuiltInConfig();
    const diagnostics = await diagnoseLearningModulesBackend();
    state.learningModuleBackendDiagnostics = {
      ...diagnostics,
      reason
    };
    if (diagnostics?.persistenceAvailable) {
      clearLearningModulesLiveFailure();
      state.learningModulesStatus = {
        ...getLearningModulesStatus(),
        backendState: 'live_ready',
        backendAvailability: 'available',
        persistenceAvailable: true
      };
      if (state.user) {
        try {
          const syncResult = await syncPendingLearningModuleConnectionsForCurrentUser(state.learningModules);
          const remaining = syncResult?.remaining || await fetchPendingLearningModuleConnectionsForCurrentUser();
          state.pendingLocalModuleConnectionIds = new Set((remaining || []).map((connection) => connection.module_id));
        } catch (_syncError) {
          // Keep existing queued state when a live sync attempt fails; operation-specific errors are surfaced elsewhere.
        }
      } else {
        state.pendingLocalModuleConnectionIds = new Set();
      }
    }
  } catch (error) {
    state.learningModuleBackendDiagnostics = {
      checkedAt: new Date().toISOString(),
      reason,
      persistenceAvailable: false,
      setupRequired: false,
      failingRequirement: '',
      summary: error?.message || 'Unable to run Learning Modules backend diagnostics.',
      checks: [
        {
          label: 'Learning Modules backend diagnostics',
          requiredFor: 'Root cause detection',
          ok: false,
          status: 'error',
          message: error?.message || 'Unknown diagnostics error.'
        }
      ]
    };
    // Fix: classify diagnostics errors as degraded so transient init/network failures do not pin the UI as unavailable.
    state.learningModulesStatus = {
      ...getLearningModulesStatus(),
      backendState: 'degraded',
      backendAvailability: 'unavailable',
      persistenceAvailable: false
    };
  }

  logStructured('log', '[Connect.Me] Learning Modules backend diagnostics', state.learningModuleBackendDiagnostics);
  renderLearningModulesSection();
  renderLearningModuleBackendDiagnostics();
  return state.learningModuleBackendDiagnostics;
}

function isLearningModuleSetupError(message = '') {
  const normalized = String(message || '').toLowerCase();
  return (normalized.includes('learning_module_connections') && (normalized.includes('schema cache') || normalized.includes('does not exist')))
    || (normalized.includes('get_learning_module_connected_users') && normalized.includes('does not exist'));
}

function setLearningModulesFallbackStatus({ setupRequired = false, message = '', detail = '' } = {}) {
  markLearningModulesLiveFailure({
    setupRequired,
    message: message || (setupRequired
      ? 'Learning Modules persistence is unavailable because setup is incomplete.'
      : 'Supabase is currently unavailable.'),
    detail
  });
  state.learningModulesStatus = {
    source: 'fallback',
    phase: setupRequired ? 'degraded' : 'fallback_ready',
    contentState: 'fallback_ready',
    backendState: setupRequired ? 'degraded' : 'unavailable',
    backendAvailability: 'unavailable',
    authActionState: state.user ? 'signed_in' : 'signed_out',
    persistenceAvailable: false,
    setupRequired,
    statusBadge: setupRequired ? 'Setup required' : 'Fallback data',
    statusTone: setupRequired ? 'error' : 'warning',
    statusMessage: message || (setupRequired
      ? 'Starter modules are shown from built-in fallback data until the Learning Modules migration is applied.'
      : 'Starter modules are shown from built-in fallback data while Supabase sync is unavailable.'),
    fallbackDetail: detail || (setupRequired
      ? 'Learning Modules persistence is unavailable because one or more Supabase tables or functions are missing.'
      : 'Supabase is temporarily unavailable, so the workspace is using starter module data bundled with the app.'),
    errorMessage: ''
  };
}

function setLearningModulesSyncedStatus({ badge = 'Sync active', message = 'Learning Modules are synced with Supabase and support saved connections.' } = {}) {
  clearLearningModulesLiveFailure();
  state.learningModulesStatus = {
    source: 'supabase',
    phase: 'live_ready',
    contentState: 'live_ready',
    backendState: 'live_ready',
    backendAvailability: 'available',
    authActionState: state.user ? 'signed_in' : 'signed_out',
    persistenceAvailable: true,
    setupRequired: false,
    statusBadge: badge,
    statusTone: 'success',
    statusMessage: message,
    fallbackDetail: '',
    errorMessage: ''
  };
}

function renderLearningModuleUsers(module) {
  const status = getLearningModulesStatus();
  const backendAvailable = status.backendAvailability === 'available';
  const backendChecking = status.backendAvailability === 'checking';
  const isUsersOpen = backendAvailable && state.expandedLearningModuleUsers.has(module.slug);
  const isUsersLoading = state.learningModuleUsersLoading.has(module.slug);
  const usersError = state.learningModuleUsersErrors.get(module.slug) || '';
  const connectedUsers = state.learningModuleUsersBySlug.get(module.slug) || [];

  let content = '<div class="empty-state">Expand this area to view connected users.</div>';
  if (backendChecking) {
    content = '<div class="empty-state">Checking Supabase sync readiness for connected-user lists…</div>';
  } else if (!backendAvailable) {
    content = '<div class="empty-state">Connected-user lists will appear after Supabase sync is available again. Local queued saves still update your own state immediately.</div>';
  } else if (isUsersOpen && isUsersLoading) {
    content = '<div class="empty-state">Loading connected users…</div>';
  } else if (isUsersOpen && usersError) {
    content = `<div class="empty-state">${escapeHtml(usersError)}</div>`;
  } else if (isUsersOpen) {
    content = connectedUsers.length
      ? `
        <div class="learning-module-users-list">
          ${connectedUsers.map((user) => `
            <div class="learning-module-user-row">
              <div class="user-row">
                ${renderModuleUserAvatar(user)}
                <div class="stack-xs">
                  <strong>${escapeHtml(user.public_name || 'Connect.Me member')}</strong>
                  <span class="muted small-text">Connected ${escapeHtml(new Date(user.connected_at).toLocaleString())}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `
      : '<div class="empty-state">No connected users yet.</div>';
  }

  return `
    <div class="learning-module-collapsible ${isUsersOpen || !backendAvailable ? 'is-open' : ''}">
      <div class="learning-module-collapsible-inner">
        <div class="learning-module-section-block learning-module-users-panel stack-sm">
          <div class="section-heading compact">
            <div>
              <h3>Connected users</h3>
              <p class="muted small-text">Only safe public-facing identity details are shown here.</p>
            </div>
            <span class="pill ${backendAvailable && connectedUsers.length ? 'success' : backendAvailable ? '' : 'warning'}">${escapeHtml(backendChecking ? 'Checking sync…' : backendAvailable ? `${connectedUsers.length} connected` : 'Sync unavailable')}</span>
          </div>
          ${content}
        </div>
      </div>
    </div>
  `;
}

function getLearningModuleById(moduleId) {
  return state.learningModules.find((module) => module.id === moduleId) || null;
}

function getLearningModuleTopicCards(topic) {
  return Array.isArray(topic?.cards) ? topic.cards : [];
}

function getLearningModulePlayerSnapshot(moduleId = state.activeModuleId) {
  const module = getLearningModuleById(moduleId);
  if (!module) {
    return null;
  }

  const flatCards = getFlattenedModuleCards(module);
  if (!flatCards.length) {
    return { module, flatCards, currentEntry: null, currentFlatIndex: -1 };
  }

  const currentFlatIndex = flatCards.findIndex((entry) => (
    entry.topicIndex === state.activeTopicIndex && entry.cardIndex === state.activeCardIndex
  ));
  const safeFlatIndex = currentFlatIndex >= 0 ? currentFlatIndex : 0;
  const currentEntry = flatCards[safeFlatIndex];

  return {
    module,
    flatCards,
    currentEntry,
    currentFlatIndex: safeFlatIndex
  };
}

function openLearningModulePlayer(moduleId) {
  const module = getLearningModuleById(moduleId);
  if (!module) {
    setStatus('That learning module could not be opened right now.', 'error');
    return;
  }

  state.activeLearningView = 'modulePlayer';
  state.activeModuleId = module.id;
  state.activeTopicIndex = 0;
  state.activeCardIndex = 0;
  state.activeSubcardIndex = 0;
  state.learningModuleCompleted = false;
  renderLearningModulesSection();
}

function returnToLearningModuleList() {
  state.activeLearningView = 'moduleList';
  state.activeModuleId = '';
  state.learningModuleCompleted = false;
  renderLearningModulesSection();
}

function moveLearningModuleCard(offset) {
  const snapshot = getLearningModulePlayerSnapshot();
  if (!snapshot?.flatCards?.length) {
    return;
  }

  const nextIndex = snapshot.currentFlatIndex + offset;
  if (nextIndex < 0) {
    return;
  }

  if (nextIndex >= snapshot.flatCards.length) {
    state.learningModuleCompleted = true;
    updateLearningModulePlayerView();
    return;
  }

  const nextEntry = snapshot.flatCards[nextIndex];
  state.activeTopicIndex = nextEntry.topicIndex;
  state.activeCardIndex = nextEntry.cardIndex;
  state.activeSubcardIndex = 0;
  state.learningModuleCompleted = false;
  updateLearningModulePlayerView();
}

function renderLearningModuleTopicPreview(module, topic) {
  const cards = getLearningModuleTopicCards(topic);
  const topicKey = `${module.id}:${topic.id}`;
  const isOpen = state.expandedLearningTopics.has(topicKey);
  const previewCards = isOpen ? cards : cards.slice(0, 3);

  return `
    <div class="learning-module-topic-preview ${isOpen ? 'is-open' : ''}" data-topic-preview-id="${escapeHtml(topic.id)}">
      <button
        type="button"
        class="learning-module-topic-toggle"
        data-action="toggle-topic"
        data-module-id="${escapeHtml(module.id)}"
        data-topic-id="${escapeHtml(topic.id)}"
        aria-expanded="${String(isOpen)}"
      >
        <div>
          <h4>${escapeHtml(topic.topic_title || 'Topic')}</h4>
          ${topic.summary ? `<p class="muted small-text">${escapeHtml(topic.summary)}</p>` : ''}
        </div>
        <div class="learning-module-topic-toggle-meta">
          <span class="pill">${escapeHtml(`${cards.length} card${cards.length === 1 ? '' : 's'}`)}</span>
          <span class="learning-module-chevron" aria-hidden="true">${renderChevronIcon()}</span>
        </div>
      </button>
      <div class="learning-module-topic-content ${isOpen ? 'is-open' : ''}">
        ${cards.length
          ? `
            <div class="learning-module-card-chip-row">
              ${previewCards.map((card, index) => `
                <div class="learning-module-card-chip">
                  <span class="pill">${index + 1}</span>
                  <div class="stack-xs">
                    <strong>${escapeHtml(card.title || 'Learning card')}</strong>
                    ${card.subtopic_title ? `<span class="muted small-text">${escapeHtml(card.subtopic_title)}</span>` : ''}
                    <span class="muted small-text">${escapeHtml(formatCardTypeLabel(card.card_type))}</span>
                  </div>
                </div>
              `).join('')}
            </div>
            ${!isOpen && cards.length > 3 ? `<p class="muted small-text">Open this topic to inspect all ${cards.length} cards without rendering every card upfront.</p>` : ''}
          `
          : '<div class="empty-state">Cards will appear here after this topic is populated.</div>'}
      </div>
    </div>
  `;
}

function rerenderLearningModuleTopicPreview(moduleId, topicId) {
  if (!moduleId || !topicId || !els.learningModulesList) {
    return;
  }

  const module = getLearningModuleById(moduleId);
  const topic = (module?.topics || []).find((entry) => entry.id === topicId);
  if (!module || !topic) {
    return;
  }

  const selector = `[data-module-card-id="${CSS.escape(moduleId)}"] [data-topic-preview-id="${CSS.escape(topicId)}"]`;
  const topicElement = els.learningModulesList.querySelector(selector);
  if (!topicElement) {
    rerenderLearningModuleCard(moduleId);
    return;
  }

  topicElement.outerHTML = renderLearningModuleTopicPreview(module, topic);
}

function renderLearningModulePlayer() {
  const snapshot = getLearningModulePlayerSnapshot();
  if (!snapshot?.module) {
    return '<div class="empty-state">This module is no longer available. Return to the module list and try again.</div>';
  }

  const { module, flatCards, currentEntry, currentFlatIndex } = snapshot;
  if (!currentEntry) {
    return `
      <div class="learning-module-player empty">
        <div class="empty-state">This module does not have lesson cards yet.</div>
        <button type="button" class="secondary small" data-action="return-module-list">Return to module list</button>
      </div>
    `;
  }

  const { topic, card, topicIndex } = currentEntry;
  const sections = Array.isArray(card.sections) ? card.sections : [];
  const cardPosition = currentFlatIndex + 1;
  const isFirstCard = currentFlatIndex === 0;
  const isLastCard = currentFlatIndex === flatCards.length - 1;

  return `
    <article class="learning-module-player surface-card stack-md" data-player-module-id="${escapeHtml(module.id)}">
      <div class="section-heading dashboard-section-heading">
        <div>
          <p class="eyebrow">Lesson viewer</p>
          <h2>${escapeHtml(module.title)}</h2>
          <p class="muted">Stay inside the desktop workspace while moving through the lesson card-by-card.</p>
        </div>
        <button type="button" class="secondary small" data-action="return-module-list">Return to module list</button>
      </div>

      <div class="learning-module-progress-grid">
        <div class="learning-module-progress-tile">
          <span class="eyebrow">Progress</span>
          <strong>Card ${cardPosition} of ${flatCards.length}</strong>
          <span class="muted small-text">Topic ${topicIndex + 1} of ${(module.topics || []).length}</span>
        </div>
        <div class="learning-module-progress-tile">
          <span class="eyebrow">Current topic</span>
          <strong>${escapeHtml(topic.topic_title || 'Topic')}</strong>
          <span class="muted small-text">${escapeHtml(card.subtopic_title || card.title || 'Current lesson')}</span>
        </div>
      </div>

      <div class="learning-module-player-card">
        <div class="learning-module-player-card-header" data-player-header>
          <div class="stack-xs">
            <span class="pill">${escapeHtml(formatCardTypeLabel(card.card_type))}</span>
            <h3>${escapeHtml(card.title || 'Learning card')}</h3>
            ${card.subtopic_title ? `<p class="muted">${escapeHtml(card.subtopic_title)}</p>` : ''}
          </div>
        </div>
        <div class="learning-module-player-sections" data-player-sections>
          ${sections.map((section) => `
            <section class="learning-module-content-section">
              <h4>${escapeHtml(section.label || 'Section')}</h4>
              ${renderRichText(section.body || '')}
            </section>
          `).join('')}
        </div>
      </div>

      <div class="learning-module-player-callout ${state.learningModuleCompleted || isLastCard ? 'is-visible' : ''}" data-player-callout>
        ${(state.learningModuleCompleted || isLastCard) ? `
        <div class="callout info">
          <strong>${state.learningModuleCompleted ? 'Module completed.' : 'Final card reached.'}</strong>
          <div>${state.learningModuleCompleted ? 'You have reached the end of this guided lesson flow.' : 'Use Next once more to mark the lesson as completed, or go Back to revisit earlier cards.'}</div>
        </div>` : ''}
      </div>

      <div class="learning-module-player-footer">
        <button type="button" class="secondary" data-action="module-back" data-player-back ${isFirstCard ? 'disabled' : ''}>Back</button>
        <div class="learning-module-progress-bar" aria-hidden="true">
          <span data-player-progress style="width: ${(cardPosition / flatCards.length) * 100}%"></span>
        </div>
        <button
          type="button"
          data-action="module-next"
          data-player-next
        >
          ${state.learningModuleCompleted ? 'Completed' : isLastCard ? 'Finish module' : 'Next'}
        </button>
      </div>
    </article>
  `;
}

function renderLearningModuleCard(module, status = getLearningModulesStatus()) {
  const isExpanded = state.expandedLearningModules.has(module.id);
  const resolvedModuleDbId = module.db_id || module.id;
  const connectionDisplay = getModuleConnectionDisplay(resolvedModuleDbId);
  const isConnected = connectionDisplay.connected;
  const isQueued = connectionDisplay.queued;
  const isConnecting = state.pendingModuleConnectionIds.has(resolvedModuleDbId);
  const topics = Array.isArray(module.topics) ? module.topics : [];
  const backendAvailable = status.backendAvailability === 'available';
  const backendChecking = status.backendAvailability === 'checking';
  const userToggleLabel = backendAvailable && state.expandedLearningModuleUsers.has(module.slug)
    ? 'Hide all users connected'
    : 'Show all users connected';
  const canConnect = !isConnecting && !connectionDisplay.isSaved;
  const helperText = !state.user
    ? 'Sign in to connect yourself to a module. Browsing modules remains available while signed out.'
    : isQueued
      ? (status.setupRequired
        ? 'Saved locally. Run the bundled Learning Modules SQL to sync this connection into Supabase.'
        : 'Saved locally and will sync automatically once Supabase becomes available again.')
      : backendAvailable
        ? 'Connect yourself to save this module to your Supabase-backed workspace.'
        : backendChecking
          ? 'Checking Supabase sync status. You can browse now and connect as soon as sync is ready.'
          : 'Supabase is currently unavailable, but you can still save this module locally and let it sync later.';

  return `
    <article class="learning-module-card ${isExpanded ? 'is-expanded' : ''}" data-module-card-id="${escapeHtml(module.id)}">
      <div class="learning-module-card-inner">
        <button
          type="button"
          class="learning-module-header"
          data-action="toggle-module"
          data-module-id="${escapeHtml(module.id)}"
          aria-expanded="${String(isExpanded)}"
        >
          <div class="stack-xs">
            <div class="learning-module-heading-row">
              <span class="pill">${escapeHtml(`${topics.length} topic${topics.length === 1 ? '' : 's'}`)}</span>
              ${isConnected ? '<span class="pill success">Connected</span>' : ''}
              ${isQueued ? '<span class="pill warning">Queued sync</span>' : ''}
              ${backendChecking ? '<span class="pill">Checking sync</span>' : !backendAvailable ? '<span class="pill warning">Fallback</span>' : ''}
            </div>
            <div>
              <h3>${escapeHtml(module.title)}</h3>
              <p class="muted">${escapeHtml(module.description)}</p>
            </div>
          </div>
          <span class="learning-module-chevron" aria-hidden="true">${renderChevronIcon()}</span>
        </button>

        <div class="learning-module-actions">
          <button
            type="button"
            class="learning-module-connect-button secondary ${isConnected ? 'is-connected' : ''}"
            data-action="connect-module"
            data-module-id="${escapeHtml(resolvedModuleDbId)}"
            data-module-slug="${escapeHtml(module.slug)}"
            ${!canConnect ? 'disabled' : ''}
            title="${escapeHtml(!state.user ? 'Sign in to save this learning module.' : isQueued ? 'Saved locally and waiting to sync to Supabase.' : backendAvailable ? 'Save this learning module to your profile.' : backendChecking ? 'Checking Supabase sync status.' : 'Save locally now and sync to Supabase later.')}"
          >
            <span class="learning-module-button-icon">${renderConnectionIcon()}</span>
            <span>${isConnecting ? 'Connecting…' : isConnected ? 'Connected' : isQueued ? 'Queued locally' : 'Connect Me'}</span>
          </button>
          <button
            type="button"
            class="learning-module-start-button"
            data-action="start-module"
            data-module-id="${escapeHtml(module.id)}"
            title="Open this module in the center panel and move through it card-by-card."
          >
            Start Module
          </button>
          <button
            type="button"
            class="secondary small"
            data-action="toggle-users"
            data-module-id="${escapeHtml(resolvedModuleDbId)}"
            data-module-slug="${escapeHtml(module.slug)}"
            ${!backendAvailable ? 'disabled' : ''}
            title="${escapeHtml(backendAvailable ? 'View everyone who connected to this module.' : backendChecking ? 'Checking Supabase sync status.' : 'Connected-user lists require Supabase syncing.')}"
          >
            ${escapeHtml(userToggleLabel)}
          </button>
        </div>

        <p class="muted small-text">${escapeHtml(helperText)}</p>

        <div class="learning-module-collapsible ${isExpanded ? 'is-open' : ''}">
          <div class="learning-module-collapsible-inner">
            <div class="learning-module-section-block stack-sm">
              <div class="section-heading compact">
                <div>
                  <h3>Topics</h3>
                  <p class="muted small-text">Preview the guided study path before opening the lesson viewer.</p>
                </div>
              </div>
              ${topics.length
                ? `
                  <div class="learning-module-topic-list">
                    ${topics.map((topic) => renderLearningModuleTopicPreview(module, topic)).join('')}
                  </div>
                `
                : '<div class="empty-state">No topics have been added yet.</div>'}
            </div>
          </div>
        </div>

        ${renderLearningModuleUsers(module)}
      </div>
    </article>
  `;
}

function rerenderLearningModuleCard(moduleId) {
  if (!moduleId || !els.learningModulesList) {
    return;
  }

  const module = getLearningModuleById(moduleId);
  if (!module) {
    return;
  }

  const existingCard = els.learningModulesList.querySelector(`[data-module-card-id="${CSS.escape(moduleId)}"]`);
  if (!existingCard) {
    renderLearningModulesSection();
    return;
  }

  existingCard.outerHTML = renderLearningModuleCard(module);
}

function updateLearningModulePlayerView() {
  const player = els.learningModulesList?.querySelector('.learning-module-player[data-player-module-id]');
  if (!player || state.activeLearningView !== 'modulePlayer') {
    return;
  }

  const snapshot = getLearningModulePlayerSnapshot();
  if (!snapshot?.module || !snapshot?.currentEntry) {
    renderLearningModulesSection();
    return;
  }

  const { module, flatCards, currentEntry, currentFlatIndex } = snapshot;
  const { topic, card, topicIndex } = currentEntry;
  const sections = Array.isArray(card.sections) ? card.sections : [];
  const cardPosition = currentFlatIndex + 1;
  const isFirstCard = currentFlatIndex === 0;
  const isLastCard = currentFlatIndex === flatCards.length - 1;

  const title = player.querySelector('h2');
  if (title) {
    title.textContent = module.title;
  }

  const progressTitle = player.querySelector('.learning-module-progress-tile strong');
  if (progressTitle) {
    progressTitle.textContent = `Card ${cardPosition} of ${flatCards.length}`;
  }
  const progressTopic = player.querySelector('.learning-module-progress-tile .muted.small-text');
  if (progressTopic) {
    progressTopic.textContent = `Topic ${topicIndex + 1} of ${(module.topics || []).length}`;
  }

  const topicTileTitle = player.querySelector('.learning-module-progress-tile:nth-child(2) strong');
  if (topicTileTitle) {
    topicTileTitle.textContent = topic.topic_title || 'Topic';
  }
  const topicTileSub = player.querySelector('.learning-module-progress-tile:nth-child(2) .muted.small-text');
  if (topicTileSub) {
    topicTileSub.textContent = card.subtopic_title || card.title || 'Current lesson';
  }

  const header = player.querySelector('[data-player-header]');
  if (header) {
    header.innerHTML = `
      <div class="stack-xs">
        <span class="pill">${escapeHtml(formatCardTypeLabel(card.card_type))}</span>
        <h3>${escapeHtml(card.title || 'Learning card')}</h3>
        ${card.subtopic_title ? `<p class="muted">${escapeHtml(card.subtopic_title)}</p>` : ''}
      </div>
    `;
  }

  const sectionsContainer = player.querySelector('[data-player-sections]');
  if (sectionsContainer) {
    sectionsContainer.innerHTML = sections.map((section) => `
      <section class="learning-module-content-section">
        <h4>${escapeHtml(section.label || 'Section')}</h4>
        ${renderRichText(section.body || '')}
      </section>
    `).join('');
  }

  const callout = player.querySelector('[data-player-callout]');
  if (callout) {
    const showCallout = state.learningModuleCompleted || isLastCard;
    callout.classList.toggle('is-visible', showCallout);
    callout.innerHTML = showCallout
      ? `<div class="callout info">
          <strong>${state.learningModuleCompleted ? 'Module completed.' : 'Final card reached.'}</strong>
          <div>${state.learningModuleCompleted ? 'You have reached the end of this guided lesson flow.' : 'Use Next once more to mark the lesson as completed, or go Back to revisit earlier cards.'}</div>
        </div>`
      : '';
  }

  const backButton = player.querySelector('[data-player-back]');
  if (backButton) {
    backButton.disabled = isFirstCard;
  }
  const nextButton = player.querySelector('[data-player-next]');
  if (nextButton) {
    nextButton.textContent = state.learningModuleCompleted ? 'Completed' : isLastCard ? 'Finish module' : 'Next';
  }
  const progressBar = player.querySelector('[data-player-progress]');
  if (progressBar) {
    progressBar.style.width = `${(cardPosition / flatCards.length) * 100}%`;
  }
}

function renderLearningModulesSection() {
  if (!isDesktopWorkspace || !els.learningModulesList) {
    return;
  }

  renderLearningModulesStatus();
  const status = getLearningModulesStatus();

  let markup = '';
  if (state.learningModulesLoading && !state.learningModules.length) {
    markup = '<div class="empty-state">Loading learning modules…</div>';
  } else if (state.learningModulesError && !state.learningModules.length) {
    markup = `<div class="empty-state">${escapeHtml(state.learningModulesError)}</div>`;
  } else if (!state.learningModules.length) {
    markup = '<div class="empty-state">No learning modules are available yet.</div>';
  } else if (state.activeLearningView === 'modulePlayer' && state.activeModuleId) {
    markup = renderLearningModulePlayer();
  } else {
    markup = state.learningModules.map((module) => renderLearningModuleCard(module, status)).join('');
  }

  if (state.lastLearningModulesListSignature === markup) {
    return;
  }
  state.lastLearningModulesListSignature = markup;
  els.learningModulesList.innerHTML = markup;
}

async function loadLearningModules({ force = false } = {}) {
  const loadCycle = state.learningModulesLoadCycle + 1;
  state.learningModulesLoadCycle = loadCycle;
  state.learningModulesLoading = true;
  state.learningModulesError = '';
  const hasExistingModules = Array.isArray(state.learningModules) && state.learningModules.length > 0;
  if (!hasExistingModules) {
    state.learningModules = getStarterLearningModules();
  }
  setLearningModulesLoadingStatus();
  renderLearningModulesSection();
  logStructured('log', '[Connect.Me] Learning modules preload started', {
    loadCycle,
    force,
    authPresent: Boolean(state.user?.id),
    usingStarterPreload: !hasExistingModules
  });

  try {
    const canReuseCachedModules = !force
      && state.learningModules.length
      && getLearningModulesStatus().persistenceAvailable
      && state.learningModulesStatus?.source !== 'fallback'
      && hasLiveUuidForEveryRenderedModule(state.learningModules);

    const modulePayload = canReuseCachedModules
      ? { modules: state.learningModules, ...getLearningModulesStatus() }
      : await fetchLearningModules();
    if (loadCycle !== state.learningModulesLoadCycle) {
      return;
    }

    state.learningModules = modulePayload?.modules || [];
    logStructured('log', '[Connect.Me] Learning modules public live query resolved', {
      source: modulePayload?.source || 'unknown',
      liveQuerySucceeded: modulePayload?.source !== 'fallback',
      fallbackUsed: modulePayload?.source === 'fallback',
      setupRequired: Boolean(modulePayload?.setupRequired),
      renderedModules: state.learningModules.length
    });

    state.learningModulesStatus = {
      ...getLearningModulesStatus(),
      source: modulePayload?.source || getLearningModulesStatus().source,
      contentState: modulePayload?.source === 'fallback' ? 'fallback_ready' : 'live_ready',
      phase: modulePayload?.source === 'fallback' ? 'fallback_ready' : 'reconciling_live_rows',
      setupRequired: Boolean(modulePayload?.setupRequired),
      statusBadge: modulePayload?.source === 'fallback' ? 'Fallback data' : 'Reconciling',
      statusTone: modulePayload?.source === 'fallback' ? 'warning' : 'neutral',
      statusMessage: modulePayload?.statusMessage || 'Learning modules loaded. Verifying sync backend readiness…',
      fallbackDetail: modulePayload?.fallbackDetail || '',
      errorMessage: '',
      authActionState: state.user ? 'signed_in' : 'signed_out'
    };

    logStructured('log', '[Connect.Me] Learning modules payload diagnostics', {
      source: modulePayload?.source || 'unknown',
      fetchedLiveModulesCount: (modulePayload?.reconciliationDiagnostics || []).length || state.learningModules.length,
      liveUuidBySlug: (modulePayload?.reconciliationDiagnostics || state.learningModules || []).map((entry) => ({
        slug: entry?.slug || '',
        liveUuidFound: entry?.liveUuidFound !== undefined
          ? (entry.liveUuidFound ? 'yes' : 'no')
          : (isUuidLike(entry?.db_id || entry?.id) ? 'yes' : 'no'),
        reconciledToLiveRow: entry?.reconciledWithStarter !== undefined
          ? (entry.reconciledWithStarter ? 'yes' : 'no')
          : 'unknown'
      }))
    });

    await refreshLearningModuleBackendDiagnostics({ reason: 'module-payload-load' });
    if (loadCycle !== state.learningModulesLoadCycle) {
      return;
    }
    if (state.activeModuleId && !state.learningModules.some((module) => module.id === state.activeModuleId)) {
      state.activeLearningView = 'moduleList';
      state.activeModuleId = '';
      state.activeTopicIndex = 0;
      state.activeCardIndex = 0;
      state.activeSubcardIndex = 0;
      state.learningModuleCompleted = false;
    }

    if (state.user) {
      let remoteConnections = [];
      let pendingConnections = [];

      try {
        pendingConnections = await fetchPendingLearningModuleConnectionsForCurrentUser();

        if (getLearningModulesStatus().persistenceAvailable) {
          let connectionsSetupError = false;
          try {
            const syncResult = await syncPendingLearningModuleConnectionsForCurrentUser(state.learningModules);
            pendingConnections = syncResult.remaining || [];
          } catch (syncError) {
            if (isLearningModuleSetupError(syncError?.message)) {
              connectionsSetupError = true;
              markLearningModulesLiveFailure({
                setupRequired: true,
                message: 'Supabase setup is incomplete for Learning Modules connections.',
                detail: syncError?.message || 'Missing Learning Modules connection schema.'
              });
            }
          }

          try {
            remoteConnections = await fetchLearningModuleConnectionsForCurrentUser();
          } catch (error) {
            if (isLearningModuleSetupError(error?.message)) {
              connectionsSetupError = true;
              markLearningModulesLiveFailure({
                setupRequired: true,
                message: 'Supabase setup is incomplete for Learning Modules connections.',
                detail: error?.message || 'Missing Learning Modules connection schema.'
              });
            } else {
              markLearningModulesLiveFailure({
                setupRequired: false,
                message: 'Unable to load your saved module connections from Supabase.',
                detail: error?.message || 'Unknown connection read error.',
                errorMessage: error?.message || ''
              });
              remoteConnections = [];
            }
          }

          if (!connectionsSetupError) {
            clearLearningModulesLiveFailure();
          }
        }
      } catch (_error) {
        pendingConnections = [];
      }

      const moduleUuidBySlug = buildLearningModuleUuidLookup();
      const normalizeConnectionModuleId = (connection = {}) => {
        if (isUuidLike(connection?.module_id)) {
          return connection.module_id;
        }
        if (connection?.module_slug) {
          return moduleUuidBySlug.get(connection.module_slug) || '';
        }
        return '';
      };

      state.pendingLocalModuleConnectionIds = new Set((pendingConnections || [])
        .map((connection) => normalizeConnectionModuleId(connection))
        .filter(Boolean));
      state.moduleConnectionIds = new Set([
        ...(remoteConnections || []).map((connection) => normalizeConnectionModuleId(connection)).filter(Boolean),
        ...(pendingConnections || []).map((connection) => normalizeConnectionModuleId(connection)).filter(Boolean)
      ]);
    } else {
      state.moduleConnectionIds = new Set();
      state.pendingModuleConnectionIds = new Set();
      state.pendingLocalModuleConnectionIds = new Set();
    }
  } catch (error) {
    state.learningModulesError = 'Starter learning modules could not be loaded right now.';
    state.learningModules = [];
    markLearningModulesLiveFailure({
      setupRequired: isLearningModuleSetupError(error?.message),
      message: 'Unable to load Learning Modules from Supabase.',
      detail: error?.message || 'Unknown module load error.',
      errorMessage: error?.message || ''
    });
    setLearningModulesFallbackStatus({
      setupRequired: isLearningModuleSetupError(error?.message),
      detail: 'The workspace could not initialize Learning Modules. Reload after applying the Supabase migration if the issue persists.'
    });
    logStructured('error', '[Connect.Me] Learning modules public live query failed', {
      loadCycle,
      error: error?.message || 'Unknown preload error',
      fallbackUsed: true,
      authPresent: Boolean(state.user?.id)
    });
  } finally {
    if (loadCycle !== state.learningModulesLoadCycle) {
      return;
    }
    state.learningModulesLoading = false;
    if (!state.user) {
      state.moduleConnectionIds = new Set();
      state.pendingModuleConnectionIds = new Set();
      state.pendingLocalModuleConnectionIds = new Set();
    }
    logStructured('log', '[Connect.Me] Learning modules final resolved state', {
      loadCycle,
      contentState: getLearningModulesStatus().contentState,
      backendState: getLearningModulesStatus().backendState,
      authActionState: getLearningModulesStatus().authActionState,
      fallbackUsed: getLearningModulesStatus().source === 'fallback'
    });
    renderLearningModulesSection();
  }
}

async function loadLearningModuleUsers(moduleSlug, { force = false } = {}) {
  if (!moduleSlug || !getLearningModulesStatus().persistenceAvailable) {
    return;
  }

  if (!force && state.learningModuleUsersBySlug.has(moduleSlug)) {
    const module = state.learningModules.find((item) => item.slug === moduleSlug);
    rerenderLearningModuleCard(module?.id);
    return;
  }

  state.learningModuleUsersLoading.add(moduleSlug);
  state.learningModuleUsersErrors.delete(moduleSlug);
  {
    const module = state.learningModules.find((item) => item.slug === moduleSlug);
    rerenderLearningModuleCard(module?.id);
  }

  try {
    const connectedUsers = await fetchLearningModuleConnectedUsers(moduleSlug);
    clearLearningModulesLiveFailure();
    state.learningModuleUsersBySlug.set(moduleSlug, connectedUsers || []);
  } catch (error) {
    markLearningModulesLiveFailure({
      setupRequired: isLearningModuleSetupError(error?.message),
      message: 'Unable to load connected users from Supabase.',
      detail: error?.message || 'Unknown connected-users error.',
      errorMessage: error?.message || '',
      operation: 'connected-users-read'
    });
    state.learningModuleUsersErrors.set(moduleSlug, error.message || 'Unable to load connected users right now.');
  } finally {
    state.learningModuleUsersLoading.delete(moduleSlug);
    const module = state.learningModules.find((item) => item.slug === moduleSlug);
    rerenderLearningModuleCard(module?.id);
  }
}

async function handleLearningModuleConnect(moduleId, moduleSlug) {
  if (!moduleId && !moduleSlug) {
    return;
  }

  if (!state.user) {
    try {
      state.user = await getCurrentUser();
    } catch (_error) {
      state.user = null;
    }
  }

  if (!state.user) {
    logStructured('log', '[Connect.Me] Learning module connect action gated by auth', {
      moduleId,
      moduleSlug,
      authPresent: false,
      gatedByAuth: true
    });
    renderLearningModulesSection();
    setStatus('Please sign in to connect yourself to a learning module.', 'error');
    return;
  }
  logStructured('log', '[Connect.Me] Learning module connect action gated by auth', {
    moduleId,
    moduleSlug,
    authPresent: true,
    gatedByAuth: false
  });

  const { resolvedUuid } = resolveLearningModuleUuid(moduleId, moduleSlug);
  const connectionTrackingId = resolvedUuid || moduleId || moduleSlug;

  if (state.moduleConnectionIds.has(connectionTrackingId) || state.pendingModuleConnectionIds.has(connectionTrackingId)) {
    return;
  }

  state.pendingModuleConnectionIds.add(connectionTrackingId);
  rerenderLearningModuleCard(moduleId);

  const connectAttemptDiagnostics = {
    userIdPresent: Boolean(state.user?.id),
    moduleIdPresent: Boolean(resolvedUuid),
    liveSyncAvailable: Boolean(getLearningModulesStatus().persistenceAvailable && resolvedUuid),
    attemptedSupabaseInsert: false,
    insertResult: 'not_attempted',
    fallbackQueueBranchTaken: false
  };
  logStructured('log', '[Connect.Me] Learning module connect attempt', {
    starterId: moduleId,
    slug: moduleSlug,
    resolvedLiveUuid: resolvedUuid,
    insertPayload: {
      module_id: resolvedUuid || moduleId || null,
      user_id: state.user?.id || null
    },
    ...connectAttemptDiagnostics
  });

  let connectResult = null;

  try {
    const moduleUuidBySlug = buildLearningModuleUuidLookup();
    connectResult = await connectCurrentUserToLearningModule(resolvedUuid || moduleId, { moduleSlug, moduleUuidBySlug });
    logStructured('log', '[Connect.Me] Learning module connect result', {
      starterId: moduleId,
      slug: moduleSlug,
      resolvedLiveUuid: resolvedUuid,
      ...(connectResult?.diagnostics || connectAttemptDiagnostics),
      queued: Boolean(connectResult?.queued),
      status: connectResult?.status || ''
    });
    if (connectResult?.queued) {
      state.pendingLocalModuleConnectionIds.add(connectionTrackingId);
      markLearningModulesLiveFailure({
        setupRequired: connectResult?.status === 'setup_required',
        message: connectResult?.status === 'setup_required'
          ? 'Supabase setup is incomplete for Learning Modules connections.'
          : 'Supabase write failed, so this connection was queued locally.',
        detail: connectResult?.diagnostics?.insertError || 'Live save failed and the connection was queued locally.',
        errorMessage: connectResult?.diagnostics?.insertError || '',
        operation: 'connect-write'
      });
      await refreshLearningModuleBackendDiagnostics({ reason: 'connect-queued' });
      setStatus(
        connectResult.status === 'setup_required'
          ? 'Connect Me saved this module locally. Run the bundled Learning Modules SQL and it will sync automatically.'
          : 'Connect Me saved this module locally and will sync it to Supabase automatically when the backend is reachable again.',
        'success'
      );
      state.moduleConnectionIds.add(connectionTrackingId);
    } else {
      clearLearningModulesLiveFailure();
      state.pendingLocalModuleConnectionIds.delete(connectionTrackingId);
      await refreshLearningModuleBackendDiagnostics({ reason: 'connect-supabase-success' });
      state.learningModuleUsersBySlug.delete(moduleSlug);
      setStatus('You are now connected to this learning module.', 'success');

      await loadLearningModules({ force: false });
      await loadLearningModuleUsers(moduleSlug, { force: true });
      state.moduleConnectionIds.add(connectionTrackingId);

    }
  } catch (error) {
    state.moduleConnectionIds.delete(connectionTrackingId);
    markLearningModulesLiveFailure({
      setupRequired: isLearningModuleSetupError(error?.message),
      message: 'Unable to save this module connection to Supabase.',
      detail: error?.message || 'Unknown connection save error.',
      errorMessage: error?.message || '',
      operation: 'connect-write'
    });
    logStructured('error', '[Connect.Me] Learning module connect failed', {
      starterId: moduleId,
      slug: moduleSlug,
      resolvedLiveUuid: resolvedUuid,
      ...(error?.learningModuleConnectDiagnostics || connectAttemptDiagnostics),
      insertResult: 'error',
      error: error?.message || 'Unknown error'
    });
    await refreshLearningModuleBackendDiagnostics({ reason: 'connect-error' });
    if (!state.pendingLocalModuleConnectionIds.has(connectionTrackingId)) {
      setStatus(error.message || 'Unable to connect you to this module right now.', 'error');
    }
  } finally {
    state.pendingModuleConnectionIds.delete(connectionTrackingId);
    rerenderLearningModuleCard(moduleId);
  }
}

function renderDesktopWorkspace() {
  renderProfileWorkspaceSection();
  renderDataControlsSection();
  renderSupabaseConfiguration();
  renderLearningModulesSection();
}

function syncDesktopNavState() {
  if (!isDesktopWorkspace || !els.workspaceNav) {
    return;
  }

  if (els.dashboardShell) {
    els.dashboardShell.style.setProperty(
      '--workspace-sidebar-width',
      state.isNavExpanded ? DESKTOP_NAV_WIDTH.expanded : DESKTOP_NAV_WIDTH.collapsed
    );
  }

  els.workspaceNav.classList.toggle('is-expanded', state.isNavExpanded);
  els.workspaceNav.classList.toggle('is-collapsed', !state.isNavExpanded);
  if (els.navRailToggle) {
    els.navRailToggle.setAttribute('aria-expanded', String(state.isNavExpanded));
    els.navRailToggle.setAttribute('aria-label', state.isNavExpanded ? 'Collapse navigation' : 'Expand navigation');
  }

  document.querySelectorAll('.workspace-nav-item').forEach((button) => {
    const isActive = button.dataset.section === state.activeSection;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  document.querySelectorAll('.workspace-main-shell .tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === state.activeSection);
  });
}

function setDesktopNavExpanded(nextExpanded) {
  if (!isDesktopWorkspace) {
    return;
  }
  state.isNavExpanded = Boolean(nextExpanded);
  syncDesktopNavState();
}

function setActiveDesktopSection(sectionId, { openDrawer = false } = {}) {
  if (!isDesktopWorkspace) {
    return;
  }

  state.activeSection = sectionId;
  syncDesktopNavState();

  if (sectionId === 'editProfileTab') {
    setProfileDrawerOpen(openDrawer || Boolean(state.user));
  } else if (state.profileDrawerOpen) {
    setProfileDrawerOpen(false);
  }

  if (sectionId === 'supabaseConfigTab') {
    runSupabaseDiagnostics({ reason: 'nav-section-opened' }).catch((error) => {
      setStatus(error.message || 'Unable to refresh Supabase diagnostics.', 'error');
    });
  }
}

function renderTopSites() {
  const currentScope = getCurrentSiteScope();
  const signature = JSON.stringify({
    userId: state.user?.id || '',
    currentDomain: currentScope?.domain || '',
    sites: state.topSites.map((site) => ({
      domain: site.domain,
      active: site.active_user_count,
      title: site.page_title || '',
      url: site.full_url || site.trackedDisplayUrl || '',
      lastSeen: site.last_seen
    }))
  });
  if (state.lastTopSitesSignature === signature) {
    return;
  }
  state.lastTopSitesSignature = signature;

  if (!state.user || !state.topSites.length) {
    els.topSitesList.innerHTML = '<div class="empty-state">No ranked sites are available yet. Users must opt into presence sharing before sites appear here.</div>';
    return;
  }

  els.topSitesList.innerHTML = state.topSites
    .map((site) => {
      const matchesCurrentSite = currentScope?.domain && currentScope.domain === site.domain;
      const siteTitle = String(site.page_title || '').trim() || 'Title unavailable';
      const siteUrl = String(site.full_url || site.trackedDisplayUrl || site.domain || '').trim() || 'URL unavailable';
      const currentSiteDetail = matchesCurrentSite
        ? `<div class="muted small-text break-anywhere">Current visible detail: ${escapeHtml(currentScope.displayUrl)}</div>`
        : '';

      return `
        <button type="button" class="list-item site-item" data-domain="${escapeHtml(site.domain)}">
          <div class="site-item-content stack-xs">
            <strong class="break-anywhere">${escapeHtml(site.domain)}</strong>
            <div class="site-meta-row"><span class="site-meta-label">Title</span><span class="muted break-anywhere">${escapeHtml(siteTitle)}</span></div>
            <div class="site-meta-row"><span class="site-meta-label">Full URL</span><span class="muted break-anywhere">${escapeHtml(siteUrl)}</span></div>
            <div class="site-meta-row"><span class="site-meta-label">Domain</span><span class="muted break-anywhere">${escapeHtml(site.domain)}</span></div>
            <div class="muted">Last active ${new Date(site.last_seen).toLocaleTimeString()}</div>
            ${currentSiteDetail}
          </div>
          ${renderActiveUserBadge(site.active_user_count)}
        </button>
      `;
    })
    .join('');

  els.topSitesList.querySelectorAll('[data-domain]').forEach((button) => {
    button.addEventListener('click', () => openTopSiteDetail(button.dataset.domain));
  });
}

function renderUserCard(user) {
  const rawPayload = user?.__sharedCardDebug || null;

  const visibility = normalizeProfileVisibility(user || {});
  const publicUser = getPublicProfile(user);
  const professionalHeadline = String(publicUser.professional_headline || publicUser.headline || '').trim();
  const sharedFields = {
    avatar_url: visibility.share_avatar ? publicUser.avatar_url || '' : '',
    avatar_path: visibility.share_avatar ? publicUser.avatar_path || '' : '',
    first_name: visibility.share_first_name ? publicUser.first_name || '' : '',
    last_name: visibility.share_last_name ? publicUser.last_name || '' : '',
    place_of_work: visibility.share_place_of_work ? publicUser.place_of_work || '' : '',
    education: visibility.share_education ? publicUser.education || '' : '',
    current_location: visibility.share_current_location ? publicUser.current_location || '' : '',
    bio: visibility.share_bio ? publicUser.bio || '' : '',
    professional_headline: professionalHeadline
  };
  const sharedName = [sharedFields.first_name, sharedFields.last_name].filter(Boolean).join(' ').trim();
  const titleText = sharedName || sharedFields.professional_headline || sharedFields.place_of_work || sharedFields.education || sharedFields.current_location || 'Connect.Me member';
  const subtitleCandidates = [
    titleText !== sharedFields.professional_headline ? sharedFields.professional_headline : '',
    titleText !== sharedFields.place_of_work ? sharedFields.place_of_work : '',
    titleText !== sharedFields.education ? sharedFields.education : '',
    titleText !== sharedFields.current_location ? sharedFields.current_location : ''
  ].filter(Boolean);
  const subtitleText = subtitleCandidates[0] || '';
  const sharedMeta = [
    sharedFields.place_of_work ? `<span class="meta-pill">Work: ${escapeHtml(sharedFields.place_of_work)}</span>` : '',
    sharedFields.education ? `<span class="meta-pill">Education: ${escapeHtml(sharedFields.education)}</span>` : '',
    sharedFields.current_location ? `<span class="meta-pill">Location: ${escapeHtml(sharedFields.current_location)}</span>` : ''
  ].filter(Boolean).join('');
  const sharedFieldEntries = [
    ['avatar_url', Boolean(sharedFields.avatar_url)],
    ['first_name', Boolean(sharedFields.first_name)],
    ['last_name', Boolean(sharedFields.last_name)],
    ['place_of_work', Boolean(sharedFields.place_of_work)],
    ['education', Boolean(sharedFields.education)],
    ['current_location', Boolean(sharedFields.current_location)],
    ['bio', Boolean(sharedFields.bio)],
    ['professional_headline', Boolean(sharedFields.professional_headline)]
  ];
  const renderedFieldKeys = sharedFieldEntries.filter(([, isRendered]) => isRendered).map(([field]) => field);
  const sharedFieldCount = renderedFieldKeys.length;
  const hasSharedNonFallbackText = renderedFieldKeys.some((field) => field !== 'avatar_url');
  const limitedProfileNote = sharedFieldCount <= 2
    ? '<p class="muted hidden-field-note">This user is sharing a limited public profile.</p>'
    : '';
  const detailMarkup = [
    sharedMeta ? `<div class="user-meta-list">${sharedMeta}</div>` : '',
    renderTrackedPageDetail(publicUser),
    sharedFields.bio ? `<p>${escapeHtml(sharedFields.bio)}</p>` : '',
    limitedProfileNote,
    SHARED_CARD_DEBUG_ENABLED
      ? `<details class="user-card-debug"><summary>Shared card debug</summary><pre>${escapeHtml(stringifyForLog({
        rawPayload,
        shareFlags: visibility,
        resolvedAvatarUrl: sharedFields.avatar_url || '',
        renderedFieldKeys,
        sharedFields
      }))}</pre></details>`
      : ''
  ].filter(Boolean).join('');
  const avatarProfile = {
    ...publicUser,
    avatar_url: sharedFields.avatar_url,
    avatar_path: sharedFields.avatar_path,
    first_name: sharedFields.first_name,
    last_name: sharedFields.last_name
  };
  const titleMarkup = `<strong>${escapeHtml(titleText)}</strong>`;
  const subtitleMarkup = subtitleText
    ? `<div class="muted">${escapeHtml(subtitleText)}</div>`
    : (!hasSharedNonFallbackText ? '<div class="muted">Connect.Me member</div>' : '');

  return `
    <div class="user-card">
      <div class="user-row">
        ${renderAvatar(avatarProfile, 'small')}
        <div>
          ${titleMarkup}
          ${subtitleMarkup}
        </div>
      </div>
      ${detailMarkup}
      <small class="muted">Last seen ${new Date(publicUser.last_seen).toLocaleTimeString()}</small>
    </div>
  `;
}

async function openTopSiteDetail(domain, { force = false } = {}) {
  state.detailDomain = domain;
  const requestId = ++state.detailUsersRequestId;
  els.topSiteDetailHeading.textContent = `Users on ${domain}`;
  if (els.topSiteDetailSubheading) {
    els.topSiteDetailSubheading.textContent = UI_TEXT.topSiteDetailSubheading;
  }
  els.topSiteDetailCard.classList.remove('hidden');
  const cachedUsers = !force ? getCacheEntry(state.caches.detailUsers, domain, FETCH_TTL_MS.detailUsers) : null;
  if (!cachedUsers) {
    els.topSiteUsersList.innerHTML = '<div class="empty-state">Loading users…</div>';
  }

  try {
    const users = cachedUsers || await getCachedActiveUsers(domain, { force, detail: true });
    if (requestId !== state.detailUsersRequestId || state.detailDomain !== domain) {
      return;
    }

    els.topSiteUsersList.innerHTML = users?.length
      ? users.map(renderUserCard).join('')
      : '<div class="empty-state">No active users are visible on this site right now.</div>';
  } catch (error) {
    if (requestId !== state.detailUsersRequestId || state.detailDomain !== domain) {
      return;
    }

    els.topSiteUsersList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function renderActiveUsers({ refreshVersion = state.refreshVersion, force = false } = {}) {
  updatePresenceAvailability();
  const requestId = ++state.activeUsersRequestId;
  const setActiveUsersMarkup = (nextMarkup) => {
    if (state.lastActiveUsersSignature === nextMarkup) {
      return;
    }
    state.lastActiveUsersSignature = nextMarkup;
    els.activeUsersList.innerHTML = nextMarkup;
  };

  if (!state.tabInfo?.domain) {
    setActiveUsersMarkup('<div class="empty-state">Open a website to view live activity on the current domain.</div>');
    return;
  }

  if (!state.user) {
    setActiveUsersMarkup('<div class="empty-state">Sign in to use Connect.Me on this site.</div>');
    return;
  }

  if (!state.presenceAvailability.consentSaved) {
    setActiveUsersMarkup('<div class="empty-state">Save consent preferences before any presence data is shown.</div>');
    return;
  }

  if (!state.presenceAvailability.profileComplete) {
    setActiveUsersMarkup('<div class="empty-state">Complete your full profile to use presence and community features.</div>');
    return;
  }

  if (!state.presenceAvailability.canViewPresenceData) {
    setActiveUsersMarkup('<div class="empty-state">Turn on presence sharing and turn off Invisible Mode to see other active users here.</div>');
    return;
  }

  const cachedUsers = !force ? getCacheEntry(state.caches.activeUsers, state.tabInfo.domain, FETCH_TTL_MS.activeUsers) : null;
  if (!cachedUsers) {
    setActiveUsersMarkup('<div class="empty-state">Refreshing live members…</div>');
  }

  try {
    const users = cachedUsers || await getCachedActiveUsers(state.tabInfo.domain, { force });
    if (requestId !== state.activeUsersRequestId || isStaleRefresh(refreshVersion)) {
      return;
    }

    const others = (users || []).filter((user) => user.id !== state.user?.id);
    setActiveUsersMarkup(others.length
      ? others.map(renderUserCard).join('')
      : '<div class="empty-state">No other active users are visible on this site right now.</div>');
  } catch (error) {
    if (requestId !== state.activeUsersRequestId || isStaleRefresh(refreshVersion)) {
      return;
    }

    setActiveUsersMarkup(`<div class="empty-state">${escapeHtml(error.message)}</div>`);
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-link').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    if (isDesktopWorkspace) {
      panel.classList.add('active');
      return;
    }
    panel.classList.toggle('active', panel.id === tabId);
  });

  if (isDesktopWorkspace) {
    document.getElementById(tabId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function loadTopSites({ reason = 'manual', refreshVersion = state.refreshVersion, force = false } = {}) {
  logStructured('log', '[Connect.Me] Top-sites refresh trigger', { reason, detailDomain: state.detailDomain });
  const requestId = ++state.topSitesRequestId;

  if (!state.user) {
    state.topSites = [];
    renderTopSites();
    if (state.detailDomain) {
      state.detailDomain = null;
      els.topSiteDetailCard.classList.add('hidden');
    }
    return;
  }

  const cachedTopSites = !force && state.caches.topSites.data && (Date.now() - state.caches.topSites.fetchedAt) <= FETCH_TTL_MS.topSites
    ? state.caches.topSites.data
    : null;

  try {
    state.topSites = cachedTopSites || await getCachedTopSites(force);
  } catch (_error) {
    if (requestId !== state.topSitesRequestId || isStaleRefresh(refreshVersion)) {
      return;
    }

    state.topSites = [];
  }

  if (requestId !== state.topSitesRequestId || isStaleRefresh(refreshVersion)) {
    return;
  }

  renderTopSites();

  if (state.detailDomain) {
    const exists = state.topSites.some((site) => site.domain === state.detailDomain);
    if (exists) {
      await openTopSiteDetail(state.detailDomain, { force });
    } else {
      state.detailDomain = null;
      els.topSiteDetailCard.classList.add('hidden');
    }
  }
}

async function refreshState({ reason = 'manual', force = false } = {}) {
  const refreshVersion = bumpRefreshVersion();
  if (force || !state.tabInfo) {
    state.tabInfo = await getCurrentTabInfo();
  } else {
    state.tabInfo = await getCurrentTabInfo();
  }
  renderDomainBadge();

  state.user = await getCachedUser();
  try {
    state.user = await getCurrentUser();
  } catch (_error) {
    state.user = null;
  }

  if (state.user) {
    try {
      state.profile = await getProfile();
      const privacyRecord = await getPrivacySettingsRecord();
      state.privacy = privacyRecord.normalized;
      state.hasSavedPrivacySettings = privacyRecord.rowExists;
    } catch (_error) {
      state.profile = null;
      state.privacy = getDefaultPrivacySettings();
      state.hasSavedPrivacySettings = false;
    }
  } else {
    state.profile = null;
    state.privacy = getDefaultPrivacySettings();
    state.hasSavedPrivacySettings = false;
  }

  logStructured('log', `[Connect.Me] ${WORKSPACE_LABEL} state sync`, {
    reason,
    refreshVersion,
    userId: state.user?.id || null,
    profileComplete: hasCompleteProfile(state.profile),
    hasSavedPrivacySettings: state.hasSavedPrivacySettings,
    privacy: state.privacy
  });

  renderAuthState();
  renderProfileForm();
  renderProfileSummary();
  renderConsentForm();
  renderPrivacySettingsForm();
  renderDataControlsForm();
  renderPresenceControls();
  renderCurrentSiteUrlSummary();
  renderDesktopWorkspace();
  const shouldRefreshLearningModules = force
    || !state.learningModulesInitialized
    || state.lastLearningModulesUserId !== (state.user?.id || '');
  if (shouldRefreshLearningModules) {
    await loadLearningModules({ force });
    state.learningModulesInitialized = true;
    state.lastLearningModulesUserId = state.user?.id || '';
  }
  await renderActiveUsers({ refreshVersion, force });
  await loadTopSites({ reason, refreshVersion, force });

  if (isDesktopWorkspace) {
    await runSupabaseDiagnostics({ reason });
  }
}

async function refreshContextState({ reason = 'context-sync', force = false } = {}) {
  const refreshVersion = bumpRefreshVersion();
  const previousDomain = state.tabInfo?.domain || '';
  state.tabInfo = await getCurrentTabInfo();
  const nextDomain = state.tabInfo?.domain || '';
  if (force || previousDomain !== nextDomain) {
    invalidatePresenceCaches(previousDomain);
    invalidatePresenceCaches(nextDomain);
  }
  renderDomainBadge();
  renderCurrentSiteUrlSummary();
  if (force || previousDomain !== nextDomain) {
    renderTopSites();
    renderDesktopWorkspace();
  }
  await renderActiveUsers({ refreshVersion, force: force || previousDomain !== nextDomain });
  if (state.detailDomain && (force || state.detailDomain === nextDomain || previousDomain !== nextDomain)) {
    await openTopSiteDetail(state.detailDomain, { force });
  }
  await loadTopSites({ reason, refreshVersion, force });
}

function buildProfilePayload() {
  return {
    first_name: els.firstName.value.trim(),
    last_name: els.lastName.value.trim(),
    place_of_work: els.placeOfWork.value.trim(),
    education: els.education.value.trim(),
    current_location: els.currentLocation.value.trim(),
    headline: els.headline.value.trim(),
    bio: els.bio.value.trim(),
    avatar_url: state.profile?.avatar_url || '',
    avatar_path: state.profile?.avatar_path || '',
    share_avatar: parseVisibilityValue(els.shareAvatar.value),
    share_first_name: parseVisibilityValue(els.shareFirstName.value),
    share_last_name: parseVisibilityValue(els.shareLastName.value),
    share_place_of_work: parseVisibilityValue(els.sharePlaceOfWork.value),
    share_education: parseVisibilityValue(els.shareEducation.value),
    share_current_location: parseVisibilityValue(els.shareCurrentLocation.value),
    share_bio: parseVisibilityValue(els.shareBio.value)
  };
}

function validateProfilePayload(profile) {
  const missing = [
    ['first name', profile.first_name],
    ['last name', profile.last_name],
    ['place of work', profile.place_of_work],
    ['education', profile.education],
    ['current location', profile.current_location]
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Please complete the following required fields: ${missing.map(([label]) => label).join(', ')}.`);
  }
}

function buildPrivacyPayload(source) {
  const fieldMap = source === 'consent'
    ? {
        retentionSelect: els.consentRetention,
        trackingEnabled: els.consentTrackingEnabled,
        historyMode: els.consentHistoryMode,
        presenceSharingEnabled: els.consentPresenceEnabled,
        invisibleModeEnabled: els.consentInvisibleMode,
        consentGranted: { checked: true }
      }
    : source === 'dataControls'
      ? {
          retentionSelect: els.dataRetentionSelect,
          trackingEnabled: els.dataTrackingEnabled,
          historyMode: els.dataHistoryMode,
          presenceSharingEnabled: els.dataPresenceSharingEnabled,
          invisibleModeEnabled: els.dataInvisibleModeEnabled,
          consentGranted: { checked: state.privacy.consentGranted }
        }
      : {
          retentionSelect: els.retentionSelect,
          trackingEnabled: els.trackingEnabled,
          historyMode: els.historyMode,
          presenceSharingEnabled: els.presenceSharingEnabled,
          invisibleModeEnabled: els.invisibleModeEnabled,
          consentGranted: els.trackingConsent
        };

  const retentionSelection = getRetentionSelectionSnapshot(fieldMap.retentionSelect);
  logStructured('log', '[Connect.Me] Retention dropdown raw value', { source, retentionSelection });
  const retention = syncFormState(source, retentionSelection, { clearValidation: true });
  const requestedPresenceSharingEnabled = fieldMap.presenceSharingEnabled.checked;

  if (!retention) {
    const message = `Unable to parse the selected retention window (${formatRetentionSelectionForMessage(retentionSelection)}). Please choose one of the supported values, such as 1 hour, 2 hours, 12 hours, 1 day, 30 days, 1 month, or 30 months.`;
    setFormError(source, message);
    throw new Error(message);
  }

  setFormError(source, '');

  return {
    consentGranted: Boolean(fieldMap.consentGranted.checked),
    trackingEnabled: fieldMap.trackingEnabled.checked,
    historyMode: fieldMap.historyMode.value,
    retentionUnit: retention.retentionUnit,
    retentionValue: retention.retentionValue,
    presenceSharingEnabled: requestedPresenceSharingEnabled && hasCompleteProfile(state.profile),
    invisibleModeEnabled: fieldMap.invisibleModeEnabled.checked
  };
}

async function syncSavedPrivacyState(savedPrivacy, source) {
  state.privacy = savedPrivacy || getDefaultPrivacySettings();
  state.hasSavedPrivacySettings = Boolean(savedPrivacy && savedPrivacy.consentGranted);
  const refreshVersion = bumpRefreshVersion();
  logStructured('log', '[Connect.Me] Applying saved privacy state to popup', {
    source,
    refreshVersion,
    savedPrivacy: state.privacy,
    hasSavedPrivacySettings: state.hasSavedPrivacySettings
  });
  renderAuthState();
  renderConsentForm();
  renderPrivacySettingsForm();
  renderDataControlsForm();
  renderPresenceControls();
  renderDesktopWorkspace();
  await renderActiveUsers({ refreshVersion });
  await loadTopSites({ reason: `${source}-privacy-sync`, refreshVersion });
}

async function savePrivacy(source) {
  const requestedPresenceSharingEnabled = source === 'consent'
    ? els.consentPresenceEnabled.checked
    : source === 'dataControls'
      ? els.dataPresenceSharingEnabled.checked
      : els.presenceSharingEnabled.checked;
  const payload = buildPrivacyPayload(source);
  logStructured('log', '[Connect.Me] Privacy settings save payload', { source, payload });

  try {
    const savedPrivacy = await upsertPrivacySettings(payload);
    logStructured('log', '[Connect.Me] Privacy save succeeded', { source, savedPrivacy, payload });
    invalidatePresenceCaches();
    await syncSavedPrivacyState(savedPrivacy, source);

    if (!savedPrivacy.presenceSharingEnabled || savedPrivacy.invisibleModeEnabled) {
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: `${source}-presence-disabled` });
    } else {
      chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: source === 'consent' ? 'consent-saved' : 'privacy-updated' });
      chrome.runtime.sendMessage({ type: 'REFRESH_TOP_SITES', reason: source === 'consent' ? 'consent-saved' : 'privacy-updated' });
    }

    setInlineValidation('');

    return {
      savedPrivacy,
      presenceDeferred: Boolean(requestedPresenceSharingEnabled && !payload.presenceSharingEnabled)
    };
  } catch (error) {
    logStructured('error', '[Connect.Me] Privacy save failed', {
      source,
      payload,
      error: { message: error.message }
    });
    throw error;
  }
}

async function togglePresence(enabled) {
  logStructured('log', '[Connect.Me] Presence toggle requested', {
    requestedEnabled: enabled,
    savedPrivacy: state.privacy,
    availability: state.presenceAvailability
  });

  if (!state.user) {
    setStatus('Please log in before changing presence settings.', 'error');
    return;
  }
  if (!state.privacy.consentGranted) {
    setStatus('Save consent preferences before enabling presence sharing.', 'error');
    renderPresenceControls();
    return;
  }
  if (!hasCompleteProfile(state.profile)) {
    setStatus('Complete your full profile before enabling presence sharing.', 'error');
    renderPresenceControls();
    return;
  }

  try {
    const savedPrivacy = await updatePresenceSharingPreference(enabled);
    await syncSavedPrivacyState(savedPrivacy, 'presence-toggle');
    if (savedPrivacy.presenceSharingEnabled && !savedPrivacy.invisibleModeEnabled) {
      chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: 'presence-enabled' });
      chrome.runtime.sendMessage({ type: 'REFRESH_TOP_SITES', reason: 'presence-enabled' });
      setStatus('Presence enabled.', 'success');
    } else {
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: 'presence-disabled' });
      chrome.runtime.sendMessage({ type: 'REFRESH_TOP_SITES', reason: 'presence-disabled' });
      setStatus('Presence disabled.', 'success');
    }
  } catch (error) {
    renderPresenceControls();
    setStatus(error.message || 'Unable to update presence settings.', 'error');
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  setStatus('Saving profile…');

  try {
    const profilePayload = buildProfilePayload();
    validateProfilePayload(profilePayload);

    if (state.pendingAvatar) {
      const upload = await uploadProfileImage(state.pendingAvatar);
      profilePayload.avatar_path = upload.path;
      profilePayload.avatar_url = upload.publicUrl;
      setStatus('Profile picture uploaded successfully', 'success');
    }

    const savedProfile = await upsertProfile(profilePayload);
    await saveUserMetadataProfileSnapshot(savedProfile);
    state.pendingAvatar = null;
    els.profileImage.value = '';
    invalidatePresenceCaches();
    await refreshState({ reason: 'profile-updated', force: true });
    if (isDesktopWorkspace) {
      setProfileDrawerOpen(false);
    }
    const successMessage = hasCompleteProfile(state.profile)
      ? 'Profile and visibility settings saved successfully.'
      : 'Profile and visibility settings saved successfully. Add a profile photo and any remaining required details to enable presence.';
    setStatus(successMessage, 'success');
    chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: 'profile-updated' });
    chrome.runtime.sendMessage({ type: 'REFRESH_TOP_SITES', reason: 'profile-updated' });
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function getCacheEntry(map, key, ttl) {
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  if ((Date.now() - entry.fetchedAt) > ttl) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function setCacheEntry(map, key, data) {
  map.set(key, { data, fetchedAt: Date.now() });
  return data;
}

function invalidatePresenceCaches(domain = state.tabInfo?.domain || state.detailDomain) {
  if (domain) {
    state.caches.activeUsers.delete(domain);
    state.caches.detailUsers.delete(domain);
  }
  state.caches.topSites.fetchedAt = 0;
}

async function getCachedTopSites(force = false) {
  if (!force && state.caches.topSites.data && (Date.now() - state.caches.topSites.fetchedAt) <= FETCH_TTL_MS.topSites) {
    return state.caches.topSites.data;
  }
  const data = await fetchTopSites();
  state.caches.topSites = { data, fetchedAt: Date.now() };
  return data;
}

async function getCachedActiveUsers(domain, { force = false, detail = false } = {}) {
  const cache = detail ? state.caches.detailUsers : state.caches.activeUsers;
  if (!force) {
    const cached = getCacheEntry(cache, domain, detail ? FETCH_TTL_MS.detailUsers : FETCH_TTL_MS.activeUsers);
    if (cached) {
      return cached;
    }
  }
  const users = await fetchActiveUsersForDomain(domain);
  setCacheEntry(cache, domain, users);
  if (detail) {
    setCacheEntry(state.caches.activeUsers, domain, users);
  }
  return users;
}

function scheduleRefresh({ reason = 'scheduled', scope = 'full', force = false } = {}) {
  if (scope === 'context' && state.refreshQueuedReason === 'full') {
    return state.refreshPromise || Promise.resolve();
  }
  state.refreshQueuedReason = force || scope === 'full' ? 'full' : (state.refreshQueuedReason || scope);
  if (state.refreshTimerId) {
    clearTimeout(state.refreshTimerId);
  }
  state.refreshPromise = new Promise((resolve) => {
    state.refreshTimerId = window.setTimeout(async () => {
      const queuedScope = state.refreshQueuedReason === 'full' ? 'full' : state.refreshQueuedReason || scope;
      state.refreshTimerId = null;
      state.refreshQueuedReason = null;
      try {
        if (queuedScope === 'context') {
          await refreshContextState({ reason, force });
        } else {
          await refreshState({ reason, force });
        }
      } finally {
        resolve();
      }
    }, REFRESH_DEBOUNCE_MS);
  });
  return state.refreshPromise;
}

function stopTopSitesPolling() {
  if (state.topSitesPollId) {
    clearInterval(state.topSitesPollId);
    state.topSitesPollId = null;
  }
}

function startTopSitesPolling() {
  if (isDesktopWorkspace) {
    return;
  }
  stopTopSitesPolling();
  state.topSitesPollId = window.setInterval(() => {
    if (document.hidden || !state.user) {
      return;
    }
    invalidatePresenceCaches();
    loadTopSites({ reason: isDesktopWorkspace ? 'desktop-poll' : 'popup-poll', refreshVersion: state.refreshVersion, force: true }).catch((error) => {
      logStructured('warn', '[Connect.Me] Top-sites polling failed', { message: error.message });
    });
  }, POLL_INTERVAL_MS);
}

function handleRuntimeMessage(message) {
  if (message?.type === 'ACTIVE_CONTEXT_CHANGED') {
    logStructured('log', `[Connect.Me] ${WORKSPACE_LABEL} current-site event`, message);
    const nextContext = normalizeContextToTabInfo(message?.context || null);
    const domainChanged = (nextContext?.domain || '') !== (state.tabInfo?.domain || '');
    const pathChanged = (nextContext?.path || '') !== (state.tabInfo?.path || '');
    const shouldForce = domainChanged || pathChanged || message?.reason === 'startup' || message?.reason === 'domain-updated';
    scheduleRefresh({ reason: message.reason || 'background-event', scope: 'context', force: shouldForce }).catch((error) => {
      logStructured('error', `[Connect.Me] ${WORKSPACE_LABEL} refresh failed`, { reason: message.reason, message: error.message });
    });
    return;
  }

  if (message?.type === 'TOP_SITES_REFRESH_REQUESTED') {
    logStructured('log', '[Connect.Me] Top-sites refresh trigger', message);
    invalidatePresenceCaches();
    loadTopSites({ reason: message.reason || 'background-request', refreshVersion: state.refreshVersion, force: true }).catch((error) => {
      logStructured('error', '[Connect.Me] Top-sites refresh failed', { reason: message.reason, message: error.message });
    });
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName !== 'local' || !changes?.[ACTIVE_CONTEXT_STORAGE_KEY]) {
    return;
  }

  logStructured('log', `[Connect.Me] ${WORKSPACE_LABEL} storage current-site sync`, {
    oldValue: changes[ACTIVE_CONTEXT_STORAGE_KEY].oldValue || null,
    newValue: changes[ACTIVE_CONTEXT_STORAGE_KEY].newValue || null
  });

  scheduleRefresh({ reason: isDesktopWorkspace ? 'desktop-storage-sync' : 'popup-storage-sync', scope: 'context', force: true }).catch((error) => {
    logStructured('error', `[Connect.Me] ${WORKSPACE_LABEL} storage sync failed`, { message: error.message });
  });
}

function bindRuntimeListeners() {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener('focus', () => {
    scheduleRefresh({ reason: isDesktopWorkspace ? 'desktop-focus' : 'popup-focus', scope: 'context' }).catch((error) => {
      logStructured('error', `[Connect.Me] ${WORKSPACE_LABEL} focus refresh failed`, { message: error.message });
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleRefresh({ reason: isDesktopWorkspace ? 'desktop-visible' : 'popup-visible', scope: 'context' }).catch((error) => {
        logStructured('error', `[Connect.Me] ${WORKSPACE_LABEL} visibility refresh failed`, { message: error.message });
      });
    }
  });
  if (!isDesktopWorkspace) {
    state.contextRefreshId = window.setInterval(() => {
      scheduleRefresh({ reason: isDesktopWorkspace ? 'desktop-fallback-refresh' : 'popup-fallback-refresh', scope: 'context' }).catch((error) => {
        logStructured('warn', `[Connect.Me] ${WORKSPACE_LABEL} fallback refresh missed`, { message: error.message });
      });
    }, CONTEXT_FALLBACK_REFRESH_MS);
  }
  window.addEventListener('beforeunload', () => {
    stopTopSitesPolling();
    if (state.contextRefreshId) {
      clearInterval(state.contextRefreshId);
      state.contextRefreshId = null;
    }
  });
}

function bindElements() {
  [
    'statusBanner', 'desktopDomainMetric', 'authPanel', 'authForm', 'authEmail', 'authPassword', 'signupButton', 'consentPanel', 'consentForm',
    'consentHistoryMode', 'consentRetention', 'consentTrackingEnabled', 'consentPresenceEnabled', 'consentInvisibleMode',
    'profilePanel', 'profileForm', 'profilePrompt', 'logoutButton', 'avatarPreview', 'profileImage', 'shareAvatar', 'firstName', 'lastName',
    'shareFirstName', 'shareLastName', 'placeOfWork', 'sharePlaceOfWork', 'education', 'shareEducation', 'currentLocation',
    'shareCurrentLocation', 'headline', 'bio', 'shareBio', 'presenceQuickToggle', 'openDesktopButton', 'currentDomainBadge', 'currentSiteUrlSummary', 'currentSitePrivacyNote', 'copyCurrentUrlButton',
    'selfProfileSummary', 'presenceSharingInline', 'presenceStateNote', 'activeUsersList', 'refreshTopSites', 'topSitesList',
    'topSiteDetailCard', 'topSiteDetailHeading', 'topSiteDetailSubheading', 'topSiteUsersList', 'closeTopSiteDetail', 'configForm', 'supabaseUrl',
    'supabaseAnonKey', 'privacySettingsForm', 'trackingConsent', 'trackingEnabled', 'historyMode', 'retentionSelect',
    'presenceSharingEnabled', 'invisibleModeEnabled', 'privacyValidationMessage', 'deleteHistoryButton', 'deleteAccountButton',
    'privacyPolicyContent', 'workspaceNav', 'navRailToggle', 'editProfileSectionButton', 'profileWorkspaceSummary', 'profileVisibilitySummary',
    'refreshSupabaseDiagnostics', 'testSupabaseConnection', 'recheckSupabaseConfig', 'supabaseProjectStatus', 'supabaseDiagnosticsStatus',
    'supabaseTablesOverview', 'supabaseStorageOverview', 'supabaseAuthSummary', 'supabaseEnvStatus', 'dataControlsForm',
    'dataPresenceSharingEnabled', 'dataInvisibleModeEnabled', 'dataTrackingEnabled', 'dataHistoryMode', 'dataRetentionSelect',
    'dataControlsValidationMessage', 'dataPresenceSummary', 'dataConsentSummary', 'dataProfileSummary', 'dataRetentionSummary',
    'clearPresenceButton', 'resetConsentButton', 'exportDataButton', 'editProfileFromDataControls', 'learningModulesList',
    'learningModulesStatusBadge', 'learningModulesStatusCallout', 'learningModulesBackendDiagnostics'
  ].forEach((id) => {
    els[id] = $(id);
  });

  els.dashboardShell = document.querySelector('.desktop-dashboard');
  els.profileDrawer = $('profileDrawer');
  els.profileDrawerBackdrop = $('profileDrawerBackdrop');
  els.editProfileButton = $('editProfileButton');
  els.profileSummaryEditButton = $('profileSummaryEditButton');
  els.closeProfileDrawerButton = $('closeProfileDrawerButton');
}

async function bindEvents() {
  if (isDesktopWorkspace) {
    document.querySelectorAll('.workspace-nav-item').forEach((button) => {
      button.addEventListener('click', () => {
        setActiveDesktopSection(button.dataset.section, { openDrawer: button.dataset.section === 'editProfileTab' });
      });
    });
    els.navRailToggle?.addEventListener('click', () => {
      setDesktopNavExpanded(!state.isNavExpanded);
    });
  } else {
    document.querySelectorAll('.tab-link').forEach((button) => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
  }

  els.openDesktopButton?.addEventListener('click', async () => {
    await openDesktopWorkspace();
  });

  els.learningModulesList?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      return;
    }

    const moduleId = actionButton.dataset.moduleId || '';
    const moduleSlug = actionButton.dataset.moduleSlug || '';

    if (actionButton.dataset.action === 'toggle-module') {
      if (state.expandedLearningModules.has(moduleId)) {
        state.expandedLearningModules.delete(moduleId);
      } else {
        state.expandedLearningModules.add(moduleId);
      }
      const moduleCard = actionButton.closest('.learning-module-card');
      const isExpanded = state.expandedLearningModules.has(moduleId);
      moduleCard?.classList.toggle('is-expanded', isExpanded);
      actionButton.setAttribute('aria-expanded', String(isExpanded));
      return;
    }

    if (actionButton.dataset.action === 'toggle-topic') {
      const topicId = actionButton.dataset.topicId || '';
      const topicKey = `${moduleId}:${topicId}`;
      if (state.expandedLearningTopics.has(topicKey)) {
        state.expandedLearningTopics.delete(topicKey);
      } else {
        state.expandedLearningTopics.add(topicKey);
      }
      rerenderLearningModuleTopicPreview(moduleId, topicId);
      return;
    }

    if (actionButton.dataset.action === 'connect-module') {
      await handleLearningModuleConnect(moduleId, moduleSlug);
      return;
    }

    if (actionButton.dataset.action === 'start-module') {
      openLearningModulePlayer(moduleId);
      return;
    }

    if (actionButton.dataset.action === 'return-module-list') {
      returnToLearningModuleList();
      return;
    }

    if (actionButton.dataset.action === 'module-back') {
      moveLearningModuleCard(-1);
      return;
    }

    if (actionButton.dataset.action === 'module-next') {
      moveLearningModuleCard(1);
      return;
    }

    if (actionButton.dataset.action === 'toggle-users') {
      if (state.expandedLearningModuleUsers.has(moduleSlug)) {
        state.expandedLearningModuleUsers.delete(moduleSlug);
        rerenderLearningModuleCard(moduleId);
        return;
      }

      state.expandedLearningModuleUsers.add(moduleSlug);
      rerenderLearningModuleCard(moduleId);
      await loadLearningModuleUsers(moduleSlug);
    }
  });

  [els.editProfileButton, els.profileSummaryEditButton, els.editProfileSectionButton, els.editProfileFromDataControls].filter(Boolean).forEach((button) => {
    button.addEventListener('click', () => {
      if (isDesktopWorkspace) {
        setActiveDesktopSection('editProfileTab', { openDrawer: true });
        return;
      }
      setProfileDrawerOpen(true);
    });
  });

  els.closeProfileDrawerButton?.addEventListener('click', () => {
    setProfileDrawerOpen(false);
  });

  els.profileDrawerBackdrop?.addEventListener('click', () => {
    setProfileDrawerOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.profileDrawerOpen) {
      setProfileDrawerOpen(false);
    }
  });

  els.copyCurrentUrlButton?.addEventListener('click', async () => {
    const value = els.copyCurrentUrlButton.dataset.copyValue || '';
    if (!value) {
      setStatus('No visible URL detail is available to copy yet.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setStatus('Visible URL detail copied to the clipboard.', 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to copy the visible URL detail.', 'error');
    }
  });

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Logging in…');
    try {
      await signIn(els.authEmail.value.trim(), els.authPassword.value);
      invalidatePresenceCaches();
      await refreshState({ reason: 'login', force: true });
      chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: 'login' });
      setStatus('Logged in successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.signupButton.addEventListener('click', async () => {
    setStatus('Creating account…');
    try {
      await signUp(els.authEmail.value.trim(), els.authPassword.value);
      await refreshState({ reason: 'signup', force: true });
      setStatus('Account created successfully. Check your email if confirmation is enabled.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.logoutButton.addEventListener('click', async () => {
    setStatus('Signing out…');
    try {
      await signOut();
      setProfileDrawerOpen(false);
      state.profile = null;
      state.user = null;
      invalidatePresenceCaches();
      await refreshState({ reason: 'logout', force: true });
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: 'logout' });
      setStatus('Logged out successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.consentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving consent preferences…');
    try {
      const { presenceDeferred } = await savePrivacy('consent');
      setStatus(
        presenceDeferred
          ? 'Consent preferences saved successfully. Presence remains off until your full profile is complete.'
          : 'Consent preferences saved successfully and synced from Supabase.',
        'success'
      );
    } catch (error) {
      const message = error.message || 'Unable to save consent preferences.';
      setStatus(message, 'error');
      setInlineValidation(message);
      setFormError('consent', message);
      logStructured('error', '[Connect.Me] Consent save failed', { error: { message: error.message } });
    }
  });

  els.profileImage.addEventListener('change', () => {
    const [file] = els.profileImage.files || [];
    if (!file) {
      state.pendingAvatar = null;
      return;
    }
    if (!file.type.startsWith('image/')) {
      state.pendingAvatar = null;
      els.profileImage.value = '';
      setStatus('Please select an image file for your profile picture.', 'error');
      return;
    }
    state.pendingAvatar = file;
    const reader = new FileReader();
    reader.onload = () => {
      els.avatarPreview.innerHTML = `<img class="avatar avatar-large" src="${reader.result}" alt="Profile preview" />`;
    };
    reader.readAsDataURL(file);
  });

  els.profileForm.addEventListener('submit', handleProfileSubmit);

  els.configForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const config = await readConfig();
    if (els.supabaseUrl) {
      els.supabaseUrl.value = maskUrlPreview(config.url || '');
    }
    if (els.supabaseAnonKey) {
      els.supabaseAnonKey.value = maskValue(config.anonKey || '', { start: 10, end: 6 });
    }
    setStatus('Built-in Supabase configuration loaded successfully.', 'success');
  });

  els.privacySettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving privacy settings…');
    try {
      const { presenceDeferred } = await savePrivacy('settings');
      setStatus(
        presenceDeferred
          ? 'Privacy settings saved successfully. Presence remains off until your full profile is complete.'
          : 'Privacy settings saved successfully and synced from Supabase.',
        'success'
      );
    } catch (error) {
      const message = error.message || 'Unable to save consent preferences.';
      setStatus(message, 'error');
      setInlineValidation(message);
      setFormError('settings', message);
      logStructured('error', '[Connect.Me] Privacy settings save failed', { error: { message: error.message } });
    }
  });

  els.dataControlsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving data controls…');
    try {
      const { presenceDeferred } = await savePrivacy('dataControls');
      setStatus(
        presenceDeferred
          ? 'Data controls saved. Presence remains off until your full profile is complete.'
          : 'Data controls saved successfully.',
        'success'
      );
    } catch (error) {
      const message = error.message || 'Unable to save data controls.';
      els.dataControlsValidationMessage.textContent = message;
      els.dataControlsValidationMessage.classList.remove('hidden');
      setStatus(message, 'error');
    }
  });

  [
    ['consent', els.consentRetention],
    ['settings', els.retentionSelect],
    ['dataControls', els.dataRetentionSelect]
  ].forEach(([source, select]) => {
    select?.addEventListener('change', () => {
      const selection = getRetentionSelectionSnapshot(select);
      const parsed = syncFormState(source, selection, { clearValidation: true });
      if (!parsed) {
        const message = `Unable to parse the selected retention window (${formatRetentionSelectionForMessage(selection)}). Please choose a supported retention value.`;
        if (source === 'dataControls' && els.dataControlsValidationMessage) {
          els.dataControlsValidationMessage.textContent = message;
          els.dataControlsValidationMessage.classList.remove('hidden');
        } else {
          setInlineValidation(message);
        }
        setFormError(source, message);
      }
    });
  });

  [els.presenceQuickToggle, els.presenceSharingInline].filter(Boolean).forEach((input) => {
    input.addEventListener('change', async (event) => {
      await togglePresence(event.target.checked);
    });
  });

  els.clearPresenceButton?.addEventListener('click', async () => {
    const confirmed = await confirmDangerousAction('Clear your current presence data from Connect.Me?');
    if (!confirmed) {
      return;
    }
    setStatus('Clearing presence data…');
    try {
      await clearPresence();
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: 'manual-clear' });
      await refreshState({ reason: 'presence-cleared', force: true });
      setStatus('Presence data cleared successfully.', 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to clear presence data.', 'error');
    }
  });

  els.deleteHistoryButton.addEventListener('click', async () => {
    const confirmed = await confirmDangerousAction('Clear your stored browsing history from Connect.Me?');
    if (!confirmed) {
      return;
    }
    setStatus('Deleting stored history…');
    try {
      await deleteHistory();
      await refreshState({ reason: 'history-deleted', force: true });
      setStatus('Stored history deleted successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.resetConsentButton?.addEventListener('click', async () => {
    const confirmed = await confirmDangerousAction('Reset consent preferences and disable tracking/presence settings?');
    if (!confirmed) {
      return;
    }
    setStatus('Resetting consent preferences…');
    try {
      const resetPrivacy = {
        ...getDefaultPrivacySettings(),
        retentionUnit: state.privacy.retentionUnit,
        retentionValue: state.privacy.retentionValue,
        historyMode: 'domain'
      };
      await upsertPrivacySettings(resetPrivacy);
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: 'consent-reset' });
      await refreshState({ reason: 'consent-reset', force: true });
      setStatus('Consent preferences reset successfully.', 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to reset consent preferences.', 'error');
    }
  });

  els.exportDataButton?.addEventListener('click', () => {
    setStatus('Export my data is not yet implemented in this build. Add an export endpoint to enable this action.', 'info');
  });

  els.deleteAccountButton.addEventListener('click', async () => {
    const confirmed = await confirmDangerousAction('Delete all Connect.Me account data for this user? This cannot be undone.');
    if (!confirmed) {
      return;
    }
    setStatus('Deleting account data…');
    try {
      await deleteAccountData();
      await signOut();
      invalidatePresenceCaches();
      await refreshState({ reason: 'account-deleted', force: true });
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: 'account-deleted' });
      setStatus('Account data deleted successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.refreshSupabaseDiagnostics?.addEventListener('click', async () => {
    setStatus('Refreshing Supabase diagnostics…');
    await runSupabaseDiagnostics({ reason: 'refresh-diagnostics' });
    setStatus('Supabase diagnostics refreshed.', 'success');
  });

  els.testSupabaseConnection?.addEventListener('click', async () => {
    setStatus('Testing Supabase connection…');
    await runSupabaseDiagnostics({ reason: 'test-connection' });
    setStatus('Supabase connection test finished.', 'success');
  });

  els.recheckSupabaseConfig?.addEventListener('click', async () => {
    setStatus('Rechecking Supabase configuration…');
    await runSupabaseDiagnostics({ reason: 'recheck-config', recheckConfig: true });
    setStatus('Supabase configuration rechecked.', 'success');
  });

  els.refreshTopSites.addEventListener('click', async () => {
    setStatus('Refreshing top sites…');
    invalidatePresenceCaches();
    await loadTopSites({ reason: 'manual-refresh', refreshVersion: state.refreshVersion, force: true });
    setStatus('Top sites refreshed', 'success');
  });

  els.closeTopSiteDetail.addEventListener('click', () => {
    state.detailDomain = null;
    els.topSiteDetailCard.classList.add('hidden');
  });
}

async function initialize() {
  setUiInitializationState(false);
  enforcePopupWidth();
  bindElements();
  renderPrivacyTab();
  const config = await ensureBuiltInConfig();
  if (els.supabaseUrl) {
    els.supabaseUrl.value = maskUrlPreview(config.url || '');
    els.supabaseUrl.readOnly = true;
  }
  if (els.supabaseAnonKey) {
    els.supabaseAnonKey.value = maskValue(config.anonKey || '', { start: 10, end: 6 });
    els.supabaseAnonKey.readOnly = true;
  }
  populateSelect(els.historyMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.retentionSelect, getRetentionOptions(), '7|days');
  populateSelect(els.consentHistoryMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.consentRetention, getRetentionOptions(), '7|days');
  if (els.dataHistoryMode) {
    populateSelect(els.dataHistoryMode, HISTORY_MODE_OPTIONS, 'domain');
  }
  if (els.dataRetentionSelect) {
    populateSelect(els.dataRetentionSelect, getRetentionOptions(), '7|days');
  }
  await bindEvents();
  bindRuntimeListeners();
  startTopSitesPolling();
  if (isDesktopWorkspace) {
    setDesktopNavExpanded(false);
    setActiveDesktopSection(state.activeSection);
  }
  await refreshState({ reason: isDesktopWorkspace ? 'desktop-opened' : 'popup-opened', force: true });
  setUiInitializationState(true);
  setStatus('Built-in Supabase configuration loaded successfully.', 'success');
}

initialize().catch((error) => {
  setUiInitializationState(true);
  setStatus(error.message, 'error');
});
