const { getSupabaseClient, isSupabaseConfigured } = require('./supabase');
const { info, reportError, warn } = require('./logger');

class EventQueue {
  constructor() {
    this.tableName = 'bot_event_queue';
    this.handlers = new Map();
    this.interval = null;
    this.processing = false;
    this.pollIntervalMs = 1000;
    this.batchSize = 10;
    this.maxAttempts = 8;
  }

  isEnabled() {
    return isSupabaseConfigured();
  }

  registerHandler(eventType, handler) {
    this.handlers.set(eventType, handler);
  }

  start() {
    if (!this.isEnabled()) {
      warn('event queue disabled', { reason: 'missing Supabase configuration' });
      return;
    }

    if (this.interval) {
      return;
    }

    info('event queue enabled', { table: this.tableName });
    this.interval = setInterval(() => {
      this.tick().catch((error) => {
        reportError('event-queue.tick', error);
      });
    }, this.pollIntervalMs);

    this.tick().catch((error) => {
      reportError('event-queue.start', error);
    });
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async enqueue(event) {
    if (!this.isEnabled()) {
      return { queued: false, duplicate: false };
    }

    const client = getSupabaseClient();
    const { error } = await client
      .from(this.tableName)
      .insert({
        event_key: event.eventKey,
        channel: event.channel,
        event_type: event.eventType,
        payload: event.payload,
        status: 'pending',
        attempts: 0,
        error: null,
        available_at: new Date().toISOString()
      });

    if (error) {
      if (error.code === '23505') {
        return { queued: false, duplicate: true };
      }

      throw error;
    }

    return { queued: true, duplicate: false };
  }

  async tick() {
    if (this.processing || !this.isEnabled()) {
      return;
    }

    this.processing = true;

    try {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const { data, error } = await client
        .from(this.tableName)
        .select('*')
        .in('status', ['pending', 'failed'])
        .lte('available_at', now)
        .order('created_at', { ascending: true })
        .limit(this.batchSize);

      if (error) {
        throw error;
      }

      for (const event of data || []) {
        await this.processEvent(event);
      }
    } finally {
      this.processing = false;
    }
  }

  async processEvent(event) {
    const client = getSupabaseClient();
    const handler = this.handlers.get(event.event_type);

    if (!handler) {
      await this.markProcessed(event.event_key);
      return;
    }

    const nextAttempt = Number(event.attempts || 0) + 1;
    const claim = await client
      .from(this.tableName)
      .update({
        status: 'processing',
        attempts: nextAttempt,
        updated_at: new Date().toISOString()
      })
      .eq('event_key', event.event_key)
      .in('status', ['pending', 'failed'])
      .select('event_key')
      .maybeSingle();

    if (claim.error) {
      throw claim.error;
    }

    if (!claim.data) {
      return;
    }

    try {
      await handler(event.payload);
      await this.markProcessed(event.event_key);
    } catch (error) {
      const delaySeconds = Math.min(300, 2 ** Math.min(nextAttempt, 8));
      const terminal = nextAttempt >= this.maxAttempts;

      const { error: updateError } = await client
        .from(this.tableName)
        .update({
          status: terminal ? 'dead' : 'failed',
          error: error.message || String(error),
          available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('event_key', event.event_key);

      if (updateError) {
        throw updateError;
      }

      await reportError('event-queue.handler', error, {
        eventKey: event.event_key,
        eventType: event.event_type,
        terminal
      });
    }
  }

  async markProcessed(eventKey) {
    const client = getSupabaseClient();
    const { error } = await client
      .from(this.tableName)
      .update({
        status: 'processed',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null
      })
      .eq('event_key', eventKey);

    if (error) {
      throw error;
    }
  }
}

module.exports = new EventQueue();
