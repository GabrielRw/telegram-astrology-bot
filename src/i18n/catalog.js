const SELF_LANGUAGE_NAMES = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español'
};

const BASE_FIRST_QUESTIONS = {
  en: [
    'What does my birth chart say about my personality?',
    'What are my Sun, Moon, and Rising signs, and what do they mean?',
    'Who am I most compatible with in love?',
    'What does my chart say about my career path?',
    'What is my biggest hidden strength according to astrology?',
    'What karmic lessons am I here to learn?',
    'What does my Saturn placement say about my life challenges?',
    'What does my Venus sign reveal about how I love?',
    'What major transits are affecting me right now?',
    'Why has this year felt so difficult for me astrologically?',
    'What does the current moon mean for me personally?',
    'What area of life is about to change for me?',
    'What is my soul purpose based on my North Node?',
    'Which zodiac signs understand me best emotionally?',
    'What patterns in my chart explain my friendships and conflicts?',
    'What does western astrology predict for my next 12 months?',
    'Where should I relocate in the world for my career?',
    'How is the city where I live influencing me?',
    'Show me my natal chart visually.'
  ],
  fr: [
    'Que dit mon thème natal sur ma personnalité ?',
    'Quels sont mes signes Soleil, Lune et Ascendant, et que signifient-ils ?',
    'Avec qui suis-je le plus compatible en amour ?',
    'Que dit mon thème sur ma voie professionnelle ?',
    'Quelle est ma plus grande force cachée selon l’astrologie ?',
    'Quelles leçons karmiques suis-je venu apprendre ?',
    'Que dit ma position de Saturne sur mes défis de vie ?',
    'Que révèle mon signe de Vénus sur ma manière d’aimer ?',
    'Quels transits majeurs m’affectent en ce moment ?',
    'Pourquoi cette année semble-t-elle si difficile astrologiquement ?',
    'Que signifie la lune actuelle pour moi personnellement ?',
    'Quel domaine de ma vie est sur le point de changer ?',
    'Quel est mon but d’âme selon mon Nœud Nord ?',
    'Quels signes du zodiaque me comprennent le mieux émotionnellement ?',
    'Quels schémas de mon thème expliquent mes amitiés et mes conflits ?',
    'Que prédit l’astrologie occidentale pour mes 12 prochains mois ?',
    'Où devrais-je m’installer dans le monde pour ma carrière ?',
    'Comment la ville où je vis m’influence-t-elle ?',
    'Montre-moi mon thème natal visuellement.'
  ],
  de: [
    'Was sagt mein Geburtshoroskop über meine Persönlichkeit aus?',
    'Was sind mein Sonnen-, Mond- und Aszendentenzeichen und was bedeuten sie?',
    'Mit wem bin ich in der Liebe am kompatibelsten?',
    'Was sagt mein Horoskop über meinen beruflichen Weg?',
    'Was ist laut Astrologie meine größte verborgene Stärke?',
    'Welche karmischen Lektionen soll ich lernen?',
    'Was sagt meine Saturn-Stellung über meine Lebensherausforderungen aus?',
    'Was verrät mein Venuszeichen darüber, wie ich liebe?',
    'Welche großen Transite beeinflussen mich gerade?',
    'Warum fühlt sich dieses Jahr astrologisch so schwierig an?',
    'Was bedeutet der aktuelle Mond persönlich für mich?',
    'Welcher Lebensbereich wird sich bald verändern?',
    'Was ist meine Seelenaufgabe laut meinem Nordknoten?',
    'Welche Sternzeichen verstehen mich emotional am besten?',
    'Welche Muster in meinem Horoskop erklären meine Freundschaften und Konflikte?',
    'Was sagt die westliche Astrologie über meine nächsten 12 Monate?',
    'Wohin sollte ich für meine Karriere auf der Welt umziehen?',
    'Wie beeinflusst mich die Stadt, in der ich lebe?',
    'Zeig mir mein Geburtshoroskop visuell.'
  ],
  es: [
    '¿Qué dice mi carta natal sobre mi personalidad?',
    '¿Cuáles son mis signos de Sol, Luna y Ascendente, y qué significan?',
    '¿Con quién soy más compatible en el amor?',
    '¿Qué dice mi carta sobre mi camino profesional?',
    '¿Cuál es mi mayor fortaleza oculta según la astrología?',
    '¿Qué lecciones kármicas vine a aprender?',
    '¿Qué dice mi posición de Saturno sobre mis desafíos de vida?',
    '¿Qué revela mi signo de Venus sobre cómo amo?',
    '¿Qué tránsitos importantes me están afectando ahora mismo?',
    '¿Por qué este año se ha sentido tan difícil astrológicamente?',
    '¿Qué significa la luna actual para mí personalmente?',
    '¿Qué área de mi vida está a punto de cambiar?',
    '¿Cuál es mi propósito del alma según mi Nodo Norte?',
    '¿Qué signos del zodiaco me entienden mejor emocionalmente?',
    '¿Qué patrones de mi carta explican mis amistades y conflictos?',
    '¿Qué predice la astrología occidental para mis próximos 12 meses?',
    '¿Dónde debería reubicarme en el mundo para mi carrera?',
    '¿Cómo me está influyendo la ciudad en la que vivo?',
    'Muéstrame mi carta natal visualmente.'
  ]
};

const CATALOG = {
  en: {
    languageNames: SELF_LANGUAGE_NAMES,
    buttons: {
      yes: 'Yes',
      no: 'No',
      showMoreQuestions: 'Show more questions',
      update: 'Update',
      reset: 'Reset',
      showChart: 'Show chart'
    },
    prompts: {
      onboardingChat: 'I can answer that properly from your chart.\nFirst I need your birth date and birth city.\n\nSend your birth date in YYYY-MM-DD format.',
      onboardingStart: 'I read charts from your birth details so later questions stay personal and precise.\n\nSend your birth date in YYYY-MM-DD format.',
      birthDateAccepted: 'Good. Your birth date anchors the core chart.\nNow send your birth city.\nExample: Paris or New York',
      cityConfirm: 'I found these city matches. Choose the right one.\nReply 1, 2, or 3 if buttons don’t appear.',
      cityAccepted: 'Good. Your birth city locks the location and timezone.\nDo you know your birth time? It helps with Rising sign and house accuracy.',
      birthTimePrompt: 'Send your birth time in 24-hour format.\nExample: 14:30',
      firstReady: 'We are ready now, What do you want to explore first?',
      welcomeBack: 'Welcome back. What do you want to explore today?',
      chooseQuestion: 'Choose a question',
      moreQuestions: 'More questions',
      nextYouCanAsk: 'Next you can ask: {suggestions}.',
      readingChart: 'Reading your chart...',
      stillReading: 'Still reading your chart...',
      chartCaption: 'Your natal chart',
      profileActions: 'Profile actions',
      languagePrompt: 'Choose your language.',
      languageUpdated: 'Language set to {language}.'
    },
    profile: {
      none: 'No birth details are saved yet.\n\nUse /start to set up your chart.',
      title: 'Saved birth details',
      birthDate: 'Birth date: {value}',
      city: 'City: {value}',
      birthTimeSaved: 'Birth time: {value}',
      birthTimeMissing: 'Birth time: not saved',
      language: 'Language: {value}',
      footer: 'Use the buttons below to update, reset, or view your chart.',
      cleared: 'Your saved birth details were cleared. Send /start when you want to set them again.',
      chartUnavailable: 'Your chart image is not available right now.'
    },
    errors: {
      cancelled: 'Cancelled.',
      startAgain: 'Start again with /start.',
      questionExpired: 'Question expired.',
      cityChoicesExpired: 'City choices expired. Start again with /start.',
      cityOptionUnavailable: 'That city option is no longer available.',
      usingCity: 'Using {city}',
      invalidDate: 'Date format should look like 1990-05-15.',
      invalidTime: 'Time format should look like 14:30.',
      cityLookupFailed: 'I could not look up that city right now.',
      chooseCityOption: 'Choose one of the city options above. Reply 1, 2, or 3 if buttons don’t appear.',
      replyYesNo: 'Reply yes or no. Birth time helps with Rising sign and house accuracy.',
      noGroundedAnswer: 'I could not produce a grounded astrology answer.',
      conversationUnavailable: 'Conversational mode is unavailable right now.',
      starsUnavailable: 'Could not fetch the stars right now.',
      genericUnexpected: 'Unexpected error.'
    },
    suggestions: {
      starter: [
        "How are today's transits affecting me?",
        'What area of life is about to change for me?'
      ],
      followUps: {
        relocation: ['another city in France', 'career relocation', 'romantic relocation'],
        rising_sign: ['Moon sign meaning', 'love patterns', 'strongest aspect'],
        planet_placement: ['strongest aspect', 'career themes', 'Rising sign'],
        major_aspects: ['how that aspect plays out in love', 'chart summary', 'Rising sign'],
        house_question: ['another house focus', 'Rising sign', 'career themes'],
        chart_summary: ['love patterns', 'career themes', 'strongest aspect'],
        fallback: ['Rising sign', 'strongest aspect', 'love patterns']
      },
      firstQuestions: BASE_FIRST_QUESTIONS.en
    },
    natal: {
      snapshotTitle: 'Natal Snapshot',
      name: 'Name',
      city: 'City',
      houseSystem: 'House system',
      sun: 'Sun',
      moon: 'Moon',
      rising: 'Rising',
      risingUnavailable: 'Rising: unavailable without birth time',
      mc: 'MC',
      confidence: 'Confidence',
      strongestAspects: 'Strongest natal aspects:'
    }
  },
  fr: {
    languageNames: SELF_LANGUAGE_NAMES,
    buttons: {
      yes: 'Oui',
      no: 'Non',
      showMoreQuestions: 'Voir plus',
      update: 'Modifier',
      reset: 'Réinitialiser',
      showChart: 'Voir le thème'
    },
    prompts: {
      onboardingChat: 'Je peux répondre correctement à partir de votre thème.\nJ’ai d’abord besoin de votre date de naissance et de votre ville de naissance.\n\nEnvoyez votre date de naissance au format AAAA-MM-JJ.',
      onboardingStart: 'Je lis votre thème à partir de vos données de naissance pour que vos prochaines questions restent personnelles et précises.\n\nEnvoyez votre date de naissance au format AAAA-MM-JJ.',
      birthDateAccepted: 'Parfait. Votre date de naissance ancre le thème de base.\nEnvoyez maintenant votre ville de naissance.\nExemple : Paris ou New York',
      cityConfirm: 'J’ai trouvé ces villes possibles. Choisissez la bonne.\nRépondez 1, 2 ou 3 si les boutons n’apparaissent pas.',
      cityAccepted: 'Parfait. Votre ville de naissance fixe le lieu et le fuseau horaire.\nConnaissez-vous votre heure de naissance ? Elle améliore la précision de l’Ascendant et des maisons.',
      birthTimePrompt: 'Envoyez votre heure de naissance au format 24 h.\nExemple : 14:30',
      firstReady: 'Nous sommes prêts maintenant, que voulez-vous explorer en premier ?',
      welcomeBack: 'Bon retour. Que voulez-vous explorer aujourd’hui ?',
      chooseQuestion: 'Choisissez une question',
      moreQuestions: 'Plus de questions',
      nextYouCanAsk: 'Ensuite, vous pouvez demander : {suggestions}.',
      readingChart: 'Je lis votre thème...',
      stillReading: 'Je lis encore votre thème...',
      chartCaption: 'Votre thème natal',
      profileActions: 'Actions du profil',
      languagePrompt: 'Choisissez votre langue.',
      languageUpdated: 'Langue définie sur {language}.'
    },
    profile: {
      none: 'Aucune donnée de naissance n’est enregistrée.\n\nUtilisez /start pour configurer votre thème.',
      title: 'Données de naissance enregistrées',
      birthDate: 'Date de naissance : {value}',
      city: 'Ville : {value}',
      birthTimeSaved: 'Heure de naissance : {value}',
      birthTimeMissing: 'Heure de naissance : non enregistrée',
      language: 'Langue : {value}',
      footer: 'Utilisez les boutons ci-dessous pour modifier, réinitialiser ou voir votre thème.',
      cleared: 'Vos données de naissance ont été effacées. Envoyez /start quand vous voudrez les reconfigurer.',
      chartUnavailable: 'L’image de votre thème n’est pas disponible pour le moment.'
    },
    errors: {
      cancelled: 'Annulé.',
      startAgain: 'Recommencez avec /start.',
      questionExpired: 'Cette question a expiré.',
      cityChoicesExpired: 'Les choix de ville ont expiré. Recommencez avec /start.',
      cityOptionUnavailable: 'Cette option de ville n’est plus disponible.',
      usingCity: 'Ville utilisée : {city}',
      invalidDate: 'Le format de date doit ressembler à 1990-05-15.',
      invalidTime: 'Le format de l’heure doit ressembler à 14:30.',
      cityLookupFailed: 'Je ne peux pas rechercher cette ville pour le moment.',
      chooseCityOption: 'Choisissez l’une des villes ci-dessus. Répondez 1, 2 ou 3 si les boutons n’apparaissent pas.',
      replyYesNo: 'Répondez oui ou non. L’heure de naissance améliore la précision de l’Ascendant et des maisons.',
      noGroundedAnswer: 'Je n’ai pas pu produire une réponse astrologique suffisamment fondée.',
      conversationUnavailable: 'Le mode conversationnel est indisponible pour le moment.',
      starsUnavailable: 'Je ne peux pas interroger les astres pour le moment.',
      genericUnexpected: 'Erreur inattendue.'
    },
    suggestions: {
      starter: [
        'Comment les transits du jour m’affectent-ils ?',
        'Quel domaine de ma vie est sur le point de changer ?'
      ],
      followUps: {
        relocation: ['une autre ville en France', 'une relocalisation carrière', 'une relocalisation amoureuse'],
        rising_sign: ['le sens de ma Lune', 'mes schémas amoureux', 'mon aspect le plus fort'],
        planet_placement: ['mon aspect le plus fort', 'mes thèmes de carrière', 'mon Ascendant'],
        major_aspects: ['cet aspect en amour', 'résume mon thème', 'mon Ascendant'],
        house_question: ['une autre maison', 'mon Ascendant', 'mes thèmes de carrière'],
        chart_summary: ['mes schémas amoureux', 'mes thèmes de carrière', 'mon aspect le plus fort'],
        fallback: ['mon Ascendant', 'mon aspect le plus fort', 'mes schémas amoureux']
      },
      firstQuestions: BASE_FIRST_QUESTIONS.fr
    },
    natal: {
      snapshotTitle: 'Aperçu natal',
      name: 'Nom',
      city: 'Ville',
      houseSystem: 'Système de maisons',
      sun: 'Soleil',
      moon: 'Lune',
      rising: 'Ascendant',
      risingUnavailable: 'Ascendant : indisponible sans heure de naissance',
      mc: 'MC',
      confidence: 'Confiance',
      strongestAspects: 'Aspects natals les plus forts :'
    }
  },
  de: {
    languageNames: SELF_LANGUAGE_NAMES,
    buttons: {
      yes: 'Ja',
      no: 'Nein',
      showMoreQuestions: 'Mehr Fragen',
      update: 'Aktualisieren',
      reset: 'Zurücksetzen',
      showChart: 'Horoskop zeigen'
    },
    prompts: {
      onboardingChat: 'Ich kann das richtig aus deinem Horoskop beantworten.\nDafür brauche ich zuerst dein Geburtsdatum und deinen Geburtsort.\n\nSende dein Geburtsdatum im Format JJJJ-MM-TT.',
      onboardingStart: 'Ich lese dein Horoskop aus deinen Geburtsdaten, damit spätere Fragen persönlich und präzise bleiben.\n\nSende dein Geburtsdatum im Format JJJJ-MM-TT.',
      birthDateAccepted: 'Gut. Dein Geburtsdatum verankert das Grundhoroskop.\nSende jetzt deinen Geburtsort.\nBeispiel: Paris oder New York',
      cityConfirm: 'Ich habe diese möglichen Städte gefunden. Wähle die richtige aus.\nAntworte mit 1, 2 oder 3, falls keine Buttons erscheinen.',
      cityAccepted: 'Gut. Dein Geburtsort legt Ort und Zeitzone fest.\nKennst du deine Geburtszeit? Sie verbessert die Genauigkeit von Aszendent und Häusern.',
      birthTimePrompt: 'Sende deine Geburtszeit im 24-Stunden-Format.\nBeispiel: 14:30',
      firstReady: 'Wir sind jetzt bereit. Was möchtest du zuerst erkunden?',
      welcomeBack: 'Willkommen zurück. Was möchtest du heute erkunden?',
      chooseQuestion: 'Wähle eine Frage',
      moreQuestions: 'Mehr Fragen',
      nextYouCanAsk: 'Als Nächstes kannst du fragen: {suggestions}.',
      readingChart: 'Ich lese dein Horoskop...',
      stillReading: 'Ich lese dein Horoskop noch...',
      chartCaption: 'Dein Geburtshoroskop',
      profileActions: 'Profilaktionen',
      languagePrompt: 'Wähle deine Sprache.',
      languageUpdated: 'Sprache auf {language} gesetzt.'
    },
    profile: {
      none: 'Es sind noch keine Geburtsdaten gespeichert.\n\nNutze /start, um dein Horoskop einzurichten.',
      title: 'Gespeicherte Geburtsdaten',
      birthDate: 'Geburtsdatum: {value}',
      city: 'Stadt: {value}',
      birthTimeSaved: 'Geburtszeit: {value}',
      birthTimeMissing: 'Geburtszeit: nicht gespeichert',
      language: 'Sprache: {value}',
      footer: 'Nutze die Buttons unten, um dein Profil zu aktualisieren, zurückzusetzen oder dein Horoskop zu sehen.',
      cleared: 'Deine gespeicherten Geburtsdaten wurden gelöscht. Sende /start, wenn du sie erneut einrichten möchtest.',
      chartUnavailable: 'Das Bild deines Horoskops ist gerade nicht verfügbar.'
    },
    errors: {
      cancelled: 'Abgebrochen.',
      startAgain: 'Starte erneut mit /start.',
      questionExpired: 'Diese Frage ist abgelaufen.',
      cityChoicesExpired: 'Die Stadtauswahl ist abgelaufen. Starte erneut mit /start.',
      cityOptionUnavailable: 'Diese Stadtoption ist nicht mehr verfügbar.',
      usingCity: 'Verwende {city}',
      invalidDate: 'Das Datumsformat sollte wie 1990-05-15 aussehen.',
      invalidTime: 'Das Zeitformat sollte wie 14:30 aussehen.',
      cityLookupFailed: 'Ich kann diese Stadt gerade nicht nachschlagen.',
      chooseCityOption: 'Wähle eine der Städte oben. Antworte mit 1, 2 oder 3, falls keine Buttons erscheinen.',
      replyYesNo: 'Antworte mit ja oder nein. Die Geburtszeit verbessert die Genauigkeit von Aszendent und Häusern.',
      noGroundedAnswer: 'Ich konnte keine ausreichend fundierte astrologische Antwort erzeugen.',
      conversationUnavailable: 'Der Konversationsmodus ist im Moment nicht verfügbar.',
      starsUnavailable: 'Ich kann die Sterne gerade nicht abrufen.',
      genericUnexpected: 'Unerwarteter Fehler.'
    },
    suggestions: {
      starter: [
        'Wie wirken sich die heutigen Transite auf mich aus?',
        'Welcher Lebensbereich wird sich bald verändern?'
      ],
      followUps: {
        relocation: ['eine andere Stadt in Frankreich', 'beruflicher Umzug', 'romantischer Umzug'],
        rising_sign: ['die Bedeutung meines Mondes', 'Liebesmuster', 'mein stärkster Aspekt'],
        planet_placement: ['mein stärkster Aspekt', 'Berufsthemen', 'mein Aszendent'],
        major_aspects: ['dieser Aspekt in der Liebe', 'mein Horoskop zusammenfassen', 'mein Aszendent'],
        house_question: ['ein anderes Haus', 'mein Aszendent', 'Berufsthemen'],
        chart_summary: ['Liebesmuster', 'Berufsthemen', 'mein stärkster Aspekt'],
        fallback: ['mein Aszendent', 'mein stärkster Aspekt', 'Liebesmuster']
      },
      firstQuestions: BASE_FIRST_QUESTIONS.de
    },
    natal: {
      snapshotTitle: 'Geburtsübersicht',
      name: 'Name',
      city: 'Stadt',
      houseSystem: 'Häusersystem',
      sun: 'Sonne',
      moon: 'Mond',
      rising: 'Aszendent',
      risingUnavailable: 'Aszendent: ohne Geburtszeit nicht verfügbar',
      mc: 'MC',
      confidence: 'Sicherheit',
      strongestAspects: 'Stärkste Geburtsaspekte:'
    }
  },
  es: {
    languageNames: SELF_LANGUAGE_NAMES,
    buttons: {
      yes: 'Sí',
      no: 'No',
      showMoreQuestions: 'Más preguntas',
      update: 'Actualizar',
      reset: 'Restablecer',
      showChart: 'Ver carta'
    },
    prompts: {
      onboardingChat: 'Puedo responder eso correctamente a partir de tu carta.\nPrimero necesito tu fecha de nacimiento y tu ciudad de nacimiento.\n\nEnvía tu fecha de nacimiento en formato AAAA-MM-DD.',
      onboardingStart: 'Leo tu carta a partir de tus datos de nacimiento para que las siguientes preguntas sigan siendo personales y precisas.\n\nEnvía tu fecha de nacimiento en formato AAAA-MM-DD.',
      birthDateAccepted: 'Bien. Tu fecha de nacimiento ancla la carta base.\nAhora envía tu ciudad de nacimiento.\nEjemplo: París o Nueva York',
      cityConfirm: 'Encontré estas posibles ciudades. Elige la correcta.\nResponde 1, 2 o 3 si los botones no aparecen.',
      cityAccepted: 'Bien. Tu ciudad de nacimiento fija el lugar y la zona horaria.\n¿Conoces tu hora de nacimiento? Mejora la precisión del Ascendente y de las casas.',
      birthTimePrompt: 'Envía tu hora de nacimiento en formato de 24 horas.\nEjemplo: 14:30',
      firstReady: 'Ya estamos listos, ¿qué quieres explorar primero?',
      welcomeBack: 'Bienvenido de nuevo. ¿Qué quieres explorar hoy?',
      chooseQuestion: 'Elige una pregunta',
      moreQuestions: 'Más preguntas',
      nextYouCanAsk: 'Después puedes preguntar: {suggestions}.',
      readingChart: 'Estoy leyendo tu carta...',
      stillReading: 'Sigo leyendo tu carta...',
      chartCaption: 'Tu carta natal',
      profileActions: 'Acciones del perfil',
      languagePrompt: 'Elige tu idioma.',
      languageUpdated: 'Idioma configurado en {language}.'
    },
    profile: {
      none: 'Todavía no hay datos de nacimiento guardados.\n\nUsa /start para configurar tu carta.',
      title: 'Datos de nacimiento guardados',
      birthDate: 'Fecha de nacimiento: {value}',
      city: 'Ciudad: {value}',
      birthTimeSaved: 'Hora de nacimiento: {value}',
      birthTimeMissing: 'Hora de nacimiento: no guardada',
      language: 'Idioma: {value}',
      footer: 'Usa los botones de abajo para actualizar, restablecer o ver tu carta.',
      cleared: 'Tus datos de nacimiento guardados se borraron. Envía /start cuando quieras configurarlos otra vez.',
      chartUnavailable: 'La imagen de tu carta no está disponible ahora mismo.'
    },
    errors: {
      cancelled: 'Cancelado.',
      startAgain: 'Empieza de nuevo con /start.',
      questionExpired: 'Esa pregunta ya expiró.',
      cityChoicesExpired: 'Las opciones de ciudad expiraron. Empieza de nuevo con /start.',
      cityOptionUnavailable: 'Esa opción de ciudad ya no está disponible.',
      usingCity: 'Usando {city}',
      invalidDate: 'El formato de fecha debe verse como 1990-05-15.',
      invalidTime: 'El formato de hora debe verse como 14:30.',
      cityLookupFailed: 'No puedo buscar esa ciudad ahora mismo.',
      chooseCityOption: 'Elige una de las ciudades de arriba. Responde 1, 2 o 3 si los botones no aparecen.',
      replyYesNo: 'Responde sí o no. La hora de nacimiento mejora la precisión del Ascendente y de las casas.',
      noGroundedAnswer: 'No pude producir una respuesta astrológica suficientemente fundamentada.',
      conversationUnavailable: 'El modo conversacional no está disponible ahora mismo.',
      starsUnavailable: 'No pude consultar a las estrellas ahora mismo.',
      genericUnexpected: 'Error inesperado.'
    },
    suggestions: {
      starter: [
        '¿Cómo me están afectando los tránsitos de hoy?',
        '¿Qué área de mi vida está a punto de cambiar?'
      ],
      followUps: {
        relocation: ['otra ciudad en Francia', 'reubicación laboral', 'reubicación romántica'],
        rising_sign: ['el significado de mi Luna', 'patrones de amor', 'mi aspecto más fuerte'],
        planet_placement: ['mi aspecto más fuerte', 'temas de carrera', 'mi Ascendente'],
        major_aspects: ['ese aspecto en el amor', 'resume mi carta', 'mi Ascendente'],
        house_question: ['otra casa', 'mi Ascendente', 'temas de carrera'],
        chart_summary: ['patrones de amor', 'temas de carrera', 'mi aspecto más fuerte'],
        fallback: ['mi Ascendente', 'mi aspecto más fuerte', 'patrones de amor']
      },
      firstQuestions: BASE_FIRST_QUESTIONS.es
    },
    natal: {
      snapshotTitle: 'Resumen natal',
      name: 'Nombre',
      city: 'Ciudad',
      houseSystem: 'Sistema de casas',
      sun: 'Sol',
      moon: 'Luna',
      rising: 'Ascendente',
      risingUnavailable: 'Ascendente: no disponible sin hora de nacimiento',
      mc: 'MC',
      confidence: 'Confianza',
      strongestAspects: 'Aspectos natales más fuertes:'
    }
  }
};

module.exports = {
  CATALOG,
  SELF_LANGUAGE_NAMES
};
