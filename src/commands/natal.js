const { Markup } = require('telegraf');
const { answerConversation } = require('../services/conversation');
const { FreeAstroError, getNatal, getNatalChart, searchCities } = require('../services/freeastro');
const { getGeminiErrorMessage } = require('../services/gemini');
const {
  clearSession,
  createNatalChartPayload,
  createNatalPayload,
  getSession,
  parseDateInput,
  parseTimeInput,
  setSession,
  startNatalFlow
} = require('../services/natalFlow');
const {
  consumePendingQuestion,
  setNatalProfile,
  setPendingQuestion,
  setUiCache
} = require('../state/chatState');
const {
  formatAspectInterpretationMessage,
  formatNatalMessage,
  formatUsage,
  formatUserError,
  getMajorAspectButtonsData,
  getPlanetPlacementButtonsData,
  splitConversationReply,
  splitMessage
} = require('../utils/format');

const aspectCache = new Map();
const planetCache = new Map();

function setAspectCache(chatId, aspects) {
  aspectCache.set(String(chatId), aspects);
}

function getAspectCache(chatId) {
  return aspectCache.get(String(chatId)) || [];
}

function setPlanetCache(chatId, planets) {
  planetCache.set(String(chatId), planets);
}

function getPlanetCache(chatId) {
  return planetCache.get(String(chatId)) || [];
}

function getNatalIntroMessage(source = 'command') {
  if (source === 'chat') {
    return [
      'I can answer that, but first I need your natal chart so the reading is grounded.',
      '',
      'Reply with your name, or send `skip` to use Telegram User.',
      'You can cancel anytime with /cancel.'
    ].join('\n');
  }

  return [
    'Natal chart setup',
    '',
    'Reply with your name, or send `skip` to use Telegram User.',
    'You can cancel anytime with /cancel.'
  ].join('\n');
}

function formatCityOption(city) {
  const bits = [city?.name, city?.admin1 || city?.region, city?.country].filter(Boolean);
  return bits.join(', ').slice(0, 60) || 'City option';
}

function buildCityKeyboard(candidates) {
  return Markup.inlineKeyboard(
    candidates.map((city, index) => [Markup.button.callback(formatCityOption(city), `NATAL_CITY_${index}`)])
  );
}

async function promptForName(ctx, source = 'command') {
  await ctx.reply(getNatalIntroMessage(source), { parse_mode: 'Markdown' });
}

async function promptForBirthDate(ctx) {
  await ctx.reply('Send your birth date in `YYYY-MM-DD` format.\nExample: `1990-05-15`', {
    parse_mode: 'Markdown'
  });
}

async function promptForBirthTime(ctx) {
  await ctx.reply('Send your birth time in 24-hour format.\nExample: `14:30`', {
    parse_mode: 'Markdown'
  });
}

async function promptForCity(ctx, timeKnown) {
  const line = timeKnown
    ? 'Send your birth city.'
    : 'Birth time marked unknown. Houses and Rising will be omitted by the API.\nNow send your birth city.';

  await ctx.reply(`${line}\nExample: \`Paris\` or \`New York\``, {
    parse_mode: 'Markdown'
  });
}

async function promptForCityConfirmation(ctx, candidates) {
  await ctx.reply(
    'I found these city matches. Tap the correct one.',
    buildCityKeyboard(candidates)
  );
}

async function finishNatalFlow(ctx, session, cityMatch) {
  const loadingMessage = await ctx.reply('Calculating natal chart...');

  try {
    const natalPayload = createNatalPayload(session, cityMatch);
    const chartPayload = createNatalChartPayload(session, cityMatch);
    const [result, chart] = await Promise.allSettled([
      getNatal(natalPayload),
      getNatalChart(chartPayload)
    ]);

    if (result.status !== 'fulfilled') {
      throw result.reason;
    }

    clearSession(ctx.chat.id);

    const cityLabel = `${cityMatch.name}, ${cityMatch.country}`;
    setNatalProfile(ctx.chat.id, result.value, cityLabel);
    const pendingQuestion = consumePendingQuestion(ctx.chat.id);
    const shouldSendNatalReading = session.source === 'command' && !pendingQuestion;

    if (shouldSendNatalReading && chart.status === 'fulfilled') {
      await ctx.replyWithPhoto(
        {
          source: chart.value.buffer,
          filename: 'natal-chart.png'
        },
        {
          caption: 'Natal chart'
        }
      );
    }

    if (shouldSendNatalReading) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        undefined,
        formatNatalMessage(result.value, cityLabel)
      );

      const planetButtons = getPlanetPlacementButtonsData(result.value);
      setPlanetCache(ctx.chat.id, planetButtons);

      for (const [index, planet] of planetButtons.entries()) {
        await ctx.reply(
          planet.summary,
          Markup.inlineKeyboard([
            [Markup.button.callback('Get interpretation', `NATAL_PLANET_${index}`)]
          ])
        );
      }

      const aspectButtons = getMajorAspectButtonsData(result.value);
      setAspectCache(ctx.chat.id, aspectButtons);
      setUiCache(ctx.chat.id, {
        aspects: aspectButtons,
        planets: planetButtons
      });

      if (aspectButtons.length > 0) {
        for (const [index, aspect] of aspectButtons.entries()) {
          await ctx.reply(
            aspect.summary,
            Markup.inlineKeyboard([
              [Markup.button.callback('Get interpretation', `NATAL_ASPECT_${index}`)]
            ])
          );
        }
      } else {
        await ctx.reply('No major aspects were returned for this natal chart.');
      }
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMessage.message_id,
      undefined,
      'Birth details saved.'
    );

    if (!pendingQuestion) {
      await ctx.reply('Your chart is ready. Ask your question directly.');
      return;
    }

    const thinkingMessage = await ctx.reply('Now I can answer your question from the chart...');

    try {
      const answer = await answerConversation(ctx.chat.id, pendingQuestion);
      const chunks = splitConversationReply(answer.text);

      if (chunks.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          thinkingMessage.message_id,
          undefined,
          'I built the chart, but I could not produce a grounded answer to the original question.'
        );
        return;
      }

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        thinkingMessage.message_id,
        undefined,
        `Your question: ${pendingQuestion}`
      );

      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        thinkingMessage.message_id,
        undefined,
        `I built the chart, but conversational mode is unavailable right now.\n${getGeminiErrorMessage(error)}`
      );
    }
  } catch (error) {
    const message = error instanceof FreeAstroError
      ? formatUserError(error)
      : formatUserError(new Error('Unexpected error.'));

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMessage.message_id,
      undefined,
      message
    );
  }
}

module.exports = function registerNatalCommand(bot) {
  bot.command('natal', async (ctx) => {
    startNatalFlow(ctx.chat.id, 'command');
    await promptForName(ctx, 'command');
  });

  bot.command('cancel', async (ctx) => {
    clearSession(ctx.chat.id);
    setPendingQuestion(ctx.chat.id, null);
    await ctx.reply('Cancelled.');
  });

  bot.action('NATAL_TIME_YES', async (ctx) => {
    const session = getSession(ctx.chat.id);

    if (!session) {
      await ctx.answerCbQuery('Start again with /natal');
      return;
    }

    session.timeKnown = true;
    session.step = 'time';
    setSession(ctx.chat.id, session);

    await ctx.answerCbQuery();
    await promptForBirthTime(ctx);
  });

  bot.action('NATAL_TIME_NO', async (ctx) => {
    const session = getSession(ctx.chat.id);

    if (!session) {
      await ctx.answerCbQuery('Start again with /natal');
      return;
    }

    session.timeKnown = false;
    session.step = 'city';
    setSession(ctx.chat.id, session);

    await ctx.answerCbQuery();
    await promptForCity(ctx, false);
  });

  bot.action(/^NATAL_CITY_(\d+)$/, async (ctx) => {
    const session = getSession(ctx.chat.id);

    if (!session || session.step !== 'city_confirm') {
      await ctx.answerCbQuery('City choices expired. Start again with /natal.');
      return;
    }

    const cityIndex = Number(ctx.match[1]);
    const cityMatch = Array.isArray(session.cityCandidates) ? session.cityCandidates[cityIndex] : null;

    if (!cityMatch) {
      await ctx.answerCbQuery('That city option is no longer available.');
      return;
    }

    await ctx.answerCbQuery(`Using ${formatCityOption(cityMatch)}`);
    await finishNatalFlow(ctx, session, cityMatch);
  });

  bot.action(/^NATAL_ASPECT_(\d+)$/, async (ctx) => {
    const aspectIndex = Number(ctx.match[1]);
    const aspects = getAspectCache(ctx.chat.id);
    const aspect = aspects[aspectIndex];

    if (!aspect) {
      await ctx.answerCbQuery('Aspect details expired. Run /natal again.');
      return;
    }

    await ctx.answerCbQuery();

    const chunks = splitMessage(formatAspectInterpretationMessage(aspect));
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  });

  bot.action(/^NATAL_PLANET_(\d+)$/, async (ctx) => {
    const planetIndex = Number(ctx.match[1]);
    const planets = getPlanetCache(ctx.chat.id);
    const planet = planets[planetIndex];

    if (!planet) {
      await ctx.answerCbQuery('Placement details expired. Run /natal again.');
      return;
    }

    await ctx.answerCbQuery();

    const chunks = splitMessage(formatAspectInterpretationMessage(planet));
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  });

  bot.on('text', async (ctx, next) => {
    const text = String(ctx.message?.text || '').trim();
    const session = getSession(ctx.chat.id);

    if (!session || text.startsWith('/')) {
      return next();
    }

    if (session.step === 'name') {
      session.name = /^skip$/i.test(text) ? 'Telegram User' : text;
      session.step = 'date';
      setSession(ctx.chat.id, session);
      await promptForBirthDate(ctx);
      return;
    }

    if (session.step === 'date') {
      const birthDate = parseDateInput(text);

      if (!birthDate) {
        await ctx.reply('Date format should look like `1990-05-15`.', {
          parse_mode: 'Markdown'
        });
        return;
      }

      session.birthDate = birthDate;
      session.step = 'time_known';
      setSession(ctx.chat.id, session);

      await ctx.reply(
        'Do you know the birth time?',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes', 'NATAL_TIME_YES'),
            Markup.button.callback('No', 'NATAL_TIME_NO')
          ]
        ])
      );
      return;
    }

    if (session.step === 'time') {
      const birthTime = parseTimeInput(text);

      if (!birthTime) {
        await ctx.reply('Time format should look like `14:30`.', {
          parse_mode: 'Markdown'
        });
        return;
      }

      session.birthTime = birthTime;
      session.step = 'city';
      setSession(ctx.chat.id, session);
      await promptForCity(ctx, true);
      return;
    }

    if (session.step === 'city') {
      try {
        const cityCandidates = await searchCities(text, 3);
        session.city = text;
        session.cityCandidates = cityCandidates;
        session.step = 'city_confirm';
        setSession(ctx.chat.id, session);

        await promptForCityConfirmation(ctx, cityCandidates);
      } catch (error) {
        const message = error instanceof FreeAstroError
          ? error.message
          : 'I could not look up that city right now.';
        await ctx.reply(message);
      }
      return;
    }

    if (session.step === 'city_confirm') {
      await ctx.reply('Tap one of the city buttons above so I use the right location.');
      return;
    }

    await ctx.reply(
      formatUsage('/natal', '/natal'),
      { parse_mode: 'Markdown' }
    );
  });
};
