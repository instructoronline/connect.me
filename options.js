import {
  getCurrentUser,
  getPrivacySettings,
  getProfile,
  hasCompleteProfile,
  ensureBuiltInConfig,
  normalizeProfileVisibility
} from './supabase.js';

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, type = 'info') {
  const banner = $('optionsStatus');
  if (!message) {
    banner.textContent = '';
    banner.className = 'status-banner hidden';
    return;
  }
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
}

function renderConfig(config) {
  $('configSummary').innerHTML = `
    <div class="summary-item"><strong>URL:</strong> ${config.url}</div>
    <div class="summary-item"><strong>Anon key:</strong> Built in and preloaded for this extension build</div>
    <p class="muted">The popup Settings tab shows these values as read-only because this build is already configured for Supabase.</p>
  `;
}

function renderPrivacy(privacy) {
  $('privacySummary').innerHTML = `
    <div class="summary-item"><strong>Consent:</strong> ${privacy.consentGranted ? 'Granted' : 'Not granted'}</div>
    <div class="summary-item"><strong>History tracking:</strong> ${privacy.trackingEnabled ? 'Enabled' : 'Disabled'}</div>
    <div class="summary-item"><strong>Scope:</strong> ${privacy.historyMode}</div>
    <div class="summary-item"><strong>Retention:</strong> ${privacy.retentionValue} ${privacy.retentionUnit}</div>
    <div class="summary-item"><strong>Presence sharing:</strong> ${privacy.presenceSharingEnabled ? 'Enabled' : 'Disabled'}</div>
    <div class="summary-item"><strong>Invisible Mode:</strong> ${privacy.invisibleModeEnabled ? 'On' : 'Off'}</div>
  `;
}

function renderProfile(user, profile) {
  if (!user) {
    $('profileSummary').innerHTML = '<div class="empty-state">No active user session. Sign in from the popup to continue.</div>';
    return;
  }

  if (!profile) {
    $('profileSummary').innerHTML = '<div class="empty-state">No profile found. Open the popup to create your required profile.</div>';
    return;
  }

  const visibility = normalizeProfileVisibility(profile);

  $('profileSummary').innerHTML = `
    <div class="summary-item"><strong>Signed in as:</strong> ${user.email}</div>
    <div class="summary-item"><strong>Name:</strong> ${profile.first_name} ${profile.last_name}</div>
    <div class="summary-item"><strong>Work:</strong> ${profile.place_of_work}</div>
    <div class="summary-item"><strong>Education:</strong> ${profile.education}</div>
    <div class="summary-item"><strong>Location:</strong> ${profile.current_location}</div>
    <div class="summary-item"><strong>Profile status:</strong> ${hasCompleteProfile(profile) ? 'Complete' : 'Incomplete'}</div>
    <div class="summary-item"><strong>Public avatar:</strong> ${visibility.share_avatar ? 'Share' : 'Not share'}</div>
    <div class="summary-item"><strong>Public first name:</strong> ${visibility.share_first_name ? 'Share' : 'Not share'}</div>
    <div class="summary-item"><strong>Public last name:</strong> ${visibility.share_last_name ? 'Share' : 'Not share'}</div>
    <div class="summary-item"><strong>Public work:</strong> ${visibility.share_place_of_work ? 'Share' : 'Not share'}</div>
    <div class="summary-item"><strong>Public education:</strong> ${visibility.share_education ? 'Share' : 'Not share'}</div>
    <div class="summary-item"><strong>Public location:</strong> ${visibility.share_current_location ? 'Share' : 'Not share'}</div>
    <div class="summary-item"><strong>Public bio:</strong> ${visibility.share_bio ? 'Share' : 'Not share'}</div>
  `;
}

function bindOptionEvents() {
  $('openPopupButton').addEventListener('click', () => {
    chrome.action.openPopup().catch(() => {
      setStatus('Chrome blocked programmatic popup opening. Use the toolbar icon instead.', 'error');
    });
  });

  $('openPrivacyButton').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') });
  });
}

async function initialize() {
  bindOptionEvents();

  try {
    const [config, user] = await Promise.all([ensureBuiltInConfig(), getCurrentUser().catch(() => null)]);
    renderConfig(config);
    setStatus('Built-in Supabase configuration loaded successfully.', 'success');

    if (!user) {
      renderPrivacy({
        consentGranted: false,
        trackingEnabled: false,
        historyMode: 'domain',
        retentionValue: 7,
        retentionUnit: 'days',
        presenceSharingEnabled: false,
        invisibleModeEnabled: false
      });
      renderProfile(null, null);
      return;
    }

    const [privacy, profile] = await Promise.all([
      getPrivacySettings().catch(() => ({
        consentGranted: false,
        trackingEnabled: false,
        historyMode: 'domain',
        retentionValue: 7,
        retentionUnit: 'days',
        presenceSharingEnabled: false,
        invisibleModeEnabled: false
      })),
      getProfile().catch(() => null)
    ]);

    renderPrivacy(privacy);
    renderProfile(user, profile);
  } catch (error) {
    setStatus(error.message, 'error');
  }

}

initialize();