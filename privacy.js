const privacyHtml = `
  <section>
    <h2>What Connect.Me collects</h2>
    <p>Connect.Me collects account credentials managed by Supabase Authentication, your self-authored profile data, your privacy preferences, and optional browsing history or presence data only after you log in and explicitly opt in.</p>
  </section>
  <section>
    <h2>When data is collected</h2>
    <p>No browsing activity is collected before authentication and explicit consent. Presence updates are sent only when presence sharing is enabled and Invisible Mode is disabled. History entries are stored only when optional tracking is enabled.</p>
  </section>
  <section>
    <h2>How long data is retained</h2>
    <p>You choose the retention window for optional browsing history using selectable hour, day, or month ranges. Expired history is purged automatically. Presence records are short-lived and expire within minutes.</p>
  </section>
  <section>
    <h2>Your controls</h2>
    <ul>
      <li>Turn tracking consent on or off.</li>
      <li>Select exactly what history is stored: none, domain, path, or full URL.</li>
      <li>Choose a retention window from 1–12 hours, 1–30 days, or 1–30 months.</li>
      <li>Enable or disable presence sharing at any time.</li>
      <li>Enable Invisible Mode to use the extension without appearing to others.</li>
      <li>Delete stored history or request deletion of your account data from the Settings tab.</li>
    </ul>
  </section>
  <section>
    <h2>Third-party sharing</h2>
    <p><strong>Connect.Me will NOT share your data with ANY third parties.</strong> Supabase is used solely as the data processor you configure for authentication, profile storage, presence, and optional history features.</p>
  </section>
`;

const target = document.getElementById('privacyContent') || document.getElementById('privacyPolicyContent');
if (target) {
  target.innerHTML = privacyHtml;
}

export { privacyHtml };
