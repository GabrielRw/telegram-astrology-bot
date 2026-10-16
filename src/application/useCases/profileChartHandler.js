const defaultLocale = require('../../services/locale');
const defaultFreeAstro = require('../../services/freeastro');
const defaultChatState = require('../../state/chatState');
const { formatNatalMessage } = require('../../utils/format');

function createProfileChartHandler(overrides = {}) {
  const deps = {
    locale: defaultLocale,
    getChatState: defaultChatState.getChatState,
    getNatalChart: defaultFreeAstro.getNatalChart,
    formatNatalMessage,
    ...overrides
  };

  return {
    async handleProfileChart(event, channelApi) {
      if (typeof channelApi.ackAction === 'function') {
        await channelApi.ackAction(event);
      }

      const chatState = deps.getChatState(event);
      const chartPayload = chatState.chartRequestPayload;

      if (!chartPayload || !chatState.rawNatalPayload) {
        await channelApi.sendText(event, deps.locale.t(event, 'profile.chartUnavailable'));
        return true;
      }

      try {
        const chart = await deps.getNatalChart(chartPayload);
        await channelApi.sendImage(event, chart.buffer, {
          caption: deps.locale.t(event, 'prompts.chartCaption'),
          filename: 'natal-chart.png'
        });
        await channelApi.sendText(
          event,
          deps.formatNatalMessage(
            chatState.rawNatalPayload,
            chatState.natalProfile.city,
            deps.locale.getLocale(event)
          )
        );
      } catch (error) {
        await channelApi.sendText(
          event,
          deps.locale.translateUserError(deps.locale.getLocale(event), error)
        );
      }

      return true;
    }
  };
}

module.exports = {
  createProfileChartHandler
};
