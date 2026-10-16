function buildWarmableActiveProfile(chatState) {
  if (!chatState?.activeProfileId || !chatState?.rawNatalPayload || !chatState?.natalRequestPayload) {
    return null;
  }

  return {
    profileId: chatState.activeProfileId,
    profileName: chatState.natalProfile?.name || 'Chart User',
    rawNatalPayload: chatState.rawNatalPayload,
    natalRequestPayload: chatState.natalRequestPayload,
    chartRequestPayload: chatState.chartRequestPayload,
    cityLabel: chatState.natalProfile?.city || null,
    timezone: chatState.rawNatalPayload?.subject?.location?.timezone || chatState.natalRequestPayload?.tz_str || null,
    timeKnown: chatState.natalProfile?.timeKnown !== false,
    natalProfile: chatState.natalProfile || null
  };
}

function scheduleDailyHoroscopePrewarm(event, deps, chatState = deps.getChatState(event)) {
  const profile = buildWarmableActiveProfile(chatState);

  if (!profile || typeof deps.toolCache.prewarmDailyHoroscope !== 'function') {
    return;
  }

  deps.toolCache.prewarmDailyHoroscope(event, profile, {
    locale: deps.locale.getLocale(event)
  });
}

module.exports = {
  buildWarmableActiveProfile,
  scheduleDailyHoroscopePrewarm
};
