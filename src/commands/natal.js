const { Markup } = require('telegraf');
const { getNatal, getNatalChart, searchCity, FreeAstroError } = require('../services/freeastro');
const {
  formatAspectInterpretationMessage,
  formatNatalMessage,
  formatUsage,
  formatUserError,
  getMajorAspectButtonsData,
  getPlanetPlacementButtonsData,
  splitMessage
} = require('../utils/format');

const sessions = new Map();
const aspectCache = new Map();
const planetCache = new Map();

function getSession(chatId) {
  return sessions.get(String(chatId));
}

function setSession(chatId, session) {
  sessions.set(String(chatId), session);
}

function clearSession(chatId) {
  sessions.delete(String(chatId));
}

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

function parseDateInput(input) {
  const value = String(input || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsedDate = new Date(`${value}T00:00:00`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { year, month, day, raw: value };
}

function parseTimeInput(input) {
  const value = String(input || '').trim();

  if (!/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(':').map(Number);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute, raw: value };
}

function createNatalPayload(session, cityMatch) {
  return {
    name: session.name || 'Telegram User',
    year: session.birthDate.year,
    month: session.birthDate.month,
    day: session.birthDate.day,
    time_known: session.timeKnown,
    hour: session.timeKnown ? session.birthTime.hour : undefined,
    minute: session.timeKnown ? session.birthTime.minute : undefined,
    city: cityMatch.name,
    lat: cityMatch.lat,
    lng: cityMatch.lng,
    tz_str: cityMatch.timezone || 'AUTO',
    house_system: 'placidus',
    zodiac_type: 'tropical',
    include_speed: true,
    include_dignity: true,
    include_minor_aspects: true,
    include_stelliums: true,
    include_features: ['chiron', 'lilith', 'true_node'],
    interpretation: {
      enable: true,
      style: 'improved'
    }
  };
}

function createNatalChartPayload(session, cityMatch) {
  return {
    name: session.name || 'Telegram User',
    year: session.birthDate.year,
    month: session.birthDate.month,
    day: session.birthDate.day,
    time_known: session.timeKnown,
    hour: session.timeKnown ? session.birthTime.hour : 12,
    minute: session.timeKnown ? session.birthTime.minute : 0,
    city: cityMatch.name,
    lat: cityMatch.lat,
    lng: cityMatch.lng,
    tz_str: cityMatch.timezone || 'AUTO',
    house_system: 'placidus',
    zodiac_type: 'tropical',
    format: 'png',
    size: 900,
    png_quality_scale: 2,
    theme_type: 'light',
    show_metadata: true,
    display_settings: {
      chiron: true,
      lilith: true,
      mc: session.timeKnown,
      dsc: session.timeKnown,
      ic: session.timeKnown
    },
    chart_config: {
      sign_line_width: 1.6,
      house_line_width: 0.9,
      asc_line_width: 2.4,
      dsc_line_width: 2.4,
      mc_line_width: 2.4,
      ic_line_width: 2.4,
      sign_ring_inner_width: 1.2,
      sign_ring_outer_width: 1.6,
      house_ring_inner_width: 0.8,
      house_ring_outer_width: 0.9,
      sign_tick_width: 0.45,
      aspect_conjunction_width: 2.2,
      aspect_opposition_width: 2.2,
      aspect_trine_width: 1.8,
      aspect_square_width: 2,
      aspect_sextile_width: 1.5,
      aspect_quincunx_width: 1.3
    }
  };
}

module.exports = function registerNatalCommand(bot) {
  bot.command('natal', async (ctx) => {
    setSession(ctx.chat.id, {
      step: 'name'
    });

    await ctx.reply(
      [
        'Natal chart setup',
        '',
        'Reply with your name, or send `skip` to use Telegram User.',
        'You can cancel anytime with /cancel.'
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('cancel', async (ctx) => {
    clearSession(ctx.chat.id);
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
    await ctx.reply('Send your birth time in 24-hour format.\nExample: `14:30`', {
      parse_mode: 'Markdown'
    });
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
    await ctx.reply(
      'Birth time marked unknown. Houses and Rising will be omitted by the API.\nNow send your birth city.',
      { parse_mode: 'Markdown' }
    );
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

      await ctx.reply('Send your birth date in `YYYY-MM-DD` format.\nExample: `1990-05-15`', {
        parse_mode: 'Markdown'
      });
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

      await ctx.reply('Send your birth city.\nExample: `Paris` or `New York`', {
        parse_mode: 'Markdown'
      });
      return;
    }

    if (session.step === 'city') {
      session.city = text;
      const loadingMessage = await ctx.reply('Calculating natal chart...');

      try {
        const cityMatch = await searchCity(session.city);
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

        if (chart.status === 'fulfilled') {
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

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMessage.message_id,
          undefined,
          formatNatalMessage(result.value, `${cityMatch.name}, ${cityMatch.country}`)
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
      return;
    }

    await ctx.reply(
      formatUsage('/natal', '/natal'),
      { parse_mode: 'Markdown' }
    );
  });
};
