const { CATALOG, SELF_LANGUAGE_NAMES } = require('../i18n/catalog');
const { getChatState, notifyPersistence } = require('../state/chatState');

const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'es'];

function normalizeLocale(input) {
  const value = String(input || '').trim().toLowerCase();

  if (!value) {
    return null;
  }

  const short = value.split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(short) ? short : null;
}

function mapPlatformLocale(localeHint) {
  return normalizeLocale(localeHint);
}

function mapCountryToLocale(country) {
  const value = String(country || '').trim().toLowerCase();

  if (!value) {
    return null;
  }

  if (['france'].includes(value)) {
    return 'fr';
  }

  if (['germany', 'deutschland'].includes(value)) {
    return 'de';
  }

  if (['spain', 'españa', 'espana'].includes(value)) {
    return 'es';
  }

  return null;
}

function resolveLocaleForState(state) {
  if (state.localeSource === 'manual' && normalizeLocale(state.locale)) {
    return {
      locale: normalizeLocale(state.locale),
      source: 'manual'
    };
  }

  const platformLocale = mapPlatformLocale(state.platformLocaleHint);
  if (platformLocale) {
    return {
      locale: platformLocale,
      source: 'platform'
    };
  }

  const birthCountryLocale = mapCountryToLocale(state.natalProfile?.country || state.rawNatalPayload?.subject?.location?.country);
  if (birthCountryLocale) {
    return {
      locale: birthCountryLocale,
      source: 'birth_country'
    };
  }

  return {
    locale: 'en',
    source: 'default'
  };
}

function applyResolvedLocale(identity, nextResolved) {
  const state = getChatState(identity);
  state.locale = nextResolved.locale;
  state.localeSource = nextResolved.source;
  notifyPersistence(identity);
  return state.locale;
}

function syncLocaleFromEvent(event) {
  const state = getChatState(event);
  const nextPlatformHint = mapPlatformLocale(event?.localeHint);

  if (nextPlatformHint) {
    state.platformLocaleHint = nextPlatformHint;
  }

  if (state.localeSource === 'manual') {
    if (nextPlatformHint) {
      notifyPersistence(event);
    }
    return state.locale || 'en';
  }

  return applyResolvedLocale(event, resolveLocaleForState(state));
}

function refreshLocaleFromProfile(identity) {
  const state = getChatState(identity);

  if (state.localeSource === 'manual') {
    return state.locale || 'en';
  }

  return applyResolvedLocale(identity, resolveLocaleForState(state));
}

function setManualLocale(identity, locale) {
  const normalized = normalizeLocale(locale) || 'en';
  const state = getChatState(identity);
  state.locale = normalized;
  state.localeSource = 'manual';
  notifyPersistence(identity);
  return normalized;
}

function getLocale(identity) {
  const state = getChatState(identity);

  if (!normalizeLocale(state.locale)) {
    return applyResolvedLocale(identity, resolveLocaleForState(state));
  }

  return normalizeLocale(state.locale) || 'en';
}

function getCatalog(locale) {
  return CATALOG[normalizeLocale(locale) || 'en'] || CATALOG.en;
}

function interpolate(template, args = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = args[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function pickByPath(locale, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), getCatalog(locale));
}

function t(identityOrLocale, path, args = {}) {
  const locale = typeof identityOrLocale === 'string' && SUPPORTED_LOCALES.includes(identityOrLocale)
    ? identityOrLocale
    : getLocale(identityOrLocale);
  const value = pickByPath(locale, path) ?? pickByPath('en', path);

  if (typeof value !== 'string') {
    return '';
  }

  return interpolate(value, args);
}

function getStarterSuggestions(locale) {
  return [...getCatalog(locale).suggestions.starter];
}

function getStarterSuggestionButtons(locale) {
  const catalog = getCatalog(locale);
  return [...(catalog.suggestions.starterButtons || catalog.suggestions.starter)];
}

function getFirstQuestionPrompts(locale) {
  return [...getCatalog(locale).suggestions.firstQuestions];
}

function getFirstQuestionButtonLabels(locale) {
  const catalog = getCatalog(locale);
  return [...(catalog.suggestions.firstQuestionButtons || catalog.suggestions.firstQuestions)];
}

function getFollowUpSuggestions(locale, intentId) {
  const followUps = getCatalog(locale).suggestions.followUps;
  return [...(followUps[intentId] || followUps.fallback)];
}

function getLanguageOptions() {
  return SUPPORTED_LOCALES.map((locale) => ({
    locale,
    title: SELF_LANGUAGE_NAMES[locale]
  }));
}

function getLanguageName(locale, displayLocale = locale) {
  const catalog = getCatalog(displayLocale);
  return catalog.languageNames[normalizeLocale(locale) || 'en'] || SELF_LANGUAGE_NAMES.en;
}

function translateUserError(locale, error) {
  const rawMessage = error && error.message ? String(error.message) : t(locale, 'errors.genericUnexpected');

  const replacements = [
    {
      test: /^FreeAstro rejected the API key/i,
      text: {
        en: 'FreeAstro rejected the API key. Check FREEASTRO_API_KEY.',
        fr: 'FreeAstro a rejeté la clé API. Vérifiez FREEASTRO_API_KEY.',
        de: 'FreeAstro hat den API-Schlüssel abgelehnt. Prüfe FREEASTRO_API_KEY.',
        es: 'FreeAstro rechazó la clave API. Revisa FREEASTRO_API_KEY.'
      }
    },
    {
      test: /^FreeAstro access is not available/i,
      text: {
        en: 'FreeAstro access is not available for this API key.',
        fr: 'L’accès FreeAstro n’est pas disponible pour cette clé API.',
        de: 'Der FreeAstro-Zugriff ist für diesen API-Schlüssel nicht verfügbar.',
        es: 'El acceso a FreeAstro no está disponible para esta clave API.'
      }
    },
    {
      test: /^FreeAstro endpoint was not found/i,
      text: {
        en: 'FreeAstro endpoint was not found.',
        fr: 'Le point d’accès FreeAstro est introuvable.',
        de: 'Der FreeAstro-Endpunkt wurde nicht gefunden.',
        es: 'No se encontró el endpoint de FreeAstro.'
      }
    },
    {
      test: /^FreeAstro rate limit reached/i,
      text: {
        en: rawMessage,
        fr: rawMessage.replace('FreeAstro rate limit reached. Try again', 'La limite FreeAstro est atteinte. Réessayez'),
        de: rawMessage.replace('FreeAstro rate limit reached. Try again', 'Das FreeAstro-Limit ist erreicht. Versuche es erneut'),
        es: rawMessage.replace('FreeAstro rate limit reached. Try again', 'Se alcanzó el límite de FreeAstro. Inténtalo de nuevo')
      }
    },
    {
      test: /^FreeAstro is temporarily unavailable/i,
      text: {
        en: 'FreeAstro is temporarily unavailable. Try again shortly.',
        fr: 'FreeAstro est temporairement indisponible. Réessayez bientôt.',
        de: 'FreeAstro ist vorübergehend nicht verfügbar. Versuche es bald erneut.',
        es: 'FreeAstro no está disponible temporalmente. Inténtalo de nuevo pronto.'
      }
    },
    {
      test: /^Could not find a city match for/i,
      text: {
        en: rawMessage,
        fr: rawMessage.replace('Could not find a city match for', 'Aucune ville correspondante trouvée pour'),
        de: rawMessage.replace('Could not find a city match for', 'Keine passende Stadt gefunden für'),
        es: rawMessage.replace('Could not find a city match for', 'No se encontró una ciudad coincidente para')
      }
    },
    {
      test: /^Please provide a city name/i,
      text: {
        en: 'Please provide a city name.',
        fr: 'Veuillez fournir un nom de ville.',
        de: 'Bitte gib einen Stadtnamen an.',
        es: 'Indica el nombre de una ciudad.'
      }
    },
    {
      test: /^FreeAstro API returned invalid JSON/i,
      text: {
        en: 'FreeAstro API returned invalid JSON.',
        fr: 'L’API FreeAstro a renvoyé un JSON invalide.',
        de: 'Die FreeAstro-API hat ungültiges JSON zurückgegeben.',
        es: 'La API de FreeAstro devolvió JSON no válido.'
      }
    }
  ];

  const localizedDetail = replacements.find((entry) => entry.test.test(rawMessage))?.text?.[locale] || rawMessage;
  return `${t(locale, 'errors.starsUnavailable')}\n${localizedDetail}`;
}

module.exports = {
  SUPPORTED_LOCALES,
  getFirstQuestionPrompts,
  getFirstQuestionButtonLabels,
  getFollowUpSuggestions,
  getLanguageName,
  getLanguageOptions,
  getLocale,
  getStarterSuggestions,
  getStarterSuggestionButtons,
  mapCountryToLocale,
  mapPlatformLocale,
  normalizeLocale,
  refreshLocaleFromProfile,
  setManualLocale,
  syncLocaleFromEvent,
  t,
  translateUserError
};
