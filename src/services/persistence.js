const { getSupabaseClient, isSupabaseConfigured } = require('./supabase');
const { info, reportError, warn } = require('./logger');
const {
  getChatStateSnapshot,
  replaceChatState,
  resolveIdentity,
  resolveStateKey,
  setPersistenceHook: setChatStatePersistenceHook
} = require('../state/chatState');
const {
  getSessionSnapshot,
  replaceSession,
  setPersistenceHook: setSessionPersistenceHook
} = require('./natalFlow');

class ConversationPersistence {
  constructor() {
    this.tableName = 'bot_conversations';
    this.pendingWrites = new Map();
    this.hydratedKeys = new Set();
    this.hydrating = new Map();
  }

  isEnabled() {
    return isSupabaseConfigured();
  }

  initialize() {
    setChatStatePersistenceHook((identity) => this.schedulePersist(identity));
    setSessionPersistenceHook((identity) => this.schedulePersist(identity));

    if (this.isEnabled()) {
      info('conversation persistence enabled', { table: this.tableName });
    } else {
      warn('conversation persistence disabled', { reason: 'missing Supabase configuration' });
    }
  }

  async ensureHydrated(identity) {
    if (!this.isEnabled()) {
      return;
    }

    const key = resolveStateKey(identity);
    if (this.hydratedKeys.has(key)) {
      return;
    }

    if (this.hydrating.has(key)) {
      await this.hydrating.get(key);
      return;
    }

    const task = this.loadConversation(identity)
      .catch((error) => reportError('persistence.hydrate', error, { stateKey: key }))
      .finally(() => {
        this.hydrating.delete(key);
        this.hydratedKeys.add(key);
      });

    this.hydrating.set(key, task);
    await task;
  }

  schedulePersist(identity) {
    if (!this.isEnabled()) {
      return;
    }

    const key = resolveStateKey(identity);

    if (this.pendingWrites.has(key)) {
      clearTimeout(this.pendingWrites.get(key));
    }

    const timer = setTimeout(() => {
      this.pendingWrites.delete(key);
      this.persistConversation(identity).catch((error) => {
        reportError('persistence.persist', error, { stateKey: key });
      });
    }, 150);

    this.pendingWrites.set(key, timer);
  }

  async persistConversation(identity) {
    const client = getSupabaseClient();
    if (!client) {
      return;
    }

    const normalized = resolveIdentity(identity);
    const stateKey = resolveStateKey(identity);
    const state = getChatStateSnapshot(identity);
    const session = getSessionSnapshot(identity);

    const { error } = await client
      .from(this.tableName)
      .upsert({
        state_key: stateKey,
        channel: normalized.channel,
        user_id: normalized.userId,
        chat_id: normalized.chatId,
        state,
        session,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'state_key'
      });

    if (error) {
      throw error;
    }
  }

  async loadConversation(identity) {
    const client = getSupabaseClient();
    if (!client) {
      return;
    }

    const stateKey = resolveStateKey(identity);
    const { data, error } = await client
      .from(this.tableName)
      .select('state, session')
      .eq('state_key', stateKey)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return;
    }

    if (data.state) {
      replaceChatState(identity, data.state);
    }

    replaceSession(identity, data.session || null);
  }
}

module.exports = new ConversationPersistence();
