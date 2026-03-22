const STORAGE_KEYS = {
  config: 'supabaseConfig',
  session: 'supabaseSession',
  cachedUser: 'cachedUser'
};

const DEFAULT_PRIVACY_SETTINGS = {
  consentGranted: false,
  trackingEnabled: false,
  historyMode: 'domain',
  retentionUnit: 'days',
  retentionValue: 7,
  presenceSharingEnabled: true,
  invisibleModeEnabled: false
};

function isExtensionContext() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

function promisifyChrome(fn, ctx, ...args) {
  return new Promise((resolve, reject) => {
    fn.call(ctx, ...args, (result) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
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
  const raw = localStorage.getItem('connectme-local-store');
  const parsed = raw ? JSON.parse(raw) : {};
  const next = { ...parsed };
  for (const key of [].concat(keys)) {
    delete next[key];
  }
  localStorage.setItem('connectme-local-store', JSON.stringify(next));
}

function normalizeSupabaseUrl(url) {
  if (!url) {
    throw new Error('Supabase URL is required.');
  }
  return url.replace(/\/+$/, '');
}

async function getConfig() {
  const { [STORAGE_KEYS.config]: config } = await getLocalStore(STORAGE_KEYS.config);
  if (!config?.url || !config?.anonKey) {
    throw new Error('Supabase URL and anon key are required in Settings before continuing.');
  }
  return {
    url: normalizeSupabaseUrl(config.url),
    anonKey: config.anonKey
  };
}

export async function saveConfig(config) {
  await setLocalStore({
    [STORAGE_KEYS.config]: {
      url: normalizeSupabaseUrl(config.url),
      anonKey: config.anonKey.trim()
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

export function buildExpiryIso(retentionUnit, retentionValue) {
  const expiresAt = new Date();
  if (retentionUnit === 'hours') {
    expiresAt.setHours(expiresAt.getHours() + Number(retentionValue));
  } else if (retentionUnit === 'days') {
    expiresAt.setDate(expiresAt.getDate() + Number(retentionValue));
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + Number(retentionValue));
  }
  return expiresAt.toISOString();
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
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in,
    user: session.user
  };
  await setLocalStore({ [STORAGE_KEYS.session]: stored, [STORAGE_KEYS.cachedUser]: stored.user || null });
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
  const refreshed = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!refreshed.ok) {
    await writeSession(null);
    throw new Error('Your session expired. Please sign in again.');
  }
  const data = await refreshed.json();
  return writeSession(data);
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
    throw new Error(data.msg || data.error_description || data.error || 'Authentication failed.');
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
      // Ignore logout network errors and clear local state anyway.
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

async function restRequest(tableOrRpc, { method = 'GET', query = '', body = null, rpc = false } = {}) {
  const session = await ensureValidSession();
  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }
  const prefix = rpc ? '/rest/v1/rpc/' : '/rest/v1/';
  return supabaseFetch(`${prefix}${tableOrRpc}${query}`, {
    method,
    accessToken: session.access_token,
    body: body ? JSON.stringify(body) : undefined
  });
}

export async function getProfile() {
  const rows = await restRequest('profiles', {
    query: '?select=id,email,display_name,headline,bio,presence_visible,avatar_url,created_at,updated_at&limit=1'
  });
  return rows?.[0] || null;
}

export async function upsertProfile(profile) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }
  const rows = await restRequest('profiles', {
    method: 'POST',
    body: {
      id: user.id,
      email: user.email,
      display_name: profile.display_name,
      headline: profile.headline || '',
      bio: profile.bio || '',
      avatar_url: profile.avatar_url || '',
      presence_visible: profile.presence_visible !== false
    },
    query: '?on_conflict=id'
  });
  return rows?.[0] || null;
}

export async function getPrivacySettings() {
  const rows = await restRequest('user_privacy_settings', {
    query: '?select=consent_granted,tracking_enabled,history_mode,retention_unit,retention_value,presence_sharing_enabled,invisible_mode_enabled&limit=1'
  });
  if (!rows?.[0]) {
    return getDefaultPrivacySettings();
  }
  return {
    consentGranted: rows[0].consent_granted,
    trackingEnabled: rows[0].tracking_enabled,
    historyMode: rows[0].history_mode,
    retentionUnit: rows[0].retention_unit,
    retentionValue: rows[0].retention_value,
    presenceSharingEnabled: rows[0].presence_sharing_enabled,
    invisibleModeEnabled: rows[0].invisible_mode_enabled
  };
}

export async function upsertPrivacySettings(settings) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }
  const rows = await restRequest('user_privacy_settings', {
    method: 'POST',
    body: {
      user_id: user.id,
      consent_granted: !!settings.consentGranted,
      tracking_enabled: !!settings.trackingEnabled,
      history_mode: settings.historyMode,
      retention_unit: settings.retentionUnit,
      retention_value: Number(settings.retentionValue),
      presence_sharing_enabled: !!settings.presenceSharingEnabled,
      invisible_mode_enabled: !!settings.invisibleModeEnabled
    },
    query: '?on_conflict=user_id'
  });
  return rows?.[0] || null;
}

export async function recordHistory(entry) {
  return restRequest('browsing_history', {
    method: 'POST',
    body: entry
  });
}

export async function deleteHistory() {
  return restRequest('delete_my_history', { method: 'POST', rpc: true });
}

export async function purgeExpiredHistory() {
  return restRequest('purge_expired_history', { method: 'POST', rpc: true }).catch(() => null);
}

export async function upsertPresence(payload) {
  return restRequest('active_presence', {
    method: 'POST',
    body: payload,
    query: '?on_conflict=user_id'
  });
}

export async function clearPresence() {
  return restRequest('clear_my_presence', { method: 'POST', rpc: true });
}

export async function fetchActiveUsersForDomain(domain) {
  return restRequest(`rpc/get_active_users_for_domain`, {
    method: 'POST',
    rpc: true,
    body: { requested_domain: domain }
  });
}

export async function fetchTopSites() {
  return restRequest('top_active_sites', {
    query: '?select=domain,active_user_count,last_seen&order=active_user_count.desc,last_seen.desc'
  });
}

export async function fetchUsersOnTopSite(domain) {
  return fetchActiveUsersForDomain(domain);
}

export async function deleteAccountData() {
  return restRequest('delete_my_account_completely', {
    method: 'POST',
    rpc: true
  });
}

export function extractTabInfo(urlString) {
  if (!urlString) {
    return null;
  }
  try {
    const url = new URL(urlString);
    if (!/^https?:$/.test(url.protocol)) {
      return null;
    }
    return {
      url: url.toString(),
      origin: url.origin,
      domain: url.hostname,
      path: url.pathname,
      title: url.hostname
    };
  } catch (_error) {
    return null;
  }
}
