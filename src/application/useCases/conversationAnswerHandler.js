const defaultConversation = require('../../services/conversation');
const defaultBilling = require('../../services/billing');
const defaultLocale = require('../../services/locale');
const defaultChatState = require('../../state/chatState');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultToolCache = require('../../services/toolCache');
const defaultAstroMap = require('../../services/astroMap');
const defaultInteractiveAstroMap = require('../../services/interactiveAstroMap');
const defaultFreeAstro = require('../../services/freeastro');
const defaultEphemerisTable = require('../../services/ephemerisTable');
const defaultMoonPhaseVisual = require('../../services/moonPhaseVisual');
const defaultNatalAspectTable = require('../../services/natalAspectTable');
const defaultMonthlyTransitTable = require('../../services/monthlyTransitTable');
const defaultGemini = require('../../services/gemini');
const defaultLogger = require('../../services/logger');
const { repairAnswerText, validateAnswerText } = require('../../domain/answerQuality');
const { splitConversationReply } = require('../../utils/format');
const { sendExternalLink } = require('../channelPrompts');
const {
  promptForBirthDate,
  promptForProfileName
} = require('./natalFlowPrompts');
const {
  sendRelocationCityChoices,
  sendSynastryPartnerChoices,
  sendWeddingSpouseAChoices
} = require('./conversationSelectionActionHandler');

async function sendEditablePrompt(event, channelApi, text, options = {}) {
  return channelApi.sendText(event, text, options);
}

function buildRelocationCitySelectionNotice(locale) {
  if (locale === 'fr') {
    return 'J’ai trouvé plusieurs villes possibles pour cette question de relocalisation.';
  }

  if (locale === 'de') {
    return 'Ich habe mehrere mögliche Städte für diese Relokationsfrage gefunden.';
  }

  if (locale === 'es') {
    return 'Encontré varias ciudades posibles para esta pregunta de relocalización.';
  }

  return 'I found several possible cities for this relocation question.';
}

function createConversationAnswerHandler(overrides = {}) {
  const deps = {
    astroMap: defaultAstroMap,
    billing: defaultBilling,
    chatState: defaultChatState,
    conversation: defaultConversation,
    ephemerisTable: defaultEphemerisTable,
    freeAstro: defaultFreeAstro,
    gemini: defaultGemini,
    logger: defaultLogger,
    interactiveAstroMap: defaultInteractiveAstroMap,
    locale: defaultLocale,
    moonPhaseVisual: defaultMoonPhaseVisual,
    monthlyTransitTable: defaultMonthlyTransitTable,
    natalAspectTable: defaultNatalAspectTable,
    natalFlow: defaultNatalFlow,
    toolCache: defaultToolCache,
    ...overrides
  };

  async function maybeBuildCheckoutLink(identity) {
    if (!deps.billing.isStripeConfigured()) {
      return null;
    }

    try {
      return await deps.billing.createCheckoutSessionUrl(identity);
    } catch (error) {
      return null;
    }
  }

  function formatBillingLinkMessage(event) {
    return [
      deps.locale.t(event, 'billing.limitReached', { limit: deps.billing.FREE_QUESTIONS_PER_DAY }),
      deps.billing.getUpgradePitch((path, args) => deps.locale.t(event, path, args))
    ].join('\n\n');
  }

  async function handleQuestionLimit(event, channelApi, loadingRef = null) {
    const checkoutUrl = await maybeBuildCheckoutLink(event);
    const message = checkoutUrl
      ? formatBillingLinkMessage(event, checkoutUrl)
      : [
          deps.locale.t(event, 'billing.limitReached', { limit: deps.billing.FREE_QUESTIONS_PER_DAY }),
          deps.locale.t(event, 'billing.checkoutUnavailable')
        ].join('\n\n');

    if (loadingRef && !checkoutUrl) {
      await channelApi.editText(event, loadingRef, message);
      return true;
    }

    if (checkoutUrl) {
      if (loadingRef) {
        await channelApi.editText(event, loadingRef, message);
      }

      return sendExternalLink(
        event,
        channelApi,
        message,
        'billing.subscribeButton',
        checkoutUrl,
        deps
      );
    }

    await channelApi.sendText(event, message);
    return true;
  }

  async function maybeSendAstroMap(event, channelApi, userText, conversationResult) {
    if (conversationResult?.intent !== 'relocation') {
      return;
    }

    if (!Array.isArray(conversationResult?.usedTools) || conversationResult.usedTools.length === 0) {
      return;
    }

    try {
      const rendered = await deps.astroMap.renderAstrocartographyMap({
        locale: deps.locale.getLocale(event),
        toolResults: conversationResult.usedTools,
        userText,
        renderMode: 'atlas',
        projectionName: 'equirectangular'
      });

      if (!rendered) {
        return;
      }

      await channelApi.sendImage(event, rendered.buffer, {
        filename: rendered.filename
      });

      const interactiveUrl = deps.interactiveAstroMap.registerInteractiveAstroMap({
        locale: deps.locale.getLocale(event),
        toolResults: conversationResult.usedTools,
        userText
      });

      if (interactiveUrl) {
        await sendExternalLink(
          event,
          channelApi,
          deps.locale.t(event, 'prompts.interactiveMapPrompt'),
          'buttons.openInteractiveMap',
          interactiveUrl,
          deps
        );
      }
    } catch (error) {
      return;
    }
  }

  async function maybeSendRouteMediaAttachments(event, channelApi, conversationResult) {
    const attachments = Array.isArray(conversationResult?.mediaAttachments)
      ? conversationResult.mediaAttachments
      : [];
    const effectiveAttachments = [...attachments];
    const addAttachment = (attachment) => {
      if (!effectiveAttachments.includes(attachment)) {
        effectiveAttachments.push(attachment);
      }
    };

    if (conversationResult?.mediaPayload?.monthlyTransits?.rows?.length > 0) {
      addAttachment('monthly_transits_png');
    }

    if (effectiveAttachments.includes('natal_chart_png')) {
      const chatState = deps.chatState.getChatState(event);
      const chartPayload = chatState.chartRequestPayload;
      if (!chartPayload || !chatState.rawNatalPayload) {
        await channelApi.sendText(event, deps.locale.t(event, 'profile.chartUnavailable'));
      } else {
        try {
          const chart = await deps.freeAstro.getNatalChart(chartPayload);
          await channelApi.sendImage(event, chart.buffer, {
            caption: deps.locale.t(event, 'prompts.chartCaption'),
            filename: 'natal-chart.png'
          });
        } catch (error) {
          await channelApi.sendText(event, deps.locale.translateUserError(deps.locale.getLocale(event), error));
        }
      }
    }

    const ephemerisTool = Array.isArray(conversationResult?.usedTools)
      ? conversationResult.usedTools.find((tool) => tool?.name === 'rest_ephemeris' || tool?.name === 'v1_ephemeris')
      : null;
    const ephemerisPayload = ephemerisTool?.result?.structuredContent || ephemerisTool?.result || null;

    if (effectiveAttachments.includes('ephemeris_month_png') && ephemerisPayload) {
      try {
        const buffer = await deps.ephemerisTable.renderEphemerisMonthPng(ephemerisPayload);
        await channelApi.sendImage(event, buffer, {
          caption: 'Full month ephemeris table',
          filename: 'ephemeris-month.png'
        });
      } catch (error) {
        await channelApi.sendText(event, deps.locale.translateUserError(deps.locale.getLocale(event), error));
      }
    }

    if (effectiveAttachments.includes('natal_aspects_png')) {
      const payload = conversationResult?.mediaPayload?.natalAspects || null;
      if (payload?.lines?.length > 0) {
        try {
          const buffer = await deps.natalAspectTable.renderNatalAspectsPng(payload);
          await channelApi.sendImage(event, buffer, {
            caption: '',
            filename: 'natal-aspects.png'
          });
        } catch (error) {
          await channelApi.sendText(event, deps.locale.translateUserError(deps.locale.getLocale(event), error));
        }
      }
    }

    if (effectiveAttachments.includes('monthly_transits_png')) {
      const payload = conversationResult?.mediaPayload?.monthlyTransits || null;
      if (payload?.rows?.length > 0) {
        try {
          const renderedPages = await deps.monthlyTransitTable.renderMonthlyTransitsPng(payload);
          const pages = Array.isArray(renderedPages) ? renderedPages : [renderedPages].filter(Boolean);
          for (const page of pages) {
            if (page?.buffer) {
              await channelApi.sendImage(event, page.buffer, {
                caption: page.caption || '',
                filename: page.filename || 'monthly-transits.png'
              });
            }
          }
        } catch (error) {
          await channelApi.sendText(event, deps.locale.translateUserError(deps.locale.getLocale(event), error));
        }
      }
    }

    if (effectiveAttachments.includes('moon_phase_svg')) {
      const moonPhaseTool = Array.isArray(conversationResult?.usedTools)
        ? conversationResult.usedTools.find((tool) => tool?.name === 'rest_moon_phase')
        : null;
      const moonPhasePayload = moonPhaseTool?.result?.structuredContent || moonPhaseTool?.result || null;
      if (moonPhasePayload) {
        try {
          const rendered = await deps.moonPhaseVisual.renderMoonPhaseVisualPng(moonPhasePayload);
          if (rendered?.buffer) {
            await channelApi.sendImage(event, rendered.buffer, {
              caption: rendered.caption || '',
              filename: rendered.filename || 'current-moon-phase.png'
            });
          }
        } catch (error) {
          await channelApi.sendText(event, deps.locale.translateUserError(deps.locale.getLocale(event), error));
        }
      }
    }

    const links = Array.isArray(conversationResult?.externalLinks) && conversationResult.externalLinks.length > 0
      ? conversationResult.externalLinks
      : (ephemerisPayload ? [{ label: 'Customize table', url: deps.ephemerisTable.buildEphemerisWebAppUrl(ephemerisPayload) }] : []);
    for (const link of links) {
      if (link?.url && typeof channelApi.sendLink === 'function') {
        await channelApi.sendLink(
          event,
          'Open the interactive ephemeris table to customize bodies, zodiac mode, and local points.',
          link.label || 'Open table',
          link.url
        );
      }
    }
  }

  function logAnswerQuality(event, userText, result, delivery) {
    const locale = deps.locale.getLocale(event);
    const text = delivery.texts.join('\n\n');
    const { issues, stats } = validateAnswerText(text, {
      locale,
      userText,
      hasMedia: delivery.hasMedia
    });

    deps.logger.info('answer quality', {
      channel: event.channel || null,
      chatId: event.chatId || null,
      locale,
      userText,
      intent: result?.intent || null,
      renderMode: delivery.renderMode,
      hasMedia: delivery.hasMedia,
      repairs: [...delivery.repairs],
      issues,
      ...stats
    });
  }

  async function handleConversationAnswer(event, channelApi, userText, options = {}) {
    const access = await deps.billing.getAccessSummary(event);

    if (access.limitReached) {
      return handleQuestionLimit(event, channelApi, options.loadingRef || null);
    }

    const loadingRef = options.loadingRef || await sendEditablePrompt(
      event,
      channelApi,
      deps.locale.t(event, 'prompts.readingChart')
    );

    let progressiveDelivered = false;
    let result = null;
    // Set by every branch that delivers an answer; reported once in `finally`.
    let delivery = null;
    const delivered = { texts: [], repairs: new Set() };
    const prepareAnswerText = (rawText) => {
      const repaired = repairAnswerText(rawText);
      repaired.repairs.forEach((repair) => delivered.repairs.add(repair));
      if (repaired.text) {
        delivered.texts.push(repaired.text);
      }
      return repaired.text;
    };
    const markDelivered = (renderMode, hasMedia = false) => {
      delivery = { ...delivered, renderMode, hasMedia };
    };

    try {
      result = await deps.conversation.answerConversation(event, userText, {
        onProgressSection: async (sectionText) => {
          const text = prepareAnswerText(sectionText);
          if (!text) {
            return;
          }

          if (!progressiveDelivered) {
            await channelApi.editText(event, loadingRef, text);
            progressiveDelivered = true;
            return;
          }

          await channelApi.sendText(event, text);
        }
      });

      if (result?.requiresSynastryProfileSelection) {
        deps.chatState.setPendingSynastryQuestion(event, userText);
        await channelApi.editText(
          event,
          loadingRef,
          result.candidates?.length > 0 ? deps.locale.t(event, 'errors.choosePartnerProfile') : deps.locale.t(event, 'profile.noOtherProfiles')
        );

        if (result.candidates?.length > 0) {
          await sendSynastryPartnerChoices(event, channelApi, result.candidates, deps);
        }

        return true;
      }

      if (result?.requiresWeddingProfileSelection) {
        deps.chatState.setPendingWeddingSelection(event, {
          question: userText,
          spouseAProfileId: null
        });
        await channelApi.editText(
          event,
          loadingRef,
          deps.locale.t(event, 'prompts.weddingFirstSpouse')
        );

        if (result.candidates?.length > 0) {
          await sendWeddingSpouseAChoices(event, channelApi, result.candidates, deps);
        }

        return true;
      }

      if (result?.requiresCitySelection) {
        deps.chatState.setUiCache(event, {
          ...deps.chatState.getUiCache(event),
          citySelection: {
            question: result.replayQuestion || userText,
            candidates: Array.isArray(result.candidates) ? result.candidates : []
          }
        });
        await channelApi.editText(
          event,
          loadingRef,
          buildRelocationCitySelectionNotice(deps.locale.getLocale(event))
        );

        if (result.candidates?.length > 0) {
          await sendRelocationCityChoices(event, channelApi, result.candidates, deps);
        }

        return true;
      }

      if (result?.needsProfileCreation) {
        deps.chatState.setPendingQuestion(event, userText);
        deps.natalFlow.startNatalFlow(event, 'chat', {
          mode: 'add_secondary',
          profileName: result.requestedProfileName || null
        });

        await channelApi.editText(
          event,
          loadingRef,
          result.text
        );

        if (result.requestedProfileName) {
          await promptForBirthDate(event, channelApi, 'chat', deps);
        } else {
          await promptForProfileName(event, channelApi, deps);
        }

        return true;
      }

      if (result?.renderMode === 'telegram_pre' && event.channel === 'telegram') {
        delivered.texts.push(String(result.text || '').replace(/<[^>]+>/g, ''));
        markDelivered('telegram_pre');
        await channelApi.editText(event, loadingRef, result.text, { html: true });
        await deps.billing.recordAnsweredQuestion(event);
        await maybeSendRouteMediaAttachments(event, channelApi, result);
        await maybeSendAstroMap(event, channelApi, userText, result);
        return true;
      }

      if (result?.renderMode === 'telegram_html' && event.channel === 'telegram') {
        const htmlParts = Array.isArray(result?.textParts) && result.textParts.length > 0 ? result.textParts : [result.text];
        delivered.texts.push(...htmlParts.map((part) => String(part || '').replace(/<[^>]+>/g, '')));
        markDelivered('telegram_html');
        if (Array.isArray(result?.textParts) && result.textParts.length > 0) {
          await channelApi.editText(event, loadingRef, result.textParts[0], { html: true });

          for (const part of result.textParts.slice(1)) {
            await channelApi.sendText(event, part, { html: true });
          }
        } else {
          await channelApi.editText(event, loadingRef, result.text, { html: true });
        }
        await deps.billing.recordAnsweredQuestion(event);
        await maybeSendRouteMediaAttachments(event, channelApi, result);
        await maybeSendAstroMap(event, channelApi, userText, result);
        return true;
      }

      if (result?.alreadyDelivered) {
        markDelivered('progressive');
        await deps.billing.recordAnsweredQuestion(event);
        await maybeSendRouteMediaAttachments(event, channelApi, result);
        await maybeSendAstroMap(event, channelApi, userText, result);
        return true;
      }

      if (result?.suppressTextResponse) {
        if (String(result.text || '').trim()) {
          delivered.texts.push(String(result.text).trim());
        }
        markDelivered('media', true);
        if (typeof channelApi.deleteMessage === 'function') {
          await channelApi.deleteMessage(event, loadingRef);
        } else if (loadingRef && event.channel !== 'whatsapp') {
          await channelApi.editText(event, loadingRef, String(result.text || '').trim() || 'Done.');
        }
        await deps.billing.recordAnsweredQuestion(event);
        await maybeSendRouteMediaAttachments(event, channelApi, result);
        await maybeSendAstroMap(event, channelApi, userText, result);
        return true;
      }

      if (Array.isArray(result?.textParts) && result.textParts.length > 0) {
        const parts = result.textParts.map(prepareAnswerText).filter(Boolean);
        markDelivered('text_parts');
        await channelApi.editText(event, loadingRef, parts[0] || deps.locale.t(event, 'errors.noGroundedAnswer'));

        for (const part of parts.slice(1)) {
          await channelApi.sendText(event, part);
        }

        await deps.billing.recordAnsweredQuestion(event);
        await maybeSendRouteMediaAttachments(event, channelApi, result);
        await maybeSendAstroMap(event, channelApi, userText, result);
        return true;
      }

      const chunks = splitConversationReply(prepareAnswerText(result.text));
      markDelivered('text');

      if (chunks.length === 0) {
        await channelApi.editText(event, loadingRef, deps.locale.t(event, 'errors.noGroundedAnswer'));
        return true;
      }

      await channelApi.editText(event, loadingRef, chunks[0]);

      for (const chunk of chunks.slice(1)) {
        await channelApi.sendText(event, chunk);
      }

      await deps.billing.recordAnsweredQuestion(event);
      await maybeSendRouteMediaAttachments(event, channelApi, result);
      await maybeSendAstroMap(event, channelApi, userText, result);
    } catch (error) {
      const errorMessage = error?.name === 'FreeAstroError'
        ? deps.locale.translateUserError(deps.locale.getLocale(event), error)
        : deps.gemini.getGeminiErrorMessage(error, deps.locale.getLocale(event));
      const message = `${deps.locale.t(event, 'errors.conversationUnavailable')}\n${errorMessage}`;
      if (progressiveDelivered) {
        await channelApi.sendText(event, message);
      } else {
        await channelApi.editText(
          event,
          loadingRef,
          message
        );
      }
    } finally {
      if (delivery) {
        logAnswerQuality(event, userText, result, delivery);
      }
    }

    return true;
  }

  return {
    buildRelocationCitySelectionNotice,
    handleConversationAnswer,
    handleQuestionLimit,
    maybeSendAstroMap,
    maybeSendRouteMediaAttachments
  };
}

module.exports = {
  buildRelocationCitySelectionNotice,
  createConversationAnswerHandler
};
