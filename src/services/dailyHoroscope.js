const { getDailyPersonalHoroscopeV3 } = require('./freeastro');
const { generatePlainText, getFastPathModelName } = require('./gemini');
const { t } = require('./locale');

function buildDailyHoroscopeBirthPayload(profile, timezone) {
  const natal = profile?.natalRequestPayload || {};
  return {
    year: natal.year,
    month: natal.month,
    day: natal.day,
    hour: natal.hour,
    minute: natal.minute,
    city: natal.city,
    lat: natal.lat,
    lng: natal.lng,
    tz_str: natal.tz_str || timezone
  };
}

function formatIsoDateInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildDailyHoroscopeRequest(profile, locale) {
  if (!profile?.natalRequestPayload) {
    return null;
  }

  const timezone = profile?.timezone || profile?.natalRequestPayload?.tz_str || 'UTC';
  return {
    birth: buildDailyHoroscopeBirthPayload(profile, timezone),
    date: formatIsoDateInTimezone(timezone),
    timezone,
    tz_str: timezone,
    locale
  };
}

function formatDailyHoroscopeTransit(entry) {
  const transitPlanet = entry?.transit_planet?.label || entry?.transit_planet || null;
  const aspect = entry?.aspect?.label || entry?.aspect_type || null;
  const natalTarget = entry?.natal_planet?.label || entry?.natal_point?.label || entry?.natal_point || null;
  const parts = [transitPlanet, aspect, natalTarget]
    .filter(Boolean)
    .map((value) => String(value).trim());
  return parts.length >= 3 ? parts.join(' ') : null;
}

function buildDailyHoroscopeFallback(locale, payload) {
  const data = payload?.data || {};
  const labels = {
    theme: { en: 'Theme', fr: 'Thème', de: 'Thema', es: 'Tema' },
    topTransits: { en: 'Key transits today', fr: 'Transits clés du jour', de: 'Wichtige Transite heute', es: 'Tránsitos clave de hoy' }
  };
  const lines = [
    t(locale, 'buttons.dailyHoroscope')
  ];

  if (data?.date) {
    lines[0] = `${lines[0]} — ${data.date}`;
  }

  if (data?.content?.theme) {
    lines.push(`${labels.theme[locale] || labels.theme.en}: ${data.content.theme}`);
  }

  if (data?.content?.text) {
    lines.push(String(data.content.text));
  }

  const topTransits = Array.isArray(data?.personal?.transits_top) ? data.personal.transits_top : [];
  const transitLines = topTransits
    .slice(0, 3)
    .map((entry, index) => {
      const label = formatDailyHoroscopeTransit(entry);
      return label ? `${index + 1}. ${label}` : null;
    })
    .filter(Boolean);

  if (transitLines.length > 0) {
    lines.push([
      labels.topTransits[locale] || labels.topTransits.en,
      ...transitLines
    ].join('\n'));
  }

  return lines.filter(Boolean).join('\n\n');
}

async function rewriteDailyHoroscope(locale, profile, payload) {
  const subject = String(profile?.profileName || profile?.natalProfile?.name || 'you').trim();
  const prompt = [
    `Locale: ${locale}`,
    `Subject: ${subject}`,
    'Grounded endpoint: /api/v3/horoscope/daily/personal',
    '',
    'Grounded payload JSON:',
    JSON.stringify(payload || {}).slice(0, 12000),
    '',
    'Write a detailed daily horoscope in the user locale.',
    'Use only the grounded payload above.',
    'Do not invent dates, transits, timings, meanings, or advice that is not supported by the payload.',
    'Do not mention or restate numerical scores.',
    'If you mention a transit, name it explicitly as transit planet + aspect type + natal target.',
    'Do not refer to unnamed or generic transits.',
    'Organize the answer in 3 to 5 short paragraphs covering the main theme, key influences, opportunities, and cautions.'
  ].join('\n');

  return generatePlainText({
    systemInstruction: [
      'You write detailed but grounded daily horoscope answers.',
      `Write in ${locale}.`,
      'Stay faithful to the payload only.',
      'Do not mention missing fields or speculate.',
      'Never include numeric scores in the final answer.',
      'If you cite a transit, always include its explicit aspect type.'
    ].join('\n'),
    userText: prompt,
    history: [],
    model: getFastPathModelName()
  });
}

async function buildDailyHoroscopeResult(profile, locale, requestArgs = null) {
  const normalizedArgs = requestArgs || buildDailyHoroscopeRequest(profile, locale);

  if (!normalizedArgs) {
    return null;
  }

  const payload = await getDailyPersonalHoroscopeV3(normalizedArgs);
  let text = buildDailyHoroscopeFallback(locale, payload);

  try {
    const rewritten = await rewriteDailyHoroscope(locale, profile, payload);
    if (String(rewritten || '').trim()) {
      text = rewritten.trim();
    }
  } catch (error) {
    // Keep the grounded fallback text when the rewrite path fails.
  }

  return {
    text,
    payload,
    date: normalizedArgs.date,
    timezone: normalizedArgs.timezone,
    locale
  };
}

module.exports = {
  buildDailyHoroscopeRequest,
  buildDailyHoroscopeResult,
  formatIsoDateInTimezone
};
