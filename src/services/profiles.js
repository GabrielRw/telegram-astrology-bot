const { randomUUID } = require('node:crypto');
const { getSupabaseClient, isSupabaseConfigured } = require('./supabase');
const factIndex = require('./factIndex');
const { getLocale } = require('./locale');
const toolCache = require('./toolCache');
const { info, reportError, warn } = require('./logger');
const {
  getChatState,
  hydrateActiveProfile,
  normalizeNatalProfile,
  notifyPersistence,
  resolveIdentity,
  resolveStateKey,
  setProfileDirectory
} = require('../state/chatState');

const TABLE_NAME = 'bot_profiles';
const memoryProfiles = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function buildBirthDate(payload, natalRequestPayload) {
  if (payload?.subject?.datetime) {
    return String(payload.subject.datetime).slice(0, 10);
  }

  if (
    Number.isFinite(natalRequestPayload?.year) &&
    Number.isFinite(natalRequestPayload?.month) &&
    Number.isFinite(natalRequestPayload?.day)
  ) {
    return `${natalRequestPayload.year}-${padNumber(natalRequestPayload.month)}-${padNumber(natalRequestPayload.day)}`;
  }

  return null;
}

function buildBirthTime(payload, natalRequestPayload) {
  if (payload?.subject?.settings?.time_known === false || natalRequestPayload?.time_known === false) {
    return null;
  }

  if (payload?.subject?.datetime) {
    const slice = String(payload.subject.datetime).slice(11, 16);
    return /^\d{2}:\d{2}$/.test(slice) ? slice : null;
  }

  if (Number.isFinite(natalRequestPayload?.hour) && Number.isFinite(natalRequestPayload?.minute)) {
    return `${padNumber(natalRequestPayload.hour)}:${padNumber(natalRequestPayload.minute)}`;
  }

  return null;
}

function buildCityLabel(natalRequestPayload, rawNatalPayload, options = {}) {
  if (options.cityLabel) {
    return options.cityLabel;
  }

  const city = natalRequestPayload?.city || rawNatalPayload?.subject?.location?.city || rawNatalPayload?.subject?.location?.name;
  const country = options.birthCountry || rawNatalPayload?.subject?.location?.country;
  return [city, country].filter(Boolean).join(', ') || city || 'Unknown';
}

function buildProfileSummary(rawNatalPayload, cityLabel, options = {}) {
  const normalized = normalizeNatalProfile(rawNatalPayload, cityLabel, options);

  return {
    name: normalized.name,
    city: normalized.city,
    country: normalized.country,
    birthDatetime: normalized.birthDatetime,
    timeKnown: normalized.timeKnown,
    confidence: normalized.confidence,
    sun: normalized.sun,
    moon: normalized.moon,
    rising: normalized.rising,
    summaryText: normalized.summaryText
  };
}

function normalizeProfileRecord(record) {
  if (!record) {
    return null;
  }

  return {
    profileId: String(record.profile_id || record.profileId),
    stateKey: String(record.state_key || record.stateKey),
    channel: String(record.channel || 'telegram'),
    userId: record.user_id ? String(record.user_id) : null,
    chatId: record.chat_id ? String(record.chat_id) : null,
    profileName: String(record.profile_name || record.profileName || 'Chart User'),
    isActive: Boolean(record.is_active ?? record.isActive),
    birthDate: record.birth_date || record.birthDate || null,
    birthTime: record.birth_time || record.birthTime || null,
    timeKnown: Boolean(record.time_known ?? record.timeKnown),
    cityName: record.city_name || record.cityName || null,
    cityLabel: record.city_label || record.cityLabel || null,
    timezone: record.timezone || null,
    lat: Number.isFinite(Number(record.lat)) ? Number(record.lat) : null,
    lng: Number.isFinite(Number(record.lng)) ? Number(record.lng) : null,
    birthCountry: record.birth_country || record.birthCountry || null,
    rawNatalPayload: clone(record.raw_natal_payload || record.rawNatalPayload || null),
    natalRequestPayload: clone(record.natal_request_payload || record.natalRequestPayload || null),
    chartRequestPayload: clone(record.chart_request_payload || record.chartRequestPayload || null),
    profileSummary: clone(record.profile_summary || record.profileSummary || null),
    createdAt: record.created_at || record.createdAt || null,
    updatedAt: record.updated_at || record.updatedAt || null
  };
}

function buildDirectoryEntry(profile) {
  return {
    profileId: profile.profileId,
    profileName: profile.profileName,
    isActive: profile.isActive,
    birthDate: profile.birthDate,
    birthTime: profile.birthTime,
    timeKnown: profile.timeKnown,
    cityLabel: profile.cityLabel,
    timezone: profile.timezone,
    summary: profile.profileSummary || null
  };
}

function sortProfiles(profiles) {
  return [...profiles].sort((left, right) => {
    if (Boolean(right.isActive) !== Boolean(left.isActive)) {
      return Number(Boolean(right.isActive)) - Number(Boolean(left.isActive));
    }

    return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
  });
}

function buildProfilePayload(identity, input, existingProfile = null) {
  const normalized = resolveIdentity(identity);
  const stateKey = resolveStateKey(identity);
  const rawNatalPayload = clone(input.rawNatalPayload);
  const natalRequestPayload = clone(input.natalRequestPayload);
  const chartRequestPayload = clone(input.chartRequestPayload);
  const birthCountry = input.birthCountry || rawNatalPayload?.subject?.location?.country || null;
  const cityLabel = buildCityLabel(natalRequestPayload, rawNatalPayload, input);
  const profileSummary = buildProfileSummary(rawNatalPayload, cityLabel, { birthCountry });
  const timestamp = new Date().toISOString();

  return {
    profile_id: existingProfile?.profileId || input.profileId || randomUUID(),
    state_key: stateKey,
    channel: normalized.channel,
    user_id: normalized.userId,
    chat_id: normalized.chatId,
    profile_name: String(input.profileName || existingProfile?.profileName || profileSummary.name || 'Chart User'),
    is_active: Boolean(input.isActive),
    birth_date: buildBirthDate(rawNatalPayload, natalRequestPayload),
    birth_time: buildBirthTime(rawNatalPayload, natalRequestPayload),
    time_known: rawNatalPayload?.subject?.settings?.time_known !== false && natalRequestPayload?.time_known !== false,
    city_name: natalRequestPayload?.city || rawNatalPayload?.subject?.location?.city || rawNatalPayload?.subject?.location?.name || null,
    city_label: cityLabel,
    timezone: rawNatalPayload?.subject?.location?.timezone || natalRequestPayload?.tz_str || null,
    lat: Number.isFinite(Number(natalRequestPayload?.lat)) ? Number(natalRequestPayload.lat) : null,
    lng: Number.isFinite(Number(natalRequestPayload?.lng)) ? Number(natalRequestPayload.lng) : null,
    birth_country: birthCountry,
    raw_natal_payload: rawNatalPayload,
    natal_request_payload: natalRequestPayload,
    chart_request_payload: chartRequestPayload,
    profile_summary: profileSummary,
    created_at: existingProfile?.createdAt || timestamp,
    updated_at: timestamp
  };
}

function getMemoryProfiles(stateKey) {
  return sortProfiles(toArray(memoryProfiles.get(stateKey)).map(normalizeProfileRecord).filter(Boolean));
}

function setMemoryProfiles(stateKey, profiles) {
  memoryProfiles.set(stateKey, profiles.map((profile) => normalizeProfileRecord(profile)));
}

async function listProfiles(identity) {
  const stateKey = resolveStateKey(identity);

  if (!isSupabaseConfigured()) {
    return getMemoryProfiles(stateKey);
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('state_key', stateKey)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return sortProfiles((data || []).map(normalizeProfileRecord).filter(Boolean));
}

async function applyProfilesToState(identity, profiles, options = {}) {
  const directory = profiles.map(buildDirectoryEntry);
  const activeProfile = profiles.find((profile) => profile.isActive) || profiles[0] || null;

  setProfileDirectory(identity, directory, { notify: false });

  if (activeProfile) {
    hydrateActiveProfile(identity, activeProfile, { notify: false });
    await factIndex.syncActiveProfileFactAvailability(identity, activeProfile, { notify: false });
  } else {
    hydrateActiveProfile(identity, null, { notify: false });
    await factIndex.syncActiveProfileFactAvailability(identity, null, { notify: false });
  }

  if (options.log !== false && activeProfile) {
    info('active profile hydrated', {
      stateKey: resolveStateKey(identity),
      profileId: activeProfile.profileId,
      profileName: activeProfile.profileName
    });
  }

  if (options.notify !== false) {
    notifyPersistence(identity);
  }

  return {
    directory,
    activeProfile
  };
}

async function refreshProfiles(identity, options = {}) {
  const profiles = await listProfiles(identity);
  await applyProfilesToState(identity, profiles, options);
  return profiles;
}

async function getActiveProfile(identity) {
  const profiles = await listProfiles(identity);
  return profiles.find((profile) => profile.isActive) || profiles[0] || null;
}

async function getProfileById(identity, profileId) {
  const normalizedId = String(profileId || '').trim();
  if (!normalizedId) {
    return null;
  }

  const profiles = await listProfiles(identity);
  return profiles.find((profile) => profile.profileId === normalizedId) || null;
}

async function deactivateOtherProfiles(identity, exceptProfileId) {
  const stateKey = resolveStateKey(identity);
  const normalizedId = String(exceptProfileId || '').trim();

  if (!isSupabaseConfigured()) {
    const profiles = getMemoryProfiles(stateKey).map((profile) => ({
      ...profile,
      isActive: profile.profileId === normalizedId
    }));
    setMemoryProfiles(stateKey, profiles);
    return;
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(TABLE_NAME)
    .update({ is_active: false })
    .eq('state_key', stateKey)
    .neq('profile_id', normalizedId)
    .eq('is_active', true);

  if (error) {
    throw error;
  }
}

async function saveProfile(identity, input) {
  const stateKey = resolveStateKey(identity);
  const existingProfile = input.profileId ? await getProfileById(identity, input.profileId) : null;
  const currentlyActive = await getActiveProfile(identity);
  const shouldActivate = input.isActive === true || !currentlyActive || currentlyActive.profileId === input.profileId;
  const payload = buildProfilePayload(identity, {
    ...input,
    isActive: shouldActivate
  }, existingProfile);

  if (!isSupabaseConfigured()) {
    const profiles = getMemoryProfiles(stateKey).filter((profile) => profile.profileId !== payload.profile_id);
    const nextProfiles = profiles.map((profile) => ({
      ...profile,
      isActive: shouldActivate ? false : profile.isActive
    }));
    nextProfiles.push(normalizeProfileRecord(payload));
    setMemoryProfiles(stateKey, nextProfiles);
    await refreshProfiles(identity, { log: false });
    const storedProfile = await getProfileById(identity, payload.profile_id);
    await toolCache.ensureNatalInsights(identity, storedProfile, { source: 'prewarm', force: true });
    if (storedProfile?.isActive) {
      toolCache.prewarmDailyHoroscope(identity, storedProfile, { locale: getLocale(identity) });
      await factIndex.syncActiveProfileFactAvailability(identity, storedProfile, { notify: false });
    }
    return storedProfile;
  }

  if (shouldActivate) {
    await deactivateOtherProfiles(identity, payload.profile_id);
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'profile_id' });

  if (error) {
    throw error;
  }

  await refreshProfiles(identity, { log: false });
  const storedProfile = await getProfileById(identity, payload.profile_id);
  await toolCache.ensureNatalInsights(identity, storedProfile, { source: 'prewarm', force: true });
  if (storedProfile?.isActive) {
    toolCache.prewarmDailyHoroscope(identity, storedProfile, { locale: getLocale(identity) });
    await factIndex.syncActiveProfileFactAvailability(identity, storedProfile, { notify: false });
  }
  return storedProfile;
}

async function setActiveProfile(identity, profileId) {
  const target = await getProfileById(identity, profileId);
  if (!target) {
    return null;
  }

  if (!isSupabaseConfigured()) {
    const stateKey = resolveStateKey(identity);
    const profiles = getMemoryProfiles(stateKey).map((profile) => ({
      ...profile,
      isActive: profile.profileId === target.profileId
    }));
    setMemoryProfiles(stateKey, profiles);
    await refreshProfiles(identity, { log: false });
    return getProfileById(identity, target.profileId);
  }

  await deactivateOtherProfiles(identity, target.profileId);

  const client = getSupabaseClient();
  const { error } = await client
    .from(TABLE_NAME)
    .update({ is_active: true })
    .eq('profile_id', target.profileId);

  if (error) {
    throw error;
  }

  await refreshProfiles(identity, { log: false });
  const activeProfile = await getProfileById(identity, target.profileId);
  await toolCache.ensureNatalInsights(identity, activeProfile, { source: 'prewarm' });
  toolCache.prewarmDailyHoroscope(identity, activeProfile, { locale: getLocale(identity) });
  await factIndex.syncActiveProfileFactAvailability(identity, activeProfile, { notify: false });
  return activeProfile;
}

async function deleteProfile(identity, profileId) {
  const target = await getProfileById(identity, profileId);
  if (!target) {
    return { deleted: false, nextActiveProfile: await getActiveProfile(identity) };
  }

  const stateKey = resolveStateKey(identity);

  if (!isSupabaseConfigured()) {
    const remaining = getMemoryProfiles(stateKey).filter((profile) => profile.profileId !== target.profileId);

    if (target.isActive && remaining.length > 0) {
      remaining[0].isActive = true;
    }

    setMemoryProfiles(stateKey, remaining);
    await refreshProfiles(identity, { log: false });
    await factIndex.syncActiveProfileFactAvailability(identity, await getActiveProfile(identity), { notify: false });
    return {
      deleted: true,
      nextActiveProfile: await getActiveProfile(identity)
    };
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(TABLE_NAME)
    .delete()
    .eq('profile_id', target.profileId);

  if (error) {
    throw error;
  }

  const remaining = await listProfiles(identity);

  if (target.isActive && remaining.length > 0 && !remaining.some((profile) => profile.isActive)) {
    await setActiveProfile(identity, remaining[0].profileId);
  } else {
    await refreshProfiles(identity, { log: false });
  }

  await factIndex.syncActiveProfileFactAvailability(identity, await getActiveProfile(identity), { notify: false });

  return {
    deleted: true,
    nextActiveProfile: await getActiveProfile(identity)
  };
}

function buildLegacyMigrationInput(identity, state) {
  if (!state?.rawNatalPayload || !state?.natalRequestPayload) {
    return null;
  }

  return {
    profileName: state?.natalProfile?.name || state?.rawNatalPayload?.subject?.name || 'Chart User',
    rawNatalPayload: state.rawNatalPayload,
    natalRequestPayload: state.natalRequestPayload,
    chartRequestPayload: state.chartRequestPayload,
    birthCountry: state?.natalProfile?.country || state?.rawNatalPayload?.subject?.location?.country || null,
    cityLabel: state?.natalProfile?.city || null,
    isActive: true
  };
}

async function ensureHydrated(identity) {
  const profiles = await listProfiles(identity);

  if (profiles.length > 0) {
    await applyProfilesToState(identity, profiles, { log: false, notify: false });
    const activeProfile = profiles.find((profile) => profile.isActive) || profiles[0] || null;
    await toolCache.ensureNatalInsights(identity, activeProfile, { source: 'prewarm' });
    toolCache.prewarmDailyHoroscope(identity, activeProfile, { locale: getLocale(identity) });
    await factIndex.syncActiveProfileFactAvailability(identity, activeProfile, { notify: false });
    return profiles;
  }

  const state = getChatState(identity);
  const legacyInput = buildLegacyMigrationInput(identity, state);

  if (!legacyInput) {
    setProfileDirectory(identity, [], { notify: false });
    hydrateActiveProfile(identity, null, { notify: false });
    return [];
  }

  warn('migrating legacy natal profile into profile store', {
    stateKey: resolveStateKey(identity)
  });

  try {
    await saveProfile(identity, legacyInput);
    return listProfiles(identity);
  } catch (error) {
    await reportError('profiles.legacy-migration', error, {
      stateKey: resolveStateKey(identity)
    });
    return [];
  }
}

async function findMentionedProfiles(identity, text, options = {}) {
  const normalizedText = String(text || '').trim().toLowerCase();
  const excludedProfileId = String(options.excludeProfileId || '').trim();

  if (!normalizedText) {
    return [];
  }

  const profiles = await listProfiles(identity);
  return profiles.filter((profile) => {
    if (excludedProfileId && profile.profileId === excludedProfileId) {
      return false;
    }

    const name = String(profile.profileName || '').trim().toLowerCase();
    if (!name) {
      return false;
    }

    const pattern = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    return pattern.test(normalizedText);
  });
}

function buildSynastryPersonPayload(profile) {
  if (!profile?.rawNatalPayload) {
    return null;
  }

  return {
    id: profile.profileId,
    name: profile.profileName,
    datetime: profile.rawNatalPayload?.subject?.datetime || null,
    time_unknown: profile.timeKnown === false,
    location: clone(profile.rawNatalPayload?.subject?.location || null),
    tz_str: profile.timezone || profile.natalRequestPayload?.tz_str || null
  };
}

module.exports = {
  applyProfilesToState,
  buildDirectoryEntry,
  buildProfileSummary,
  buildSynastryPersonPayload,
  ensureHydrated,
  findMentionedProfiles,
  getActiveProfile,
  getProfileById,
  listProfiles,
  refreshProfiles,
  saveProfile,
  setActiveProfile,
  deleteProfile
};
