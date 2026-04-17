const factIndex = require('../services/factIndex');

const TYPO_REPLACEMENTS = new Map([
  ['waht', 'what'],
  ['wht', 'what'],
  ['teh', 'the'],
  ['transitss', 'transits'],
  ['trnasits', 'transits'],
  ['transiit', 'transit'],
  ['currnt', 'current'],
  ['curent', 'current'],
  ['todai', 'today'],
  ['todays', 'today'],
  ['sky', 'sky'],
  ['relashionship', 'relationship'],
  ['relashonship', 'relationship'],
  ['realtionship', 'relationship'],
  ['relationshp', 'relationship'],
  ['paterns', 'patterns'],
  ['patters', 'patterns'],
  ['carrer', 'career'],
  ['carer', 'career'],
  ['carreer', 'career'],
  ['signiture', 'signature'],
  ['signiature', 'signature'],
  ['mercuri', 'mercury'],
  ['venuz', 'venus'],
  ['ascedant', 'ascendant'],
  ['ascendent', 'ascendant'],
  ['speficities', 'specificities'],
  ['specificite', 'specificite'],
  ['specifities', 'specificities'],
  ['thme', 'theme'],
  ['nattal', 'natal']
]);

const SYNONYM_REPLACEMENTS = new Map([
  ['work', 'career'],
  ['job', 'career'],
  ['profession', 'career'],
  ['romance', 'love'],
  ['partner', 'relationship'],
  ['relationships', 'relationship'],
  ['schema', 'patterns'],
  ['schemas', 'patterns'],
  ['current', 'current'],
  ['today', 'today'],
  ['now', 'current'],
  ['mindset', 'mind'],
  ['thinking', 'mind'],
  ['communication', 'mind'],
  ['overview', 'overview'],
  ['summary', 'overview'],
  ['overall', 'overview'],
  ['theme', 'natal'],
  ['chart', 'natal'],
  ['birth', 'natal'],
  ['thème', 'natal'],
  ['theme natal', 'natal']
]);

function buildAliases(localized = {}) {
  return ['en', 'fr', 'de', 'es']
    .flatMap((locale) => localized[locale] || [])
    .filter(Boolean);
}

function buildCommonRoute(input) {
  return {
    id: input.id,
    intentSample: input.intentSample,
    routeKind: input.routeKind,
    answerStyle: input.answerStyle,
    sourceKinds: input.sourceKinds,
    categories: input.categories || [],
    tags: input.tags || [],
    aliases: buildAliases(input.localized)
  };
}

const COMMON_QUESTION_ROUTES = [
  buildCommonRoute({
    id: 'current_sky_today',
    intentSample: 'current sky today',
    routeKind: 'astrology_transits',
    answerStyle: 'current_sky',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_event', 'transit_theme', 'timing_window'],
    tags: ['current', 'today', 'sky'],
    localized: {
      en: ['tell me about the current sky', 'what is happening in the sky today'],
      fr: ['parle moi du ciel du jour', 'quels sont les transits du jour'],
      de: ['erzahl mir vom aktuellen himmel', 'welche transite sind heute am himmel'],
      es: ['hablame del cielo actual', 'que esta pasando en el cielo hoy']
    }
  }),
  buildCommonRoute({
    id: 'today_transits_me',
    intentSample: 'my transits today',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_event', 'transit_theme', 'timing_window'],
    tags: ['current', 'today', 'transit'],
    localized: {
      en: ['what are my transits today', 'what is active for me today'],
      fr: ['quels sont mes transits du jour', 'quest ce qui est active pour moi aujourdhui'],
      de: ['welche transite habe ich heute', 'was ist heute fur mich aktiviert'],
      es: ['cuales son mis transitos de hoy', 'que esta activo para mi hoy']
    }
  }),
  buildCommonRoute({
    id: 'month_ahead_transits',
    intentSample: 'my transits this month',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_theme', 'timing_window'],
    tags: ['current', 'month', 'transit'],
    localized: {
      en: ['tell me about my transits this month', 'what is the theme of my month astrologically'],
      fr: ['parle moi de mes transits de ce mois', 'quel est le theme astrologique de mon mois'],
      de: ['erzahl mir von meinen transit en diesen monat', 'was ist mein astrologisches monatsthema'],
      es: ['hablame de mis transitos de este mes', 'cual es el tema astrologico de mi mes']
    }
  }),
  buildCommonRoute({
    id: 'current_relationship_transits',
    intentSample: 'my relationship transits now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_theme', 'timing_window'],
    tags: ['current', 'relationship', 'love', 'transit'],
    localized: {
      en: ['what is happening in love for me right now', 'what are my current relationship transits'],
      fr: ['que se passe t il en amour pour moi en ce moment', 'quels sont mes transits relationnels actuels'],
      de: ['was passiert gerade in der liebe fur mich', 'welche beziehungstransite habe ich gerade'],
      es: ['que pasa en el amor para mi ahora', 'cuales son mis transitos actuales de relacion']
    }
  }),
  buildCommonRoute({
    id: 'current_career_transits',
    intentSample: 'my career transits now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_theme', 'timing_window'],
    tags: ['current', 'career', 'work', 'transit', 'angle:mc'],
    localized: {
      en: ['what is happening in my career right now', 'what are my current career transits'],
      fr: ['que se passe dans ma carriere en ce moment', 'quels sont mes transits actuels de carriere'],
      de: ['was passiert gerade in meiner karriere', 'welche aktuellen karrieretransite habe ich'],
      es: ['que pasa en mi carrera ahora', 'cuales son mis transitos actuales de carrera']
    }
  }),
  buildCommonRoute({
    id: 'current_mental_transits',
    intentSample: 'my mental transits now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_theme', 'timing_window'],
    tags: ['current', 'mind', 'transit', 'planet:mercury'],
    localized: {
      en: ['what is happening mentally for me right now', 'what are my mercury transits now'],
      fr: ['que se passe mentalement pour moi en ce moment', 'quels sont mes transits de mercure actuellement'],
      de: ['was passiert mental gerade fur mich', 'welche merkur transite habe ich jetzt'],
      es: ['que pasa mentalmente para mi ahora', 'cuales son mis transitos de mercurio ahora']
    }
  }),
  buildCommonRoute({
    id: 'current_emotional_transits',
    intentSample: 'my emotional transits now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_theme', 'timing_window'],
    tags: ['current', 'emotions', 'transit', 'planet:moon'],
    localized: {
      en: ['what is happening emotionally for me right now', 'what are my emotional transits now'],
      fr: ['que se passe emotionnellement pour moi en ce moment', 'quels sont mes transits emotionnels actuels'],
      de: ['was passiert emotional gerade fur mich', 'welche emotionalen transite habe ich jetzt'],
      es: ['que pasa emocionalmente para mi ahora', 'cuales son mis transitos emocionales ahora']
    }
  }),
  buildCommonRoute({
    id: 'pressure_window_now',
    intentSample: 'my pressure window now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['timing_window', 'transit_theme'],
    tags: ['current', 'pressure', 'timing'],
    localized: {
      en: ['where is the pressure for me right now', 'what is my current pressure window'],
      fr: ['ou est la pression pour moi en ce moment', 'quelle est ma fenetre de pression actuelle'],
      de: ['wo liegt der druck fur mich gerade', 'was ist mein aktuelles druckfenster'],
      es: ['donde esta la presion para mi ahora', 'cual es mi ventana de presion actual']
    }
  }),
  buildCommonRoute({
    id: 'timing_window_month',
    intentSample: 'important timing this month',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['timing_window'],
    tags: ['current', 'month', 'timing'],
    localized: {
      en: ['what are the most important dates for me this month', 'what is the main timing window this month'],
      fr: ['quelles sont les dates les plus importantes pour moi ce mois ci', 'quelle est la fenetre temporelle principale de ce mois'],
      de: ['welche daten sind fur mich diesen monat am wichtigsten', 'was ist das wichtigste zeitfenster diesen monat'],
      es: ['cuales son las fechas mas importantes para mi este mes', 'cual es la ventana temporal principal de este mes']
    }
  }),
  buildCommonRoute({
    id: 'current_saturn_transits',
    intentSample: 'saturn transits now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_event', 'transit_theme'],
    tags: ['current', 'planet:saturn', 'transit'],
    localized: {
      en: ['what is saturn doing to me right now', 'tell me about my saturn transits'],
      fr: ['que fait saturne pour moi en ce moment', 'parle moi de mes transits de saturne'],
      de: ['was macht saturn gerade mit mir', 'erzahl mir von meinen saturntransiten'],
      es: ['que esta haciendo saturno conmigo ahora', 'hablame de mis transitos de saturno']
    }
  }),
  buildCommonRoute({
    id: 'current_chiron_transits',
    intentSample: 'chiron transits now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_event', 'transit_theme'],
    tags: ['current', 'planet:chiron', 'transit'],
    localized: {
      en: ['what is chiron activating for me now', 'tell me about my chiron transits'],
      fr: ['que chiron active t il pour moi en ce moment', 'parle moi de mes transits de chiron'],
      de: ['was aktiviert chiron gerade fur mich', 'erzahl mir von meinen chirontransiten'],
      es: ['que esta activando quiron para mi ahora', 'hablame de mis transitos de quiron']
    }
  }),
  buildCommonRoute({
    id: 'natal_overview',
    intentSample: 'my natal chart overview',
    routeKind: 'astrology_natal',
    answerStyle: 'natal_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'life_path', 'chart_pattern'],
    tags: ['natal', 'overview'],
    localized: {
      en: ['tell me about my natal chart and its specificities', 'what are the main themes of my chart'],
      fr: ['parle moi de mon theme natal et ses specificites', 'quelles sont les grandes lignes de mon theme'],
      de: ['erzahl mir von meinem geburtshoroskop und seinen besonderheiten', 'was sind die hauptthemen meines horoskops'],
      es: ['hablame de mi carta natal y sus particularidades', 'cuales son los temas principales de mi carta']
    }
  }),
  buildCommonRoute({
    id: 'relationship_patterns',
    intentSample: 'my relationship patterns',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'identity', 'emotions'],
    tags: ['relationship', 'love', 'patterns', 'house:7'],
    localized: {
      en: ['what are my relationship patterns', 'how am i in relationships'],
      fr: ['quels sont mes schemas amoureux', 'mes patterns relationnels'],
      de: ['was sind meine beziehungsmuster', 'wie bin ich in beziehungen'],
      es: ['cuales son mis patrones de relacion', 'como soy en relaciones']
    }
  }),
  buildCommonRoute({
    id: 'career_signature',
    intentSample: 'my career signature',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'identity', 'chart_pattern'],
    tags: ['career', 'angle:mc', 'house:10'],
    localized: {
      en: ['what is my career signature', 'tell me about my work path'],
      fr: ['quelle est ma signature de carriere', 'parle moi de ma voie professionnelle'],
      de: ['was ist meine berufliche signatur', 'erzahl mir von meinem berufsweg'],
      es: ['cual es mi firma de carrera', 'hablame de mi camino profesional']
    }
  }),
  buildCommonRoute({
    id: 'money_pattern',
    intentSample: 'my money pattern',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['growth', 'life_path', 'identity'],
    tags: ['money', 'resources', 'house:2', 'house:8'],
    localized: {
      en: ['what is my money pattern', 'tell me about money in my chart'],
      fr: ['quel est mon schema financier', 'parle moi de largent dans mon theme'],
      de: ['was ist mein geldmuster', 'erzahl mir von geld in meinem horoskop'],
      es: ['cual es mi patron de dinero', 'hablame del dinero en mi carta']
    }
  }),
  buildCommonRoute({
    id: 'spiritual_path',
    intentSample: 'my spiritual path',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'transformation', 'identity'],
    tags: ['spiritual', 'life_path', 'house:12'],
    localized: {
      en: ['what is my spiritual path', 'tell me about my spiritual evolution'],
      fr: ['quel est mon chemin spirituel', 'parle moi de mon evolution spirituelle'],
      de: ['was ist mein spiritueller weg', 'erzahl mir von meiner spirituellen entwicklung'],
      es: ['cual es mi camino espiritual', 'hablame de mi evolucion espiritual']
    }
  }),
  buildCommonRoute({
    id: 'shadow_pattern',
    intentSample: 'my shadow patterns',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['transformation', 'emotions', 'identity'],
    tags: ['shadow', 'challenge', 'house:8', 'house:12'],
    localized: {
      en: ['what are my shadow patterns', 'tell me about my hidden patterns'],
      fr: ['quels sont mes schemas dombre', 'parle moi de mes mecanismes caches'],
      de: ['was sind meine schattenmuster', 'erzahl mir von meinen verborgenen mustern'],
      es: ['cuales son mis patrones de sombra', 'hablame de mis patrones ocultos']
    }
  }),
  buildCommonRoute({
    id: 'rare_signatures',
    intentSample: 'my rare signatures',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['chart_pattern', 'identity', 'life_path'],
    tags: ['rare', 'signature', 'chart_pattern'],
    localized: {
      en: ['tell me about my rare signatures', 'what are the rare signatures in my chart'],
      fr: ['parle moi de mes signatures rares', 'quelles sont les signatures rares de mon theme'],
      de: ['erzahl mir von meinen seltenen signaturen', 'welche seltenen signaturen hat mein horoskop'],
      es: ['hablame de mis firmas raras', 'cuales son las firmas raras de mi carta']
    }
  }),
  buildCommonRoute({
    id: 'interceptions_meaning',
    intentSample: 'what do interceptions mean in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['chart_pattern', 'identity'],
    tags: ['interceptions', 'chart_pattern'],
    localized: {
      en: ['what do interceptions mean in my chart', 'how do my interceptions affect me'],
      fr: ['que signifient les interceptions dans mon theme', 'comment mes interceptions maffectent elles'],
      de: ['was bedeuten interceptionen in meinem horoskop', 'wie beeinflussen mich meine interceptionen'],
      es: ['que significan las intercepciones en mi carta', 'como me afectan mis intercepciones']
    }
  }),
  buildCommonRoute({
    id: 'stellium_meaning',
    intentSample: 'meaning of my stellium',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['chart_pattern', 'identity', 'life_path'],
    tags: ['stellium', 'chart_pattern'],
    localized: {
      en: ['what does my stellium mean', 'tell me about the stellium in my chart'],
      fr: ['que signifie mon stellium', 'parle moi du stellium dans mon theme'],
      de: ['was bedeutet mein stellium', 'erzahl mir vom stellium in meinem horoskop'],
      es: ['que significa mi stellium', 'hablame del stellium en mi carta']
    }
  }),
  buildCommonRoute({
    id: 'dominant_element',
    intentSample: 'my dominant element',
    routeKind: 'astrology_natal',
    answerStyle: 'natal_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'chart_pattern'],
    tags: ['element', 'identity'],
    localized: {
      en: ['what is my dominant element', 'which element dominates my chart'],
      fr: ['quel est mon element dominant', 'quel element domine mon theme'],
      de: ['was ist mein dominantes element', 'welches element dominiert mein horoskop'],
      es: ['cual es mi elemento dominante', 'que elemento domina mi carta']
    }
  }),
  buildCommonRoute({
    id: 'dominant_modality',
    intentSample: 'my dominant modality',
    routeKind: 'astrology_natal',
    answerStyle: 'natal_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'chart_pattern'],
    tags: ['modality', 'identity'],
    localized: {
      en: ['what is my dominant modality', 'is my chart more cardinal fixed or mutable'],
      fr: ['quelle est ma modalite dominante', 'mon theme est il plus cardinal fixe ou mutable'],
      de: ['was ist meine dominante modalitat', 'ist mein horoskop eher kardinal fix oder veranderlich'],
      es: ['cual es mi modalidad dominante', 'mi carta es mas cardinal fija o mutable']
    }
  }),
  buildCommonRoute({
    id: 'life_purpose_nodes',
    intentSample: 'north node life purpose',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'transformation'],
    tags: ['life_path', 'node', 'north_node'],
    localized: {
      en: ['what do the nodes say about my life purpose', 'what is my north node path'],
      fr: ['que disent les noeuds sur ma mission de vie', 'quel est mon chemin de noeud nord'],
      de: ['was sagen die knoten uber meinen lebensweg', 'was ist mein nordknoten weg'],
      es: ['que dicen los nodos sobre mi proposito de vida', 'cual es mi camino de nodo norte']
    }
  }),
  buildCommonRoute({
    id: 'wound_chiron',
    intentSample: 'my chiron wound',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['transformation', 'emotions', 'life_path'],
    tags: ['planet:chiron', 'wound', 'healing'],
    localized: {
      en: ['what is my chiron wound', 'how does chiron shape me'],
      fr: ['quelle est ma blessure chiron', 'comment chiron me faconne t il'],
      de: ['was ist meine chiron wunde', 'wie pragt mich chiron'],
      es: ['cual es mi herida de quiron', 'como me moldea quiron']
    }
  }),
  buildCommonRoute({
    id: 'venus_love',
    intentSample: 'venus love in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'identity'],
    tags: ['planet:venus', 'love', 'relationship'],
    localized: {
      en: ['what does venus say about love for me', 'tell me about my venus in love'],
      fr: ['que dit venus sur ma vie amoureuse', 'parle moi de ma venus en amour'],
      de: ['was sagt venus uber meine liebe aus', 'erzahl mir von meiner venus in der liebe'],
      es: ['que dice venus sobre mi vida amorosa', 'hablame de mi venus en el amor']
    }
  }),
  buildCommonRoute({
    id: 'mars_desire',
    intentSample: 'mars desire in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'relationships'],
    tags: ['planet:mars', 'desire', 'drive'],
    localized: {
      en: ['what does mars say about my desire nature', 'tell me about mars in my chart'],
      fr: ['que dit mars sur mon desir', 'parle moi de mars dans mon theme'],
      de: ['was sagt mars uber mein begehren', 'erzahl mir von mars in meinem horoskop'],
      es: ['que dice marte sobre mi deseo', 'hablame de marte en mi carta']
    }
  }),
  buildCommonRoute({
    id: 'mercury_mind',
    intentSample: 'mercury and my mind',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['mind', 'identity'],
    tags: ['planet:mercury', 'mind'],
    localized: {
      en: ['what does mercury say about my mind', 'how do i think according to mercury'],
      fr: ['que dit mercure sur mon mental', 'comment je pense selon mercure'],
      de: ['was sagt merkur uber meinen geist', 'wie denke ich laut merkur'],
      es: ['que dice mercurio sobre mi mente', 'como pienso segun mercurio']
    }
  }),
  buildCommonRoute({
    id: 'moon_emotions',
    intentSample: 'moon and my emotions',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['emotions', 'identity'],
    tags: ['planet:moon', 'emotions'],
    localized: {
      en: ['what does the moon say about my emotions', 'tell me about my moon emotionally'],
      fr: ['que dit la lune sur mes emotions', 'parle moi de ma lune sur le plan emotionnel'],
      de: ['was sagt der mond uber meine emotionen', 'erzahl mir emotional von meinem mond'],
      es: ['que dice la luna sobre mis emociones', 'hablame de mi luna emocionalmente']
    }
  }),
  buildCommonRoute({
    id: 'saturn_lesson',
    intentSample: 'saturn lessons in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'identity', 'transformation'],
    tags: ['planet:saturn', 'lesson', 'growth'],
    localized: {
      en: ['what are saturns lessons in my chart', 'tell me about saturn in my chart'],
      fr: ['quelles sont les lecons de saturne dans mon theme', 'parle moi de saturne dans mon theme'],
      de: ['was sind saturns lektionen in meinem horoskop', 'erzahl mir von saturn in meinem horoskop'],
      es: ['cuales son las lecciones de saturno en mi carta', 'hablame de saturno en mi carta']
    }
  }),
  buildCommonRoute({
    id: 'jupiter_growth',
    intentSample: 'jupiter growth in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['growth', 'life_path'],
    tags: ['planet:jupiter', 'growth'],
    localized: {
      en: ['where does jupiter bring growth for me', 'tell me about jupiter in my chart'],
      fr: ['ou jupiter apporte t il de la croissance pour moi', 'parle moi de jupiter dans mon theme'],
      de: ['wo bringt jupiter mir wachstum', 'erzahl mir von jupiter in meinem horoskop'],
      es: ['donde trae crecimiento jupiter para mi', 'hablame de jupiter en mi carta']
    }
  }),
  buildCommonRoute({
    id: 'pluto_transformation',
    intentSample: 'pluto transformation in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['transformation', 'identity'],
    tags: ['planet:pluto', 'transformation'],
    localized: {
      en: ['how does pluto transform me', 'tell me about pluto in my chart'],
      fr: ['comment pluton me transforme t il', 'parle moi de pluton dans mon theme'],
      de: ['wie verwandelt mich pluto', 'erzahl mir von pluto in meinem horoskop'],
      es: ['como me transforma pluton', 'hablame de pluton en mi carta']
    }
  }),
  buildCommonRoute({
    id: 'strongest_aspect',
    intentSample: 'my strongest aspect',
    routeKind: 'astrology_natal',
    answerStyle: 'aspect_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'chart_pattern'],
    tags: ['aspect', 'strongest'],
    localized: {
      en: ['what is my strongest aspect', 'tell me my most important aspect'],
      fr: ['quel est mon aspect le plus fort', 'quel est mon aspect le plus important'],
      de: ['was ist mein starkster aspekt', 'welcher aspekt ist fur mich am wichtigsten'],
      es: ['cual es mi aspecto mas fuerte', 'cual es mi aspecto mas importante']
    }
  }),
  buildCommonRoute({
    id: 'tenth_house_career',
    intentSample: '10th house career meaning',
    routeKind: 'astrology_natal',
    answerStyle: 'house_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'identity'],
    tags: ['house:10', 'career'],
    localized: {
      en: ['what does my 10th house say about career', 'tell me about my 10th house and career'],
      fr: ['que dit ma maison 10 sur ma carriere', 'parle moi de ma maison 10 et de la carriere'],
      de: ['was sagt mein zehntes haus uber meine karriere', 'erzahl mir von haus 10 und beruf'],
      es: ['que dice mi casa 10 sobre la carrera', 'hablame de mi casa 10 y la carrera']
    }
  }),
  buildCommonRoute({
    id: 'seventh_house_relationship',
    intentSample: '7th house relationships',
    routeKind: 'astrology_natal',
    answerStyle: 'house_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'identity'],
    tags: ['house:7', 'relationship'],
    localized: {
      en: ['what does my 7th house say about relationships', 'tell me about my 7th house in love'],
      fr: ['que dit ma maison 7 sur les relations', 'parle moi de ma maison 7 en amour'],
      de: ['was sagt mein siebtes haus uber beziehungen', 'erzahl mir von haus 7 in der liebe'],
      es: ['que dice mi casa 7 sobre las relaciones', 'hablame de mi casa 7 en el amor']
    }
  }),
  buildCommonRoute({
    id: 'twelfth_house_inner_life',
    intentSample: '12th house inner life',
    routeKind: 'astrology_natal',
    answerStyle: 'house_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['emotions', 'transformation', 'identity'],
    tags: ['house:12', 'inner_life', 'spiritual'],
    localized: {
      en: ['what does my 12th house mean', 'tell me about my 12th house and inner life'],
      fr: ['que signifie ma maison 12', 'parle moi de ma maison 12 et de ma vie interieure'],
      de: ['was bedeutet mein zwolftes haus', 'erzahl mir von haus 12 und meinem innenleben'],
      es: ['que significa mi casa 12', 'hablame de mi casa 12 y mi vida interior']
    }
  }),
  buildCommonRoute({
    id: 'rising_sign',
    intentSample: 'my rising sign',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity'],
    tags: ['angle:asc', 'rising'],
    localized: {
      en: ['what is my rising sign', 'tell me my ascendant'],
      fr: ['quel est mon ascendant', 'dis moi mon signe ascendant'],
      de: ['was ist mein aszendent', 'sag mir mein aszendentenzeichen'],
      es: ['cual es mi ascendente', 'dime mi signo ascendente']
    }
  }),
  buildCommonRoute({
    id: 'midheaven_calling',
    intentSample: 'my midheaven calling',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'identity'],
    tags: ['angle:mc', 'career'],
    localized: {
      en: ['what does my midheaven say about my calling', 'tell me about my midheaven'],
      fr: ['que dit mon milieu du ciel sur ma vocation', 'parle moi de mon milieu du ciel'],
      de: ['was sagt mein medium coeli uber meine berufung', 'erzahl mir von meinem medium coeli'],
      es: ['que dice mi medio cielo sobre mi vocacion', 'hablame de mi medio cielo']
    }
  }),
  buildCommonRoute({
    id: 'special_structures',
    intentSample: 'special structures in my chart',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['chart_pattern', 'identity', 'life_path'],
    tags: ['chart_pattern', 'signature', 'rare', 'stellium', 'interceptions'],
    localized: {
      en: ['what special structures are in my chart', 'what unusual patterns are in my chart'],
      fr: ['quelles structures speciales sont dans mon theme', 'quels motifs astrologiques particuliers ai je'],
      de: ['welche besonderen strukturen gibt es in meinem horoskop', 'welche ungewohnlichen muster habe ich im horoskop'],
      es: ['que estructuras especiales hay en mi carta', 'que patrones astrologicos inusuales tengo']
    }
  }),
  buildCommonRoute({
    id: 'chart_ruler_meaning',
    intentSample: 'what does my chart ruler say about me',
    routeKind: 'astrology_natal',
    answerStyle: 'planet_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'life_path'],
    tags: ['ruler', 'chart_ruler', 'angle:asc'],
    localized: {
      en: ['what does my chart ruler say about me', 'tell me about my chart ruler'],
      fr: ['que dit mon maitre dascendant sur moi', 'parle moi de mon maitre de theme'],
      de: ['was sagt mein horoskopherrscher uber mich', 'erzahl mir von meinem chart ruler'],
      es: ['que dice mi regente de carta sobre mi', 'hablame de mi regente de carta']
    }
  }),
  buildCommonRoute({
    id: 'seventh_ruler_meaning',
    intentSample: 'what does my 7th house ruler say about relationships',
    routeKind: 'astrology_natal',
    answerStyle: 'house_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'identity'],
    tags: ['ruler', 'house:7', 'relationship'],
    localized: {
      en: ['what does my 7th house ruler say about relationships', 'what does the ruler of my 7th house say about love'],
      fr: ['que dit le maitre de ma maison 7 sur les relations', 'que dit le maitre de ma maison 7 sur lamour'],
      de: ['was sagt der herrscher meines siebten hauses uber beziehungen', 'was sagt der herrscher von haus 7 uber liebe'],
      es: ['que dice el regente de mi casa 7 sobre las relaciones', 'que dice el regente de mi casa 7 sobre el amor']
    }
  }),
  buildCommonRoute({
    id: 'tenth_ruler_meaning',
    intentSample: 'what does my 10th house ruler say about career',
    routeKind: 'astrology_natal',
    answerStyle: 'house_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['life_path', 'identity'],
    tags: ['ruler', 'house:10', 'career'],
    localized: {
      en: ['what does my 10th house ruler say about career', 'what does the ruler of my 10th house say about vocation'],
      fr: ['que dit le maitre de ma maison 10 sur ma carriere', 'que dit le maitre de ma maison 10 sur ma vocation'],
      de: ['was sagt der herrscher meines zehnten hauses uber meine karriere', 'was sagt der herrscher von haus 10 uber meine berufung'],
      es: ['que dice el regente de mi casa 10 sobre mi carrera', 'que dice el regente de mi casa 10 sobre mi vocacion']
    }
  }),
  buildCommonRoute({
    id: 'twelfth_ruler_meaning',
    intentSample: 'what does my 12th house ruler say about my inner life',
    routeKind: 'astrology_natal',
    answerStyle: 'house_focus',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['transformation', 'emotions', 'identity'],
    tags: ['ruler', 'house:12', 'spiritual'],
    localized: {
      en: ['what does my 12th house ruler say about me', 'what does the ruler of my 12th house reveal'],
      fr: ['que dit le maitre de ma maison 12 sur moi', 'que revele le maitre de ma maison 12'],
      de: ['was sagt der herrscher meines zwolften hauses uber mich', 'was zeigt der herrscher von haus 12'],
      es: ['que dice el regente de mi casa 12 sobre mi', 'que revela el regente de mi casa 12']
    }
  }),
  buildCommonRoute({
    id: 'astro_weather_today',
    intentSample: 'astro weather today',
    routeKind: 'astrology_transits',
    answerStyle: 'current_sky',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_theme', 'timing_window'],
    tags: ['astro_weather', 'current', 'today', 'sky'],
    localized: {
      en: ['what is the astro weather today', 'tell me the astrological weather today'],
      fr: ['quelle est la meteo astro du jour', 'quelle est la meteo astrologique aujourdhui'],
      de: ['wie ist das astrologische wetter heute', 'was ist das astro wetter heute'],
      es: ['cual es el clima astrologico de hoy', 'como esta el tiempo astrologico hoy']
    }
  }),
  buildCommonRoute({
    id: 'current_stellium',
    intentSample: 'what is the current stellium doing',
    routeKind: 'astrology_transits',
    answerStyle: 'current_sky',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_event', 'transit_theme'],
    tags: ['current', 'stellium', 'sky'],
    localized: {
      en: ['what is the current stellium doing', 'tell me about the stellium in the sky right now'],
      fr: ['que fait le stellium actuel', 'parle moi du stellium actuel dans le ciel'],
      de: ['was macht das aktuelle stellium', 'erzahl mir vom stellium am himmel gerade'],
      es: ['que esta haciendo el stellium actual', 'hablame del stellium actual en el cielo']
    }
  }),
  buildCommonRoute({
    id: 'dominant_transit_now',
    intentSample: 'what is my dominant transit now',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['transit_event', 'timing_window'],
    tags: ['current', 'dominant', 'transit'],
    localized: {
      en: ['what is my dominant transit right now', 'what is the main transit affecting me now'],
      fr: ['quel est mon transit dominant du moment', 'quel est le transit principal qui maffecte maintenant'],
      de: ['was ist mein dominanter transit gerade', 'welcher transit beeinflusst mich jetzt am meisten'],
      es: ['cual es mi transito dominante ahora', 'cual es el transito principal que me afecta ahora']
    }
  }),
  buildCommonRoute({
    id: 'love_timing_month',
    intentSample: 'best love timing this month',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['timing_window', 'transit_theme'],
    tags: ['love', 'relationship', 'timing', 'month'],
    localized: {
      en: ['when is the best love timing for me this month', 'what is the best relationship timing this month'],
      fr: ['quel est le meilleur timing amoureux pour moi ce mois ci', 'quel est le meilleur timing relationnel ce mois ci'],
      de: ['wann ist das beste liebes timing fur mich diesen monat', 'was ist das beste beziehungs timing diesen monat'],
      es: ['cual es el mejor momento amoroso para mi este mes', 'cual es el mejor timing de relacion este mes']
    }
  }),
  buildCommonRoute({
    id: 'career_timing_month',
    intentSample: 'best career timing this month',
    routeKind: 'astrology_transits',
    answerStyle: 'personal_transits',
    sourceKinds: [factIndex.MONTHLY_TRANSIT_SOURCE_KIND],
    categories: ['timing_window', 'transit_theme'],
    tags: ['career', 'timing', 'month', 'angle:mc'],
    localized: {
      en: ['when is the best career timing for me this month', 'what is the best professional timing this month'],
      fr: ['quel est le meilleur timing professionnel pour moi ce mois ci', 'quel est le meilleur timing de carriere ce mois ci'],
      de: ['wann ist das beste karriere timing fur mich diesen monat', 'was ist das beste berufliche timing diesen monat'],
      es: ['cual es el mejor momento profesional para mi este mes', 'cual es el mejor timing de carrera este mes']
    }
  }),
  buildCommonRoute({
    id: 'money_relationship',
    intentSample: 'my relationship with money',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['growth', 'identity', 'life_path'],
    tags: ['money', 'resources', 'relationship', 'house:2', 'house:8'],
    localized: {
      en: ['what is my relationship with money', 'how do i relate to money astrologically'],
      fr: ['quelle est ma relation a largent', 'comment je vis largent astrologiquement'],
      de: ['wie ist meine beziehung zu geld', 'wie verhalte ich mich astrologisch zu geld'],
      es: ['cual es mi relacion con el dinero', 'como me relaciono con el dinero astrologicamente']
    }
  }),
  buildCommonRoute({
    id: 'relationship_relationship',
    intentSample: 'my relationship with relationships',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'identity', 'emotions'],
    tags: ['relationship', 'patterns', 'house:7'],
    localized: {
      en: ['what is my relationship with relationships', 'how do i relate to relationship itself'],
      fr: ['quelle est ma relation aux relations', 'comment je vis la relation elle meme'],
      de: ['wie ist meine beziehung zu beziehungen', 'wie stehe ich zur partnerschaft selbst'],
      es: ['cual es mi relacion con las relaciones', 'como me relaciono con la relacion en si']
    }
  }),
  buildCommonRoute({
    id: 'attachment_style',
    intentSample: 'my attachment style astrologically',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'emotions'],
    tags: ['attachment', 'relationship', 'planet:moon', 'planet:venus'],
    localized: {
      en: ['what is my attachment style astrologically', 'how do i attach in love'],
      fr: ['quel est mon style dattachement astrologiquement', 'comment je mattache en amour'],
      de: ['was ist mein bindungsstil astrologisch', 'wie binde ich mich in der liebe'],
      es: ['cual es mi estilo de apego astrologicamente', 'como me apego en el amor']
    }
  }),
  buildCommonRoute({
    id: 'family_pattern',
    intentSample: 'my family pattern in the chart',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['emotions', 'identity', 'life_path'],
    tags: ['family', 'home', 'house:4', 'ic'],
    localized: {
      en: ['what is my family pattern in the chart', 'tell me about my family imprint'],
      fr: ['quel est mon schema familial dans le theme', 'parle moi de mon empreinte familiale'],
      de: ['was ist mein familienmuster im horoskop', 'erzahl mir von meiner familienpragung'],
      es: ['cual es mi patron familiar en la carta', 'hablame de mi huella familiar']
    }
  }),
  buildCommonRoute({
    id: 'hidden_strength',
    intentSample: 'my hidden strengths',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['identity', 'growth', 'transformation'],
    tags: ['hidden', 'strength', 'house:12', 'house:8'],
    localized: {
      en: ['what are my hidden strengths', 'tell me about my hidden gifts'],
      fr: ['quelles sont mes forces cachees', 'parle moi de mes dons caches'],
      de: ['was sind meine verborgenen starken', 'erzahl mir von meinen verborgenen gaben'],
      es: ['cuales son mis fortalezas ocultas', 'hablame de mis dones ocultos']
    }
  }),
  buildCommonRoute({
    id: 'soulmate_pattern',
    intentSample: 'my soulmate pattern',
    routeKind: 'astrology_natal',
    answerStyle: 'life_area_theme',
    sourceKinds: [factIndex.NATAL_SOURCE_KIND],
    categories: ['relationships', 'life_path'],
    tags: ['relationship', 'love', 'soulmate', 'house:7'],
    localized: {
      en: ['what is my soulmate pattern', 'what kind of soulmate energy do i attract'],
      fr: ['quel est mon schema ame soeur', 'quel type denergie ame soeur jattire'],
      de: ['was ist mein seelenpartner muster', 'welche seelenpartner energie ziehe ich an'],
      es: ['cual es mi patron de alma gemela', 'que tipo de energia de alma gemela atraigo']
    }
  })
];

function normalizeQuestion(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TYPO_REPLACEMENTS.get(token) || token)
    .map((token) => SYNONYM_REPLACEMENTS.get(token) || token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeQuestion(text)
    .split(' ')
    .filter(Boolean);
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');

  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, (_, rowIndex) => [rowIndex]);
  for (let columnIndex = 0; columnIndex <= b.length; columnIndex += 1) {
    matrix[0][columnIndex] = columnIndex;
  }

  for (let rowIndex = 1; rowIndex <= a.length; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= b.length; columnIndex += 1) {
      const cost = a[rowIndex - 1] === b[columnIndex - 1] ? 0 : 1;
      matrix[rowIndex][columnIndex] = Math.min(
        matrix[rowIndex - 1][columnIndex] + 1,
        matrix[rowIndex][columnIndex - 1] + 1,
        matrix[rowIndex - 1][columnIndex - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function phraseSimilarity(left, right) {
  const a = normalizeQuestion(left);
  const b = normalizeQuestion(right);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return 0.96;
  }

  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - (distance / Math.max(a.length, b.length, 1)));
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

function matchCommonQuestionRoute(text) {
  const normalizedQuestion = normalizeQuestion(text);
  const questionTokens = tokenize(text);

  if (!normalizedQuestion || questionTokens.length === 0) {
    return null;
  }

  const bestMatch = COMMON_QUESTION_ROUTES
    .map((route) => ({
      ...route,
      normalizedQuestion,
      score: buildRouteScore(route, normalizedQuestion, questionTokens)
    }))
    .sort((left, right) => right.score - left.score)[0];

  if (!bestMatch || bestMatch.score < 0.74) {
    return null;
  }

  return bestMatch;
}

module.exports = {
  COMMON_QUESTION_ROUTES,
  matchCommonQuestionRoute,
  normalizeQuestion
};
