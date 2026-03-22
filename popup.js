import {
  deleteAccountData,
  deleteHistory,
  ensureBuiltInConfig,
  extractTabInfo,
  fetchActiveUsersForDomain,
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
  signIn,
  signOut,
  signUp,
  updatePresenceSharingPreference,
  uploadProfileImage,
  upsertPrivacySettings,
  upsertProfile
} from './supabase.js';
import { privacyHtml } from './privacy.js';

const HISTORY_MODE_OPTIONS = [
  { value: 'none', label: 'Store no history' },
  { value: 'domain', label: 'Domain only (recommended)' },
  { value: 'path', label: 'Domain and path' },
  { value: 'full_url', label: 'Full URL' }
];

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
  formState: {
    consent: createFormState(),
    settings: createFormState()
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
  detailUsersRequestId: 0
};

const els = {};

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

function formatActiveUserLabel(count) {
  const safeCount = Number(count) || 0;
  return `${safeCount} active user${safeCount === 1 ? '' : 's'}`;
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

function setStatus(message, type = 'info') {
  if (!message) {
    els.statusBanner.textContent = '';
    els.statusBanner.className = 'status-banner hidden';
    return;
  }
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner ${type}`;
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

async function getCurrentTabInfo() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' });
    if (response?.ok && response.context?.url) {
      return extractTabInfo(response.context.url);
    }
  } catch (_error) {
    // Fall back to querying the active tab directly when the service worker is unavailable.
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return extractTabInfo(tab?.url);
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

function renderAuthState() {
  const loggedIn = Boolean(state.user);
  els.authPanel.classList.toggle('hidden', loggedIn);
  els.profilePanel.classList.toggle('hidden', !loggedIn);
  els.consentPanel.classList.toggle('hidden', !loggedIn || state.hasSavedPrivacySettings);
}

function renderProfileForm() {
  const visibility = normalizeProfileVisibility(state.profile || {});
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
  els.avatarPreview.innerHTML = renderAvatar(state.profile, 'large');
  renderProfilePrompt();
}

function renderProfileSummary() {
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
  els.currentDomainBadge.textContent = state.tabInfo?.domain || 'No website detected';
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

function renderTopSites() {
  if (!state.user || !state.topSites.length) {
    els.topSitesList.innerHTML = '<div class="empty-state">No ranked sites are available yet. Users must opt into presence sharing before sites appear here.</div>';
    return;
  }

  els.topSitesList.innerHTML = state.topSites
    .map(
      (site) => `
        <button type="button" class="list-item site-item" data-domain="${escapeHtml(site.domain)}">
          <div>
            <strong>${escapeHtml(site.domain)}</strong>
            <div class="muted">Last active ${new Date(site.last_seen).toLocaleTimeString()}</div>
          </div>
          <span class="badge">${formatActiveUserLabel(site.active_user_count)}</span>
        </button>
      `
    )
    .join('');

  els.topSitesList.querySelectorAll('[data-domain]').forEach((button) => {
    button.addEventListener('click', () => openTopSiteDetail(button.dataset.domain));
  });
}

function renderUserCard(user) {
  logStructured('log', '[Connect.Me] Raw fetched shared-user payload', user);

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
  const hasSharedName = Boolean(sharedName);
  const hasPrimaryText = Boolean(sharedFields.professional_headline || sharedFields.place_of_work || sharedFields.education || sharedFields.current_location || sharedFields.bio);
  const titleMarkup = hasSharedName
    ? `<strong>${escapeHtml(sharedName)}</strong>`
    : '<strong>Connect.Me member</strong>';
  const subtitleText = sharedFields.professional_headline || sharedFields.place_of_work || '';
  const subtitleMarkup = subtitleText
    ? `<div class="muted">${escapeHtml(subtitleText)}</div>`
    : (!hasSharedName && !sharedFields.avatar_url && !hasPrimaryText
      ? '<div class="muted">Connect.Me member</div>'
      : '');
  const sharedMeta = [
    sharedFields.place_of_work ? `<span class="meta-pill">Work: ${escapeHtml(sharedFields.place_of_work)}</span>` : '',
    sharedFields.education ? `<span class="meta-pill">Education: ${escapeHtml(sharedFields.education)}</span>` : '',
    sharedFields.current_location ? `<span class="meta-pill">Location: ${escapeHtml(sharedFields.current_location)}</span>` : ''
  ].filter(Boolean).join('');
  const sharedFieldCount = [
    Boolean(sharedFields.avatar_url),
    Boolean(sharedFields.first_name),
    Boolean(sharedFields.last_name),
    Boolean(sharedFields.place_of_work),
    Boolean(sharedFields.education),
    Boolean(sharedFields.current_location),
    Boolean(sharedFields.bio),
    Boolean(sharedFields.professional_headline)
  ].filter(Boolean).length;
  const limitedProfileNote = sharedFieldCount <= 2
    ? '<p class="muted hidden-field-note">This user is sharing a limited public profile.</p>'
    : '';
  const detailMarkup = [
    sharedMeta ? `<div class="user-meta-list">${sharedMeta}</div>` : '',
    sharedFields.bio ? `<p>${escapeHtml(sharedFields.bio)}</p>` : '',
    limitedProfileNote
  ].filter(Boolean).join('');
  const avatarProfile = {
    ...publicUser,
    avatar_url: sharedFields.avatar_url,
    avatar_path: sharedFields.avatar_path,
    first_name: sharedFields.first_name,
    last_name: sharedFields.last_name
  };

  logStructured('log', '[Connect.Me] Share flags for shared-user card', {
    userId: publicUser.id,
    shareFlags: visibility
  });
  logStructured('log', '[Connect.Me] Resolved avatar URL for shared-user card', {
    userId: publicUser.id,
    avatar_path: sharedFields.avatar_path,
    avatar_url: sharedFields.avatar_url
  });
  logStructured('log', '[Connect.Me] Final rendered field set for shared-user card', {
    userId: publicUser.id,
    sharedFieldCount,
    renderedFields: {
      has_name: hasSharedName,
      professional_headline: sharedFields.professional_headline,
      place_of_work: sharedFields.place_of_work,
      education: sharedFields.education,
      current_location: sharedFields.current_location,
      bio: sharedFields.bio,
      avatar_url: sharedFields.avatar_url,
      limited_profile_note: sharedFieldCount <= 2
    }
  });

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

async function openTopSiteDetail(domain) {
  state.detailDomain = domain;
  const requestId = ++state.detailUsersRequestId;
  els.topSiteDetailHeading.textContent = `Users on ${domain}`;
  els.topSiteDetailCard.classList.remove('hidden');
  els.topSiteUsersList.innerHTML = '<div class="empty-state">Loading users…</div>';

  try {
    const users = await fetchUsersOnTopSite(domain);
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

async function renderActiveUsers({ refreshVersion = state.refreshVersion } = {}) {
  updatePresenceAvailability();
  const requestId = ++state.activeUsersRequestId;

  if (!state.tabInfo?.domain) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Open a website to view live activity on the current domain.</div>';
    return;
  }

  if (!state.user) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Sign in to use Connect.Me on this site.</div>';
    return;
  }

  if (!state.presenceAvailability.consentSaved) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Save consent preferences before any presence data is shown.</div>';
    return;
  }

  if (!state.presenceAvailability.profileComplete) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Complete your full profile to use presence and community features.</div>';
    return;
  }

  if (!state.presenceAvailability.canViewPresenceData) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Turn on presence sharing and turn off Invisible Mode to see other active users here.</div>';
    return;
  }

  els.activeUsersList.innerHTML = '<div class="empty-state">Refreshing live members…</div>';

  try {
    const users = await fetchActiveUsersForDomain(state.tabInfo.domain);
    if (requestId !== state.activeUsersRequestId || isStaleRefresh(refreshVersion)) {
      return;
    }

    const others = (users || []).filter((user) => user.id !== state.user?.id);
    els.activeUsersList.innerHTML = others.length
      ? others.map(renderUserCard).join('')
      : '<div class="empty-state">No other active users are visible on this site right now.</div>';
  } catch (error) {
    if (requestId !== state.activeUsersRequestId || isStaleRefresh(refreshVersion)) {
      return;
    }

    els.activeUsersList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-link').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

async function loadTopSites({ reason = 'manual', refreshVersion = state.refreshVersion } = {}) {
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

  try {
    state.topSites = await fetchTopSites();
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
      await openTopSiteDetail(state.detailDomain);
    } else {
      state.detailDomain = null;
      els.topSiteDetailCard.classList.add('hidden');
    }
  }
}

async function refreshState({ reason = 'manual' } = {}) {
  const refreshVersion = bumpRefreshVersion();
  state.tabInfo = await getCurrentTabInfo();
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

  logStructured('log', '[Connect.Me] Popup state refreshed', {
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
  renderPresenceControls();
  renderPrivacyTab();
  await renderActiveUsers({ refreshVersion });
  await loadTopSites({ reason, refreshVersion });
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
  const retentionSelection = source === 'consent'
    ? getRetentionSelectionSnapshot(els.consentRetention)
    : getRetentionSelectionSnapshot(els.retentionSelect);
  logStructured('log', '[Connect.Me] Retention dropdown raw value', { source, retentionSelection });
  const retention = syncFormState(source, retentionSelection, { clearValidation: true });
  const requestedPresenceSharingEnabled = source === 'consent'
    ? els.consentPresenceEnabled.checked
    : els.presenceSharingEnabled.checked;

  if (!retention) {
    const message = `Unable to parse the selected retention window (${formatRetentionSelectionForMessage(retentionSelection)}). Please choose one of the supported values, such as 1 hour, 2 hours, 12 hours, 1 day, 30 days, 1 month, or 30 months.`;
    setFormError(source, message);
    throw new Error(message);
  }

  setFormError(source, '');

  return {
    consentGranted: source === 'consent' ? true : els.trackingConsent.checked,
    trackingEnabled: source === 'consent' ? els.consentTrackingEnabled.checked : els.trackingEnabled.checked,
    historyMode: source === 'consent' ? els.consentHistoryMode.value : els.historyMode.value,
    retentionUnit: retention.retentionUnit,
    retentionValue: retention.retentionValue,
    presenceSharingEnabled: requestedPresenceSharingEnabled && hasCompleteProfile(state.profile),
    invisibleModeEnabled: source === 'consent' ? els.consentInvisibleMode.checked : els.invisibleModeEnabled.checked
  };
}

async function syncSavedPrivacyState(savedPrivacy, source) {
  state.privacy = savedPrivacy || getDefaultPrivacySettings();
  state.hasSavedPrivacySettings = Boolean(savedPrivacy);
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
  renderPresenceControls();
  await renderActiveUsers({ refreshVersion });
  await loadTopSites({ reason: `${source}-privacy-sync`, refreshVersion });
}

async function savePrivacy(source) {
  const requestedPresenceSharingEnabled = source === 'consent'
    ? els.consentPresenceEnabled.checked
    : els.presenceSharingEnabled.checked;
  const payload = buildPrivacyPayload(source);
  logStructured('log', '[Connect.Me] Privacy settings save payload', { source, payload });

  try {
    const savedPrivacy = await upsertPrivacySettings(payload);
    logStructured('log', '[Connect.Me] Privacy save succeeded', { source, savedPrivacy, payload });
    await refreshState({ reason: `${source}-saved` });
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
    await refreshState({ reason: 'profile-updated' });
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

function stopTopSitesPolling() {
  if (state.topSitesPollId) {
    clearInterval(state.topSitesPollId);
    state.topSitesPollId = null;
  }
}

function startTopSitesPolling() {
  stopTopSitesPolling();
  state.topSitesPollId = window.setInterval(() => {
    loadTopSites({ reason: 'popup-poll', refreshVersion: state.refreshVersion }).catch((error) => {
      logStructured('warn', '[Connect.Me] Top-sites polling failed', { message: error.message });
    });
  }, 30000);
}

function handleRuntimeMessage(message) {
  if (message?.type === 'ACTIVE_CONTEXT_CHANGED') {
    logStructured('log', '[Connect.Me] Popup refresh trigger', message);
    refreshState({ reason: message.reason || 'background-event' }).catch((error) => {
      logStructured('error', '[Connect.Me] Popup refresh failed', { reason: message.reason, message: error.message });
    });
    return;
  }

  if (message?.type === 'TOP_SITES_REFRESH_REQUESTED') {
    logStructured('log', '[Connect.Me] Top-sites refresh trigger', message);
    loadTopSites({ reason: message.reason || 'background-request', refreshVersion: state.refreshVersion }).catch((error) => {
      logStructured('error', '[Connect.Me] Top-sites refresh failed', { reason: message.reason, message: error.message });
    });
  }
}

function bindRuntimeListeners() {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener('focus', () => {
    refreshState({ reason: 'popup-focus' }).catch((error) => {
      logStructured('error', '[Connect.Me] Popup focus refresh failed', { message: error.message });
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshState({ reason: 'popup-visible' }).catch((error) => {
        logStructured('error', '[Connect.Me] Popup visibility refresh failed', { message: error.message });
      });
    }
  });
  window.addEventListener('beforeunload', stopTopSitesPolling);
}

function bindElements() {
  [
    'statusBanner', 'authPanel', 'authForm', 'authEmail', 'authPassword', 'signupButton', 'consentPanel', 'consentForm',
    'consentHistoryMode', 'consentRetention', 'consentTrackingEnabled', 'consentPresenceEnabled', 'consentInvisibleMode',
    'profilePanel', 'profileForm', 'profilePrompt', 'logoutButton', 'avatarPreview', 'profileImage', 'shareAvatar', 'firstName', 'lastName',
    'shareFirstName', 'shareLastName', 'placeOfWork', 'sharePlaceOfWork', 'education', 'shareEducation', 'currentLocation',
    'shareCurrentLocation', 'headline', 'bio', 'shareBio', 'presenceQuickToggle', 'currentDomainBadge',
    'selfProfileSummary', 'presenceSharingInline', 'presenceStateNote', 'activeUsersList', 'refreshTopSites', 'topSitesList',
    'topSiteDetailCard', 'topSiteDetailHeading', 'topSiteUsersList', 'closeTopSiteDetail', 'configForm', 'supabaseUrl',
    'supabaseAnonKey', 'privacySettingsForm', 'trackingConsent', 'trackingEnabled', 'historyMode', 'retentionSelect',
    'presenceSharingEnabled', 'invisibleModeEnabled', 'privacyValidationMessage', 'deleteHistoryButton', 'deleteAccountButton',
    'privacyPolicyContent'
  ].forEach((id) => {
    els[id] = $(id);
  });
}

async function bindEvents() {
  document.querySelectorAll('.tab-link').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Logging in…');
    try {
      await signIn(els.authEmail.value.trim(), els.authPassword.value);
      await refreshState({ reason: 'login' });
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
      await refreshState({ reason: 'signup' });
      setStatus('Account created successfully. Check your email if confirmation is enabled.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.logoutButton.addEventListener('click', async () => {
    setStatus('Signing out…');
    try {
      await signOut();
      state.profile = null;
      state.user = null;
      await refreshState({ reason: 'logout' });
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

  els.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const config = await readConfig();
    els.supabaseUrl.value = config.url || '';
    els.supabaseAnonKey.value = config.anonKey || '';
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

  [
    ['consent', els.consentRetention],
    ['settings', els.retentionSelect]
  ].forEach(([source, select]) => {
    select.addEventListener('change', () => {
      const selection = getRetentionSelectionSnapshot(select);
      const parsed = syncFormState(source, selection, { clearValidation: true });
      if (!parsed) {
        const message = `Unable to parse the selected retention window (${formatRetentionSelectionForMessage(selection)}). Please choose a supported retention value.`;
        setInlineValidation(message);
        setFormError(source, message);
      }
    });
  });

  [els.presenceQuickToggle, els.presenceSharingInline].forEach((input) => {
    input.addEventListener('change', async (event) => {
      await togglePresence(event.target.checked);
    });
  });

  els.deleteHistoryButton.addEventListener('click', async () => {
    setStatus('Deleting stored history…');
    try {
      await deleteHistory();
      setStatus('Stored history deleted successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.deleteAccountButton.addEventListener('click', async () => {
    setStatus('Deleting account data…');
    try {
      await deleteAccountData();
      await signOut();
      await refreshState({ reason: 'account-deleted' });
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE', reason: 'account-deleted' });
      setStatus('Account data deleted successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.refreshTopSites.addEventListener('click', async () => {
    setStatus('Refreshing top sites…');
    await loadTopSites({ reason: 'manual-refresh', refreshVersion: state.refreshVersion });
    setStatus('Top sites refreshed', 'success');
  });

  els.closeTopSiteDetail.addEventListener('click', () => {
    state.detailDomain = null;
    els.topSiteDetailCard.classList.add('hidden');
  });
}

async function initialize() {
  bindElements();
  renderPrivacyTab();
  const config = await ensureBuiltInConfig();
  els.supabaseUrl.value = config.url || '';
  els.supabaseAnonKey.value = config.anonKey || '';
  els.supabaseUrl.readOnly = true;
  els.supabaseAnonKey.readOnly = true;
  populateSelect(els.historyMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.retentionSelect, getRetentionOptions(), '7|days');
  populateSelect(els.consentHistoryMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.consentRetention, getRetentionOptions(), '7|days');
  await bindEvents();
  bindRuntimeListeners();
  startTopSitesPolling();
  await refreshState({ reason: 'popup-opened' });
  setStatus('Built-in Supabase configuration loaded successfully.', 'success');
}

initialize().catch((error) => {
  setStatus(error.message, 'error');
});
