const STORAGE_KEYS = {
  config: 'connectme-config',
  session: 'connectme-session',
  cachedUser: 'connectme-cached-user'
};

const DEFAULT_PRIVACY_SETTINGS = {
  consentGranted: false,
  trackingEnabled: false,
  historyMode: 'domain',
  retentionUnit: 'days',
  retentionValue: 7,
  presenceSharingEnabled: false,
  invisibleModeEnabled: false
};

function isExtensionContext() {
  return typeof chrome !== 'undefined' && chrome?.storage?.local;
}

function promisifyChrome(fn, context, ...args) {
  return new Promise((resolve, reject) => {
    fn.call(context, ...args, (result) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

export async function getLocalStore(keys) {
  if (isExtensionContext()) {
    return promisifyChrome(chrome.storage.local.get, chrome.storage.local, keys);
  }
  const raw = localStorage.getItem('connectme-local-store');
  const parsed = raw ? JSON.parse(raw) : {};
  if (Array.isArray(keys)) {
    return keys.reduce((acc, key) => {
      acc[key] = parsed[key];
      return acc;
    }, {});
  }
  return { [keys]: parsed[keys] };
}

export async function setLocalStore(values) {
  if (isExtensionContext()) {
    return promisifyChrome(chrome.storage.local.set, chrome.storage.local, values);
  }
  const raw = localStorage.getItem('connectme-local-store');
  const parsed = raw ? JSON.parse(raw) : {};
  localStorage.setItem('connectme-local-store', JSON.stringify({ ...parsed, ...values }));
}

export async function removeLocalStore(keys) {
  if (isExtensionContext()) {
    return promisifyChrome(chrome.storage.local.remove, chrome.storage.local, keys);
  }
  const keyList = Array.isArray(keys) ? keys : [keys];
  const raw = localStorage.getItem('connectme-local-store');
  const parsed = raw ? JSON.parse(raw) : {};
  keyList.forEach((key) => delete parsed[key]);
  localStorage.setItem('connectme-local-store', JSON.stringify(parsed));
}

function normalizeSupabaseUrl(url) {
  if (!url) {
    throw new Error('Supabase URL is required.');
  }
  return url.trim().replace(/\/+$/, '');
}

async function getConfig() {
  const { [STORAGE_KEYS.config]: config } = await getLocalStore(STORAGE_KEYS.config);
  if (!config?.url || !config?.anonKey) {
    throw new Error('Supabase URL and anon key are required in Settings before continuing.');
  }
  return {
    url: normalizeSupabaseUrl(config.url),
    anonKey: config.anonKey.trim()
  };
}

export async function saveConfig(config) {
  await setLocalStore({
    [STORAGE_KEYS.config]: {
      url: normalizeSupabaseUrl(config.url),
      anonKey: String(config.anonKey || '').trim()
    }
  });
}

export async function readConfig() {
  const { [STORAGE_KEYS.config]: config } = await getLocalStore(STORAGE_KEYS.config);
  return config || { url: '', anonKey: '' };
}

export function getDefaultPrivacySettings() {
  return { ...DEFAULT_PRIVACY_SETTINGS };
}

export function getRetentionOptions() {
  const options = [];
  for (let hour = 1; hour <= 12; hour += 1) {
    options.push({ unit: 'hours', value: hour, label: `${hour} hour${hour === 1 ? '' : 's'}` });
  }
  for (let day = 1; day <= 30; day += 1) {
    options.push({ unit: 'days', value: day, label: `${day} day${day === 1 ? '' : 's'}` });
  }
  for (let month = 1; month <= 30; month += 1) {
    options.push({ unit: 'months', value: month, label: `${month} month${month === 1 ? '' : 's'}` });
  }
  return options;
}

export function parseRetentionSelection(selection) {
  if (!selection) {
    return null;
  }

  const compactMatch = String(selection).trim().match(/^(hours|days|months):(\d{1,2})$/i);
  if (compactMatch) {
    const retentionUnit = compactMatch[1].toLowerCase();
    const retentionValue = Number(compactMatch[2]);
    return validateRetentionParts(retentionUnit, retentionValue) ? { retentionUnit, retentionValue } : null;
  }

  const naturalMatch = String(selection).trim().match(/^(\d{1,2})\s+(hour|hours|day|days|month|months)$/i);
  if (!naturalMatch) {
    return null;
  }

  const retentionValue = Number(naturalMatch[1]);
  const unitToken = naturalMatch[2].toLowerCase();
  const retentionUnit = unitToken.endsWith('s') ? unitToken : `${unitToken}s`;
  return validateRetentionParts(retentionUnit, retentionValue) ? { retentionUnit, retentionValue } : null;
}

function validateRetentionParts(retentionUnit, retentionValue) {
  if (!Number.isInteger(retentionValue) || retentionValue <= 0) {
    return false;
  }
  if (retentionUnit === 'hours') {
    return retentionValue >= 1 && retentionValue <= 12;
  }
  if (retentionUnit === 'days' || retentionUnit === 'months') {
    return retentionValue >= 1 && retentionValue <= 30;
  }
  return false;
}

export function buildExpiryIso(retentionUnit, retentionValue) {
  const expiry = new Date();
  if (retentionUnit === 'hours') {
    expiry.setHours(expiry.getHours() + Number(retentionValue));
  } else if (retentionUnit === 'days') {
    expiry.setDate(expiry.getDate() + Number(retentionValue));
  } else {
    expiry.setMonth(expiry.getMonth() + Number(retentionValue));
  }
  return expiry.toISOString();
}

function authHeaders(config, accessToken) {
  return {
    apikey: config.anonKey,
    Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${config.anonKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

async function supabaseFetch(path, options = {}) {
  const config = await getConfig();
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      ...authHeaders(config, options.accessToken),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.msg || body.message || body.error_description || body.error || JSON.stringify(body);
    } catch (_error) {
      detail = await response.text();
    }
    throw new Error(detail || `Supabase request failed (${response.status})`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readSession() {
  const { [STORAGE_KEYS.session]: session } = await getLocalStore(STORAGE_KEYS.session);
  return session || null;
}

async function writeSession(session) {
  if (!session) {
    await removeLocalStore([STORAGE_KEYS.session, STORAGE_KEYS.cachedUser]);
    return null;
  }

  const stored = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
    user: session.user || null
  };

  await setLocalStore({
    [STORAGE_KEYS.session]: stored,
    [STORAGE_KEYS.cachedUser]: stored.user || null
  });

  return stored;
}

export async function ensureValidSession() {
  const session = await readSession();
  if (!session?.access_token) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if ((session.expires_at || 0) - now > 90) {
    return session;
  }

  if (!session.refresh_token) {
    return session;
  }

  const config = await getConfig();
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  if (!response.ok) {
    await writeSession(null);
    throw new Error('Your session expired. Please sign in again.');
  }

  const refreshed = await response.json();
  return writeSession(refreshed);
}

async function authRequest(path, body) {
  const config = await getConfig();
  const response = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.msg || data.message || data.error_description || data.error || 'Authentication failed.');
  }

  const data = await response.json();
  await writeSession(data);
  return data;
}

export async function signUp(email, password) {
  return authRequest('/auth/v1/signup', { email, password });
}

export async function signIn(email, password) {
  return authRequest('/auth/v1/token?grant_type=password', { email, password });
}

export async function signOut() {
  const session = await readSession();
  if (session?.access_token) {
    try {
      await supabaseFetch('/auth/v1/logout', {
        method: 'POST',
        accessToken: session.access_token
      });
    } catch (_error) {
      // Ignore logout errors and clear local state anyway.
    }
  }
  await writeSession(null);
}

export async function getCurrentUser() {
  const session = await ensureValidSession();
  if (!session?.access_token) {
    return null;
  }
  const user = await supabaseFetch('/auth/v1/user', {
    method: 'GET',
    accessToken: session.access_token
  });
  await setLocalStore({ [STORAGE_KEYS.cachedUser]: user });
  return user;
}

export async function getCachedUser() {
  const { [STORAGE_KEYS.cachedUser]: user } = await getLocalStore(STORAGE_KEYS.cachedUser);
  return user || null;
}

async function restRequest(resource, { method = 'GET', query = '', body = null, rpc = false } = {}) {
  const session = await ensureValidSession();
  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }

  return supabaseFetch(`${rpc ? '/rest/v1/rpc/' : '/rest/v1/'}${resource}${query}`, {
    method,
    accessToken: session.access_token,
    body: body ? JSON.stringify(body) : undefined
  });
}

export function hasCompleteProfile(profile) {
  return Boolean(
    profile?.first_name &&
    profile?.last_name &&
    profile?.place_of_work &&
    profile?.education &&
    profile?.current_location &&
    profile?.avatar_url
  );
}

export async function saveUserMetadataProfileSnapshot(profile) {
  const session = await ensureValidSession();
  if (!session?.access_token || !profile) {
    return;
  }

  const safeProfile = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    avatar_url: profile.avatar_url,
    place_of_work: profile.place_of_work,
    education: profile.education,
    current_location: profile.current_location,
    headline: profile.headline,
    bio: profile.bio
  };

  const config = await getConfig();
  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: 'PUT',
    headers: authHeaders(config, session.access_token),
    body: JSON.stringify({ data: { connectme_profile: safeProfile } })
  });

  if (!response.ok) {
    throw new Error('Profile saved, but the cached profile snapshot could not be updated.');
  }

  const updated = await response.json();
  await setLocalStore({ [STORAGE_KEYS.cachedUser]: updated });
}

export async function getProfile() {
  const rows = await restRequest('profiles', {
    query: '?select=id,email,first_name,last_name,place_of_work,education,current_location,headline,bio,avatar_path,avatar_url,created_at,updated_at&limit=1'
  });
  return rows?.[0] || null;
}

export async function upsertProfile(profile) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  const payload = {
    id: user.id,
    email: user.email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    place_of_work: profile.place_of_work,
    education: profile.education,
    current_location: profile.current_location,
    headline: profile.headline || '',
    bio: profile.bio || '',
    avatar_path: profile.avatar_path || '',
    avatar_url: profile.avatar_url || ''
  };

  const rows = await restRequest('profiles', {
    method: 'POST',
    query: '?on_conflict=id',
    body: payload
  });
  return rows?.[0] || payload;
}

export async function uploadProfileImage(file) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new Error('Please choose an image file for the profile picture.');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  const config = await getConfig();
  const session = await ensureValidSession();
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const uploadUrl = `${config.url}/storage/v1/object/avatars/${path}`;
  const arrayBuffer = await file.arrayBuffer();

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': file.type,
      'x-upsert': 'true'
    },
    body: arrayBuffer
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || 'Profile image upload failed. Verify the avatars bucket exists and allows authenticated uploads.');
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const publicUrl = `${config.url}/storage/v1/object/public/avatars/${encodedPath}`;
  return { path, publicUrl };
}

export async function getPrivacySettings() {
  const rows = await restRequest('user_privacy_settings', {
    query: '?select=consent_granted,tracking_enabled,history_mode,retention_unit,retention_value,presence_sharing_enabled,invisible_mode_enabled&limit=1'
  });
  const row = rows?.[0];
  if (!row) {
    return getDefaultPrivacySettings();
  }
  return {
    consentGranted: Boolean(row.consent_granted),
    trackingEnabled: Boolean(row.tracking_enabled),
    historyMode: row.history_mode,
    retentionUnit: row.retention_unit,
    retentionValue: row.retention_value,
    presenceSharingEnabled: Boolean(row.presence_sharing_enabled),
    invisibleModeEnabled: Boolean(row.invisible_mode_enabled)
  };
}

export async function upsertPrivacySettings(privacy) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  if (!validateRetentionParts(privacy.retentionUnit, Number(privacy.retentionValue))) {
    throw new Error('Please choose a valid retention window before saving your settings.');
  }

  const rows = await restRequest('user_privacy_settings', {
    method: 'POST',
    query: '?on_conflict=user_id',
    body: {
      user_id: user.id,
      consent_granted: Boolean(privacy.consentGranted),
      tracking_enabled: Boolean(privacy.trackingEnabled),
      history_mode: privacy.historyMode,
      retention_unit: privacy.retentionUnit,
      retention_value: Number(privacy.retentionValue),
      presence_sharing_enabled: Boolean(privacy.presenceSharingEnabled),
      invisible_mode_enabled: Boolean(privacy.invisibleModeEnabled)
    }
  });
  return rows?.[0] || null;
}

export async function updatePresenceSharingPreference(enabled) {
  const current = await getPrivacySettings();
  const next = {
    ...current,
    presenceSharingEnabled: Boolean(enabled)
  };
  await upsertPrivacySettings(next);
  return next;
}

export function extractTabInfo(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return {
      url: parsed.toString(),
      domain: parsed.hostname,
      path: parsed.pathname || '/',
      title: parsed.hostname
    };
  } catch (_error) {
    return null;
  }
}

export async function recordHistory(payload) {
  return restRequest('browsing_history', {
    method: 'POST',
    body: payload
  });
}

export async function upsertPresence(payload) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }
  return restRequest('active_presence', {
    method: 'POST',
    query: '?on_conflict=user_id',
    body: {
      user_id: user.id,
      ...payload
    }
  });
}

export async function clearPresence() {
  try {
    await restRequest('clear_my_presence', { method: 'POST', rpc: true });
  } catch (_error) {
    // Ignore if the user is signed out or the backend is unavailable.
  }
}

export async function fetchActiveUsersForDomain(domain) {
  return restRequest('get_active_users_for_domain', {
    method: 'POST',
    rpc: true,
    body: { requested_domain: domain }
  });
}

export async function fetchTopSites() {
  const rows = await restRequest('top_active_sites', {
    query: '?select=domain,active_user_count,last_seen&order=active_user_count.desc,last_seen.desc'
  });
  return rows || [];
}

export async function fetchUsersOnTopSite(domain) {
  return fetchActiveUsersForDomain(domain);
}

export async function deleteHistory() {
  return restRequest('delete_my_history', { method: 'POST', rpc: true });
}

export async function purgeExpiredHistory() {
  return restRequest('purge_expired_history', { method: 'POST', rpc: true });
}

export async function deleteAccountData() {
  return restRequest('delete_my_account_completely', { method: 'POST', rpc: true });
}
