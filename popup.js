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
  readConfig,
  saveConfig,
  signIn,
  signOut,
  signUp,
  upsertPrivacySettings,
  upsertProfile
} from './supabase.js';
import { privacyHtml } from './privacy.js';

const state = {
  user: null,
  profile: null,
  privacy: getDefaultPrivacySettings(),
  tabInfo: null,
  topSites: [],
  topSiteDetailDomain: null
};

const els = {};

const HISTORY_MODE_OPTIONS = [
  { value: 'none', label: 'Store no history' },
  { value: 'domain', label: 'Domain only (recommended)' },
  { value: 'path', label: 'Domain and path' },
  { value: 'full_url', label: 'Full URL' }
];

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, type = 'info') {
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner ${type}`;
  if (!message) {
    els.statusBanner.classList.add('hidden');
  }
}

function populateSelect(select, options, selectedValue) {
  select.innerHTML = '';
  options.forEach((option) => {
    const element = document.createElement('option');
    element.value = option.value ?? `${option.unit}:${option.value}`;
    element.textContent = option.label;
    if ((option.value ?? `${option.unit}:${option.value}`) === selectedValue) {
      element.selected = true;
    }
    select.appendChild(element);
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
  const originPattern = `${new URL(url).origin}/*`;
  const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });
  if (alreadyGranted) {
    return;
  }
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) {
    throw new Error('Supabase host permission is required to connect to your project.');
  }
}

function renderAuthState() {
  els.authPanel.classList.toggle('hidden', !!state.user);
  const profileReady = !!state.user;
  els.profilePanel.classList.toggle('hidden', !profileReady);
  const needsConsent = !!state.user && !state.privacy.consentGranted;
  els.consentPanel.classList.toggle('hidden', !needsConsent);
}

function renderProfileSummary() {
  if (!state.user) {
    els.selfProfileSummary.innerHTML = '<div class="empty-state">Log in to load your profile.</div>';
    return;
  }
  if (!state.profile) {
    els.selfProfileSummary.innerHTML = '<div class="empty-state">Create your profile to appear to others.</div>';
    return;
  }
  els.selfProfileSummary.innerHTML = `
    <div class="user-card self">
      <strong>${state.profile.display_name}</strong>
      <span>${state.profile.headline || 'No headline yet'}</span>
      <p>${state.profile.bio || 'No bio yet.'}</p>
    </div>
  `;
}

function renderDomainBadge() {
  els.currentDomainBadge.textContent = state.tabInfo?.domain || 'Not on a supported page';
}

function renderPresenceControls() {
  const enabled = !!state.privacy.presenceSharingEnabled;
  els.presenceQuickToggle.textContent = `Presence ${enabled ? 'ON' : 'OFF'}`;
  els.presenceQuickToggle.classList.toggle('active', enabled);
  els.presenceSharingInline.checked = enabled;
  els.presenceSharingEnabled.checked = enabled;
  els.invisibleModeEnabled.checked = !!state.privacy.invisibleModeEnabled;
}

function renderPrivacySettingsForm() {
  els.trackingConsent.checked = !!state.privacy.consentGranted;
  els.trackingEnabled.checked = !!state.privacy.trackingEnabled;
  els.presenceSharingEnabled.checked = !!state.privacy.presenceSharingEnabled;
  els.invisibleModeEnabled.checked = !!state.privacy.invisibleModeEnabled;
  const retentionValue = `${state.privacy.retentionUnit}:${state.privacy.retentionValue}`;
  populateSelect(els.historyMode, HISTORY_MODE_OPTIONS, state.privacy.historyMode);
  populateSelect(els.retentionSelect, getRetentionOptions(), retentionValue);
}

function renderConsentForm() {
  populateSelect(els.consentHistoryMode, HISTORY_MODE_OPTIONS, 'domain');
  populateSelect(els.consentRetention, getRetentionOptions(), 'days:7');
  els.consentTrackingEnabled.checked = false;
  els.consentPresenceEnabled.checked = true;
  els.consentInvisibleMode.checked = false;
}

function renderProfileForm() {
  els.displayName.value = state.profile?.display_name || '';
  els.headline.value = state.profile?.headline || '';
  els.bio.value = state.profile?.bio || '';
}

function renderTopSites() {
  if (!state.topSites.length) {
    els.topSitesList.innerHTML = '<div class="empty-state">No active sites yet. Users must opt into presence sharing before sites appear here.</div>';
    return;
  }
  els.topSitesList.innerHTML = '';
  state.topSites.forEach((site) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-item';
    button.innerHTML = `
      <div>
        <strong>${site.domain}</strong>
        <span class="muted">${new Date(site.last_seen).toLocaleTimeString()}</span>
      </div>
      <span class="badge">${site.active_user_count} active</span>
    `;
    button.addEventListener('click', () => openTopSiteDetail(site.domain));
    els.topSitesList.appendChild(button);
  });
}

async function openTopSiteDetail(domain) {
  state.topSiteDetailDomain = domain;
  els.topSiteDetailHeading.textContent = `Users on ${domain}`;
  els.topSiteDetailCard.classList.remove('hidden');
  els.topSiteUsersList.innerHTML = '<div class="empty-state">Loading users…</div>';
  try {
    const users = await fetchUsersOnTopSite(domain);
    if (!users?.length) {
      els.topSiteUsersList.innerHTML = '<div class="empty-state">No currently active users on this site.</div>';
      return;
    }
    els.topSiteUsersList.innerHTML = users.map(renderUserCard).join('');
  } catch (error) {
    els.topSiteUsersList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function renderUserCard(user) {
  return `
    <div class="user-card">
      <strong>${user.display_name || 'Anonymous member'}</strong>
      <span>${user.headline || 'No headline'}</span>
      <p>${user.bio || 'No bio provided.'}</p>
      <small class="muted">Last seen ${new Date(user.last_seen).toLocaleTimeString()}</small>
    </div>
  `;
}

async function renderActiveUsers() {
  const canShowPresence = state.user && state.privacy.presenceSharingEnabled && !state.privacy.invisibleModeEnabled;
  if (!state.tabInfo?.domain) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Open a website to see who is active there.</div>';
    return;
  }
  if (!canShowPresence) {
    els.activeUsersList.innerHTML = '<div class="empty-state">Enable presence sharing and disable Invisible Mode to view live site presence.</div>';
    return;
  }
  try {
    const users = await fetchActiveUsersForDomain(state.tabInfo.domain);
    const filtered = (users || []).filter((user) => user.id !== state.user?.id);
    els.activeUsersList.innerHTML = filtered.length
      ? filtered.map(renderUserCard).join('')
      : '<div class="empty-state">No other active users are sharing presence on this site right now.</div>';
  } catch (error) {
    els.activeUsersList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function renderPrivacyTab() {
  els.privacyPolicyContent.innerHTML = privacyHtml;
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

  renderAuthState();
  renderProfileSummary();
  renderProfileForm();
  renderConsentForm();
  renderPrivacySettingsForm();
  renderPresenceControls();
  renderPrivacyTab();
  await renderActiveUsers();
  if (state.user) {
    await loadTopSites();
  } else {
    state.topSites = [];
    renderTopSites();
  }
}

async function savePrivacyFromForm(source) {
  const retention = (source === 'consent' ? els.consentRetention.value : els.retentionSelect.value).split(':');
  const nextPrivacy = {
    consentGranted: source === 'consent' ? true : els.trackingConsent.checked,
    trackingEnabled: source === 'consent' ? els.consentTrackingEnabled.checked : els.trackingEnabled.checked,
    historyMode: source === 'consent' ? els.consentHistoryMode.value : els.historyMode.value,
    retentionUnit: retention[0],
    retentionValue: Number(retention[1]),
    presenceSharingEnabled: source === 'consent' ? els.consentPresenceEnabled.checked : els.presenceSharingEnabled.checked,
    invisibleModeEnabled: source === 'consent' ? els.consentInvisibleMode.checked : els.invisibleModeEnabled.checked
  };
  await upsertPrivacySettings(nextPrivacy);
  state.privacy = nextPrivacy;
  renderPresenceControls();
  renderPrivacySettingsForm();
  chrome.runtime.sendMessage({ type: 'TRACK_NOW', reason: 'privacy-updated' });
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
      setStatus('Logged in successfully.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.signupButton.addEventListener('click', async () => {
    setStatus('Creating your account…');
    try {
      await signUp(els.authEmail.value.trim(), els.authPassword.value);
      await refreshState();
      setStatus('Account created. Check your email if Supabase email confirmation is enabled.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving profile…');
    try {
      await upsertProfile({
        display_name: els.displayName.value.trim(),
        headline: els.headline.value.trim(),
        bio: els.bio.value.trim(),
        presence_visible: true
      });
      state.profile = await getProfile();
      renderProfileSummary();
      setStatus('Profile saved.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.logoutButton.addEventListener('click', async () => {
    await signOut();
    await refreshState();
    setStatus('Logged out.', 'success');
  });

  els.consentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await savePrivacyFromForm('consent');
      await refreshState();
      setStatus('Consent saved. Tracking will only follow your chosen settings.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving Supabase settings…');
    try {
      await maybeRequestSupabasePermission(els.supabaseUrl.value.trim());
      await saveConfig({
        url: els.supabaseUrl.value.trim(),
        anonKey: els.supabaseAnonKey.value.trim()
      });
      setStatus('Supabase settings saved.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.privacySettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('Saving privacy settings…');
    try {
      await savePrivacyFromForm('settings');
      await refreshState();
      setStatus('Privacy settings updated.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.presenceQuickToggle.addEventListener('click', async () => {
    els.presenceSharingEnabled.checked = !els.presenceSharingEnabled.checked;
    try {
      await savePrivacyFromForm('settings');
      await refreshState();
      setStatus(`Presence sharing ${state.privacy.presenceSharingEnabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.presenceSharingInline.addEventListener('change', async () => {
    els.presenceSharingEnabled.checked = els.presenceSharingInline.checked;
    try {
      await savePrivacyFromForm('settings');
      await refreshState();
      setStatus('Presence preference updated.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.deleteHistoryButton.addEventListener('click', async () => {
    if (!confirm('Delete all stored browsing history from Supabase?')) {
      return;
    }
    try {
      await deleteHistory();
      setStatus('Stored history deleted.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.deleteAccountButton.addEventListener('click', async () => {
    if (!confirm('Delete your profile, privacy settings, presence, and stored history? This action is irreversible.')) {
      return;
    }
    try {
      await deleteAccountData();
      await signOut();
      await refreshState();
      setStatus('Account data deleted.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  els.refreshTopSites.addEventListener('click', async () => {
    await loadTopSites();
    setStatus('Top sites refreshed.', 'success');
  });

  els.closeTopSiteDetail.addEventListener('click', () => {
    els.topSiteDetailCard.classList.add('hidden');
  });
}

async function init() {
  [
    'authPanel', 'consentPanel', 'profilePanel', 'statusBanner', 'authForm', 'authEmail', 'authPassword', 'loginButton', 'signupButton',
    'profileForm', 'displayName', 'headline', 'bio', 'logoutButton', 'currentDomainBadge', 'selfProfileSummary', 'activeUsersList',
    'presenceQuickToggle', 'presenceSharingInline', 'topSitesList', 'topSiteDetailCard', 'topSiteDetailHeading', 'topSiteUsersList',
    'refreshTopSites', 'closeTopSiteDetail', 'configForm', 'supabaseUrl', 'supabaseAnonKey', 'privacySettingsForm', 'trackingConsent',
    'trackingEnabled', 'historyMode', 'retentionSelect', 'presenceSharingEnabled', 'invisibleModeEnabled', 'deleteHistoryButton',
    'deleteAccountButton', 'consentForm', 'consentHistoryMode', 'consentRetention', 'consentTrackingEnabled', 'consentPresenceEnabled',
    'consentInvisibleMode', 'privacyPolicyContent'
  ].forEach((id) => {
    els[id] = $(id);
  });

  const config = await readConfig();
  els.supabaseUrl.value = config.url || '';
  els.supabaseAnonKey.value = config.anonKey || '';

  await bindEvents();
  await refreshState();
}

init().catch((error) => {
  setStatus(error.message, 'error');
});
