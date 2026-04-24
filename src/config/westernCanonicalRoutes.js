const { normalizeQuestion } = require('./commonQuestionRoutes');

function buildAliases(localized = {}) {
  return ['en', 'fr', 'de', 'es']
    .flatMap((locale) => localized[locale] || [])
    .filter(Boolean);
}

function buildCanonicalRoute(input) {
  return {
    id: input.id,
    family: input.family,
    routeKind: input.routeKind,
    answerStyle: input.answerStyle,
    toolTarget: input.toolTarget || null,
    commonRouteId: input.commonRouteId || null,
    requiredArgs: input.requiredArgs || [],
    optionalArgs: input.optionalArgs || [],
    cacheStrategy: input.cacheStrategy || 'none',
    supportsRaw: input.supportsRaw !== false,
    responseShape: input.responseShape || 'synthesis',
    scope: input.scope || null,
    intentSample: input.intentSample,
    matchHint: input.matchHint || null,
    aliases: buildAliases(input.localized)
  };
}

function buildElectionalCanonicalRoute(input) {
  return buildCanonicalRoute({
    family: 'electional',
    routeKind: 'astrology_transits',
    answerStyle: 'system_answer',
    requiredArgs: ['profile', 'searchWindow', 'location'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    ...input
  });
}

const ELECTIONAL_CANONICAL_ROUTES = [
  buildElectionalCanonicalRoute({
    id: 'wedding_election_search',
    toolTarget: 'v2_western_electional_wedding_search',
    optionalArgs: ['secondaryProfile'],
    scope: 'wedding_election',
    intentSample: 'what is the best wedding date for me this year',
    localized: {
      en: [
        'what is the best wedding date for me this year',
        'what is the best time to get married this year',
        'when is the best time to marry this year'
      ],
      fr: [
        'quel est le meilleur moment pour me marier cette année',
        'quelle est la meilleure date pour mon mariage cette année',
        'quel est le meilleur moment pour me marrier cette année'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'making_contracts_election_search',
    toolTarget: 'v2_western_electional_making_contracts_search',
    scope: 'making_contracts_election',
    intentSample: 'what is the best date to sign a contract',
    localized: {
      en: [
        'what is the best date to sign a contract',
        'when should i make a contract',
        'best timing for signing an agreement'
      ],
      fr: [
        'quelle est la meilleure date pour signer un contrat',
        'quel est le meilleur moment pour faire un contrat',
        'quel est le meilleur moment pour signer un accord'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'job_audition_election_search',
    toolTarget: 'v2_western_electional_job_audition_search',
    scope: 'job_audition_election',
    intentSample: 'what is the best time for a job audition',
    localized: {
      en: [
        'what is the best time for a job audition',
        'best date for a job interview',
        'when should i do my audition'
      ],
      fr: [
        'quel est le meilleur moment pour un entretien d embauche',
        'quelle est la meilleure date pour une audition',
        'quel est le meilleur moment pour un entretien'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'purchase_property_election_search',
    toolTarget: 'v2_western_electional_purchase_property_search',
    scope: 'purchase_property_election',
    intentSample: 'what is the best time to buy property',
    localized: {
      en: [
        'what is the best time to buy property',
        'best date to purchase a house',
        'when should i buy real estate'
      ],
      fr: [
        'quel est le meilleur moment pour acheter un bien immobilier',
        'quelle est la meilleure date pour acheter une maison',
        'quel est le meilleur moment pour acheter un appartement'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'purchase_car_election_search',
    toolTarget: 'v2_western_electional_purchase_car_search',
    scope: 'purchase_car_election',
    intentSample: 'what is the best time to buy a car',
    localized: {
      en: [
        'what is the best time to buy a car',
        'best date to purchase a car',
        'when should i buy a vehicle'
      ],
      fr: [
        'quel est le meilleur moment pour acheter une voiture',
        'quelle est la meilleure date pour acheter une voiture',
        'quel est le meilleur moment pour acheter un vehicule'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'move_into_new_home_election_search',
    toolTarget: 'v2_western_electional_move_into_new_home_search',
    scope: 'move_into_new_home_election',
    intentSample: 'what is the best date to move into my new home',
    localized: {
      en: [
        'what is the best date to move into my new home',
        'best timing for moving into a new house',
        'when should i move into my new apartment'
      ],
      fr: [
        'quelle est la meilleure date pour emmenager dans mon nouveau logement',
        'quel est le meilleur moment pour emmenager dans ma nouvelle maison',
        'quel est le meilleur moment pour mon demenagement'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'starting_journey_election_search',
    toolTarget: 'v2_western_electional_starting_journey_search',
    scope: 'starting_journey_election',
    intentSample: 'what is the best time to start my journey',
    localized: {
      en: [
        'what is the best time to start my journey',
        'best date to begin a trip',
        'when should i start traveling',
        'what is the best time to travel this year'
      ],
      fr: [
        'quel est le meilleur moment pour commencer mon voyage',
        'quelle est la meilleure date pour partir en voyage',
        'quel est le meilleur moment pour prendre la route',
        'quel est le meilleur moment pour voyager cette annee'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'legal_proceedings_election_search',
    toolTarget: 'v2_western_electional_legal_proceedings_search',
    scope: 'legal_proceedings_election',
    intentSample: 'what is the best time for legal proceedings',
    localized: {
      en: [
        'what is the best time for legal proceedings',
        'best date for a court case',
        'when should i start legal action'
      ],
      fr: [
        'quel est le meilleur moment pour une procedure judiciaire',
        'quelle est la meilleure date pour aller au tribunal',
        'quel est le meilleur moment pour un proces'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'physical_examination_election_search',
    toolTarget: 'v2_western_electional_physical_examination_search',
    scope: 'physical_examination_election',
    intentSample: 'what is the best time for a physical examination',
    localized: {
      en: [
        'what is the best time for a physical examination',
        'best date for a medical checkup',
        'when should i schedule a medical exam'
      ],
      fr: [
        'quel est le meilleur moment pour un examen medical',
        'quelle est la meilleure date pour un bilan de sante',
        'quel est le meilleur moment pour une visite medicale'
      ]
    }
  }),
  buildElectionalCanonicalRoute({
    id: 'invest_money_election_search',
    toolTarget: 'v2_western_electional_invest_money_search',
    scope: 'invest_money_election',
    intentSample: 'what is the best time to invest money',
    localized: {
      en: [
        'what is the best time to invest money',
        'best date for an investment',
        'when should i invest my money'
      ],
      fr: [
        'quel est le meilleur moment pour investir mon argent',
        'quelle est la meilleure date pour un investissement',
        'quel est le meilleur moment pour faire un placement'
      ]
    }
  })
];

const WESTERN_CANONICAL_ROUTES = [
  buildCanonicalRoute({
    id: 'natal_overview',
    family: 'natal',
    routeKind: 'astrology_natal',
    answerStyle: 'natal_theme',
    commonRouteId: 'natal_overview',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_natal_then_tool',
    responseShape: 'factual_cards',
    scope: 'natal_overview',
    intentSample: 'tell me about my natal chart and its specificities',
    localized: {
      en: ['tell me about my natal chart', 'what are the main themes of my chart', 'my birth chart overview'],
      fr: ['parle moi de mon theme natal', 'parle moi de mon thème natal', 'parle moi de mon theme astro', 'parle moi de mon thème astro', 'parle de mon theme astro', 'parle de mon thème astro', 'quelles sont les grandes lignes de mon theme'],
      de: ['erzahl mir von meinem geburtshoroskop', 'was sind die hauptthemen meines horoskops'],
      es: ['hablame de mi carta natal', 'cuales son los temas principales de mi carta']
    }
  }),
  buildCanonicalRoute({
    id: 'relationship_patterns',
    family: 'natal',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    commonRouteId: 'relationship_patterns',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_natal_then_tool',
    responseShape: 'factual_cards',
    scope: 'relationship_patterns',
    intentSample: 'what are my relationship patterns',
    localized: {
      en: ['what are my relationship patterns', 'how am i in relationships'],
      fr: ['quels sont mes schemas amoureux', 'mes patterns relationnels'],
      de: ['was sind meine beziehungsmuster'],
      es: ['cuales son mis patrones de relacion']
    }
  }),
  buildCanonicalRoute({
    id: 'career_signature',
    family: 'natal',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    commonRouteId: 'career_signature',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_natal_then_tool',
    responseShape: 'factual_cards',
    scope: 'career_signature',
    intentSample: 'what is my career signature',
    localized: {
      en: ['what is my career signature', 'tell me about my work path'],
      fr: ['quelle est ma signature de carriere', 'parle moi de ma voie professionnelle'],
      de: ['was ist meine berufliche signatur'],
      es: ['cual es mi firma de carrera']
    }
  }),
  buildCanonicalRoute({
    id: 'money_pattern',
    family: 'natal',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    commonRouteId: 'money_pattern',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_natal_then_tool',
    responseShape: 'factual_cards',
    scope: 'money_pattern',
    intentSample: 'what is my money pattern',
    localized: {
      en: ['what is my money pattern', 'tell me about money in my chart'],
      fr: ['quel est mon schema financier', 'parle moi de l argent dans mon theme'],
      de: ['was ist mein geldmuster'],
      es: ['cual es mi patron de dinero']
    }
  }),
  buildCanonicalRoute({
    id: 'chart_structures',
    family: 'natal',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    commonRouteId: 'special_structures',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_natal_then_tool',
    responseShape: 'factual_cards',
    scope: 'chart_structures',
    intentSample: 'what special structures are in my chart',
    localized: {
      en: ['what special structures are in my chart', 'what structures are in my chart', 'show me the structures in my chart'],
      fr: ['quelles structures speciales sont dans mon theme', 'quels sont les structures de mon theme', 'quels sont les structures de mon thème', 'quels sont les structures de mon thèmes', 'montre moi les structures de mon theme', 'montre moi les structures de mon thème'],
      de: ['welche besonderen strukturen gibt es in meinem horoskop', 'welche strukturen gibt es in meinem horoskop'],
      es: ['que estructuras especiales hay en mi carta', 'que estructuras hay en mi carta']
    }
  }),
  buildCanonicalRoute({
    id: 'all_natal_aspects',
    family: 'natal',
    routeKind: 'astrology_natal',
    answerStyle: 'aspect_focus',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_natal_then_tool',
    responseShape: 'full_listing',
    scope: 'natal_aspects',
    intentSample: 'list all my aspects',
    matchHint: 'Static natal chart aspect listing only. Use this only when the user wants the aspects that already exist inside the birth chart. Do not use for transit searches across time, date ranges, years, or since birth.',
    localized: {
      en: ['list all my aspects', 'show me all my aspects', 'give me all my natal aspects', 'all aspects in my chart'],
      fr: ['liste mes aspects', 'liste tous mes aspects', 'donne moi tous mes aspects astrologiques', 'donne moi tous mes aspects astrologiques de mon theme', 'aspects de mon theme', 'aspects de mon thème', 'tous mes aspects'],
      de: ['liste alle meine aspekte', 'zeige mir alle meine aspekte', 'alle aspekte in meinem horoskop'],
      es: ['lista todos mis aspectos', 'muestrame todos mis aspectos', 'todos mis aspectos astrologicos']
    }
  }),
  buildCanonicalRoute({
    id: 'rising_sign',
    family: 'signs',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    toolTarget: 'v1_western_signs_rising',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'rising_sign',
    intentSample: 'what is my rising sign',
    localized: {
      en: ['what is my rising sign', 'what is my ascendant'],
      fr: ['quel est mon ascendant', 'quel est mon signe ascendant', 'montre moi mon ascendant', 'donne moi mon ascendant'],
      de: ['was ist mein aszendent'],
      es: ['cual es mi ascendente']
    }
  }),
  buildCanonicalRoute({
    id: 'sun_sign',
    family: 'signs',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    toolTarget: 'v1_western_signs_sun',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'sun_sign',
    intentSample: 'what is my sun sign',
    localized: {
      en: ['what is my sun sign'],
      fr: ['quel est mon signe solaire'],
      de: ['was ist mein sonnenzeichen'],
      es: ['cual es mi signo solar']
    }
  }),
  buildCanonicalRoute({
    id: 'moon_sign',
    family: 'signs',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    toolTarget: 'v1_western_signs_moon',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'moon_sign',
    intentSample: 'what is my moon sign',
    localized: {
      en: ['what is my moon sign'],
      fr: ['quel est mon signe lunaire'],
      de: ['was ist mein mondzeichen'],
      es: ['cual es mi signo lunar']
    }
  }),
  buildCanonicalRoute({
    id: 'midheaven_sign',
    family: 'signs',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    toolTarget: 'v1_western_signs_midheaven',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'midheaven_sign',
    intentSample: 'what is my midheaven sign',
    localized: {
      en: ['what is my midheaven sign', 'what is my mc sign'],
      fr: ['quel est mon signe de milieu du ciel', 'quel est mon mc'],
      de: ['was ist mein medium coeli zeichen'],
      es: ['cual es mi signo de medio cielo']
    }
  }),
  buildCanonicalRoute({
    id: 'current_sky_today',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'current_sky',
    commonRouteId: 'current_sky_today',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    responseShape: 'factual_cards',
    scope: 'current_sky',
    intentSample: 'tell me about the current sky',
    localized: {
      en: ['tell me about the current sky', 'what is happening in the sky today'],
      fr: ['parle moi du ciel du jour', 'quels sont les transits du jour'],
      de: ['erzahl mir vom aktuellen himmel'],
      es: ['hablame del cielo actual']
    }
  }),
  buildCanonicalRoute({
    id: 'today_transits_me',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'today_transits_me',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    responseShape: 'factual_cards',
    scope: 'today_transits',
    intentSample: 'what are my transits today',
    localized: {
      en: ['what are my transits today', 'what is active for me today'],
      fr: ['quels sont mes transits du jour', 'qu est ce qui est active pour moi aujourd hui'],
      de: ['welche transite habe ich heute'],
      es: ['cuales son mis transitos de hoy']
    }
  }),
  buildCanonicalRoute({
    id: 'month_ahead_transits',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'month_ahead_transits',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    responseShape: 'factual_cards',
    scope: 'monthly_transits',
    intentSample: 'what are my transits this month',
    matchHint: 'Monthly transit overview for the current or requested month. Curated top major transits, not all transits.',
    localized: {
      en: ['what are my transits this month', 'what are this months transits', 'transits this month'],
      fr: ['quels sont mes transits de ce mois', 'quels sont les transits pour ce mois', 'donne moi les transits du mois', 'transits du mois'],
      de: ['welche transite habe ich diesen monat'],
      es: ['cuales son mis transitos de este mes']
    }
  }),
  buildCanonicalRoute({
    id: 'monthly_transits_for_planet',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'monthly_transits_filtered',
    intentSample: 'show me the top monthly transits related to a specific planet',
    matchHint: 'Monthly transit listing filtered to one named planet, for example Pluto, Saturn, Venus, Mars, Jupiter, Uranus, Neptune, Chiron, Sun, Moon, or Mercury. Includes formulations asking for the strongest or top 3/top 5 transits related to that planet during this month or another requested month. Supports requested months and asks about when they end.',
    localized: {
      en: [
        'show me all monthly transits related to pluto',
        'give me all this month transits related to pluto',
        'monthly pluto transits and when they end',
        'return the 3 strongest transits related to pluto this month',
        'show me the top 5 monthly transits related to saturn',
        'what are the strongest venus transits for me this month'
      ],
      fr: [
        'donne moi tous les transits du mois en rapport avec pluton',
        'donne moi tous les transits du moi en rapport avec pluton',
        'montre moi tous les transits du mois liés à pluton',
        'montre moi tous les transits du mois lies a pluton et quand ils se terminent',
        'retourne les 3 transits les plus forts en rapport avec pluton ce mois ci',
        'retourne les 3 transits les plus forts en rapport avec pluton ce mois-ci',
        'montre moi les 5 transits les plus forts lies a saturne ce mois ci',
        'quels sont les transits les plus forts en rapport avec venus ce mois ci'
      ],
      de: [
        'zeige mir alle monatstransite in bezug auf pluto',
        'zeige mir die 3 starksten transite zu pluto in diesem monat'
      ],
      es: [
        'muestrame todos los transitos del mes relacionados con pluton',
        'devuelveme los 3 transitos mas fuertes relacionados con pluton este mes'
      ]
    }
  }),
  buildCanonicalRoute({
    id: 'all_monthly_transits',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    responseShape: 'full_listing',
    scope: 'monthly_transits',
    intentSample: 'list all monthly transits',
    matchHint: 'Exhaustive monthly transit listing for the current or requested month. Return all transits, not a curated subset.',
    localized: {
      en: ['list all monthly transits', 'show me all transits this month', 'all my transits this month', 'list all transits this month'],
      fr: ['tous les transits du mois', 'liste tous les transits', 'liste tous les transits du mois', 'donne moi tous les transits du mois'],
      de: ['liste alle transite dieses monats', 'zeige mir alle transite diesen monat'],
      es: ['lista todos los transitos del mes', 'muestrame todos los transitos de este mes']
    }
  }),
  buildCanonicalRoute({
    id: 'current_relationship_transits',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'current_relationship_transits',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    intentSample: 'what is happening in love for me right now',
    localized: {
      en: ['what is happening in love for me right now', 'what are my current relationship transits'],
      fr: ['que se passe en amour pour moi en ce moment', 'quels sont mes transits relationnels actuels'],
      de: ['was passiert gerade in der liebe fur mich'],
      es: ['que pasa en el amor para mi ahora']
    }
  }),
  buildCanonicalRoute({
    id: 'current_career_transits',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'current_career_transits',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    intentSample: 'what is happening in my career right now',
    localized: {
      en: ['what is happening in my career right now', 'what are my current career transits'],
      fr: ['que se passe dans ma carriere en ce moment', 'quels sont mes transits actuels de carriere'],
      de: ['was passiert gerade in meiner karriere'],
      es: ['que pasa en mi carrera ahora']
    }
  }),
  buildCanonicalRoute({
    id: 'current_mental_transits',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'current_mental_transits',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    intentSample: 'what is happening mentally for me right now',
    localized: {
      en: ['what is happening mentally for me right now', 'what are my mercury transits now'],
      fr: ['que se passe mentalement pour moi en ce moment', 'quels sont mes transits de mercure actuellement'],
      de: ['was passiert mental gerade fur mich'],
      es: ['que pasa mentalmente para mi ahora']
    }
  }),
  buildCanonicalRoute({
    id: 'current_emotional_transits',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'current_emotional_transits',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    intentSample: 'what is happening emotionally for me right now',
    localized: {
      en: ['what is happening emotionally for me right now', 'what are my emotional transits now'],
      fr: ['que se passe emotionnellement pour moi en ce moment', 'quels sont mes transits emotionnels actuels'],
      de: ['was passiert emotional gerade fur mich'],
      es: ['que pasa emocionalmente para mi ahora']
    }
  }),
  buildCanonicalRoute({
    id: 'pressure_window_now',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'pressure_window_now',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    intentSample: 'what is my current pressure window',
    localized: {
      en: ['what is my current pressure window', 'where is the pressure for me right now'],
      fr: ['quelle est ma fenetre de pression actuelle', 'ou est la pression pour moi en ce moment'],
      de: ['was ist mein aktuelles druckfenster'],
      es: ['cual es mi ventana de presion actual']
    }
  }),
  buildCanonicalRoute({
    id: 'timing_window_month',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    commonRouteId: 'timing_window_month',
    toolTarget: 'v1_western_transits_timeline',
    requiredArgs: ['profile'],
    cacheStrategy: 'indexed_transits_then_tool',
    intentSample: 'what are the most important dates for me this month',
    localized: {
      en: ['what are the most important dates for me this month', 'what is the main timing window this month'],
      fr: ['quelles sont les dates les plus importantes pour moi ce mois ci', 'quelle est la fenetre temporelle principale de ce mois'],
      de: ['welche daten sind fur mich diesen monat am wichtigsten'],
      es: ['cuales son las fechas mas importantes para mi este mes']
    }
  }),
  buildCanonicalRoute({
    id: 'transit_search_exact',
    family: 'transits',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_transits_search',
    requiredArgs: ['profile', 'transitPlanet', 'natalPoint'],
    optionalArgs: ['range'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'transit_search',
    intentSample: 'show me all exact transits of one planet to one natal point over a requested period',
    matchHint: 'Search one transit planet against one natal point across a date range, month, year, or since birth. Supports aspect filters like square, conjunction, opposition, trine, sextile. Use this for phrases like between my Sun and Saturn since birth, exact Saturn transits to my Moon, or all squares/oppositions/trines over time. Never use this for a static natal aspect list.',
    localized: {
      en: [
        'show me exact saturn transits to my moon',
        'find exact transits to my moon',
        'search transits of saturn to my moon',
        'return all squares between my sun and saturn since birth',
        'show me all squares between my sun and saturn since birth'
      ],
      fr: [
        'montre moi les transits exacts de saturne a ma lune',
        'montre moi les transits exacts de saturne à ma lune',
        'cherche les transits exacts sur ma lune',
        'retourne tous les carres entre mon soleil et saturne depuis ma naissance',
        'retourne tous les carrés entre mon soleil et saturne depuis ma naissance',
        'montre moi tous les carrés entre mon soleil et saturne depuis ma naissance',
        'cherche tous les carrés entre mon soleil et saturne depuis ma naissance'
      ],
      de: ['zeige mir exakte saturn transite zu meinem mond'],
      es: ['muestrame los transitos exactos de saturno a mi luna']
    }
  }),
  buildCanonicalRoute({
    id: 'synastry_summary',
    family: 'synastry',
    routeKind: 'astrology_synastry',
    answerStyle: 'synastry',
    toolTarget: 'v1_western_synastry_summary',
    requiredArgs: ['profile', 'secondaryProfile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'synastry_summary',
    intentSample: 'compare me with Elie',
    localized: {
      en: ['compare me with', 'compatibility with', 'synastry summary with'],
      fr: ['compare moi avec', 'compatibilite avec', 'synastrie avec'],
      de: ['vergleiche mich mit', 'kompatibilitat mit'],
      es: ['comparame con', 'compatibilidad con']
    }
  }),
  buildCanonicalRoute({
    id: 'synastry_detailed',
    family: 'synastry',
    routeKind: 'astrology_synastry',
    answerStyle: 'synastry',
    toolTarget: 'v1_western_synastry',
    requiredArgs: ['profile', 'secondaryProfile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'synastry_detailed',
    intentSample: 'give me detailed synastry with Elie',
    localized: {
      en: ['detailed synastry with', 'full synastry with'],
      fr: ['synastrie detaillee avec', 'synastrie complete avec'],
      de: ['detaillierte synastrie mit'],
      es: ['sinastria detallada con']
    }
  }),
  buildCanonicalRoute({
    id: 'couples_horoscope',
    family: 'synastry',
    routeKind: 'astrology_synastry',
    answerStyle: 'synastry',
    toolTarget: 'v1_western_synastry_horoscope',
    requiredArgs: ['profile', 'secondaryProfile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'couples_horoscope',
    intentSample: 'give me a couples horoscope with Elie',
    localized: {
      en: ['couples horoscope with', 'relationship horoscope with'],
      fr: ['horoscope de couple avec'],
      de: ['paarchorstkop mit'],
      es: ['horoscopo de pareja con']
    }
  }),
  ...ELECTIONAL_CANONICAL_ROUTES,
  buildCanonicalRoute({
    id: 'relocation_recommendations',
    family: 'relocation',
    routeKind: 'astrology_relocation',
    answerStyle: 'system_answer',
    toolTarget: 'v1_western_astrocartography_recommendations',
    requiredArgs: ['profile', 'focus'],
    optionalArgs: ['countryScope'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'relocation_recommendations',
    intentSample: 'where should I relocate for career',
    localized: {
      en: ['where should i relocate for career', 'best places to live for my career', 'where should i live in the world'],
      fr: ['ou devrais je habiter pour ma carriere', 'meilleures villes pour vivre', 'ou est ce que je dois habiter dans le monde'],
      de: ['wo sollte ich fur meine karriere leben'],
      es: ['donde deberia vivir para mi carrera']
    }
  }),
  buildCanonicalRoute({
    id: 'relocation_city_check',
    family: 'relocation',
    routeKind: 'astrology_relocation',
    answerStyle: 'system_answer',
    toolTarget: 'v1_western_astrocartography_city_check',
    requiredArgs: ['profile', 'city'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'relocation_city_check',
    intentSample: 'check Tokyo for me',
    localized: {
      en: ['check tokyo for me', 'check this city for me', 'what about living in tokyo'],
      fr: ['verifie tokyo pour moi', 'que penses tu de vivre a tokyo'],
      de: ['prufe tokio fur mich'],
      es: ['revisa tokio para mi']
    }
  }),
  buildCanonicalRoute({
    id: 'astrocartography_lines',
    family: 'relocation',
    routeKind: 'astrology_relocation',
    answerStyle: 'system_answer',
    toolTarget: 'v1_western_astrocartography_lines',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'astrocartography_lines',
    intentSample: 'show me my astrocartography lines',
    localized: {
      en: ['show me my astrocartography lines', 'what are my lines on the map'],
      fr: ['montre moi mes lignes astrocartographiques', 'quelles sont mes lignes sur la carte'],
      de: ['zeige mir meine astrocartography linien'],
      es: ['muestrame mis lineas astrocartograficas']
    }
  }),
  buildCanonicalRoute({
    id: 'astrocartography_parans',
    family: 'relocation',
    routeKind: 'astrology_relocation',
    answerStyle: 'system_answer',
    toolTarget: 'v1_western_astrocartography_parans',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'astrocartography_parans',
    intentSample: 'show me my astrocartography parans',
    localized: {
      en: ['show me my astrocartography parans', 'what are my parans'],
      fr: ['montre moi mes parans astrocartographiques', 'quels sont mes parans'],
      de: ['zeige mir meine parans'],
      es: ['muestrame mis parans']
    }
  }),
  buildCanonicalRoute({
    id: 'secondary_progressions',
    family: 'progressions',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_progressions_secondary',
    requiredArgs: ['profile', 'targetDate'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'secondary_progressions',
    intentSample: 'my secondary progressions this year',
    localized: {
      en: ['my secondary progressions this year', 'show me my secondary progressions'],
      fr: ['mes progressions secondaires cette annee', 'montre moi mes progressions secondaires'],
      de: ['meine sekundarprogressionen dieses jahr'],
      es: ['mis progresiones secundarias este ano']
    }
  }),
  buildCanonicalRoute({
    id: 'secondary_progressions_exact_aspects',
    family: 'progressions',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_progressions_secondary_exact_aspects',
    requiredArgs: ['profile', 'range'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'secondary_progression_aspects',
    intentSample: 'show me my exact secondary progression aspects this year',
    localized: {
      en: ['show me exact secondary progression aspects', 'secondary progression exact aspects this year'],
      fr: ['montre moi les aspects exacts de mes progressions secondaires'],
      de: ['zeige mir exakte sekundarprogressions aspekte'],
      es: ['muestrame los aspectos exactos de mis progresiones secundarias']
    }
  }),
  buildCanonicalRoute({
    id: 'annual_profections',
    family: 'profections',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_profections_annual',
    requiredArgs: ['profile', 'year'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'annual_profections',
    intentSample: 'my annual profection',
    localized: {
      en: ['my annual profection', 'annual profections'],
      fr: ['ma profection annuelle', 'mes profections annuelles'],
      de: ['meine jahresprofection'],
      es: ['mi profeccion anual']
    }
  }),
  buildCanonicalRoute({
    id: 'solar_return',
    family: 'returns',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_solar_calculate',
    requiredArgs: ['profile', 'year'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'solar_return',
    intentSample: 'my solar return 2026',
    localized: {
      en: ['my solar return', 'solar return 2026'],
      fr: ['mon retour solaire', 'mon retour solaire 2026'],
      de: ['mein solar return'],
      es: ['mi retorno solar']
    }
  }),
  buildCanonicalRoute({
    id: 'planet_return',
    family: 'returns',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_western_returns_calculate',
    requiredArgs: ['profile', 'body'],
    optionalArgs: ['startDate'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'planet_return',
    intentSample: 'my Saturn return',
    localized: {
      en: ['my saturn return', 'my jupiter return', 'planet return'],
      fr: ['mon retour de saturne', 'mon retour de jupiter', 'retour planetaire'],
      de: ['mein saturn return'],
      es: ['mi retorno de saturno']
    }
  }),
  buildCanonicalRoute({
    id: 'ephemeris',
    family: 'ephemeris',
    routeKind: 'astrology_transits',
    answerStyle: 'system_answer',
    toolTarget: 'v1_ephemeris',
    requiredArgs: ['range'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'ephemeris',
    intentSample: 'give me the ephemeris for a requested month or date range',
    matchHint: 'Planetary ephemeris for a requested month, year, or date range.',
    localized: {
      en: ['give me the ephemeris for may', 'show me the ephemeris', 'give me the ephemeris for may 2027'],
      fr: ['donne moi l ephemeride pour mai', 'montre moi l ephemeride', 'donne moi les ephemerides pour mai 2027', 'donne moi les éphémérides pour mai 2027'],
      de: ['gib mir die ephemeride fur mai'],
      es: ['dame la efemeride de mayo']
    }
  }),
  buildCanonicalRoute({
    id: 'personal_horoscope',
    family: 'horoscope',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    toolTarget: 'v1_horoscope_daily_personal',
    requiredArgs: ['profile'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'personal_horoscope',
    intentSample: 'my personal horoscope today',
    localized: {
      en: ['my personal horoscope today', 'give me my horoscope today'],
      fr: ['mon horoscope personnel du jour', 'donne moi mon horoscope du jour'],
      de: ['mein personliches horoskop heute'],
      es: ['mi horoscopo personal de hoy']
    }
  }),
  buildCanonicalRoute({
    id: 'sign_horoscope',
    family: 'horoscope',
    routeKind: 'astrology_transits',
    answerStyle: 'current_sky',
    toolTarget: 'v1_horoscope_daily_sign',
    requiredArgs: ['sign'],
    cacheStrategy: 'tool_only',
    responseShape: 'factual_cards',
    scope: 'sign_horoscope',
    intentSample: 'aries horoscope today',
    localized: {
      en: ['aries horoscope today', 'taurus horoscope today', 'sign horoscope today'],
      fr: ['horoscope belier du jour', 'horoscope du signe aujourd hui'],
      de: ['widder horoskop heute'],
      es: ['horoscopo aries de hoy']
    }
  })
];

function tokenize(text) {
  return normalizeQuestion(text)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function phraseSimilarity(left, right) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (left.includes(right) || right.includes(left)) {
    return 0.92;
  }

  return 0;
}

function tokenOverlapScore(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(Math.min(left.size, right.size), 1);
}

function buildRouteScore(route, normalizedQuestion, questionTokens) {
  return route.aliases.reduce((bestScore, alias) => {
    const aliasNormalized = normalizeQuestion(alias);
    const aliasTokens = tokenize(alias);
    const similarity = phraseSimilarity(normalizedQuestion, aliasNormalized);
    const overlap = tokenOverlapScore(questionTokens, aliasTokens);
    const score = Math.max(similarity, (similarity * 0.55) + (overlap * 0.45));
    return Math.max(bestScore, score);
  }, 0);
}

function matchWesternCanonicalRoute(text) {
  const normalizedQuestion = normalizeQuestion(text);
  const questionTokens = tokenize(text);

  if (!normalizedQuestion || questionTokens.length === 0) {
    return null;
  }

  const bestMatch = WESTERN_CANONICAL_ROUTES
    .map((route) => ({
      ...route,
      normalizedQuestion,
      score: buildRouteScore(route, normalizedQuestion, questionTokens)
    }))
    .sort((left, right) => right.score - left.score)[0];

  if (!bestMatch || bestMatch.score < 0.72) {
    return null;
  }

  return bestMatch;
}

function getWesternCanonicalRouteById(routeId) {
  const normalizedId = String(routeId || '').trim();
  if (!normalizedId) {
    return null;
  }

  return WESTERN_CANONICAL_ROUTES.find((route) => route.id === normalizedId) || null;
}

function listWesternCanonicalRoutes(filter = {}) {
  const routeKind = filter.routeKind ? String(filter.routeKind) : null;
  const family = filter.family ? String(filter.family) : null;

  return WESTERN_CANONICAL_ROUTES.filter((route) => (
    (!routeKind || route.routeKind === routeKind) &&
    (!family || route.family === family)
  ));
}

module.exports = {
  WESTERN_CANONICAL_ROUTES,
  getWesternCanonicalRouteById,
  listWesternCanonicalRoutes,
  matchWesternCanonicalRoute
};
