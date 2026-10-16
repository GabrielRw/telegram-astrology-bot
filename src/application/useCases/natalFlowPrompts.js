const { ACTIONS } = require('../actionIds');
const { sendFlowPrompt } = require('../channelPrompts');

function formatCityOption(city) {
  const bits = [city?.name, city?.admin1 || city?.region, city?.country].filter(Boolean);
  return bits.join(', ').slice(0, 60) || 'City option';
}

function getOnboardingIntro(locale, source, localeService) {
  return source === 'chat'
    ? localeService.t(locale, 'prompts.onboardingChat')
    : localeService.t(locale, 'prompts.onboardingStart');
}

async function promptForBirthDate(event, channelApi, source, deps) {
  const locale = deps.locale.getLocale(event);
  await sendFlowPrompt(event, channelApi, getOnboardingIntro(locale, source, deps.locale), deps);
}

async function promptForProfileName(event, channelApi, deps) {
  await sendFlowPrompt(event, channelApi, deps.locale.t(event, 'prompts.profileNamePrompt'), deps);
}

async function promptForCity(event, channelApi, deps) {
  await sendFlowPrompt(event, channelApi, deps.locale.t(event, 'prompts.birthDateAccepted'), deps);
}

async function promptForCityAfterDateCorrection(event, channelApi, birthDate, deps) {
  await sendFlowPrompt(event, channelApi, deps.locale.t(event, 'prompts.birthDateUpdated', { date: birthDate.raw }), deps);
}

async function promptForCityConfirmation(event, channelApi, candidates, deps) {
  const choices = candidates.map((city, index) => ({
    id: `${ACTIONS.CITY_PREFIX}${index}`,
    title: formatCityOption(city)
  }));

  await channelApi.sendChoices(event, deps.locale.t(event, 'prompts.cityConfirm'), choices);
  deps.chatState.setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
}

async function promptForBirthTimeKnown(event, channelApi, deps) {
  const locale = deps.locale.getLocale(event);
  const choices = [
    { id: ACTIONS.TIME_YES, title: deps.locale.t(locale, 'buttons.yes') },
    { id: ACTIONS.TIME_NO, title: deps.locale.t(locale, 'buttons.no') }
  ];

  await channelApi.sendChoices(
    event,
    deps.locale.t(locale, 'prompts.cityAccepted'),
    choices
  );
  deps.chatState.setChoiceMap(event, Object.fromEntries(choices.map((choice, index) => [String(index + 1), choice.id])));
}

async function promptForBirthTime(event, channelApi, deps) {
  await sendFlowPrompt(event, channelApi, deps.locale.t(event, 'prompts.birthTimePrompt'), deps);
}

async function repromptCurrentStep(event, channelApi, deps) {
  const session = deps.natalFlow.getSession(event);

  if (!session) {
    return;
  }

  if (session.step === 'name') {
    await promptForProfileName(event, channelApi, deps);
    return;
  }

  if (session.step === 'date') {
    await promptForBirthDate(event, channelApi, session.source, deps);
    return;
  }

  if (session.step === 'city') {
    await promptForCity(event, channelApi, deps);
    return;
  }

  if (session.step === 'city_confirm') {
    await promptForCityConfirmation(event, channelApi, session.cityCandidates || [], deps);
    return;
  }

  if (session.step === 'time_known') {
    await promptForBirthTimeKnown(event, channelApi, deps);
    return;
  }

  if (session.step === 'time') {
    await promptForBirthTime(event, channelApi, deps);
  }
}

module.exports = {
  formatCityOption,
  promptForBirthDate,
  promptForBirthTime,
  promptForBirthTimeKnown,
  promptForCity,
  promptForCityAfterDateCorrection,
  promptForCityConfirmation,
  promptForProfileName,
  repromptCurrentStep
};
