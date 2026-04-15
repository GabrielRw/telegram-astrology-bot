const Stripe = require('stripe');
const { getSupabaseClient, isSupabaseConfigured } = require('./supabase');
const { info, warn } = require('./logger');
const { resolveIdentity, resolveStateKey } = require('../state/chatState');

const BILLING_TABLE = 'bot_billing_profiles';
const DAILY_USAGE_TABLE = 'bot_daily_usage';
const FREE_QUESTIONS_PER_DAY = 3;
const MONTHLY_PRICE_USD = '$4';
const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const memoryProfiles = new Map();
const memoryUsage = new Map();

let stripeClient = null;

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv('STRIPE_SECRET_KEY'), {
      apiVersion: '2026-02-25.clover'
    });
  }

  return stripeClient;
}

function getAppBaseUrl() {
  return String(process.env.APP_BASE_URL || process.env.WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '');
}

function getStripeWebhookPath() {
  return process.env.STRIPE_WEBHOOK_PATH || '/stripe/webhook';
}

function getStripePriceId() {
  return getRequiredEnv('STRIPE_MONTHLY_PRICE_ID');
}

function getStateKey(identity) {
  return String(identity?.stateKey || '').trim() || resolveStateKey(identity);
}

function isStripeConfigured() {
  return Boolean(
    String(process.env.STRIPE_SECRET_KEY || '').trim() &&
    String(process.env.STRIPE_MONTHLY_PRICE_ID || '').trim() &&
    getAppBaseUrl()
  );
}

function isStripeWebhookConfigured() {
  return isStripeConfigured() && Boolean(String(process.env.STRIPE_WEBHOOK_SECRET || '').trim());
}

function normalizeDateKey(input = new Date()) {
  if (typeof input === 'string') {
    return input.slice(0, 10);
  }

  return input.toISOString().slice(0, 10);
}

function getUsageMapKey(stateKey, dateKey) {
  return `${stateKey}:${dateKey}`;
}

function normalizeBillingProfile(identity, profile = {}) {
  const normalized = resolveIdentity(identity);
  const stateKey = getStateKey(identity);

  return {
    state_key: stateKey,
    channel: normalized.channel,
    user_id: normalized.userId,
    chat_id: normalized.chatId,
    stripe_customer_id: profile.stripe_customer_id || null,
    stripe_subscription_id: profile.stripe_subscription_id || null,
    stripe_price_id: profile.stripe_price_id || null,
    stripe_checkout_session_id: profile.stripe_checkout_session_id || null,
    subscription_status: profile.subscription_status || 'free',
    cancel_at_period_end: Boolean(profile.cancel_at_period_end),
    current_period_end: profile.current_period_end || null,
    created_at: profile.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function normalizeUsageRow(identity, dateKey, row = {}) {
  const normalized = resolveIdentity(identity);
  const stateKey = getStateKey(identity);

  return {
    state_key: stateKey,
    channel: normalized.channel,
    user_id: normalized.userId,
    chat_id: normalized.chatId,
    question_date: dateKey,
    question_count: Number(row.question_count || 0),
    created_at: row.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function getBillingProfile(identity) {
  const stateKey = getStateKey(identity);

  if (!isSupabaseConfigured()) {
    return normalizeBillingProfile(identity, memoryProfiles.get(stateKey) || {});
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(BILLING_TABLE)
    .select('*')
    .eq('state_key', stateKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeBillingProfile(identity, data || {});
}

async function getBillingProfileByCustomerId(customerId) {
  if (!customerId) {
    return null;
  }

  if (!isSupabaseConfigured()) {
    for (const profile of memoryProfiles.values()) {
      if (profile.stripe_customer_id === customerId) {
        return profile;
      }
    }

    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(BILLING_TABLE)
    .select('*')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function upsertBillingProfile(identity, patch = {}) {
  const current = await getBillingProfile(identity);
  const next = {
    ...current,
    ...patch
  };
  const normalized = normalizeBillingProfile(identity, next);

  if (!isSupabaseConfigured()) {
    memoryProfiles.set(normalized.state_key, normalized);
    return normalized;
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from(BILLING_TABLE)
    .upsert(normalized, { onConflict: 'state_key' });

  if (error) {
    throw error;
  }

  return normalized;
}

async function getUsageCount(identity, dateKey = normalizeDateKey()) {
  const stateKey = getStateKey(identity);

  if (!isSupabaseConfigured()) {
    return Number(memoryUsage.get(getUsageMapKey(stateKey, dateKey)) || 0);
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(DAILY_USAGE_TABLE)
    .select('question_count')
    .eq('state_key', stateKey)
    .eq('question_date', dateKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Number(data?.question_count || 0);
}

async function incrementUsage(identity, dateKey = normalizeDateKey()) {
  const stateKey = getStateKey(identity);
  const nextCount = (await getUsageCount(identity, dateKey)) + 1;

  if (!isSupabaseConfigured()) {
    memoryUsage.set(getUsageMapKey(stateKey, dateKey), nextCount);
    return nextCount;
  }

  const row = normalizeUsageRow(identity, dateKey, { question_count: nextCount });
  const client = getSupabaseClient();
  const { error } = await client
    .from(DAILY_USAGE_TABLE)
    .upsert(row, { onConflict: 'state_key,question_date' });

  if (error) {
    throw error;
  }

  return nextCount;
}

function hasUnlimitedAccess(profile) {
  return ACTIVE_STATUSES.has(String(profile?.subscription_status || '').toLowerCase());
}

async function getAccessSummary(identity) {
  const [profile, usedToday] = await Promise.all([
    getBillingProfile(identity),
    getUsageCount(identity)
  ]);
  const unlimited = hasUnlimitedAccess(profile);
  const remainingFreeQuestions = unlimited
    ? null
    : Math.max(0, FREE_QUESTIONS_PER_DAY - usedToday);

  return {
    profile,
    usedToday,
    remainingFreeQuestions,
    unlimited,
    limitReached: !unlimited && usedToday >= FREE_QUESTIONS_PER_DAY
  };
}

async function recordAnsweredQuestion(identity) {
  const access = await getAccessSummary(identity);

  if (access.unlimited) {
    return {
      ...access,
      usedToday: access.usedToday,
      remainingFreeQuestions: null
    };
  }

  const usedToday = await incrementUsage(identity);

  return {
    ...access,
    usedToday,
    remainingFreeQuestions: Math.max(0, FREE_QUESTIONS_PER_DAY - usedToday),
    limitReached: usedToday >= FREE_QUESTIONS_PER_DAY
  };
}

async function ensureCustomer(identity) {
  const profile = await getBillingProfile(identity);

  if (profile.stripe_customer_id) {
    return profile;
  }

  const stripe = getStripeClient();
  const normalized = resolveIdentity(identity);
  const stateKey = getStateKey(identity);
  const customer = await stripe.customers.create({
    metadata: {
      state_key: stateKey,
      channel: normalized.channel,
      user_id: normalized.userId || '',
      chat_id: normalized.chatId || ''
    }
  });

  return upsertBillingProfile(identity, {
    stripe_customer_id: customer.id
  });
}

function buildBillingPageUrl(pathname) {
  return `${getAppBaseUrl()}${pathname}`;
}

async function createCheckoutSessionUrl(identity) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe checkout is not configured.');
  }

  const profile = await ensureCustomer(identity);
  const stripe = getStripeClient();
  const normalized = resolveIdentity(identity);
  const stateKey = getStateKey(identity);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: profile.stripe_customer_id,
    client_reference_id: stateKey,
    line_items: [
      {
        price: getStripePriceId(),
        quantity: 1
      }
    ],
    metadata: {
      state_key: stateKey,
      channel: normalized.channel,
      user_id: normalized.userId || '',
      chat_id: normalized.chatId || ''
    },
    subscription_data: {
      metadata: {
        state_key: stateKey,
        channel: normalized.channel,
        user_id: normalized.userId || '',
        chat_id: normalized.chatId || ''
      }
    },
    allow_promotion_codes: true,
    success_url: `${buildBillingPageUrl('/billing/success')}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: buildBillingPageUrl('/billing/cancel')
  });

  await upsertBillingProfile(identity, {
    stripe_customer_id: profile.stripe_customer_id,
    stripe_checkout_session_id: session.id
  });

  return session.url;
}

async function createCustomerPortalUrl(identity) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe billing portal is not configured.');
  }

  const profile = await getBillingProfile(identity);

  if (!profile.stripe_customer_id) {
    throw new Error('No Stripe customer exists for this user yet.');
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: buildBillingPageUrl('/billing/return')
  });

  return session.url;
}

function normalizeSubscriptionPatch(subscription, extra = {}) {
  const subscriptionId = typeof subscription?.id === 'string' ? subscription.id : null;
  const customerId = typeof subscription?.customer === 'string'
    ? subscription.customer
    : subscription?.customer?.id || null;
  const priceId = subscription?.items?.data?.[0]?.price?.id || null;
  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  return {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_price_id: priceId,
    subscription_status: subscription?.status || 'free',
    cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    current_period_end: currentPeriodEnd,
    ...extra
  };
}

async function upsertWebhookProfileFromMetadata(metadata = {}, patch = {}) {
  const stateKey = String(metadata.state_key || '').trim();

  if (!stateKey) {
    return null;
  }

  const identity = {
    stateKey,
    channel: metadata.channel || 'telegram',
    userId: metadata.user_id || null,
    chatId: metadata.chat_id || null
  };

  return upsertBillingProfile(identity, patch);
}

async function handleCheckoutCompleted(session) {
  if (session?.mode !== 'subscription') {
    return;
  }

  const metadata = session.metadata || {};
  const stateKey = String(session.client_reference_id || metadata.state_key || '').trim();

  if (!stateKey) {
    return;
  }

  await upsertWebhookProfileFromMetadata(
    {
      ...metadata,
      state_key: stateKey
    },
    {
      stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
      stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null,
      stripe_checkout_session_id: session.id
    }
  );
}

async function handleSubscriptionUpdated(subscription) {
  const customerId = typeof subscription?.customer === 'string'
    ? subscription.customer
    : subscription?.customer?.id || null;
  const existingProfile = await getBillingProfileByCustomerId(customerId);
  const patch = normalizeSubscriptionPatch(subscription);

  if (existingProfile?.state_key) {
    const identity = {
      channel: existingProfile.channel || 'telegram',
      userId: existingProfile.user_id || null,
      chatId: existingProfile.chat_id || null
    };

    await upsertBillingProfile(identity, patch);
    return;
  }

  await upsertWebhookProfileFromMetadata(subscription.metadata || {}, patch);
}

async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    getRequiredEnv('STRIPE_WEBHOOK_SECRET')
  );

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionUpdated(event.data.object);
      break;
    default:
      break;
  }

  return event;
}

function getBillingStatusLabel(access, localeT) {
  if (access.unlimited) {
    if (access.profile.cancel_at_period_end && access.profile.current_period_end) {
      return localeT('billing.statusActiveUntil', { date: access.profile.current_period_end.slice(0, 10) });
    }

    return localeT('billing.statusActive');
  }

  return localeT('billing.statusFree', {
    used: access.usedToday,
    limit: FREE_QUESTIONS_PER_DAY
  });
}

function getUpgradePitch(localeT) {
  return localeT('billing.upgradePitch', {
    price: MONTHLY_PRICE_USD
  });
}

function initialize() {
  if (!isSupabaseConfigured()) {
    warn('billing persistence using in-memory fallback', { reason: 'missing Supabase configuration' });
  }

  if (isStripeConfigured()) {
    info('stripe billing enabled', {
      webhookPath: getStripeWebhookPath()
    });
  } else {
    warn('stripe billing disabled', {
      reason: 'missing Stripe configuration'
    });
  }
}

module.exports = {
  FREE_QUESTIONS_PER_DAY,
  getAccessSummary,
  getBillingPageUrl: buildBillingPageUrl,
  getBillingStatusLabel,
  getStripeWebhookPath,
  getUpgradePitch,
  handleStripeWebhook,
  initialize,
  isStripeConfigured,
  isStripeWebhookConfigured,
  recordAnsweredQuestion,
  createCheckoutSessionUrl,
  createCustomerPortalUrl
};
