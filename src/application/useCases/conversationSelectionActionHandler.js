const defaultLocale = require('../../services/locale');
const defaultNatalFlow = require('../../services/natalFlow');
const defaultProfiles = require('../../services/profiles');
const defaultChatState = require('../../state/chatState');
const { ACTIONS } = require('../actionIds');
const { buildWeddingReplayQuestion } = require('./natalFlowHandler');
const { formatCityOption, promptForProfileName } = require('./natalFlowPrompts');

function chunkItems(items, size = 3) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function sendChoiceBatches(event, channelApi, prompt, choices, size = 3) {
  for (const batch of chunkItems(choices, size)) {
    await channelApi.sendChoices(event, prompt, batch);
  }
}

async function sendSynastryPartnerChoices(event, channelApi, candidates, deps) {
  const choices = candidates.map((candidate) => ({
    id: `${ACTIONS.SYNASTRY_PARTNER_PREFIX}${candidate.profileId}`,
    title: `${candidate.profileName}${candidate.cityLabel ? ` • ${candidate.cityLabel}` : ''}`.slice(0, 60)
  }));

  if (choices.length === 0) {
    await channelApi.sendText(event, deps.locale.t(event, 'profile.noOtherProfiles'));
    return;
  }

  deps.chatState.setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
  await sendChoiceBatches(event, channelApi, deps.locale.t(event, 'prompts.synastryPartner'), choices);
}

async function sendWeddingSpouseAChoices(event, channelApi, candidates, deps) {
  const choices = candidates.map((candidate) => ({
    id: `${ACTIONS.WEDDING_SPOUSE_A_PREFIX}${candidate.profileId}`,
    title: `${candidate.profileName}${candidate.cityLabel ? ` • ${candidate.cityLabel}` : ''}`.slice(0, 60)
  }));

  if (choices.length === 0) {
    await channelApi.sendText(event, deps.locale.t(event, 'profile.noOtherProfiles'));
    return;
  }

  deps.chatState.setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
  await sendChoiceBatches(event, channelApi, deps.locale.t(event, 'prompts.weddingFirstSpouse'), choices);
}

async function sendWeddingSpouseBChoices(event, channelApi, spouseA, candidates, deps) {
  const profileChoices = candidates.map((candidate) => ({
    id: `${ACTIONS.WEDDING_SPOUSE_B_PREFIX}${candidate.profileId}`,
    title: `${candidate.profileName}${candidate.cityLabel ? ` • ${candidate.cityLabel}` : ''}`.slice(0, 60)
  }));
  const choices = [
    ...profileChoices,
    {
      id: ACTIONS.WEDDING_SPOUSE_B_NEW,
      title: deps.locale.t(event, 'buttons.addNewUser').slice(0, 60)
    }
  ];

  deps.chatState.setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
  await sendChoiceBatches(
    event,
    channelApi,
    deps.locale.t(event, 'prompts.weddingSecondSpouse', { value: spouseA?.profileName || 'the first spouse' }),
    choices
  );
}

async function sendRelocationCityChoices(event, channelApi, candidates, deps) {
  const choices = candidates.map((candidate, index) => ({
    id: `${ACTIONS.RELOCATION_CITY_PREFIX}${index}`,
    title: formatCityOption(candidate)
  }));

  if (choices.length === 0) {
    return;
  }

  deps.chatState.setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
  await sendChoiceBatches(
    event,
    channelApi,
    deps.locale.t(event, 'prompts.cityConfirm'),
    choices
  );
}

function createConversationSelectionActionHandler(overrides = {}) {
  const deps = {
    chatState: defaultChatState,
    locale: defaultLocale,
    natalFlow: defaultNatalFlow,
    profiles: defaultProfiles,
    ...overrides
  };

  return {
    async handleConversationSelectionAction(event, channelApi, answerPaidConversation) {
      const actionId = String(event.actionId || '');

      if (actionId.startsWith(ACTIONS.SYNASTRY_PARTNER_PREFIX)) {
        const profileId = actionId.slice(ACTIONS.SYNASTRY_PARTNER_PREFIX.length);
        const selectedProfile = await deps.profiles.getProfileById(event, profileId);

        if (!selectedProfile) {
          await channelApi.ackAction(event, deps.locale.t(event, 'errors.profileUnavailable'));
          return true;
        }

        await channelApi.ackAction(event);
        return answerPaidConversation(
          event,
          channelApi,
          `Compare me with ${selectedProfile.profileName}`
        );
      }

      if (actionId.startsWith(ACTIONS.WEDDING_SPOUSE_A_PREFIX)) {
        const selection = deps.chatState.getPendingWeddingSelection(event);
        const profileId = actionId.slice(ACTIONS.WEDDING_SPOUSE_A_PREFIX.length);
        const selectedProfile = await deps.profiles.getProfileById(event, profileId);

        if (!selection?.question || !selectedProfile) {
          await channelApi.ackAction(event, deps.locale.t(event, 'errors.weddingSelectionExpired'));
          return true;
        }

        const candidates = (await deps.profiles.listProfiles(event))
          .filter((profile) => profile.profileId !== selectedProfile.profileId);

        deps.chatState.setPendingWeddingSelection(event, {
          ...selection,
          spouseAProfileId: selectedProfile.profileId
        });
        await channelApi.ackAction(event);
        await channelApi.sendText(
          event,
          deps.locale.t(event, 'prompts.weddingSecondSpouse', { value: selectedProfile.profileName })
        );
        await sendWeddingSpouseBChoices(event, channelApi, selectedProfile, candidates, deps);
        return true;
      }

      if (actionId === ACTIONS.WEDDING_SPOUSE_B_NEW) {
        const selection = deps.chatState.getPendingWeddingSelection(event);

        if (!selection?.question || !selection?.spouseAProfileId) {
          await channelApi.ackAction(event, deps.locale.t(event, 'errors.weddingSelectionExpired'));
          return true;
        }

        await channelApi.ackAction(event);
        deps.chatState.setPendingQuestion(event, selection.question);
        deps.chatState.setChoiceMap(event, {});
        deps.natalFlow.startNatalFlow(event, 'chat', { mode: 'add_secondary' });
        await channelApi.sendText(event, deps.locale.t(event, 'prompts.weddingAddPartner'));
        await promptForProfileName(event, channelApi, deps);
        return true;
      }

      if (actionId.startsWith(ACTIONS.WEDDING_SPOUSE_B_PREFIX)) {
        const selection = deps.chatState.getPendingWeddingSelection(event);
        const spouseBProfileId = actionId.slice(ACTIONS.WEDDING_SPOUSE_B_PREFIX.length);
        const spouseA = selection?.spouseAProfileId ? await deps.profiles.getProfileById(event, selection.spouseAProfileId) : null;
        const spouseB = await deps.profiles.getProfileById(event, spouseBProfileId);

        if (!selection?.question || !spouseA || !spouseB || spouseA.profileId === spouseB.profileId) {
          await channelApi.ackAction(event, deps.locale.t(event, 'errors.weddingSelectionExpired'));
          return true;
        }

        deps.chatState.setPendingWeddingSelection(event, null);
        deps.chatState.setChoiceMap(event, {});
        await channelApi.ackAction(event);
        return answerPaidConversation(
          event,
          channelApi,
          buildWeddingReplayQuestion(selection.question, spouseA.profileName, spouseB.profileName)
        );
      }

      if (actionId.startsWith(ACTIONS.RELOCATION_CITY_PREFIX)) {
        const cityIndex = Number(actionId.slice(ACTIONS.RELOCATION_CITY_PREFIX.length));
        const citySelection = deps.chatState.getUiCache(event)?.citySelection || null;
        const selectedCity = Array.isArray(citySelection?.candidates) ? citySelection.candidates[cityIndex] : null;

        if (!selectedCity || !citySelection?.question) {
          await channelApi.ackAction(event, 'These city choices have expired.');
          return true;
        }

        deps.chatState.setUiCache(event, {
          ...deps.chatState.getUiCache(event),
          citySelection: null
        });
        deps.chatState.setChoiceMap(event, {});
        await channelApi.ackAction(event, `Using ${formatCityOption(selectedCity)}.`);

        const selectedQuestion = [
          citySelection.question,
          '',
          `Selected city: ${selectedCity.name}${selectedCity.country ? `, ${selectedCity.country}` : ''}${selectedCity.lat !== undefined && selectedCity.lng !== undefined ? ` [${selectedCity.lat}, ${selectedCity.lng}]` : ''}`
        ].join('\n');

        return answerPaidConversation(event, channelApi, selectedQuestion);
      }

      return false;
    }
  };
}

module.exports = {
  createConversationSelectionActionHandler,
  sendRelocationCityChoices,
  sendSynastryPartnerChoices,
  sendWeddingSpouseAChoices,
  sendWeddingSpouseBChoices
};
