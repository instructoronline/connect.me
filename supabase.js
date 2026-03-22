const STORAGE_KEYS = {
  config: 'connectme-config',
  session: 'connectme-session',
  cachedUser: 'connectme-cached-user'
};

export const BUILT_IN_SUPABASE_CONFIG = Object.freeze({
  url: 'https://dhmtljnjygcqzjrhhscu.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXRsam5qeWdjcXpqcmhoc2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDEzNjksImV4cCI6MjA4OTc3NzM2OX0.U_FPABVKYafvdEC9ewRt2hbARKta-fjHvLfKhbvltas'
});

const DEFAULT_PRIVACY_SETTINGS = {
  consentGranted: false,
  trackingEnabled: false,
  historyMode: 'domain',
  retentionUnit: 'days',
  retentionValue: 7,
  presenceSharingEnabled: false,
  invisibleModeEnabled: false
};

export const PROFILE_VISIBILITY_FIELDS = Object.freeze({
  share_avatar: true,
  share_first_name: true,
  share_last_name: true,
  share_place_of_work: true,
  share_education: true,
  share_current_location: true,
  share_bio: true
});

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

function getBuiltInConfig() {
  return {
    url: normalizeSupabaseUrl(BUILT_IN_SUPABASE_CONFIG.url),
    anonKey: BUILT_IN_SUPABASE_CONFIG.anonKey.trim()
  };
}

function isBuiltInConfig(config) {
  const builtIn = getBuiltInConfig();
  return config?.url === builtIn.url && config?.anonKey === builtIn.anonKey;
}

export async function ensureBuiltInConfig() {
  const builtIn = getBuiltInConfig();
  const { [STORAGE_KEYS.config]: storedConfig } = await getLocalStore(STORAGE_KEYS.config);

  if (!isBuiltInConfig(storedConfig)) {
    await setLocalStore({
      [STORAGE_KEYS.config]: builtIn
    });
  }

  return builtIn;
}

async function getConfig() {
  return ensureBuiltInConfig();
}

export async function saveConfig(_config = BUILT_IN_SUPABASE_CONFIG) {
  return ensureBuiltInConfig();
}

export async function readConfig() {
  return ensureBuiltInConfig();
}

export function getDefaultPrivacySettings() {
  return { ...DEFAULT_PRIVACY_SETTINGS };
}

export function getRetentionOptions() {
  const options = [];
  for (let hour = 1; hour <= 12; hour += 1) {
    options.push({
      unit: 'hours',
      retentionValue: hour,
      value: `${hour}|hours`,
      label: `${hour} hour${hour === 1 ? '' : 's'}`
    });
  }
  for (let day = 1; day <= 30; day += 1) {
    options.push({
      unit: 'days',
      retentionValue: day,
      value: `${day}|days`,
      label: `${day} day${day === 1 ? '' : 's'}`
    });
  }
  for (let month = 1; month <= 30; month += 1) {
    options.push({
      unit: 'months',
      retentionValue: month,
      value: `${month}|months`,
      label: `${month} month${month === 1 ? '' : 's'}`
    });
  }
  return options;
}

function stringifyLogValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function normalizeRetentionUnit(unit) {
  if (!unit) {
    return null;
  }

  const normalized = String(unit).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['hour', 'hours'].includes(normalized)) {
    return 'hours';
  }
  if (['day', 'days'].includes(normalized)) {
    return 'days';
  }
  if (['month', 'months'].includes(normalized)) {
    return 'months';
  }
  return null;
}

function parseRetentionMachineValue(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  let match = trimmed.match(/^(\d{1,2})\|(hours|days|months)$/i);
  if (match) {
    return {
      retentionValue: Number(match[1]),
      retentionUnit: match[2].toLowerCase(),
      format: 'machine-value'
    };
  }

  match = trimmed.match(/^(hours|days|months):(\d{1,2})$/i);
  if (match) {
    return {
      retentionValue: Number(match[2]),
      retentionUnit: match[1].toLowerCase(),
      format: 'legacy-compact'
    };
  }

  match = trimmed.match(/^(\d{1,2})\s+(hour|hours|day|days|month|months)$/i);
  if (match) {
    return {
      retentionValue: Number(match[1]),
      retentionUnit: normalizeRetentionUnit(match[2]),
      format: 'natural-label'
    };
  }

  return null;
}

export function normalizeRetentionSelection(selection) {
  const normalized = {
    rawSelection: selection,
    selectionType: selection === null ? 'null' : Array.isArray(selection) ? 'array' : typeof selection,
    machineValue: null,
    displayLabel: null,
    derivedFrom: null,
    fieldSnapshot: null
  };

  if (selection == null || selection === '') {
    return normalized;
  }

  if (typeof selection === 'string') {
    const trimmed = selection.trim();
    return {
      ...normalized,
      machineValue: trimmed || null,
      displayLabel: trimmed || null,
      derivedFrom: 'string'
    };
  }

  if (typeof selection === 'number') {
    const asString = String(selection);
    return {
      ...normalized,
      machineValue: asString,
      displayLabel: asString,
      derivedFrom: 'number'
    };
  }

  if (typeof selection === 'object') {
    const snapshot = {
      value: selection.value ?? null,
      label: selection.label ?? null,
      selected: selection.selected ?? null,
      retentionValue: selection.retentionValue ?? null,
      retentionUnit: selection.retentionUnit ?? null,
      unit: selection.unit ?? null
    };

    if (selection.retentionValue != null && normalizeRetentionUnit(selection.retentionUnit ?? selection.unit)) {
      return {
        ...normalized,
        machineValue: `${Number(selection.retentionValue)}|${normalizeRetentionUnit(selection.retentionUnit ?? selection.unit)}`,
        displayLabel: selection.label ? String(selection.label).trim() : null,
        derivedFrom: 'retention-parts',
        fieldSnapshot: snapshot
      };
    }

    if (typeof selection.value === 'number' && normalizeRetentionUnit(selection.unit ?? selection.retentionUnit)) {
      return {
        ...normalized,
        machineValue: `${selection.value}|${normalizeRetentionUnit(selection.unit ?? selection.retentionUnit)}`,
        displayLabel: selection.label ? String(selection.label).trim() : null,
        derivedFrom: 'numeric-value-and-unit',
        fieldSnapshot: snapshot
      };
    }

    if (selection.value != null) {
      const nested = normalizeRetentionSelection(selection.value);
      if (nested.machineValue || nested.displayLabel) {
        return {
          ...normalized,
          machineValue: nested.machineValue,
          displayLabel: selection.label ? String(selection.label).trim() : (nested.displayLabel || null),
          derivedFrom: `value:${nested.derivedFrom || typeof selection.value}`,
          fieldSnapshot: snapshot
        };
      }
    }

    if (selection.selected != null) {
      const nested = normalizeRetentionSelection(selection.selected);
      if (nested.machineValue || nested.displayLabel) {
        return {
          ...normalized,
          machineValue: nested.machineValue,
          displayLabel: selection.label ? String(selection.label).trim() : (nested.displayLabel || null),
          derivedFrom: `selected:${nested.derivedFrom || typeof selection.selected}`,
          fieldSnapshot: snapshot
        };
      }
    }

    if (selection.label != null) {
      const label = String(selection.label).trim();
      return {
        ...normalized,
        machineValue: label || null,
        displayLabel: label || null,
        derivedFrom: 'label',
        fieldSnapshot: snapshot
      };
    }

    return {
      ...normalized,
      derivedFrom: 'object-unrecognized',
      fieldSnapshot: snapshot
    };
  }

  const fallback = String(selection).trim();
  return {
    ...normalized,
    machineValue: fallback || null,
    displayLabel: fallback || null,
    derivedFrom: typeof selection
  };
}

export function parseRetentionSelection(selection) {
  const normalized = normalizeRetentionSelection(selection);
  console.log('[Connect.Me] Retention raw selection:', stringifyLogValue(selection));
  console.log('[Connect.Me] Retention normalized selection:', stringifyLogValue({
    selectionType: normalized.selectionType,
    machineValue: normalized.machineValue,
    displayLabel: normalized.displayLabel,
    derivedFrom: normalized.derivedFrom,
    fieldSnapshot: normalized.fieldSnapshot
  }));

  if (!normalized.machineValue && !normalized.displayLabel) {
    console.warn('[Connect.Me] Retention parsing failed: empty selection');
    return null;
  }

  const machineCandidate = parseRetentionMachineValue(normalized.machineValue);
  if (machineCandidate) {
    const parsed = validateRetentionParts(machineCandidate.retentionUnit, machineCandidate.retentionValue)
      ? {
          retentionUnit: machineCandidate.retentionUnit,
          retentionValue: machineCandidate.retentionValue
        }
      : null;
    console.log('[Connect.Me] Retention parsed result:', stringifyLogValue({
      parsed,
      format: machineCandidate.format,
      machineValue: normalized.machineValue
    }));
    return parsed;
  }

  const displayCandidate = parseRetentionMachineValue(normalized.displayLabel);
  if (displayCandidate) {
    const parsed = validateRetentionParts(displayCandidate.retentionUnit, displayCandidate.retentionValue)
      ? {
          retentionUnit: displayCandidate.retentionUnit,
          retentionValue: displayCandidate.retentionValue
        }
      : null;
    console.log('[Connect.Me] Retention parsed result:', stringifyLogValue({
      parsed,
      format: displayCandidate.format,
      displayLabel: normalized.displayLabel
    }));
    return parsed;
  }

  console.warn('[Connect.Me] Retention parsing failed: unsupported format', stringifyLogValue({
    machineValue: normalized.machineValue,
    displayLabel: normalized.displayLabel,
    derivedFrom: normalized.derivedFrom,
    fieldSnapshot: normalized.fieldSnapshot
  }));
  return null;
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

async function restRequest(resource, { method = 'GET', query = '', body = null, rpc = false, headers = {} } = {}) {
  const session = await ensureValidSession();
  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }

  return supabaseFetch(`${rpc ? '/rest/v1/rpc/' : '/rest/v1/'}${resource}${query}`, {
    method,
    accessToken: session.access_token,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

export function normalizeProfileVisibility(profile = {}) {
  return Object.entries(PROFILE_VISIBILITY_FIELDS).reduce((acc, [key, defaultValue]) => {
    acc[key] = profile[key] == null ? defaultValue : Boolean(profile[key]);
    return acc;
  }, {});
}

export function mergeProfileVisibility(profile = {}) {
  return {
    ...profile,
    ...normalizeProfileVisibility(profile)
  };
}

export function getPublicProfile(profile = {}) {
  const merged = mergeProfileVisibility(profile);
  const professionalHeadline = merged.professional_headline ?? merged.headline ?? '';
  const shareProfessionalHeadline = merged.share_professional_headline == null
    ? true
    : Boolean(merged.share_professional_headline);

  return {
    ...merged,
    headline: shareProfessionalHeadline ? professionalHeadline : '',
    professional_headline: shareProfessionalHeadline ? professionalHeadline : '',
    avatar_path: merged.share_avatar ? merged.avatar_path || '' : '',
    avatar_url: merged.share_avatar ? merged.avatar_url || '' : '',
    first_name: merged.share_first_name ? merged.first_name || '' : '',
    last_name: merged.share_last_name ? merged.last_name || '' : '',
    place_of_work: merged.share_place_of_work ? merged.place_of_work || '' : '',
    education: merged.share_education ? merged.education || '' : '',
    current_location: merged.share_current_location ? merged.current_location || '' : '',
    bio: merged.share_bio ? merged.bio || '' : ''
  };
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

export function buildDisplayName(profile = {}) {
  const firstName = String(profile.first_name || '').trim();
  const lastName = String(profile.last_name || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) {
    return fullName;
  }

  return firstName || lastName || 'Connect.Me User';
}

export async function saveUserMetadataProfileSnapshot(profile) {
  const session = await ensureValidSession();
  if (!session?.access_token || !profile) {
    return;
  }

  const visibility = normalizeProfileVisibility(profile);
  const safeProfile = {
    display_name: buildDisplayName(profile),
    first_name: profile.first_name,
    last_name: profile.last_name,
    avatar_url: profile.avatar_url,
    place_of_work: profile.place_of_work,
    education: profile.education,
    current_location: profile.current_location,
    headline: profile.headline,
    bio: profile.bio,
    ...visibility
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
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  const query = `?select=id,email,display_name,first_name,last_name,place_of_work,education,current_location,headline,bio,avatar_path,avatar_url,share_avatar,share_first_name,share_last_name,share_place_of_work,share_education,share_current_location,share_bio,created_at,updated_at&id=eq.${encodeURIComponent(user.id)}&limit=1`;
  const rows = await restRequest('profiles', {
    query
  });
  const profile = rows?.[0] ? mergeProfileVisibility(rows[0]) : null;

  console.log('[Connect.Me] Profile fetch result:', stringifyLogValue({
    userId: user.id,
    rowExists: Boolean(profile),
    profile
  }));

  return profile;
}

export async function upsertProfile(profile) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  const visibility = normalizeProfileVisibility(profile);
  const payload = {
    id: user.id,
    email: user.email,
    display_name: buildDisplayName(profile),
    first_name: profile.first_name,
    last_name: profile.last_name,
    place_of_work: profile.place_of_work,
    education: profile.education,
    current_location: profile.current_location,
    headline: profile.headline || '',
    bio: profile.bio || '',
    avatar_path: profile.avatar_path || '',
    avatar_url: profile.avatar_url || '',
    ...visibility
  };

  console.log('[Connect.Me] Profile save payload:', stringifyLogValue(payload));

  let rows = await restRequest('profiles', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(user.id)}`,
    headers: {
      Prefer: 'return=representation'
    },
    body: payload
  });

  if (!rows?.length) {
    rows = await restRequest('profiles', {
      method: 'POST',
      query: '?on_conflict=id',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: payload
    });
  }

  const savedProfile = rows?.[0] || null;

  console.log('[Connect.Me] Profile save result:', stringifyLogValue({
    userId: user.id,
    rowCount: Array.isArray(rows) ? rows.length : 0,
    savedProfile
  }));

  return mergeProfileVisibility(savedProfile || payload);
}

async function getAvatarPublicUrlFromPath(path) {
  if (!path) {
    return '';
  }

  const config = await getConfig();
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  return `${config.url}/storage/v1/object/public/avatars/${encodedPath}`;
}

export async function resolvePublicProfile(profile = {}) {
  const publicProfile = getPublicProfile(profile);
  if (publicProfile.avatar_url || !publicProfile.avatar_path) {
    console.log('[Connect.Me] Resolved avatar URL for shared profile:', stringifyLogValue({
      userId: publicProfile.id,
      avatar_path: publicProfile.avatar_path,
      avatar_url: publicProfile.avatar_url,
      resolution: publicProfile.avatar_url ? 'existing-avatar-url' : 'no-shared-avatar-path'
    }));
    return publicProfile;
  }

  const avatar_url = await getAvatarPublicUrlFromPath(publicProfile.avatar_path);

  console.log('[Connect.Me] Resolved avatar URL for shared profile:', stringifyLogValue({
    userId: publicProfile.id,
    avatar_path: publicProfile.avatar_path,
    avatar_url,
    resolution: 'derived-from-avatar-path'
  }));

  return {
    ...publicProfile,
    avatar_url
  };
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

function normalizePrivacySettingsRow(row) {
  if (!row) {
    return getDefaultPrivacySettings();
  }

  return {
    consentGranted: Boolean(row.consent_granted ?? row.consentGranted),
    trackingEnabled: Boolean(row.tracking_enabled ?? row.trackingEnabled),
    historyMode: row.history_mode ?? row.historyMode ?? DEFAULT_PRIVACY_SETTINGS.historyMode,
    retentionUnit: row.retention_unit ?? row.retentionUnit ?? DEFAULT_PRIVACY_SETTINGS.retentionUnit,
    retentionValue: Number(row.retention_value ?? row.retentionValue ?? DEFAULT_PRIVACY_SETTINGS.retentionValue),
    presenceSharingEnabled: Boolean(row.presence_sharing_enabled ?? row.presenceSharingEnabled),
    invisibleModeEnabled: Boolean(row.invisible_mode_enabled ?? row.invisibleModeEnabled)
  };
}

export async function getPrivacySettingsRecord() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  const query = `?select=user_id,consent_granted,tracking_enabled,history_mode,retention_unit,retention_value,presence_sharing_enabled,invisible_mode_enabled&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;
  const rows = await restRequest('user_privacy_settings', { query });
  const row = rows?.[0] || null;
  const normalized = normalizePrivacySettingsRow(row);

  console.log('[Connect.Me] Privacy settings fetch result:', stringifyLogValue({
    userId: user.id,
    row,
    normalized,
    rowExists: Boolean(row)
  }));

  return {
    row,
    normalized,
    rowExists: Boolean(row)
  };
}

export async function getPrivacySettings() {
  const { normalized } = await getPrivacySettingsRecord();
  return normalized;
}

export async function upsertPrivacySettings(privacy) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in first.');
  }

  if (!validateRetentionParts(privacy.retentionUnit, Number(privacy.retentionValue))) {
    throw new Error('Please choose a valid retention window before saving your settings.');
  }

  const payload = {
    user_id: user.id,
    consent_granted: Boolean(privacy.consentGranted),
    tracking_enabled: Boolean(privacy.trackingEnabled),
    history_mode: privacy.historyMode,
    retention_unit: privacy.retentionUnit,
    retention_value: Number(privacy.retentionValue),
    presence_sharing_enabled: Boolean(privacy.presenceSharingEnabled),
    invisible_mode_enabled: Boolean(privacy.invisibleModeEnabled)
  };

  console.log('[Connect.Me] Privacy settings save payload:', stringifyLogValue(payload));

  let rows = await restRequest('user_privacy_settings', {
    method: 'PATCH',
    query: `?user_id=eq.${encodeURIComponent(user.id)}`,
    headers: {
      Prefer: 'return=representation'
    },
    body: payload
  });

  if (!rows?.length) {
    rows = await restRequest('user_privacy_settings', {
      method: 'POST',
      query: '?on_conflict=user_id',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: payload
    });
  }

  console.log('[Connect.Me] Privacy settings save result:', stringifyLogValue(rows));

  const { normalized } = await getPrivacySettingsRecord();
  return normalized;
}

export async function updatePresenceSharingPreference(enabled) {
  const current = await getPrivacySettings();
  const next = {
    ...current,
    presenceSharingEnabled: Boolean(enabled)
  };

  console.log('[Connect.Me] Presence transition requested:', stringifyLogValue({
    previous: current.presenceSharingEnabled,
    next: next.presenceSharingEnabled,
    invisibleModeEnabled: current.invisibleModeEnabled,
    consentGranted: current.consentGranted
  }));

  const saved = await upsertPrivacySettings(next);

  console.log('[Connect.Me] Presence transition saved:', stringifyLogValue({
    previous: current.presenceSharingEnabled,
    saved: saved.presenceSharingEnabled,
    invisibleModeEnabled: saved.invisibleModeEnabled,
    consentGranted: saved.consentGranted
  }));

  return saved;
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

async function fetchProfileRowsByIds(userIds = []) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  if (!uniqueIds.length) {
    return [];
  }

  const selectFields = [
    'id',
    'display_name',
    'email',
    'first_name',
    'last_name',
    'place_of_work',
    'education',
    'current_location',
    'headline',
    'bio',
    'avatar_path',
    'avatar_url',
    'share_avatar',
    'share_first_name',
    'share_last_name',
    'share_place_of_work',
    'share_education',
    'share_current_location',
    'share_bio',
    'created_at',
    'updated_at'
  ].join(',');
  const idFilter = uniqueIds.map((id) => String(id).trim()).join(',');
  const query = `?select=${selectFields}&id=in.(${encodeURIComponent(idFilter)})`;
  const rows = await restRequest('profiles', { query });

  console.log('[Connect.Me] Fetched profile rows for shared-user cards:', stringifyLogValue({
    requestedUserIds: uniqueIds,
    rowCount: Array.isArray(rows) ? rows.length : 0,
    rows
  }));

  return rows || [];
}

export async function fetchActiveUsersForDomain(domain) {
  const rows = await restRequest('get_active_users_for_domain', {
    method: 'POST',
    rpc: true,
    body: { requested_domain: domain }
  });
  console.log('[Connect.Me] Fetched shared user records for domain:', stringifyLogValue({
    domain,
    rowCount: Array.isArray(rows) ? rows.length : 0,
    rows
  }));

  const profileRows = await fetchProfileRowsByIds((rows || []).map((row) => row.id));
  const profilesById = new Map(profileRows.map((row) => [row.id, row]));

  return Promise.all((rows || []).map(async (row) => {
    const profileRow = profilesById.get(row.id) || {};
    const mergedRow = mergeProfileVisibility({
      ...row,
      ...profileRow,
      last_seen: row.last_seen,
      professional_headline: profileRow.professional_headline ?? profileRow.headline ?? row.professional_headline ?? row.headline ?? ''
    });
    const visibility = normalizeProfileVisibility(mergedRow);

    console.log('[Connect.Me] Raw payload returned for shared-user card:', stringifyLogValue({
      domain,
      userId: row.id,
      rpcRow: row,
      profileRow,
      mergedRow
    }));
    console.log('[Connect.Me] Visibility flags used for shared profile rendering:', stringifyLogValue({
      domain,
      userId: mergedRow.id,
      visibility
    }));

    const resolvedProfile = await resolvePublicProfile(mergedRow);

    return {
      ...resolvedProfile,
      __sharedCardDebug: {
        domain,
        rpcRow: row,
        profileRow,
        mergedRow,
        visibility,
        resolvedAvatarUrl: resolvedProfile.avatar_url || ''
      }
    };
  }));
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
