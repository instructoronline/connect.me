# Connect.Me Chrome Extension

Connect.Me is a privacy-first Chrome Extension built with Manifest V3 and Supabase. It lets users authenticate, create a profile, optionally track browsing history after explicit consent, share live presence on their current site, view who is active on the same domain, and browse ranked top sites by active users.

## Privacy-first principles

- **No browsing data is collected before login and explicit consent.**
- **Users choose exactly what history is stored**: none, domain only, path, or full URL.
- **Users choose retention** from 1–12 hours, 1–30 days, or 1–30 months.
- **Presence sharing is user-controlled** and can be turned OFF instantly.
- **Invisible Mode** lets users browse without appearing to others while keeping the extension available.
- **User data will NOT be shared with ANY third parties.**
- **Permissions are minimized** to storage, tabs, alarms, and an optional runtime host permission for the user’s Supabase origin.

## Included files

- `manifest.json` – Manifest V3 definition with minimal extension permissions.
- `background.js` – Service worker that performs privacy-gated tracking, presence heartbeats, and purging.
- `popup.html` / `popup.js` – Main product UI with Current Site, Top Sites, Settings, and Privacy tabs.
- `options.html` / `options.js` – Secondary settings page with summaries and a privacy policy shortcut.
- `privacy.html` / `privacy.js` – Bundled in-extension privacy policy page.
- `styles.css` – Shared styling for popup and extension pages.
- `supabase.js` – Lightweight fetch-based Supabase client for auth, profiles, privacy settings, history, and presence.
- `docs/supabase-schema.sql` – Supabase tables, RLS policies, SQL functions, and retention helpers.

## Features

### Authentication and profile management
- Sign up and log in with Supabase Auth.
- Create or update a user profile with display name, headline, and bio.
- Prompt for profile completion when the logged-in user does not yet have a profile.

### Consent-driven tracking
- After login, users must complete a consent screen before any tracking begins.
- Tracking remains disabled until the user explicitly opts in.
- Users can change tracking consent, scope, and retention at any time from Settings.

### Tracking controls
- Tracking scope options:
  - `none`
  - `domain`
  - `path`
  - `full_url`
- Retention options:
  - `hours`: 1 through 12
  - `days`: 1 through 30
  - `months`: 1 through 30
- Stored history can be deleted immediately from the popup.

### Presence and top sites
- Current Site tab shows:
  - the current domain
  - the logged-in user’s profile
  - active users on the same domain when presence sharing is enabled and Invisible Mode is off
- Top Sites tab shows domains ranked by active user count.
- Clicking a domain opens a detail view listing active users on that site.
- Presence uses a `last_seen` heartbeat with a short expiry window for “currently active” calculations.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run `docs/supabase-schema.sql`.
3. In **Authentication**, enable Email auth and configure email confirmation to match your product requirements.
4. Copy your project URL and anon key from **Project Settings → API**.
5. Load the extension, open **Settings**, and paste the Supabase URL and anon key.
6. When prompted, grant the optional host permission for your specific Supabase origin.

### Important schema notes

- The SQL file includes RLS policies for profiles, privacy settings, browsing history, and presence.
- `top_active_sites` is implemented as a view for fast popup reads.
- `purge_expired_history()` removes expired history and stale presence data.
- `delete_my_account_completely()` deletes extension-managed account data and the auth row. Review this function in your Supabase environment before using it in production to ensure it aligns with your organization’s security posture and auth permissions.
- `pg_cron` is enabled in the SQL for automatic purging. If your Supabase plan or environment does not support `pg_cron`, the extension still performs purge attempts from the background service worker.

## Loading locally in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository folder containing this extension.
5. Pin **Connect.Me** to your toolbar.
6. Open the popup and enter your Supabase credentials in Settings.

## Testing checklist

### Basic validation
- Verify `manifest.json` loads without errors in `chrome://extensions`.
- Check the background service worker logs in the Extensions page.
- Confirm the popup renders all tabs: Current Site, Top Sites, Settings, Privacy.

### Authentication and profile flow
1. Open the popup while logged out.
2. Confirm the sign-up / login form is shown.
3. Sign up with an email and password.
4. Log in and confirm the consent screen appears before any tracking is enabled.
5. Save a profile and confirm it appears in the Current Site tab.

### Consent and tracking controls
1. Enable explicit consent.
2. Choose a tracking scope such as `domain`.
3. Choose a retention period, for example `7 days`.
4. Confirm history is only stored after consent and only according to the selected scope.
5. Change the scope to `none` and confirm no additional history is written.

### Presence and Invisible Mode
1. Enable presence sharing.
2. Visit a regular `https://` site and confirm your domain appears in the Current Site tab.
3. Open the same site in another browser profile signed into another Connect.Me user.
4. Confirm users appear in the active-users list.
5. Turn ON Invisible Mode and confirm the user disappears from other clients after the short expiry window.
6. Turn OFF presence sharing and confirm the popup no longer shows active users.

### Top Sites
1. With multiple opted-in users active on different domains, open the Top Sites tab.
2. Confirm domains are ranked by active user count.
3. Click a domain and confirm the detail view lists active users on that site.

### Data deletion
1. Click **Delete Stored History** and confirm browsing history is removed.
2. Click **Delete Account Data** and confirm the extension-managed profile, presence, privacy settings, and history are removed.

## Developer notes

- This project intentionally avoids remote JavaScript and build steps to stay review-friendly for Chrome Web Store submission.
- The popup is the primary user experience; the options page is a lightweight summary and launcher.
- Domain-level tracking is the recommended default to minimize collection.
- Update copy, validation, and Supabase SQL policies to match your final legal, compliance, and product review process before store submission.
