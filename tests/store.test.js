// Grok Replica — tests for the conversation store.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STORAGE_KEY, DEFAULT_MODEL,
  emptyState, createConversation, getConversation, getActive, setActive,
  addMessage, renameConversation, deleteConversation,
  searchConversations, sortConversations, titleFromText,
  loadState, saveState, clearState,
} from '../src/store.js';

function memoryStorage(seed = null) {
  const map = new Map(seed ? [[STORAGE_KEY, seed]] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('titleFromText', () => {
  it('uses the first line, capped at 48 chars', () => {
    assert.equal(titleFromText('Hello there'), 'Hello there');
    assert.equal(titleFromText(''), 'New chat');
    assert.equal(titleFromText('   '), 'New chat');
    const long = 'a'.repeat(60);
    assert.equal(titleFromText(long), `${'a'.repeat(47)}…`);
    assert.equal(titleFromText('First line\nSecond line'), 'First line');
  });
});

describe('conversations', () => {
  it('creates a conversation and makes it active', () => {
    const state = emptyState();
    const conv = createConversation(state, 'Explain recursion');
    assert.equal(state.activeId, conv.id);
    assert.equal(conv.title, 'Explain recursion');
    assert.equal(state.conversations.length, 1);
  });

  it('adds messages and retitles on the first user message', () => {
    const state = emptyState();
    const conv = createConversation(state);
    assert.equal(conv.title, 'New chat');
    addMessage(state, conv.id, 'user', 'What is TCP?');
    assert.equal(conv.title, 'What is TCP?');
    addMessage(state, conv.id, 'assistant', 'TCP is…');
    addMessage(state, conv.id, 'user', 'And UDP?');
    assert.equal(conv.title, 'What is TCP?', 'title stays from the first question');
    assert.equal(conv.messages.length, 3);
  });

  it('returns null when adding to a missing conversation', () => {
    const state = emptyState();
    assert.equal(addMessage(state, 'nope', 'user', 'hi'), null);
  });

  it('renames only with a non-empty title', () => {
    const state = emptyState();
    const conv = createConversation(state, 'Old name');
    assert.equal(renameConversation(state, conv.id, '  New name  '), true);
    assert.equal(conv.title, 'New name');
    assert.equal(renameConversation(state, conv.id, '   '), false);
    assert.equal(conv.title, 'New name');
    assert.equal(renameConversation(state, 'nope', 'X'), false);
  });

  it('deletes and moves the active pointer to the next conversation', () => {
    const state = emptyState();
    const a = createConversation(state, 'A');
    const b = createConversation(state, 'B');
    assert.equal(state.activeId, b.id);
    assert.equal(deleteConversation(state, b.id), true);
    assert.equal(state.activeId, a.id);
    assert.equal(deleteConversation(state, 'nope'), false);
  });

  it('deleting the last conversation clears the active id', () => {
    const state = emptyState();
    const a = createConversation(state, 'A');
    deleteConversation(state, a.id);
    assert.equal(state.activeId, null);
    assert.equal(state.conversations.length, 0);
  });

  it('setActive ignores unknown ids', () => {
    const state = emptyState();
    const a = createConversation(state, 'A');
    setActive(state, 'nope');
    assert.equal(state.activeId, a.id);
  });

  it('sorts by most recently updated first', () => {
    const state = emptyState();
    const a = createConversation(state, 'A');
    const b = createConversation(state, 'B');
    a.updatedAt = 100;
    b.updatedAt = 200;
    assert.deepEqual(sortConversations(state).map((c) => c.id), [b.id, a.id]);
  });

  it('searches titles and message text, case-insensitive', () => {
    const state = emptyState();
    const a = createConversation(state, 'Recursion help');
    const b = createConversation(state, 'Cooking tips');
    addMessage(state, b.id, 'user', 'How do I boil an egg?');
    assert.deepEqual(searchConversations(state, 'recursion').map((c) => c.id), [a.id]);
    assert.deepEqual(searchConversations(state, 'EGG').map((c) => c.id), [b.id]);
    assert.deepEqual(searchConversations(state, 'zzz'), []);
    assert.equal(searchConversations(state, '').length, 2);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const state = emptyState();
    const conv = createConversation(state, 'Hello');
    addMessage(state, conv.id, 'user', 'Hello');
    state.settings.apiKey = 'AIza-test';
    state.settings.model = 'gemini-2.0-flash';
    assert.equal(saveState(storage, state), true);
    const loaded = loadState(storage);
    assert.equal(loaded.settings.apiKey, 'AIza-test');
    assert.equal(loaded.settings.model, 'gemini-2.0-flash');
    assert.equal(loaded.conversations.length, 1);
    assert.equal(loaded.conversations[0].messages[0].text, 'Hello');
    assert.equal(loaded.activeId, conv.id);
  });

  it('returns a fresh state for empty or corrupt storage', () => {
    assert.deepEqual(loadState(memoryStorage()), emptyState());
    assert.deepEqual(loadState(memoryStorage('not json{')), emptyState());
    assert.deepEqual(loadState(memoryStorage(JSON.stringify({ version: 99 }))), emptyState());
  });

  it('falls back to the default model for unknown model names', () => {
    const raw = JSON.stringify({
      version: 1,
      settings: { apiKey: '', model: 'gemini-9.9-ultra', theme: 'dark' },
      conversations: [],
      activeId: null,
    });
    const loaded = loadState(memoryStorage(raw));
    assert.equal(loaded.settings.model, DEFAULT_MODEL);
  });

  it('defaults to the latest Flash model', () => {
    assert.equal(DEFAULT_MODEL, 'gemini-3.8-flash');
    assert.equal(emptyState().settings.model, DEFAULT_MODEL);
  });

  it('clears storage and returns a fresh state', () => {
    const storage = memoryStorage();
    const state = emptyState();
    createConversation(state, 'Hello');
    saveState(storage, state);
    const cleared = clearState(storage);
    assert.equal(storage.getItem(STORAGE_KEY), null);
    assert.deepEqual(cleared, emptyState());
  });
});
