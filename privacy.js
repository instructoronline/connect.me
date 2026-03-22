export const privacyHtml = `
  <section class="stack-md">
    <p><strong>Last updated:</strong> March 22, 2026</p>
    <h3>1. What Connect.Me collects</h3>
    <ul>
      <li>Your authentication information is managed through Supabase Auth.</li>
      <li>Your profile includes a profile picture, first name, last name, place of work, education, current location, headline, and optional bio.</li>
      <li>If you explicitly grant consent, Connect.Me can store browsing history at the level you choose: none, domain, path, or full URL.</li>
      <li>If presence sharing is enabled and Invisible Mode is off, Connect.Me stores your current active website and a short-lived last-seen heartbeat.</li>
    </ul>

    <h3>2. When data is collected</h3>
    <ul>
      <li>No browsing history or presence data is collected before you log in and explicitly save consent preferences.</li>
      <li>Presence updates are only sent while presence sharing is enabled, your profile is complete, and Invisible Mode is off.</li>
      <li>History tracking only occurs if you enable tracking and select a history scope other than “Store no history.”</li>
    </ul>

    <h3>3. How long data is retained</h3>
    <p>You choose your own retention period. Available options include 1–12 hours, 1–30 days, and 1–30 months. Expired browsing history is purged automatically based on your selected retention setting.</p>

    <h3>4. How to turn tracking off</h3>
    <ul>
      <li>Open the Settings tab and disable optional tracking.</li>
      <li>Turn presence sharing off at any time using the visible ON/OFF toggle.</li>
      <li>Enable Invisible Mode to stay signed in without appearing to other users.</li>
      <li>Use the Delete Stored History button to remove saved browsing history.</li>
      <li>Use the Delete Account Data button to remove extension-managed account data.</li>
    </ul>

    <h3>5. Third-party sharing</h3>
    <p><strong>Connect.Me will NOT share your data with ANY third parties.</strong> Data is stored only in the Supabase project that you configure for Connect.Me and is used exclusively to operate the extension’s features for authenticated users.</p>

    <h3>6. User controls and choices</h3>
    <ul>
      <li>You control whether tracking is enabled.</li>
      <li>You control what browsing history is stored.</li>
      <li>You control how long tracked history is retained.</li>
      <li>You control whether presence sharing is enabled.</li>
      <li>You control whether Invisible Mode is enabled.</li>
      <li>You can update your profile, delete your history, or delete your account data at any time.</li>
    </ul>
  </section>
`;

const mount = document.getElementById('privacyDocument');
if (mount) {
  mount.innerHTML = privacyHtml;
}
