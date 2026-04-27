#!/usr/bin/env node
require('dotenv').config();

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { performance } = require('node:perf_hooks');
const persistence = require('../src/services/persistence');
const {
  handleBilling,
  handleCancel,
  handleIncomingAction,
  handleIncomingText,
  handleProfile,
  handleStart,
  handleSubscribe
} = require('../src/core/controller');
const { getChoiceMap, getChatState, resolveStateKey } = require('../src/state/chatState');

function parseArgs(argv) {
  const args = {
    chat: 'local-sim',
    locale: 'en',
    text: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];

    if ((value === '--chat' || value === '-c') && argv[index + 1]) {
      args.chat = argv[index + 1];
      index += 1;
      continue;
    }

    if ((value === '--locale' || value === '-l') && argv[index + 1]) {
      args.locale = argv[index + 1];
      index += 1;
      continue;
    }

    if ((value === '--text' || value === '-t') && argv[index + 1]) {
      args.text = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return args;
}

function createEvent(session, overrides = {}) {
  return {
    channel: 'simulator',
    userId: session.chatId,
    chatId: session.chatId,
    localeHint: session.locale,
    type: overrides.type || 'text',
    text: overrides.text !== undefined ? overrides.text : '',
    actionId: overrides.actionId || null,
    messageRef: overrides.messageRef || null
  };
}

function createCliChannelApi(session) {
  let nextMessageId = 1;

  function makeRef() {
    return {
      chatId: session.chatId,
      messageId: nextMessageId++
    };
  }

  function printBlock(prefix, text) {
    const body = String(text || '').trim();
    if (!body) {
      return;
    }

    console.log(`${prefix} ${body}`);
  }

  return {
    capabilities: {
      canEdit: true,
      helpActions: true,
      interactiveChoices: true,
      richNatalActions: false
    },
    async sendText(_event, text) {
      printBlock('BOT>', text);
      return makeRef();
    },
    async editText(_event, messageRef, text) {
      printBlock(`BOT(edit:${messageRef?.messageId || '?'})>`, text);
      return messageRef || makeRef();
    },
    async sendImage(_event, _buffer, options = {}) {
      printBlock('BOT[image]>', options.caption || '[image]');
      return makeRef();
    },
    async sendChoices(_event, prompt, choices) {
      printBlock('BOT>', prompt);
      choices.forEach((choice, index) => {
        console.log(`  ${index + 1}. ${choice.title}  [${choice.id}]`);
      });
      return makeRef();
    },
    async sendLink(_event, prompt, label, url) {
      printBlock('BOT>', `${prompt}\n${label}: ${url}`);
      return makeRef();
    },
    async ackAction(_event, text) {
      if (text) {
        printBlock('ACK>', text);
      }
    }
  };
}

function printHelp() {
  console.log([
    'Commands:',
    '  /start        Start onboarding',
    '  /profile      Show active profile and actions',
    '  /billing      Show billing state',
    '  /subscribe    Show checkout flow',
    '  /cancel       Cancel active flow',
    '  /action ID    Trigger a controller action id directly',
    '  /choices      Show current numeric choice map',
    '  /state        Show compact chat state',
    '  /chat ID      Switch simulator chat id',
    '  /locale xx    Set locale hint for the simulator event',
    '  /help         Show this help',
    '  /quit         Exit',
    '',
    'Any other line is sent as normal user text.',
    'If the bot shows numbered choices, you can usually type 1, 2, or 3 directly.'
  ].join('\n'));
}

function printState(session) {
  const state = getChatState(createEvent(session));
  console.log(JSON.stringify({
    stateKey: resolveStateKey(createEvent(session)),
    activeProfileId: state.activeProfileId,
    activeFlow: state.activeFlow,
    factAvailability: state.factAvailability,
    pendingQuestion: state.pendingQuestion,
    pendingSynastryQuestion: state.pendingSynastryQuestion,
    profileDirectory: state.profileDirectory,
    choiceMap: state.choiceMap
  }, null, 2));
}

async function dispatchInput(session, channelApi, input) {
  const line = String(input || '').trim();
  if (!line) {
    return true;
  }

  if (line === '/quit' || line === '/exit') {
    return false;
  }

  if (line === '/help') {
    printHelp();
    return true;
  }

  if (line === '/choices') {
    console.log(JSON.stringify(getChoiceMap(createEvent(session)), null, 2));
    return true;
  }

  if (line === '/state') {
    printState(session);
    return true;
  }

  if (line.startsWith('/chat ')) {
    session.chatId = line.slice('/chat '.length).trim() || session.chatId;
    console.log(`SIM> chat set to ${session.chatId}`);
    return true;
  }

  if (line.startsWith('/locale ')) {
    session.locale = line.slice('/locale '.length).trim() || session.locale;
    console.log(`SIM> locale set to ${session.locale}`);
    return true;
  }

  const startedAt = performance.now();

  if (line === '/start') {
    await handleStart(createEvent(session, { type: 'start' }), channelApi);
  } else if (line === '/profile') {
    await handleProfile(createEvent(session, { type: 'command' }), channelApi);
  } else if (line === '/billing') {
    await handleBilling(createEvent(session, { type: 'command' }), channelApi);
  } else if (line === '/subscribe') {
    await handleSubscribe(createEvent(session, { type: 'command' }), channelApi);
  } else if (line === '/cancel') {
    await handleCancel(createEvent(session, { type: 'action', actionId: 'cancel' }), channelApi);
  } else if (line.startsWith('/action ')) {
    await handleIncomingAction(
      createEvent(session, {
        type: 'action',
        actionId: line.slice('/action '.length).trim()
      }),
      channelApi
    );
  } else {
    await handleIncomingText(
      createEvent(session, {
        type: 'text',
        text: line
      }),
      channelApi
    );
  }

  const durationMs = Math.round(performance.now() - startedAt);
  console.log(`SIM> turn completed in ${durationMs}ms`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const session = {
    chatId: args.chat,
    locale: args.locale
  };

  persistence.initialize();
  const channelApi = createCliChannelApi(session);

  if (args.text) {
    await dispatchInput(session, channelApi, args.text);
    return;
  }

  console.log(`SIM> chat=${session.chatId} locale=${session.locale}`);
  printHelp();

  if (!stdin.isTTY) {
    let input = '';

    stdin.setEncoding('utf8');
    for await (const chunk of stdin) {
      input += chunk;
    }

    const lines = input.split(/\r?\n/);
    for (const line of lines) {
      const shouldContinue = await dispatchInput(session, channelApi, line);
      if (!shouldContinue) {
        break;
      }
    }
    setTimeout(() => process.exit(0), 250);
    return;
  }

  const rl = readline.createInterface({
    input: stdin,
    output: stdout
  });

  try {
    while (true) {
      const line = await rl.question('YOU> ');
      const shouldContinue = await dispatchInput(session, channelApi, line);
      if (!shouldContinue) {
        break;
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
