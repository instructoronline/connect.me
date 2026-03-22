import { getDefaultPrivacySettings, getPrivacySettings, readConfig } from './supabase.js';

async function init() {
  const configSummary = document.getElementById('optionsConfigSummary');
  const privacySummary = document.getElementById('optionsPrivacySummary');
  const openPrivacyPage = document.getElementById('openPrivacyPage');

  const config = await readConfig();
  configSummary.innerHTML = config.url
    ? `<strong>${config.url}</strong><p class="muted">Anon key saved locally in Chrome storage for this extension.</p>`
    : 'No Supabase URL or anon key saved yet.';

  let privacy = getDefaultPrivacySettings();
  try {
    privacy = await getPrivacySettings();
  } catch (_error) {
    // Logged-out state or missing backend config.
  }

  privacySummary.innerHTML = `
    <ul class="summary-list">
      <li>Consent granted: <strong>${privacy.consentGranted ? 'Yes' : 'No'}</strong></li>
      <li>Tracking enabled: <strong>${privacy.trackingEnabled ? 'Yes' : 'No'}</strong></li>
      <li>Tracking scope: <strong>${privacy.historyMode}</strong></li>
      <li>Retention: <strong>${privacy.retentionValue} ${privacy.retentionUnit}</strong></li>
      <li>Presence sharing: <strong>${privacy.presenceSharingEnabled ? 'On' : 'Off'}</strong></li>
      <li>Invisible Mode: <strong>${privacy.invisibleModeEnabled ? 'On' : 'Off'}</strong></li>
    </ul>
  `;

  openPrivacyPage.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') });
  });
}

init();
