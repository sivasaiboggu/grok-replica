// Grok Replica — conversation store.
// Pure state + a tiny storage adapter, so the logic is testable without
// a browser. All persistence is localStorage; nothing leaves the machine.
// Shape:
//   { version: 1,
//     settings: { apiKey, model, theme },
//     conversations: [ { id, title, createdAt, updatedAt,
//                        messages: [ { role: 'user'|'assistant', text,
//                                      usage: {prompt, candidates, total} | null,
//                                      error: string | null, ts } ] } ],
//     activeId: string | null }

export const STORAGE_KEY = 'grok-replica:v1';
export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyState() {
  return {
    version: 1,
    settings: { apiKey: '', model: DEFAULT_MODEL, theme: 'dark' },
    conversations: [],
    activeId: null,
  };
}

export function newConversation(firstText = '') {
  const now = Date.now();
  return {
    id: newId(),
    title: titleFromText(firstText),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

// First line of the first user message, capped at 48 chars.
export function titleFromText(text) {
  const line = String(text || '').split('\n')[0].trim();
  if (!line) return 'New chat';
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

export function createConversation(state, firstText = '') {
  const conv = newConversation(firstText);
  state.conversations.unshift(conv);
  state.activeId = conv.id;
  return conv;
}

export function getConversation(state, id) {
  return state.conversations.find((c) => c.id === id) || null;
}

export function getActive(state) {
  return state.activeId ? getConversation(state, state.activeId) : null;
}

export function setActive(state, id) {
  if (getConversation(state, id)) state.activeId = id;
  return getActive(state);
}

export function addMessage(state, convId, role, text, extra = {}) {
  const conv = getConversation(state, convId);
  if (!conv) return null;
  const msg = {
    role,
    text: String(text ?? ''),
    usage: extra.usage ?? null,
    error: extra.error ?? null,
    ts: Date.now(),
  };
  conv.messages.push(msg);
  conv.updatedAt = Date.now();
  if (role === 'user' && conv.messages.filter((m) => m.role === 'user').length === 1) {
    conv.title = titleFromText(text);
  }
  return msg;
}

export function renameConversation(state, convId, title) {
  const conv = getConversation(state, convId);
  if (!conv) return false;
  const clean = String(title || '').trim().slice(0, 120);
  if (!clean) return false;
  conv.title = clean;
  conv.updatedAt = Date.now();
  return true;
}

export function deleteConversation(state, convId) {
  const idx = state.conversations.findIndex((c) => c.id === convId);
  if (idx === -1) return false;
  state.conversations.splice(idx, 1);
  if (state.activeId === convId) {
    state.activeId = state.conversations[0] ? state.conversations[0].id : null;
  }
  return true;
}

export function searchConversations(state, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...state.conversations];
  return state.conversations.filter((c) =>
    c.title.toLowerCase().includes(q) ||
    c.messages.some((m) => m.text.toLowerCase().includes(q)));
}

export function sortConversations(state) {
  return [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

// Storage adapter: any object with getItem/setItem/removeItem.
export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return emptyState();
    const state = emptyState();
    state.settings = { ...state.settings, ...(parsed.settings || {}) };
    if (!MODELS.includes(state.settings.model)) state.settings.model = DEFAULT_MODEL;
    if (!['dark', 'light'].includes(state.settings.theme)) state.settings.theme = 'dark';
    state.conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
    state.activeId = parsed.activeId || (state.conversations[0]?.id ?? null);
    return state;
  } catch (err) {
    return emptyState();
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    return false;
  }
}

export function clearState(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (err) { /* storage unavailable — nothing to clear */ }
  return emptyState();
}
