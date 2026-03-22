# Connect.Me Chrome Extension

Connect.Me is a production-ready Chrome Extension built with Manifest V3 and Supabase. It provides privacy-first authentication, profile management, optional browsing history tracking after explicit consent, live same-site presence, ranked top sites, retention controls, and clear user-facing privacy disclosures.

## Why this extension is privacy-first

- **No browsing data is collected before authentication and explicit consent.**
- **Users choose exactly what to store**: no history, domain only, domain + path, or full URL.
- **Users choose retention**: 1–12 hours, 1–30 days, or 1–30 months.
- **Presence sharing has a visible ON/OFF toggle** in the popup.
- **Invisible Mode** lets people use the extension while remaining hidden from other users.
- **Profiles must be completed before presence/community features are enabled.**
- **Connect.Me will NOT share user data with ANY third parties.**
- **Permissions are minimized** to `storage`, `tabs`, `alarms`, and optional host permission for the configured Supabase origin.

## Feature overview

### Authentication and account lifecycle
- Sign up and log in through Supabase Auth.
- Sign out from the popup.
- Delete stored browsing history from the popup.
- Delete extension-managed account data from the popup.

### Complete profile workflow
Profiles are required for community presence features and include:
- Profile picture stored in the Supabase Storage bucket `avatars`
- First name
- Last name
- Place of work
- Education
- Current location
- Headline
- Optional short bio

If any required profile field or profile picture is missing, Connect.Me blocks presence sharing until the profile is completed.

### Consent and tracking controls
- After login, the user sees a consent screen before any tracking begins.
- Users can enable or disable optional tracking.
- Users can choose history scope:
  - `none`
  - `domain`
  - `path`
  - `full_url`
- Users can choose retention from:
  - `hours`: 1 through 12
  - `days`: 1 through 30
  - `months`: 1 through 30
- The extension automatically purges expired browsing history.

### Current Site tab
The popup’s **Current Site** tab shows:
- The current domain
- The signed-in user’s profile
- Other currently active users on that same domain if:
  - consent has been granted
  - the profile is complete
  - presence sharing is enabled
  - Invisible Mode is off

### Top Sites tab
The popup’s **Top Sites** tab shows:
- Domains ranked by active user count
- Last activity timestamp for each domain
- A site detail view listing all currently active users when a domain is clicked

### Settings tab
The popup’s **Settings** tab lets the user:
- Paste Supabase URL and anon key
- Grant explicit consent for tracking
- Enable or disable tracking
- Select exactly what history is stored
- Select a valid retention period
- Turn presence sharing on or off
- Turn Invisible Mode on or off
- Delete history
- Delete account data

### Privacy tab and standalone privacy page
- The popup includes a **Privacy** tab.
- The extension also ships a standalone `privacy.html` page.
- Both clearly disclose:
  - what is collected
  - when it is collected
  - how long it is retained
  - how the user can turn tracking off
  - that data will **NOT** be shared with any third parties

## Retention bug fix included

This implementation fixes the consent/settings save bug that previously produced:

```text
null value in column "retention_value" of relation "user_privacy_settings" violates not-null constraint
```

### How the fix works
- Retention values are parsed with strict validation before any request is sent.
- Parsing supports compact values such as `days:7` and human-readable strings such as `7 days`.
- Valid saved values are always split into:
  - `retention_unit`: `hours` | `days` | `months`
  - `retention_value`: integer
- Saving is blocked if parsing fails.
- The popup shows a visible user-friendly validation error instead of sending `null`.

Examples:
- `1 hour` → `retention_unit='hours'`, `retention_value=1`
- `12 hours` → `retention_unit='hours'`, `retention_value=12`
- `1 day` → `retention_unit='days'`, `retention_value=1`
- `30 days` → `retention_unit='days'`, `retention_value=30`
- `1 month` → `retention_unit='months'`, `retention_value=1`
- `30 months` → `retention_unit='months'`, `retention_value=30`

## Files

- `manifest.json` – Manifest V3 definition with minimal permissions and no required icon binaries.
- `background.js` – Service worker for consent-gated tracking, presence heartbeat updates, and periodic purge requests.
- `popup.html` / `popup.js` – Main popup UI with Current Site, Top Sites, Settings, and Privacy tabs.
- `options.html` / `options.js` – Full-page settings overview and quick links.
- `privacy.html` / `privacy.js` – In-extension privacy policy page and popup privacy content.
- `styles.css` – Shared light-theme UI styles with compact Chrome-extension-friendly layout.
- `supabase.js` – Lightweight Supabase integration for auth, storage, presence, history, retention parsing, and privacy settings.
- `docs/supabase-schema.sql` – Database schema, RLS, storage policies, top-sites view, and purge functions.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run `docs/supabase-schema.sql`.
3. Confirm Email auth is enabled in Supabase Authentication.
4. Confirm or create the public Storage bucket named `avatars` if your project policies require manual setup.
5. Copy the project URL and anon key from **Project Settings → API**.
6. Load this extension locally and paste the Supabase URL and anon key in the popup Settings tab.
7. When prompted, grant optional host permission for your exact Supabase origin.

## Loading locally in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Pin **Connect.Me** to the toolbar.
6. Open the popup and save your Supabase settings.

## Manual testing guide

### 1. Sign up / log in
1. Open the popup while signed out.
2. Confirm the auth form is shown.
3. Enter a valid email and password.
4. Click **Sign up** or **Log in**.
5. Confirm a visible success or error message appears.

### 2. Profile creation
1. After login, complete the profile form.
2. Upload an image file for the avatar.
3. Enter first name, last name, place of work, education, and current location.
4. Save the profile.
5. Confirm these messages appear when appropriate:
   - `Profile picture uploaded successfully`
   - `Profile updated successfully`

### 3. Profile editing
1. Reopen the popup.
2. Edit one or more profile fields.
3. Save again.
4. Confirm the visible profile summary updates immediately.

### 4. Consent saving
1. Log in with a user who has not yet granted consent.
2. Confirm the consent panel appears before any presence or history tracking begins.
3. Select a history scope and retention window.
4. Save consent.
5. Confirm the popup shows `Consent saved successfully`.

### 5. Settings save notifications
1. Open the Settings tab.
2. Change one or more privacy controls.
3. Save.
4. Confirm the popup shows `Settings saved successfully`.
5. Try an invalid retention selection in development tools, and confirm the popup shows a validation error instead of saving.

### 6. Current site tracking
1. Enable consent and optional history tracking.
2. Choose `domain` scope.
3. Visit an `https://` site.
4. Confirm the Current Site tab shows the correct domain.
5. Verify new history rows are inserted only after consent and according to the selected scope.

### 7. Top sites behavior
1. Use at least two browser profiles with separate users.
2. Enable presence sharing for both users.
3. Visit the same domain from both users.
4. Open the Top Sites tab.
5. Confirm the domain rises in the ranking with the correct active count.
6. Click the domain and confirm all active users for that site appear.

### 8. Invisible Mode
1. Enable presence sharing.
2. Confirm your user becomes visible on another logged-in client after heartbeat updates.
3. Turn on Invisible Mode.
4. Wait for the short presence expiry window.
5. Confirm the user no longer appears to others while remaining logged in locally.

### 9. Privacy controls
1. Toggle presence OFF from the header or Current Site tab.
2. Confirm the user disappears after expiry.
3. Click **Delete stored history** and verify rows are removed.
4. Click **Delete account data** and verify profile, privacy settings, history, and presence are removed.
5. Review the Privacy tab and standalone privacy page for the disclosure language.

## Validation commands

Recommended local checks:

```bash
python -m json.tool manifest.json
node --check background.js
node --check popup.js
node --check options.js
node --check privacy.js
node --check supabase.js
```

## Chrome Web Store readiness notes

- No binary assets are required for local development.
- The extension avoids remote JavaScript and build tooling to simplify review.
- Permission requests are kept minimal.
- Tracking is off by default and starts only after authentication plus explicit consent.
- Presence visibility is blocked for incomplete profiles and when Invisible Mode is enabled.
- Review the SQL function `delete_my_account_completely()` in your own Supabase environment before production use to ensure it matches your auth and compliance requirements.
