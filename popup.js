import {
  deleteAccountData,
  deleteHistory,
  extractTabInfo,
  fetchActiveUsersForDomain,
  fetchTopSites,
  fetchUsersOnTopSite,
  getCachedUser,
  getCurrentUser,
  getDefaultPrivacySettings,
  getPrivacySettings,
  getProfile,
  getRetentionOptions,
  hasCompleteProfile,
  normalizeRetentionSelection,
  parseRetentionSelection,
  readConfig,
  saveConfig,
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
  pendingAvatar: null
};

const els = {};

function $(id) {
  return document.getElementById(id);
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
  console.log('[Connect.Me] Presence availability updated', state.presenceAvailability);
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

  console.log('[Connect.Me] Retention form state synced', {
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
    const value = option.value ?? `${option.value}|${option.unit}`;
    el.value = value;
    el.textContent = option.label;
    el.selected = value === selectedValue;
    select.appendChild(el);
  });
}

async function getCurrentTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return extractTabInfo(tab?.url);
}

async function maybeRequestSupabasePermission(url) {
  if (!url) {
    return;
  }
  const origin = new URL(url).origin;
  const pattern = `${origin}/*`;
  const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] });
  if (!alreadyGranted) {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      throw new Error('Connect.Me needs host permission for your Supabase URL to save and load data.');
    }
  }
}

function getInitials(profile) {
  const first = profile?.first_name?.[0] || 'C';
  const last = profile?.last_name?.[0] || 'M';
  return `${first}${last}`.toUpperCase();
}

function renderAvatar(profile, size = 'medium') {
  if (profile?.avatar_url) {
    return `<img class="avatar avatar-${size}" src="${escapeHtml(profile.avatar_url)}" alt="${escapeHtml(profile.first_name || 'User')} avatar" />`;
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
  els.consentPanel.classList.toggle('hidden', !loggedIn || state.privacy.consentGranted);
}

function renderProfileForm() {
  els.firstName.value = state.profile?.first_name || '';
  els.lastName.value = state.profile?.last_name || '';
  els.placeOfWork.value = state.profile?.place_of_work || '';
  els.education.value = state.profile?.education || '';
  els.currentLocation.value = state.profile?.current_location || '';
  els.headline.value = state.profile?.headline || '';
  els.bio.value = state.profile?.bio || '';
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
          <span class="badge">${site.active_user_count} active</span>
        </button>
      `
    )
    .join('');

  els.topSitesList.querySelectorAll('[data-domain]').forEach((button) => {
    button.addEventListener('click', () => openTopSiteDetail(button.dataset.domain));
  });
}

function renderUserCard(user) {
  return `
    <div class="user-card">
      <div class="user-row">
        ${renderAvatar(user, 'small')}
        <div>
          <strong>${escapeHtml(user.first_name || '')} ${escapeHtml(user.last_name || '')}</strong>
          <div class="muted">${escapeHtml(user.headline || user.place_of_work || 'Connect.Me member')}</div>
        </div>
      </div>
      <div class="detail-grid compact-grid">
        <span><strong>Work:</strong> ${escapeHtml(user.place_of_work || 'Not shared')}</span>
        <span><strong>Education:</strong> ${escapeHtml(user.education || 'Not shared')}</span>
        <span><strong>Location:</strong> ${escapeHtml(user.current_location || 'Not shared')}</span>
      </div>
      <p>${escapeHtml(user.bio || 'No bio provided.')}</p>
      <small class="muted">Last seen ${new Date(user.last_seen).toLocaleTimeString()}</small>
    </div>
  `;
}

async function openTopSiteDetail(domain) {
  state.detailDomain = domain;
  els.topSiteDetailHeading.textContent = `Users on ${domain}`;
  els.topSiteDetailCard.classList.remove('hidden');
  els.topSiteUsersList.innerHTML = '<div class="empty-state">Loading users…</div>';

  try {
    const users = await fetchUsersOnTopSite(domain);
    els.topSiteUsersList.innerHTML = users?.length
      ? users.map(renderUserCard).join('')
      : '<div class="empty-state">No active users are visible on this site right now.</div>';
  } catch (error) {
    els.topSiteUsersList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function renderActiveUsers() {
  updatePresenceAvailability();

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

  try {
    const users = await fetchActiveUsersForDomain(state.tabInfo.domain);
    const others = (users || []).filter((user) => user.id !== state.user?.id);
    els.activeUsersList.innerHTML = others.length
      ? others.map(renderUserCard).join('')
      : '<div class="empty-state">No other active users are visible on this site right now.</div>';
  } catch (error) {
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

async function loadTopSites() {
  if (!state.user) {
    state.topSites = [];
    renderTopSites();
    return;
  }
  try {
    state.topSites = await fetchTopSites();
  } catch (_error) {
    state.topSites = [];
  }
  renderTopSites();
}

async function refreshState() {
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
      state.privacy = await getPrivacySettings();
    } catch (_error) {
      state.profile = null;
      state.privacy = getDefaultPrivacySettings();
    }
  } else {
    state.profile = null;
    state.privacy = getDefaultPrivacySettings();
  }

  console.log('[Connect.Me] Popup state refreshed', {
    userId: state.user?.id || null,
    profileComplete: hasCompleteProfile(state.profile),
    privacy: state.privacy
  });

  renderAuthState();
  renderProfileForm();
  renderProfileSummary();
  renderConsentForm();
  renderPrivacySettingsForm();
  renderPresenceControls();
  renderPrivacyTab();
  await renderActiveUsers();
  await loadTopSites();
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
    avatar_path: state.profile?.avatar_path || ''
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
  const retention = syncFormState(source, retentionSelection, { clearValidation: true });

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
    presenceSharingEnabled: source === 'consent' ? els.consentPresenceEnabled.checked : els.presenceSharingEnabled.checked,
    invisibleModeEnabled: source === 'consent' ? els.consentInvisibleMode.checked : els.invisibleModeEnabled.checked
  };
}

async function syncSavedPrivacyState(savedPrivacy, source) {
  state.privacy = savedPrivacy || getDefaultPrivacySettings();
  console.log('[Connect.Me] Applying saved privacy state to popup', { source, savedPrivacy: state.privacy });
  renderAuthState();
  renderConsentForm();
  renderPrivacySettingsForm();
  renderPresenceControls();
  await renderActiveUsers();
  await loadTopSites();
}

async function savePrivacy(source) {
  const payload = buildPrivacyPayload(source);
  console.log('[Connect.Me] Attempting privacy save from popup', { source, payload });

  try {
    const savedPrivacy = await upsertPrivacySettings(payload);
    console.log('[Connect.Me] Privacy save succeeded', { source, savedPrivacy, payload });
    await syncSavedPrivacyState(savedPrivacy, source);

    if (!savedPrivacy.presenceSharingEnabled || savedPrivacy.invisibleModeEnabled) {
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE' });
    } else {
      chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: source === 'consent' ? 'consent-saved' : 'privacy-updated' });
    }

    setInlineValidation('');

    return savedPrivacy;
  } catch (error) {
    console.error('[Connect.Me] Privacy save failed', { source, payload, error });
    throw error;
  }
}

async function togglePresence(enabled) {
  console.log('[Connect.Me] Presence toggle requested', {
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
      setStatus('Presence enabled.', 'success');
    } else {
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE' });
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

    state.profile = await upsertProfile(profilePayload);
    await saveUserMetadataProfileSnapshot(state.profile);
    state.pendingAvatar = null;
    els.profileImage.value = '';
    renderProfileForm();
    renderProfileSummary();
    renderPresenceControls();
    await renderActiveUsers();
    setStatus('Profile updated successfully', 'success');
    chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: 'profile-updated' });
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function bindElements() {
  [
    'statusBanner', 'authPanel', 'authForm', 'authEmail', 'authPassword', 'signupButton', 'consentPanel', 'consentForm',
    'consentHistoryMode', 'consentRetention', 'consentTrackingEnabled', 'consentPresenceEnabled', 'consentInvisibleMode',
    'profilePanel', 'profileForm', 'profilePrompt', 'logoutButton', 'avatarPreview', 'profileImage', 'firstName', 'lastName',
    'placeOfWork', 'education', 'currentLocation', 'headline', 'bio', 'presenceQuickToggle', 'currentDomainBadge',
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
      await refreshState();
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
      await refreshState();
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
      await refreshState();
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE' });
      setStatus('Logged out successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.consentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving consent preferences…');
    try {
      await savePrivacy('consent');
      setStatus('Consent preferences saved successfully.', 'success');
    } catch (error) {
      const message = error.message || 'Unable to save consent preferences.';
      setStatus(message, 'error');
      setInlineValidation(message);
      setFormError('consent', message);
      console.error('[Connect.Me] Consent save failed', { error });
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
    setStatus('Saving Supabase settings…');
    try {
      await maybeRequestSupabasePermission(els.supabaseUrl.value.trim());
      await saveConfig({
        url: els.supabaseUrl.value.trim(),
        anonKey: els.supabaseAnonKey.value.trim()
      });
      setStatus('Settings saved successfully', 'success');
      await refreshState();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.privacySettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving privacy settings…');
    try {
      await savePrivacy('settings');
      setStatus('Consent preferences saved successfully.', 'success');
    } catch (error) {
      const message = error.message || 'Unable to save consent preferences.';
      setStatus(message, 'error');
      setInlineValidation(message);
      setFormError('settings', message);
      console.error('[Connect.Me] Privacy settings save failed', { error });
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
      await refreshState();
      chrome.runtime.sendMessage({ type: 'CLEAR_PRESENCE' });
      setStatus('Account data deleted successfully', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.refreshTopSites.addEventListener('click', async () => {
    setStatus('Refreshing top sites…');
    await loadTopSites();
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
  const config = await readConfig();
  els.supabaseUrl.value = config.url || '';
  els.supabaseAnonKey.value = config.anonKey || '';
  populateSelect(els.historyMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.retentionSelect, getRetentionOptions(), '7|days');
  populateSelect(els.consentHistoryMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.consentRetention, getRetentionOptions(), '7|days');
  await bindEvents();
  await refreshState();
}

initialize().catch((error) => {
  setStatus(error.message, 'error');
});
