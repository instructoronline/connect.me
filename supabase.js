import { getStarterLearningModules } from './learning-modules.js';

const STORAGE_KEYS = {
  config: 'connectme-config',
  session: 'connectme-session',
  cachedUser: 'connectme-cached-user',
  learningModulePendingConnections: 'connectme-learning-module-pending-connections'
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

export const LEARNING_MODULE_FALLBACK_DATA = Object.freeze(getStarterLearningModules());

function cloneLearningModuleFallbackData() {
  return LEARNING_MODULE_FALLBACK_DATA.map((module) => ({
    ...module,
    topics: (module.topics || []).map((topic) => ({
      ...topic,
      cards: (topic.cards || []).map((card) => ({
        ...card,
        sections: (card.sections || []).map((section) => ({ ...section }))
      }))
    }))
  }));
}

function getLearningModuleMissingRequirement(message = '') {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('public.learning_modules')) {
    return 'public.learning_modules table';
  }
  if (normalized.includes('public.learning_module_topics')) {
    return 'public.learning_module_topics table';
  }
  if (normalized.includes('public.learning_module_cards')) {
    return 'public.learning_module_cards table';
  }
  if (normalized.includes('public.learning_module_connections')) {
    return 'public.learning_module_connections table';
  }
  if (normalized.includes('get_learning_module_connected_users')) {
    return 'public.get_learning_module_connected_users(text) RPC function';
  }
  if (normalized.includes('get_learning_module_connections')) {
    return 'public.get_learning_module_connections(text) RPC function';
  }
  if (normalized.includes('row-level security') || normalized.includes('permission denied') || normalized.includes('rls')) {
    return 'RLS policy or grant permissions';
  }
  return '';
}

function getLearningModulesFallbackPayload({ reason = 'unavailable', error = null } = {}) {
  const setupRequired = reason === 'missing_tables';
  const failingRequirement = setupRequired ? getLearningModuleMissingRequirement(error?.message) : '';
  const fallbackDetail = setupRequired
    ? `Learning Modules backend setup is incomplete${failingRequirement ? ` (${failingRequirement} missing or inaccessible)` : ''}. Apply the bundled migration to enable syncing and connections.`
    : 'Supabase is temporarily unavailable, so starter modules are being shown from built-in local data.';

  return {
    modules: cloneLearningModuleFallbackData().map((module, index) => {
      const fallbackId = String(module?.id || module?.slug || '').trim();
      return {
        ...module,
        id: fallbackId || `local-module-${index + 1}`,
        local_id: fallbackId || module?.slug || '',
        db_id: null
      };
    }),
    source: 'fallback',
    persistenceAvailable: false,
    setupRequired,
    statusBadge: setupRequired ? 'Setup required' : 'Fallback data',
    statusTone: 'warning',
    statusMessage: setupRequired
      ? 'Starter modules are shown from built-in fallback data until the Learning Modules migration is applied.'
      : 'Starter modules are shown from built-in fallback data while Supabase sync is unavailable.',
    fallbackDetail,
    errorMessage: error?.message || '',
    failingRequirement
  };
}

function isLearningModuleTableMissingMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes("could not find the table 'public.learning_modules' in the schema cache")
    || normalized.includes("could not find the table 'public.learning_module_topics' in the schema cache")
    || normalized.includes('relation "public.learning_modules" does not exist')
    || normalized.includes('relation "public.learning_module_topics" does not exist')
    || (normalized.includes('learning_modules') && normalized.includes('schema cache'))
    || (normalized.includes('learning_module_topics') && normalized.includes('schema cache'));
}

function isLearningModuleCardsTableMissingMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes("could not find the table 'public.learning_module_cards' in the schema cache")
    || normalized.includes('relation "public.learning_module_cards" does not exist')
    || (normalized.includes('learning_module_cards') && normalized.includes('schema cache'));
}

function isLearningModuleConnectionsTableMissingMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes("could not find the table 'public.learning_module_connections' in the schema cache")
    || normalized.includes('relation "public.learning_module_connections" does not exist')
    || normalized.includes("could not find the function public.get_learning_module_connected_users")
    || normalized.includes("could not find the function public.get_learning_module_connections")
    || (normalized.includes('learning_module_connections') && normalized.includes('schema cache'))
    || (normalized.includes('get_learning_module_connected_users') && normalized.includes('does not exist'))
    || (normalized.includes('get_learning_module_connections') && normalized.includes('does not exist'));
}

function isTransientLearningModulePersistenceMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('network request failed')
    || normalized.includes('load failed')
    || normalized.includes('fetch')
    || normalized.includes('timed out')
    || normalized.includes('gateway')
    || normalized.includes('service unavailable')
    || normalized.includes('temporarily unavailable');
}

export function isRecoverableLearningModulePersistenceError(message = '') {
  return isLearningModuleConnectionsTableMissingMessage(message) || isTransientLearningModulePersistenceMessage(message);
}


function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function buildModuleUuidLookup(modules = []) {
  return new Map((modules || [])
    .filter((module) => module?.slug && isUuidLike(module?.id))
    .map((module) => [module.slug, module.id]));
}

function resolveModuleUuid({ moduleId = '', moduleSlug = '', moduleUuidBySlug = new Map() } = {}) {
  const directUuid = isUuidLike(moduleId) ? moduleId : '';
  const mappedUuid = moduleSlug ? (moduleUuidBySlug.get(moduleSlug) || '') : '';
  return directUuid || mappedUuid || '';
}

function normalizePendingLearningModuleEntry(entry = {}) {
  if (!entry?.module_id || !entry?.user_id) {
    return null;
  }

  return {
    module_id: entry.module_id,
    module_slug: entry.module_slug || '',
    user_id: entry.user_id,
    queued_at: entry.queued_at || new Date().toISOString(),
    reason: entry.reason || 'pending_sync'
  };
}

async function readPendingLearningModuleConnectionStore() {
  const { [STORAGE_KEYS.learningModulePendingConnections]: stored } = await getLocalStore(STORAGE_KEYS.learningModulePendingConnections);
  return stored && typeof stored === 'object' ? stored : {};
}

async function writePendingLearningModuleConnectionStore(store) {
  await setLocalStore({
    [STORAGE_KEYS.learningModulePendingConnections]: store
  });
}

async function getPendingLearningModuleConnectionsForUser(userId) {
  if (!userId) {
    return [];
  }

  const store = await readPendingLearningModuleConnectionStore();
  return (store[userId] || []).map(normalizePendingLearningModuleEntry).filter(Boolean);
}

async function savePendingLearningModuleConnectionsForUser(userId, entries = []) {
  if (!userId) {
    return [];
  }

  const store = await readPendingLearningModuleConnectionStore();
  const normalized = entries.map(normalizePendingLearningModuleEntry).filter(Boolean);

  if (normalized.length) {
    store[userId] = normalized;
  } else {
    delete store[userId];
  }

  await writePendingLearningModuleConnectionStore(store);
  return normalized;
}

async function upsertPendingLearningModuleConnection(entry) {
  const normalized = normalizePendingLearningModuleEntry(entry);
  if (!normalized) {
    return null;
  }

  const existing = await getPendingLearningModuleConnectionsForUser(normalized.user_id);
  const next = [
    normalized,
    ...existing.filter((item) => item.module_id !== normalized.module_id)
  ];
  await savePendingLearningModuleConnectionsForUser(normalized.user_id, next);
  return normalized;
}

async function removePendingLearningModuleConnection(userId, moduleId) {
  const existing = await getPendingLearningModuleConnectionsForUser(userId);
  await savePendingLearningModuleConnectionsForUser(userId, existing.filter((item) => item.module_id !== moduleId));
}

export async function fetchPendingLearningModuleConnectionsForCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  return getPendingLearningModuleConnectionsForUser(user.id);
}

export async function syncPendingLearningModuleConnectionsForCurrentUser(availableModules = []) {
  const user = await getCurrentUser();
  if (!user) {
    return { synced: [], remaining: [] };
  }

  const pending = await getPendingLearningModuleConnectionsForUser(user.id);
  if (!pending.length) {
    return { synced: [], remaining: [] };
  }

  const synced = [];
  const remaining = [];
  const moduleUuidBySlug = buildModuleUuidLookup(availableModules || []);

  for (const entry of pending) {
    const resolvedModuleUuid = resolveModuleUuid({
      moduleId: entry.module_id,
      moduleSlug: entry.module_slug,
      moduleUuidBySlug
    });

    console.log('[Connect.Me] Pending learning module sync resolution', {
      starterId: entry.module_id,
      slug: entry.module_slug,
      resolvedLiveUuid: resolvedModuleUuid || null
    });

    if (!resolvedModuleUuid) {
      remaining.push(entry);
      continue;
    }

    try {
      await connectCurrentUserToLearningModule(resolvedModuleUuid, {
        moduleSlug: entry.module_slug,
        allowQueue: false
      });
      synced.push({
        ...entry,
        module_id: resolvedModuleUuid
      });
    } catch (error) {
      if (isRecoverableLearningModulePersistenceError(error?.message)) {
        remaining.push(entry);
        continue;
      }
      throw error;
    }
  }

  await savePendingLearningModuleConnectionsForUser(user.id, remaining);
  return { synced, remaining };
}

function normalizeLearningModuleCard(card, fallbackCard = {}, { moduleId, topicId, sortOrder = 0 } = {}) {
  const content = card?.content && typeof card.content === 'object' ? card.content : {};
  const fallbackSections = Array.isArray(fallbackCard.sections) ? fallbackCard.sections : [];
  const sections = Array.isArray(content.sections)
    ? content.sections.filter((section) => section?.body)
    : fallbackSections;

  return {
    id: card?.id || fallbackCard.id || `local-card-${topicId}-${sortOrder}`,
    module_id: card?.module_id || fallbackCard.module_id || moduleId,
    topic_id: card?.topic_id || fallbackCard.topic_id || topicId,
    title: card?.title || fallbackCard.title || 'Learning card',
    card_type: card?.card_type || fallbackCard.card_type || 'concept',
    sort_order: card?.sort_order || fallbackCard.sort_order || sortOrder,
    subtopic_title: content.subtopic_title || fallbackCard.subtopic_title || '',
    sections: sections.map((section) => ({
      label: section.label || 'Section',
      body: section.body || ''
    }))
  };
}

function mergeLearningModulesWithStarterContent(modules = [], topics = [], cards = []) {
  const starterModules = getStarterLearningModules();
  const starterModulesBySlug = new Map(starterModules.map((module) => [module.slug, module]));
  const topicsByModuleId = new Map();
  const cardsByTopicId = new Map();
  const reconciliationDiagnostics = [];

  (topics || []).forEach((topic) => {
    const moduleTopics = topicsByModuleId.get(topic.module_id) || [];
    moduleTopics.push(topic);
    topicsByModuleId.set(topic.module_id, moduleTopics);
  });

  (cards || []).forEach((card) => {
    const topicCards = cardsByTopicId.get(card.topic_id) || [];
    topicCards.push(card);
    cardsByTopicId.set(card.topic_id, topicCards);
  });

  const mergedModules = (modules || []).map((module) => {
    const starterModule = starterModulesBySlug.get(module.slug);
    const starterTopics = starterModule?.topics || [];
    const starterTopicsByTitle = new Map(starterTopics.map((topic) => [topic.topic_title, topic]));
    const moduleTopics = (topicsByModuleId.get(module.id) || starterTopics).map((topic, topicIndex) => {
      const starterTopic = starterTopicsByTitle.get(topic.topic_title) || starterTopics[topicIndex] || null;
      const topicCards = cardsByTopicId.get(topic.id) || [];
      const fallbackCards = starterTopic?.cards || [];
      const cardsSource = topicCards.length >= fallbackCards.length ? topicCards : fallbackCards;
      const cardsToUse = cardsSource.map((card, cardIndex) => (
        normalizeLearningModuleCard(card, fallbackCards[cardIndex] || {}, {
          moduleId: module.id,
          topicId: topic.id,
          sortOrder: card.sort_order || fallbackCards[cardIndex]?.sort_order || cardIndex + 1
        })
      ));

      return {
        ...topic,
        summary: topic.summary || starterTopic?.summary || '',
        cards: cardsToUse
      };
    });

    const reconciledModule = {
      ...module,
      local_id: module?.local_id || '',
      db_id: isUuidLike(module?.id) ? module.id : null,
      topics: moduleTopics
    };

    reconciliationDiagnostics.push({
      slug: module?.slug || '',
      liveUuidFound: isUuidLike(module?.id),
      reconciledWithStarter: Boolean(starterModule),
      liveTopicCount: (topicsByModuleId.get(module.id) || []).length,
      renderedTopicCount: moduleTopics.length
    });

    return reconciledModule;
  });

  return {
    modules: mergedModules,
    reconciliationDiagnostics
  };
}

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


function normalizeHistoryMode(mode) {
  if (mode === 'path' || mode === 'full_url' || mode === 'none') {
    return mode;
  }
  return 'domain';
}

export function getEffectiveHistoryMode(privacy = getDefaultPrivacySettings()) {
  const requestedMode = normalizeHistoryMode(privacy?.historyMode);
  if (!privacy?.consentGranted || !privacy?.trackingEnabled || requestedMode === 'none') {
    return 'domain';
  }
  return requestedMode;
}

export function buildScopedSiteContext(tabInfo, privacy = getDefaultPrivacySettings()) {
  if (!tabInfo?.domain) {
    return null;
  }

  const requestedMode = normalizeHistoryMode(privacy?.historyMode);
  const effectiveHistoryMode = getEffectiveHistoryMode(privacy);
  const domain = tabInfo.domain;
  const path = tabInfo.path || '/';
  const fullUrl = tabInfo.url || `https://${domain}${path}`;
  const pathDisplay = `${domain}${path}`;

  let privacyDescription = 'Only the domain is visible because detailed tracking is currently off.';
  if (requestedMode === 'path' && effectiveHistoryMode === 'path') {
    privacyDescription = 'Your privacy settings allow the domain and path to be shown.';
  } else if (requestedMode === 'full_url' && effectiveHistoryMode === 'full_url') {
    privacyDescription = 'Your privacy settings allow the full URL to be shown.';
  } else if (requestedMode === 'none') {
    privacyDescription = 'History storage is disabled, so only the domain is shown live.';
  } else if (privacy?.consentGranted && privacy?.trackingEnabled) {
    privacyDescription = 'Your privacy settings allow the domain only.';
  }

  return {
    requestedHistoryMode: requestedMode,
    effectiveHistoryMode,
    domain,
    path,
    fullUrl,
    pathDisplay,
    displayUrl: effectiveHistoryMode === 'full_url' ? fullUrl : effectiveHistoryMode === 'path' ? pathDisplay : domain,
    canShowPath: effectiveHistoryMode === 'path' || effectiveHistoryMode === 'full_url',
    canShowFullUrl: effectiveHistoryMode === 'full_url',
    privacyDescription
  };
}

export function sanitizeTabInfoForPrivacy(tabInfo, privacy = getDefaultPrivacySettings()) {
  const scoped = buildScopedSiteContext(tabInfo, privacy);
  if (!scoped) {
    return null;
  }

  return {
    domain: scoped.domain,
    path: scoped.canShowPath ? scoped.path : null,
    url: scoped.canShowFullUrl ? scoped.fullUrl : null,
    title: tabInfo?.title || scoped.domain,
    detectedAt: tabInfo?.detectedAt || null,
    requestedHistoryMode: scoped.requestedHistoryMode,
    effectiveHistoryMode: scoped.effectiveHistoryMode,
    trackedDisplayUrl: scoped.displayUrl,
    privacyDescription: scoped.privacyDescription
  };
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

async function publicRestRequest(resource, { method = 'GET', query = '', body = null, rpc = false, headers = {} } = {}) {
  return supabaseFetch(`${rpc ? '/rest/v1/rpc/' : '/rest/v1/'}${resource}${query}`, {
    method,
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
  const rows = await restRequest('active_presence', {
    query: '?select=domain,path,full_url,page_title,last_seen&order=last_seen.desc'
  });
  const sitesByDomain = new Map();

  (rows || []).forEach((row) => {
    const domain = String(row?.domain || '').trim();
    if (!domain) {
      return;
    }

    const existing = sitesByDomain.get(domain);
    const fullUrl = String(row?.full_url || '').trim();
    const path = String(row?.path || '').trim();
    const pageTitle = String(row?.page_title || '').trim();
    const lastSeen = row?.last_seen || null;

    if (!existing) {
      sitesByDomain.set(domain, {
        domain,
        active_user_count: 1,
        last_seen: lastSeen,
        page_title: pageTitle,
        full_url: fullUrl,
        path,
        trackedDisplayUrl: fullUrl || `${domain}${path || ''}` || domain
      });
      return;
    }

    existing.active_user_count += 1;
    if (lastSeen && (!existing.last_seen || new Date(lastSeen) > new Date(existing.last_seen))) {
      existing.last_seen = lastSeen;
    }
    if (!existing.page_title && pageTitle) {
      existing.page_title = pageTitle;
    }
    if (!existing.full_url && fullUrl) {
      existing.full_url = fullUrl;
    }
    if (!existing.path && path) {
      existing.path = path;
    }
    existing.trackedDisplayUrl = existing.full_url || `${domain}${existing.path || ''}` || domain;
  });

  return [...sitesByDomain.values()].sort((left, right) => {
    const countDiff = (Number(right.active_user_count) || 0) - (Number(left.active_user_count) || 0);
    if (countDiff !== 0) {
      return countDiff;
    }
    return new Date(right.last_seen || 0).getTime() - new Date(left.last_seen || 0).getTime();
  });
}

export async function fetchUsersOnTopSite(domain) {
  return fetchActiveUsersForDomain(domain);
}

export async function fetchLearningModules() {
  try {
    const requestLearningModuleRows = async (resource, query) => {
      try {
        return await publicRestRequest(resource, { query });
      } catch (publicError) {
        const normalized = String(publicError?.message || '').toLowerCase();
        const canRetryWithSession = normalized.includes('permission denied')
          || normalized.includes('row-level security')
          || normalized.includes('rls')
          || normalized.includes('jwt');

        if (!canRetryWithSession) {
          throw publicError;
        }

        const currentUser = await getCurrentUser();
        if (!currentUser) {
          throw publicError;
        }

        return restRequest(resource, { query });
      }
    };

    const [modules, topics] = await Promise.all([
      requestLearningModuleRows('learning_modules', '?select=id,slug,title,description,icon,sort_order&order=sort_order.asc'),
      requestLearningModuleRows('learning_module_topics', '?select=id,module_id,topic_title,summary,sort_order&order=module_id.asc,sort_order.asc')
    ]);
    let cards = [];
    let usingBundledCards = false;

    try {
      cards = await requestLearningModuleRows('learning_module_cards', '?select=id,module_id,topic_id,title,card_type,sort_order,content&order=module_id.asc,topic_id.asc,sort_order.asc');
    } catch (cardsError) {
      if (!isLearningModuleCardsTableMissingMessage(cardsError?.message)) {
        console.warn('[Connect.Me] Unable to load learning module cards from Supabase; using bundled lesson cards instead.', cardsError);
      }
      usingBundledCards = true;
    }

    const merged = mergeLearningModulesWithStarterContent(modules || [], topics || [], cards || []);
    console.log('[Connect.Me] Learning modules reconciliation diagnostics', {
      fetchedLiveModulesCount: (modules || []).length,
      fetchedLiveTopicsCount: (topics || []).length,
      fetchedLiveCardsCount: (cards || []).length,
      reconciliationBySlug: merged.reconciliationDiagnostics.map((entry) => ({
        slug: entry.slug,
        liveUuidFound: entry.liveUuidFound ? 'yes' : 'no',
        reconciledWithStarter: entry.reconciledWithStarter ? 'yes' : 'no',
        liveTopicCount: entry.liveTopicCount,
        renderedTopicCount: entry.renderedTopicCount
      }))
    });

    return {
      modules: merged.modules,
      source: usingBundledCards ? 'supabase+bundled-cards' : 'supabase',
      persistenceAvailable: true,
      setupRequired: false,
      statusBadge: usingBundledCards ? 'Bundled cards' : 'Supabase synced',
      statusTone: usingBundledCards ? 'warning' : 'success',
      statusMessage: usingBundledCards
        ? 'Modules and connections are synced with Supabase, and the guided lesson cards are being served from bundled starter content.'
        : 'Learning Modules are loading from Supabase and support saved connections.',
      fallbackDetail: '',
      errorMessage: '',
      reconciliationDiagnostics: merged.reconciliationDiagnostics
    };
  } catch (error) {
    if (isLearningModuleTableMissingMessage(error?.message)) {
      return getLearningModulesFallbackPayload({ reason: 'missing_tables', error });
    }

    return getLearningModulesFallbackPayload({ reason: 'unavailable', error });
  }
}

export async function diagnoseLearningModulesBackend({ moduleSlug = 'foundations-of-transformers' } = {}) {
  const checks = [];
  const runCheck = async ({ key, label, requiredFor, execute }) => {
    try {
      await execute();
      checks.push({
        key,
        label,
        requiredFor,
        ok: true,
        status: 'ok',
        message: 'OK'
      });
    } catch (error) {
      const message = error?.message || String(error);
      checks.push({
        key,
        label,
        requiredFor,
        ok: false,
        status: isLearningModuleTableMissingMessage(message)
          || isLearningModuleCardsTableMissingMessage(message)
          || isLearningModuleConnectionsTableMissingMessage(message)
          ? 'missing'
          : 'error',
        message,
        failingRequirement: getLearningModuleMissingRequirement(message)
      });
    }
  };

  await runCheck({
    key: 'learning_modules_select',
    label: 'Select from public.learning_modules',
    requiredFor: 'Module list sync',
    execute: () => publicRestRequest('learning_modules', { query: '?select=id,slug&limit=1' })
  });

  await runCheck({
    key: 'learning_module_topics_select',
    label: 'Select from public.learning_module_topics',
    requiredFor: 'Topic list sync',
    execute: () => publicRestRequest('learning_module_topics', { query: '?select=id,module_id&limit=1' })
  });

  await runCheck({
    key: 'learning_module_cards_select',
    label: 'Select from public.learning_module_cards',
    requiredFor: 'Card content sync (optional; app can use bundled cards)',
    execute: () => publicRestRequest('learning_module_cards', { query: '?select=id,topic_id&limit=1' })
  });

  await runCheck({
    key: 'get_learning_module_connected_users_rpc',
    label: 'Execute public.get_learning_module_connected_users(text)',
    requiredFor: '"Show all users connected" live data',
    execute: () => publicRestRequest('get_learning_module_connected_users', {
      method: 'POST',
      rpc: true,
      body: { requested_module_slug: moduleSlug }
    })
  });

  const user = await getCurrentUser().catch(() => null);
  if (user) {
    await runCheck({
      key: 'learning_module_connections_select_authenticated',
      label: 'Select own rows from public.learning_module_connections',
      requiredFor: 'Restore your module connections',
      execute: () => restRequest('learning_module_connections', {
        query: `?select=id,module_id,user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
      })
    });
  } else {
    checks.push({
      key: 'learning_module_connections_select_authenticated',
      label: 'Select own rows from public.learning_module_connections',
      requiredFor: 'Restore your module connections',
      ok: false,
      status: 'skipped',
      message: 'Skipped because no signed-in user session is available.'
    });
  }

  const failedChecks = checks.filter((check) => !check.ok && check.status !== 'skipped');
  const missingChecks = failedChecks.filter((check) => check.status === 'missing');
  const failingRequirement = missingChecks[0]?.failingRequirement || failedChecks[0]?.failingRequirement || '';

  return {
    checkedAt: new Date().toISOString(),
    moduleSlug,
    persistenceAvailable: failedChecks.length === 0 || (
      failedChecks.length === 1 && failedChecks[0]?.key === 'learning_module_cards_select'
    ),
    setupRequired: missingChecks.length > 0,
    failingRequirement,
    checks,
    summary: failedChecks.length
      ? `Learning Modules backend check failed: ${failedChecks[0].label} — ${failedChecks[0].message}`
      : 'All required Learning Modules backend checks passed.'
  };
}

export async function fetchLearningModuleConnectionsForCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  return restRequest('learning_module_connections', {
    query: `?select=id,module_id,user_id,connected_at&user_id=eq.${encodeURIComponent(user.id)}`
  });
}

export async function connectCurrentUserToLearningModule(moduleId, { moduleSlug = '', allowQueue = true, moduleUuidBySlug = null } = {}) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Please sign in to connect yourself to a learning module.');
  }
  const resolvedModuleId = resolveModuleUuid({
    moduleId,
    moduleSlug,
    moduleUuidBySlug: moduleUuidBySlug instanceof Map ? moduleUuidBySlug : new Map()
  });

  if (!resolvedModuleId) {
    if (allowQueue && moduleSlug) {
      const fallbackModuleId = String(moduleId || moduleSlug).trim();
      const queuedEntry = await upsertPendingLearningModuleConnection({
        module_id: fallbackModuleId,
        module_slug: moduleSlug,
        user_id: user.id,
        reason: 'missing_live_uuid'
      });
      return {
        status: 'queued_missing_uuid',
        connection: null,
        queued: Boolean(queuedEntry),
        diagnostics: {
          userIdPresent: Boolean(user?.id),
          moduleIdPresent: false,
          liveSyncAvailable: false,
          attemptedSupabaseInsert: false,
          insertResult: 'queued_missing_uuid',
          fallbackQueueBranchTaken: true,
          insertError: 'Missing live learning module UUID; queued by slug for deferred sync.'
        }
      };
    }
    throw new Error(`Missing live learning module UUID for slug "${moduleSlug || 'unknown'}". Reload modules and try again.`);
  }

  const pendingConnections = await getPendingLearningModuleConnectionsForUser(user.id);
  const existingPending = pendingConnections.find((entry) => entry.module_id === resolvedModuleId || entry.module_slug === moduleSlug);
  const diagnostics = {
    userIdPresent: Boolean(user?.id),
    moduleIdPresent: Boolean(resolvedModuleId),
    liveSyncAvailable: true,
    attemptedSupabaseInsert: false,
    insertResult: 'not_attempted',
    fallbackQueueBranchTaken: false,
    insertError: ''
  };

  try {
    const existingRows = await restRequest('learning_module_connections', {
      query: `?select=id,module_id,user_id,connected_at&module_id=eq.${encodeURIComponent(resolvedModuleId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    });

    if (existingRows?.length) {
      await removePendingLearningModuleConnection(user.id, resolvedModuleId);
      return {
        status: 'connected',
        connection: existingRows[0],
        queued: false,
        diagnostics: {
          ...diagnostics,
          attemptedSupabaseInsert: false,
          insertResult: 'already_connected'
        }
      };
    }

    diagnostics.attemptedSupabaseInsert = true;
    const insertPayload = {
      module_id: resolvedModuleId,
      user_id: user.id
    };
    console.log('[Connect.Me] Learning module insert payload', {
      starterId: moduleId,
      slug: moduleSlug,
      resolvedLiveUuid: resolvedModuleId,
      insertPayload
    });
    const rows = await restRequest('learning_module_connections', {
      method: 'POST',
      body: insertPayload
    });

    await removePendingLearningModuleConnection(user.id, resolvedModuleId);
    return {
      status: 'connected',
      connection: rows?.[0] || null,
      queued: false,
      diagnostics: {
        ...diagnostics,
        insertResult: 'success'
      }
    };
  } catch (error) {
    const normalizedMessage = String(error?.message || '').toLowerCase();
    diagnostics.insertError = error?.message || 'Unknown insert error';
    if (normalizedMessage.includes('duplicate key') || normalizedMessage.includes('already exists')) {
      const rows = await restRequest('learning_module_connections', {
        query: `?select=id,module_id,user_id,connected_at&module_id=eq.${encodeURIComponent(resolvedModuleId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
      });
      await removePendingLearningModuleConnection(user.id, resolvedModuleId);
      return {
        status: 'connected',
        connection: rows?.[0] || null,
        queued: false,
        diagnostics: {
          ...diagnostics,
          insertResult: 'duplicate_treated_as_success'
        }
      };
    }

    if (!allowQueue || !isRecoverableLearningModulePersistenceError(error?.message)) {
      error.learningModuleConnectDiagnostics = {
        ...diagnostics,
        insertResult: 'error',
        fallbackQueueBranchTaken: false
      };
      throw error;
    }

    const queuedConnection = existingPending || await upsertPendingLearningModuleConnection({
      module_id: resolvedModuleId,
      module_slug: moduleSlug,
      user_id: user.id,
      reason: isLearningModuleConnectionsTableMissingMessage(error?.message) ? 'setup_required' : 'waiting_for_supabase'
    });

    return {
      status: queuedConnection?.reason === 'setup_required' ? 'setup_required' : 'queued',
      connection: queuedConnection,
      queued: true,
      diagnostics: {
        ...diagnostics,
        liveSyncAvailable: false,
        insertResult: 'error',
        fallbackQueueBranchTaken: true
      }
    };
  }
}

export async function fetchLearningModuleConnectedUsers(moduleSlug) {
  try {
    return await publicRestRequest('get_learning_module_connected_users', {
      method: 'POST',
      rpc: true,
      body: {
        requested_module_slug: moduleSlug
      }
    });
  } catch (publicError) {
    const normalized = String(publicError?.message || '').toLowerCase();
    const canRetryWithSession = normalized.includes('permission denied')
      || normalized.includes('row-level security')
      || normalized.includes('rls')
      || normalized.includes('jwt');
    if (!canRetryWithSession) {
      throw publicError;
    }

    const user = await getCurrentUser();
    if (!user) {
      throw publicError;
    }

    return restRequest('get_learning_module_connected_users', {
      method: 'POST',
      rpc: true,
      body: {
        requested_module_slug: moduleSlug
      }
    });
  }
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
