#!/usr/bin/env node
// Answer-level eval: runs real questions through the full bot pipeline (router -> conversation ->
// FreeAstro/Gemini -> answer delivery) on a fixture profile and scores what the user would receive.
//
//   npm run eval:answers -- [--ids a,b] [--category transits] [--locale fr] [--limit 10]
//                           [--concurrency 3] [--judge] [--baseline file] [--save-baseline]
//                           [--fail-under 0.8] [--out file]
//
// Production side effects are disabled before anything loads: no Supabase, Stripe, Telegram or WhatsApp.

const PRODUCTION_ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'BOT_TOKEN',
  'WEBHOOK_BASE_URL',
  'TELEGRAM_ALERT_CHAT_ID',
  'WHATSAPP_ACCESS_TOKEN'
];
for (const key of PRODUCTION_ENV_KEYS) {
  process.env[key] = '';
}

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const REPO_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

// Every log line is JSON on stdout/stderr; capture it per turn instead of printing it.
const logStore = new AsyncLocalStorage();
const print = (...args) => process.stdout.write(`${args.join(' ')}\n`);
function captureConsole(original) {
  return (...args) => {
    const collector = logStore.getStore();
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('{"ts"')) {
      if (collector) {
        try {
          collector.push(JSON.parse(first));
        } catch (_error) {
          // not one of ours
        }
      }
      return;
    }
    if (collector) {
      return;
    }
    original(...args);
  };
}
console.log = captureConsole(console.log.bind(console));
console.error = captureConsole(console.error.bind(console));
console.warn = captureConsole(console.warn.bind(console));

const { createIncomingEventRouter } = require('../src/application/incomingEventRouter');
const { createLegacyControllerHandlers } = require('../src/adapters/legacyControllerHandlers');
const { ACTIONS } = require('../src/application/actionIds');
const chatState = require('../src/state/chatState');
const natalFlow = require('../src/services/natalFlow');
const locale = require('../src/services/locale');
const gemini = require('../src/services/gemini');
const { validateAnswerText } = require('../src/domain/answerQuality');
const { buildChartTruth, findMissingMentions, findNatalClaimContradictions } = require('../src/domain/natalClaimCheck');

const DEFAULT_CASES_PATH = path.join(REPO_ROOT, 'data/eval/answer-cases.jsonl');
const FIXTURE_PATH = path.join(REPO_ROOT, 'data/eval/fixture-profile.json');
const BASELINE_PATH = path.join(REPO_ROOT, 'data/eval/answer-baseline.json');
const REPORT_DIR = path.join(REPO_ROOT, 'var/eval');

const LATENCY_BUDGET_MS = {
  natal_placement: 6000,
  natal_topic: 15000,
  format: 15000,
  transits: 20000,
  electional: 20000,
  other: 25000,
  guardrail: 10000,
  multi_turn: 20000
};
const TURN_TIMEOUT_MS = 120000;

function parseArgs(argv) {
  const args = { concurrency: 3, judge: false, saveBaseline: false };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => argv[++index];
    if (flag === '--ids') args.ids = new Set(next().split(',').map((value) => value.trim()));
    else if (flag === '--category') args.category = next();
    else if (flag === '--locale') args.locale = next();
    else if (flag === '--limit') args.limit = Number(next());
    else if (flag === '--concurrency') args.concurrency = Math.max(1, Number(next()) || 1);
    else if (flag === '--judge') args.judge = true;
    else if (flag === '--baseline') args.baseline = path.resolve(next());
    else if (flag === '--save-baseline') args.saveBaseline = true;
    else if (flag === '--fail-under') args.failUnder = Number(next());
    else if (flag === '--cases') args.casesPath = path.resolve(next());
    else if (flag === '--out') args.out = path.resolve(next());
    else throw new Error(`Unknown flag ${flag}`);
  }
  return args;
}

function loadCases(args) {
  const cases = fs.readFileSync(args.casesPath || DEFAULT_CASES_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((item) => !args.ids || args.ids.has(item.id))
    .filter((item) => !args.category || item.category === args.category)
    .filter((item) => !args.locale || item.locale === args.locale);
  return Number.isFinite(args.limit) ? cases.slice(0, args.limit) : cases;
}

// ---------------------------------------------------------------- channel capture

function createCaptureChannel() {
  let nextId = 1;
  const messages = new Map();
  const record = (entry) => {
    const ref = { messageId: nextId++ };
    messages.set(ref.messageId, entry);
    return ref;
  };

  return {
    messages,
    reset() {
      messages.clear();
    },
    api: {
      capabilities: { canEdit: true, helpActions: true, interactiveChoices: true, richNatalActions: false },
      async sendText(_event, text) {
        return record({ kind: 'text', text: String(text || '') });
      },
      async editText(_event, ref, text) {
        const existing = ref && messages.get(ref.messageId);
        if (existing) {
          existing.text = String(text || '');
          existing.kind = 'text';
          return ref;
        }
        return record({ kind: 'text', text: String(text || '') });
      },
      async deleteMessage(_event, ref) {
        messages.delete(ref?.messageId);
        return true;
      },
      async sendImage(_event, _buffer, options = {}) {
        return record({ kind: 'image', text: String(options.caption || '') });
      },
      async sendChoices(_event, prompt, choices) {
        return record({ kind: 'choices', text: String(prompt || ''), choices: (choices || []).map((choice) => choice.title) });
      },
      async sendLink(_event, prompt, label, url) {
        return record({ kind: 'link', text: `${prompt}\n${label}: ${url}` });
      },
      async showPersistentActions(_event, _actions, text) {
        return record({ kind: 'text', text: String(text || '') });
      },
      async ackAction() {}
    }
  };
}

// ---------------------------------------------------------------- sessions

function createSessionPool(route, fixture) {
  const sessions = new Map();

  async function send(session, input) {
    const event = {
      channel: 'simulator',
      userId: session.chatId,
      chatId: session.chatId,
      localeHint: session.locale,
      type: input.actionId ? 'action' : 'text',
      text: input.text || '',
      actionId: input.actionId || null,
      messageRef: null
    };
    await route(event, session.channel.api);
    return event;
  }

  async function onboard(session) {
    const steps = [
      { text: '/start' },
      { text: fixture.birthDate },
      { text: fixture.birthCity },
      { actionId: `${ACTIONS.CITY_PREFIX}${fixture.cityChoice || 0}` },
      fixture.birthTime ? { actionId: ACTIONS.TIME_YES } : { actionId: ACTIONS.TIME_NO },
      ...(fixture.birthTime ? [{ text: fixture.birthTime }] : [])
    ];
    const logs = [];
    await logStore.run(logs, async () => {
      for (const step of steps) {
        await send(session, step);
      }
    });

    const state = chatState.getChatState(session.identity);
    if (!state.activeProfileId || !state.natalProfile) {
      const problems = logs.filter((entry) => entry.level !== 'info').map((entry) => entry.message);
      const lastBotMessage = [...session.channel.messages.values()].pop()?.text || 'none';
      throw new Error(`Onboarding failed for ${session.chatId}: ${problems.join('; ') || 'no profile saved'} (last bot message: ${lastBotMessage.slice(0, 160)})`);
    }
    session.snapshot = structuredClone(state);
    session.truth = buildChartTruth(state.natalProfile);
    session.natalProfile = state.natalProfile;
    session.timezone = state.natalProfile?.birthLocation?.timezone || 'UTC';
  }

  // Upstream calls occasionally fail; retry onboarding from a clean state before giving up.
  async function onboardWithRetry(session, attempts = 3) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        natalFlow.clearSession(session.identity);
        chatState.replaceChatState(session.identity, null);
        session.channel.reset();
        await onboard(session);
        return;
      } catch (error) {
        if (attempt === attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  async function acquire(workerIndex, caseLocale) {
    const key = `${caseLocale}:${workerIndex}`;
    if (!sessions.has(key)) {
      const chatId = `eval-${caseLocale}-${workerIndex}`;
      const session = {
        chatId,
        locale: caseLocale,
        identity: { channel: 'simulator', userId: chatId, chatId },
        channel: createCaptureChannel()
      };
      sessions.set(key, session);
    }
    const session = sessions.get(key);
    if (!session.ready) {
      session.ready = onboardWithRetry(session);
    }
    try {
      await session.ready;
    } catch (error) {
      session.ready = null; // let the next case on this worker try again
      throw error;
    }
    // A previous case may have left an onboarding flow open (e.g. "create a profile for Leo").
    natalFlow.clearSession(session.identity);
    chatState.replaceChatState(session.identity, structuredClone(session.snapshot));
    return session;
  }

  return { acquire, send };
}

// ---------------------------------------------------------------- turn execution

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`turn timed out after ${ms}ms`)), ms);
    })
  ]);
}

async function runTurn(pool, session, text) {
  session.channel.reset();
  const logs = [];
  const startedAt = performance.now();
  let failure = null;

  await logStore.run(logs, async () => {
    try {
      await withTimeout(pool.send(session, { text }), TURN_TIMEOUT_MS);
    } catch (error) {
      failure = error.message;
    }
  });

  const latencyMs = Math.round(performance.now() - startedAt);
  const loadingText = locale.t(session.locale, 'prompts.readingChart');
  const messages = [...session.channel.messages.values()];
  const textMessages = messages.filter((message) => message.kind === 'text' && message.text.trim() && message.text !== loadingText);
  const routeLog = [...logs].reverse().find((entry) => entry.message === 'conversation route resolved') || null;
  const qualityLog = [...logs].reverse().find((entry) => entry.message === 'answer quality') || null;
  const context = chatState.getConversationContext(session.identity) || {};
  const parameters = routeLog?.queryState?.parameters || context.lastQueryState?.parameters || {};

  return {
    userText: text,
    latencyMs,
    failure,
    stillLoading: messages.some((message) => message.text === loadingText),
    hasMedia: messages.some((message) => message.kind === 'image'),
    messages: messages.map(({ kind, text: messageText, choices }) => ({ kind, text: messageText, ...(choices ? { choices } : {}) })),
    answerText: textMessages.map((message) => message.text.trim()).join('\n\n'),
    route: {
      routeKind: routeLog?.routeKind || context.lastResponseRoute || null,
      commonRouteId: routeLog?.commonRouteId || null,
      canonicalRouteId: routeLog?.canonicalRouteId || null,
      contextRouteId: context.lastCommonRouteId || null,
      contextCanonicalRouteId: context.lastQueryState?.canonicalRouteId || null,
      executionFamily: routeLog?.executionFamily || context.lastResultFamily || null,
      followUpType: routeLog?.explicitFollowUpType || null,
      parameters
    },
    production: qualityLog ? { repairs: qualityLog.repairs, issues: qualityLog.issues, renderMode: qualityLog.renderMode } : null,
    errorLogs: logs.filter((entry) => entry.level === 'error').map((entry) => entry.message)
  };
}

// ---------------------------------------------------------------- date windows

function datePartsInZone(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthRange(year, month) {
  return { start: isoDate(new Date(Date.UTC(year, month - 1, 1))), end: isoDate(new Date(Date.UTC(year, month, 0))) };
}

function resolveWindowSpec(spec, timezone) {
  if (spec && typeof spec === 'object') {
    return { start: spec.start, end: spec.end };
  }

  const today = datePartsInZone(timezone);
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const shift = (days) => {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };
  const weekday = base.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;

  switch (spec) {
    case 'today': return { start: isoDate(base), end: isoDate(base) };
    case 'tomorrow': return { start: isoDate(shift(1)), end: isoDate(shift(1)) };
    case 'this_week': return { start: isoDate(shift(mondayOffset)), end: isoDate(shift(mondayOffset + 6)) };
    case 'next_week': return { start: isoDate(shift(mondayOffset + 7)), end: isoDate(shift(mondayOffset + 13)) };
    case 'this_month': return monthRange(today.year, today.month);
    case 'next_month': return today.month === 12 ? monthRange(today.year + 1, 1) : monthRange(today.year, today.month + 1);
    case 'this_year': return { start: `${today.year}-01-01`, end: `${today.year}-12-31` };
    default: throw new Error(`Unknown window spec ${spec}`);
  }
}

function resolveActualWindow(parameters, timezone) {
  if (parameters.rangeStart && parameters.rangeEnd) {
    return { start: parameters.rangeStart, end: parameters.rangeEnd };
  }
  const byTimeframe = {
    current_day: 'today',
    current_week: 'this_week',
    current_month: 'this_month',
    current_year: 'this_year'
  };
  if (byTimeframe[parameters.timeframe]) {
    return resolveWindowSpec(byTimeframe[parameters.timeframe], timezone);
  }
  if (parameters.month?.year && parameters.month?.month) {
    return monthRange(parameters.month.year, parameters.month.month);
  }
  if (parameters.timeframe === 'rolling_days' && parameters.durationDays) {
    const start = resolveWindowSpec('today', timezone).start;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + Number(parameters.durationDays) - 1);
    return { start, end: isoDate(end) };
  }
  return null;
}

// ---------------------------------------------------------------- scoring

function routeIdsOf(turn) {
  const { commonRouteId, canonicalRouteId, contextRouteId, contextCanonicalRouteId } = turn.route;
  return [...new Set([commonRouteId, canonicalRouteId, contextRouteId, contextCanonicalRouteId].filter(Boolean))];
}

function scoreCase(testCase, turns, session) {
  const expect = testCase.expect || {};
  const turn = turns[turns.length - 1];
  const checks = [];
  const check = (name, pass, detail = null, hard = true) => checks.push({ name, pass: Boolean(pass), hard, ...(detail === null ? {} : { detail }) });

  const errorTexts = ['errors.conversationUnavailable', 'errors.starsUnavailable', 'errors.noGroundedAnswer']
    .map((key) => locale.t(testCase.locale, key));
  const requireText = expect.requireText !== false;
  const answered = !turn.failure && !turn.stillLoading && (turn.answerText || (!requireText && turn.hasMedia));
  check('answered', answered, turn.failure || (turn.stillLoading ? 'loading message never replaced' : (turn.answerText ? null : 'no text answer')));
  check('no_error_reply', !errorTexts.some((text) => turn.answerText.includes(text)), null);

  if (expect.routes) {
    const actual = routeIdsOf(turn);
    check('route', actual.some((id) => expect.routes.includes(id)), { expected: expect.routes, actual });
  }

  if (expect.window) {
    const expected = resolveWindowSpec(expect.window, session.timezone);
    const actual = resolveActualWindow(turn.route.parameters, session.timezone);
    check('window', actual && actual.start === expected.start && actual.end === expected.end, { expected, actual });
  }

  if (expect.mentions) {
    const missing = findMissingMentions(turn.answerText, session.truth, expect.mentions);
    check('mentions', missing.length === 0, missing.length ? missing : null);
  }

  // Transit-routed answers talk about where planets are now, not natal placements.
  if (expect.natalClaims && !/^astrology_transits/.test(turn.route.routeKind || '')) {
    const contradictions = findNatalClaimContradictions(turn.answerText, session.truth);
    check('natal_claims', contradictions.length === 0, contradictions.length ? contradictions : null);
  }

  for (const pattern of expect.mustMatch || []) {
    check(`must_match ${pattern}`, toRegExp(pattern).test(turn.answerText));
  }
  for (const pattern of expect.mustNotMatch || []) {
    const match = turn.answerText.match(toRegExp(pattern));
    check(`must_not_match ${pattern}`, !match, match ? match[0] : null);
  }

  if (expect.behavior === 'decline') {
    const kind = turn.route.routeKind || '';
    check('declines', !/^astrology_/.test(kind) || !turn.route.executionFamily, { routeKind: kind || null, executionFamily: turn.route.executionFamily });
  }

  const validation = validateAnswerText(turn.answerText, {
    locale: testCase.locale,
    userText: turn.userText,
    hasMedia: turn.hasMedia,
    maxWords: expect.maxWords
  });
  const ignoredIssues = new Set(requireText ? [] : ['media_only_answer', 'empty_answer']);
  const issues = validation.issues.filter((issue) => !ignoredIssues.has(issue.code));
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity !== 'error');
  check('validator', errors.length === 0, errors.length ? errors : null);
  check('validator_warnings', warnings.length === 0, warnings.length ? warnings : null, false);

  const budget = expect.maxLatencyMs || LATENCY_BUDGET_MS[testCase.category] || 20000;
  check('latency', turn.latencyMs <= budget, { budgetMs: budget, latencyMs: turn.latencyMs }, false);
  check('no_production_repairs', !(turn.production?.repairs || []).length, turn.production?.repairs?.length ? turn.production.repairs : null, false);

  const hardFailures = checks.filter((item) => item.hard && !item.pass).map((item) => item.name);
  return {
    pass: hardFailures.length === 0,
    hardFailures,
    softFailures: checks.filter((item) => !item.hard && !item.pass).map((item) => item.name),
    checks,
    stats: validation.stats
  };
}

function toRegExp(pattern) {
  const flags = pattern.startsWith('(?i)') ? 'i' : '';
  return new RegExp(pattern.replace(/^\(\?i\)/, ''), flags);
}

// ---------------------------------------------------------------- LLM judge (opt-in)

function buildChartEvidence(natalProfile) {
  const planets = Object.values(natalProfile?.planetsById || {})
    .filter((planet, index, list) => list.findIndex((other) => other.id === planet.id) === index)
    .map((planet) => `${planet.name}: ${planet.sign_id} ${Number(planet.pos).toFixed(2)}°, house ${planet.house}${planet.retrograde ? ', retrograde' : ''}${planet.dignity ? `, ${planet.dignity}` : ''}`);
  const angles = Object.entries(natalProfile?.angles || {}).map(([name, angle]) => `${name.toUpperCase()}: ${angle.sign_id} ${Number(angle.pos).toFixed(2)}°`);
  const aspects = (natalProfile?.majorAspects || []).map((aspect) => `${aspect.p1} ${aspect.type} ${aspect.p2} (orb ${aspect.orb}°)`);
  const rawStelliums = natalProfile?.stelliums;
  const stelliums = (Array.isArray(rawStelliums) ? rawStelliums : Object.values(rawStelliums || {}))
    .map((stellium) => JSON.stringify(stellium).slice(0, 300));
  return ['Planets:', ...planets, 'Angles:', ...angles, 'Major aspects (tightest first):', ...aspects, 'Stelliums:', ...stelliums].join('\n');
}

async function judgeGroundedness(turn, session) {
  const systemInstruction = [
    'You audit an astrology chatbot answer against the computed natal chart below.',
    'Extract every factual natal-chart claim (planet/angle sign, house, aspect, retrograde, dignity, stellium, chart ruler).',
    'Ignore interpretation, advice and anything about current transits, progressions or dates.',
    'A claim is CONTRADICTED only when the chart data states something different (wrong sign, wrong house, wrong retrograde state, an aspect type that differs from the listed one).',
    'Claims the data cannot settle (chart patterns like T-squares or bucket shapes, dispositors, rulerships, aspects that are absent from the list, interpretations) are UNVERIFIABLE, not contradicted.',
    'Positions that match after rounding are correct.',
    'Return JSON only: {"claims": <number of natal claims>, "unverifiable": <number>, "contradicted": [{"claim": "...", "reason": "..."}]}.'
  ].join('\n');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await judgeOnce(turn, session, systemInstruction);
    // Gemma's per-minute token quota is small; honour Google's retry delay once instead of losing the verdict.
    const retryAfter = String(result.error || '').match(/retry in ([\d.]+)s/i);
    if (!retryAfter || attempt === 2) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(Number(retryAfter[1]) + 1, 65) * 1000));
  }
  return { error: 'unreachable' };
}

async function judgeOnce(turn, session, systemInstruction) {
  try {
    const prompt = `Chart:\n${buildChartEvidence(session.natalProfile)}\n\nQuestion: ${turn.userText}\n\nAnswer:\n${turn.answerText}\n\nReturn JSON now.`;
    const raw = await gemini.generatePlainText({
      systemInstruction,
      userText: prompt,
      history: [],
      model: process.env.GEMINI_JUDGE_MODEL || undefined
    });
    const json = String(raw || '').match(/\{[\s\S]*\}/);
    const parsed = json ? JSON.parse(json[0]) : null;
    if (!parsed || !Array.isArray(parsed.contradicted)) {
      return { error: 'unparseable judge output' };
    }
    return { claims: Number(parsed.claims) || 0, unverifiable: Number(parsed.unverifiable) || 0, contradicted: parsed.contradicted };
  } catch (error) {
    const message = String(error.message || error);
    const retry = message.match(/retry in [\d.]+s/i)?.[0];
    return { error: retry ? `${message.slice(0, 160)} (${retry})` : message.slice(0, 200) };
  }
}

// ---------------------------------------------------------------- reporting

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function rate(items) {
  return items.length ? items.filter((item) => item.pass).length / items.length : null;
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    (groups[item[key]] ||= []).push(item);
    return groups;
  }, {});
}

function summarize(results) {
  const checkNames = [...new Set(results.flatMap((result) => result.checks.map((item) => item.name.replace(/ .*/, ''))))];
  const checkRates = Object.fromEntries(checkNames.map((name) => {
    const items = results.flatMap((result) => result.checks.filter((item) => item.name.replace(/ .*/, '') === name));
    return [name, { pass: items.filter((item) => item.pass).length, total: items.length }];
  }));
  const countCodes = (selector) => results.flatMap(selector).reduce((counts, code) => {
    counts[code] = (counts[code] || 0) + 1;
    return counts;
  }, {});
  const latencyByCategory = Object.fromEntries(Object.entries(groupBy(results, 'category')).map(([category, items]) => {
    const latencies = items.map((item) => item.latencyMs);
    return [category, { p50: percentile(latencies, 50), p90: percentile(latencies, 90), max: Math.max(...latencies) }];
  }));
  const judged = results.filter((result) => result.judge && !result.judge.error);

  return {
    cases: results.length,
    passed: results.filter((result) => result.pass).length,
    passRate: rate(results),
    byCategory: Object.fromEntries(Object.entries(groupBy(results, 'category')).map(([name, items]) => [name, { pass: items.filter((item) => item.pass).length, total: items.length }])),
    byLocale: Object.fromEntries(Object.entries(groupBy(results, 'locale')).map(([name, items]) => [name, { pass: items.filter((item) => item.pass).length, total: items.length }])),
    checks: checkRates,
    validatorIssues: countCodes((result) => [
      ...(result.checks.find((item) => item.name === 'validator')?.detail || []),
      ...(result.checks.find((item) => item.name === 'validator_warnings')?.detail || [])
    ].map((issue) => issue.code)),
    productionRepairs: countCodes((result) => result.productionRepairs || []),
    latency: {
      p50: percentile(results.map((result) => result.latencyMs), 50),
      p90: percentile(results.map((result) => result.latencyMs), 90),
      byCategory: latencyByCategory
    },
    judge: judged.length ? {
      judged: judged.length,
      errors: results.filter((result) => result.judge?.error).length,
      claims: judged.reduce((sum, result) => sum + result.judge.claims, 0),
      unverifiable: judged.reduce((sum, result) => sum + result.judge.unverifiable, 0),
      contradicted: judged.reduce((sum, result) => sum + result.judge.contradicted.length, 0),
      answersWithContradictions: judged.filter((result) => result.judge.contradicted.length > 0).map((result) => result.id)
    } : null
  };
}

function compareWithBaseline(results, baseline) {
  const previous = baseline?.cases || {};
  const regressions = results.filter((result) => previous[result.id]?.pass && !result.pass).map((result) => result.id);
  const fixed = results.filter((result) => previous[result.id] && !previous[result.id].pass && result.pass).map((result) => result.id);
  return { baselineRunAt: baseline?.runAt || null, baselinePassRate: baseline?.summary?.passRate ?? null, regressions, fixed };
}

function formatRatio({ pass, total }) {
  return `${pass}/${total}`;
}

function printSummary(summary, results, comparison) {
  const pct = (value) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
  print('');
  print(`Answer eval: ${summary.passed}/${summary.cases} passed (${pct(summary.passRate)})`);
  print(`  by category: ${Object.entries(summary.byCategory).map(([name, value]) => `${name} ${formatRatio(value)}`).join(', ')}`);
  print(`  by locale:   ${Object.entries(summary.byLocale).map(([name, value]) => `${name} ${formatRatio(value)}`).join(', ')}`);
  print(`  checks:      ${Object.entries(summary.checks).map(([name, value]) => `${name} ${formatRatio(value)}`).join(', ')}`);
  print(`  latency:     p50 ${summary.latency.p50}ms, p90 ${summary.latency.p90}ms`);
  if (Object.keys(summary.validatorIssues).length) {
    print(`  validator:   ${Object.entries(summary.validatorIssues).map(([code, count]) => `${code} ×${count}`).join(', ')}`);
  }
  if (Object.keys(summary.productionRepairs).length) {
    print(`  repairs:     ${Object.entries(summary.productionRepairs).map(([code, count]) => `${code} ×${count}`).join(', ')}`);
  }
  if (summary.judge) {
    print(`  judge:       ${summary.judge.contradicted} contradicted, ${summary.judge.unverifiable} unverifiable of ${summary.judge.claims} natal claims in ${summary.judge.judged} answers${summary.judge.errors ? ` (${summary.judge.errors} judge errors)` : ''}`);
    if (summary.judge.answersWithContradictions.length) {
      print(`               contradictions in: ${summary.judge.answersWithContradictions.join(', ')}`);
    }
  }
  if (comparison) {
    print(`  vs baseline: ${comparison.regressions.length} regressions${comparison.regressions.length ? ` (${comparison.regressions.join(', ')})` : ''}, ${comparison.fixed.length} fixed`);
  }

  const failures = results.filter((result) => !result.pass);
  if (failures.length) {
    print('\nFailures:');
    for (const result of failures) {
      print(`  ✗ ${result.id} [${result.hardFailures.join(', ')}]`);
    }
  }
}

function buildMarkdownReport(report) {
  const { summary } = report;
  const lines = [
    `# Answer eval — ${report.runAt}`,
    '',
    `**${summary.passed}/${summary.cases} passed (${Math.round(summary.passRate * 100)}%)** · follow-ups ${report.config.followUpsEnabled ? 'on' : 'off'} · model ${report.config.model}`,
    '',
    '| Case | Locale | Result | Failed checks | Latency |',
    '| --- | --- | --- | --- | --- |',
    ...report.results.map((result) => `| ${result.id} | ${result.locale} | ${result.pass ? 'pass' : 'FAIL'} | ${[...result.hardFailures, ...result.softFailures.map((name) => `(${name})`)].join(', ')} | ${result.latencyMs}ms |`),
    '',
    '## Failed answers',
    ''
  ];
  for (const result of report.results.filter((item) => !item.pass)) {
    lines.push(`### ${result.id}`, '', ...result.turns.map((turn) => `> **Q:** ${turn.userText}`), '');
    for (const item of result.checks.filter((checkItem) => !checkItem.pass && checkItem.hard)) {
      lines.push(`- **${item.name}**: \`${JSON.stringify(item.detail ?? null)}\``);
    }
    lines.push('', '```', result.answerText.slice(0, 1500) || '(no text)', '```', '');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- main

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async (_unused, workerIndex) => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], workerIndex);
    }
  }));
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.FREEASTRO_API_KEY || !process.env.GEMINI_API_KEY) {
    throw new Error('FREEASTRO_API_KEY and GEMINI_API_KEY are required for the answer eval.');
  }

  const cases = loadCases(args);
  if (cases.length === 0) {
    throw new Error('No eval cases matched the filters.');
  }

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const route = createIncomingEventRouter(createLegacyControllerHandlers());
  const pool = createSessionPool(route, fixture);
  const runAt = new Date().toISOString();
  print(`Running ${cases.length} eval cases (concurrency ${args.concurrency}${args.judge ? ', judge on' : ''})...`);

  const results = await runPool(cases, args.concurrency, async (testCase, workerIndex) => {
    let session;
    try {
      session = await pool.acquire(workerIndex, testCase.locale);
    } catch (error) {
      print(`  ✗ ${testCase.id} — setup failed: ${error.message}`);
      return {
        id: testCase.id,
        locale: testCase.locale,
        category: testCase.category,
        pass: false,
        hardFailures: ['setup'],
        softFailures: [],
        checks: [{ name: 'setup', pass: false, hard: true, detail: error.message }],
        stats: {},
        latencyMs: 0,
        answerText: '',
        productionRepairs: [],
        judge: null,
        turns: []
      };
    }
    const turns = [];
    for (const text of testCase.turns) {
      turns.push(await runTurn(pool, session, text));
    }
    const score = scoreCase(testCase, turns, session);
    const lastTurn = turns[turns.length - 1];
    const judge = args.judge && testCase.expect?.natalClaims && lastTurn.answerText
      ? await judgeGroundedness(lastTurn, session)
      : null;
    const result = {
      id: testCase.id,
      locale: testCase.locale,
      category: testCase.category,
      ...score,
      latencyMs: lastTurn.latencyMs,
      answerText: lastTurn.answerText,
      productionRepairs: lastTurn.production?.repairs || [],
      judge,
      turns
    };
    print(`  ${result.pass ? '✓' : '✗'} ${testCase.id} (${result.latencyMs}ms)${result.pass ? '' : ` — ${result.hardFailures.join(', ')}`}`);
    return result;
  });

  const summary = summarize(results);
  const baselinePath = args.baseline || (fs.existsSync(BASELINE_PATH) ? BASELINE_PATH : null);
  const comparison = baselinePath ? compareWithBaseline(results, JSON.parse(fs.readFileSync(baselinePath, 'utf8'))) : null;
  const report = {
    runAt,
    config: {
      cases: args.casesPath || DEFAULT_CASES_PATH,
      fixture,
      followUpsEnabled: process.env.CONVERSATION_FOLLOW_UPS_ENABLED === 'true',
      model: process.env.GEMINI_MODEL || 'gemma-4-31b-it',
      judge: args.judge
    },
    summary,
    comparison,
    results
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = runAt.replace(/[:.]/g, '-');
  const outPath = args.out || path.join(REPORT_DIR, `answers-${stamp}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'answers-latest.md'), buildMarkdownReport(report));

  if (args.saveBaseline) {
    const baseline = {
      runAt,
      summary,
      cases: Object.fromEntries(results.map((result) => [result.id, { pass: result.pass, hardFailures: result.hardFailures }]))
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  }

  printSummary(summary, results, comparison);
  print(`\nReport: ${path.relative(REPO_ROOT, outPath)} (readable summary: var/eval/answers-latest.md)`);
  if (args.saveBaseline) {
    print(`Baseline saved: ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
  }

  if (Number.isFinite(args.failUnder) && summary.passRate < args.failUnder) {
    process.exitCode = 1;
  }
  // Background prewarm tasks keep handles open; the run is complete.
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
