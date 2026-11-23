// Grok Replica — UI wiring. Plain DOM, no framework.
// Chats run on the user's own Gemini key (Settings). Without a key the
// app says so plainly and never invents a reply.
import { renderMarkdown, escapeHtml, getCodeBlockById, extractCodeBlocks } from './markdown.js';
import {
  DEFAULT_MODEL,
  createConversation, getConversation,
  getActive, setActive, addMessage, renameConversation,
  deleteConversation, searchConversations, sortConversations,
  loadState, saveState, clearState,
} from './store.js';
import { streamReply, isValidModel, modelLabel, formatUsage, GeminiError } from './gemini.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  sidebar: $('#sidebar'),
  scrim: $('#scrim'),
  menuBtn: $('#menuBtn'),
  closeSidebarBtn: $('#closeSidebarBtn'),
  wordmark: $('#wordmark'),
  newChatBtn: $('#newChatBtn'),
  searchInput: $('#searchInput'),
  chatList: $('#chatList'),
  settingsBtn: $('#settingsBtn'),
  themeBtn: $('#themeBtn'),
  themeBtnLabel: $('#themeBtnLabel'),
  keyState: $('#keyState'),
  modelSelect: $('#modelSelect'),
  copyLinkBtn: $('#copyLinkBtn'),
  chatScroll: $('#chatScroll'),
  chatRoot: $('#chatRoot'),
  composerInput: $('#composerInput'),
  sendBtn: $('#sendBtn'),
  stopBtn: $('#stopBtn'),
  settingsModal: $('#settingsModal'),
  apiKeyInput: $('#apiKeyInput'),
  toggleKeyVisibility: $('#toggleKeyVisibility'),
  settingsModelSelect: $('#settingsModelSelect'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  clearDataBtn: $('#clearDataBtn'),
  toast: $('#toast'),
};

// In-memory fallback if localStorage is unavailable (private mode, etc.)
const memoryStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
})();

let storage = memoryStorage;
try {
  localStorage.setItem('__grok_replica_probe__', '1');
  localStorage.removeItem('__grok_replica_probe__');
  storage = localStorage;
} catch (err) { /* stay on the in-memory fallback */ }

let state = loadState(storage);
let generating = false;
let abortController = null;
let toastTimer = null;

const SUGGESTIONS = [
  'Explain recursion with a short example',
  'Write a Python function that finds duplicates in a list',
  'What is the difference between TCP and UDP?',
];

function persist() { saveState(storage, state); }

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function applyTheme() {
  const theme = state.settings.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
  els.themeBtnLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function renderKeyState() {
  const key = (state.settings.apiKey || '').trim();
  if (key) {
    els.keyState.textContent = `Key saved · ${modelLabel(state.settings.model)}`;
    els.keyState.classList.add('ok');
  } else {
    els.keyState.textContent = 'No API key set';
    els.keyState.classList.remove('ok');
  }
}

// ---------- sidebar ----------

function renderSidebar() {
  const query = els.searchInput.value || '';
  const list = sortConversations(state);
  const filtered = searchConversations(state, query);
  const filteredIds = new Set(filtered.map((c) => c.id));
  els.chatList.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No chats yet. Start one below — it saves here automatically.';
    els.chatList.appendChild(empty);
    return;
  }

  const section = document.createElement('div');
  section.className = 'sidebar-section';
  section.textContent = query ? `Results (${filtered.length})` : 'Recent';
  els.chatList.appendChild(section);

  for (const conv of list) {
    if (query && !filteredIds.has(conv.id)) continue;
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (conv.id === state.activeId ? ' active' : '');
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.dataset.convId = conv.id;

    const title = document.createElement('span');
    title.className = 'sidebar-item-title';
    title.textContent = conv.title || 'New chat';
    title.title = conv.title || 'New chat';
    item.appendChild(title);

    const actions = document.createElement('span');
    actions.className = 'sidebar-item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', `Rename ${conv.title}`);
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    renameBtn.addEventListener('click', (ev) => { ev.stopPropagation(); startRename(item, conv); });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete ${conv.title}`);
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
    deleteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (deleteBtn.dataset.armed) {
        deleteConversation(state, conv.id);
        persist();
        renderSidebar();
        renderChat();
      } else {
        deleteBtn.dataset.armed = '1';
        deleteBtn.textContent = 'Delete?';
        deleteBtn.classList.add('confirm-delete');
        setTimeout(() => {
          deleteBtn.dataset.armed = '';
          deleteBtn.classList.remove('confirm-delete');
          deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
        }, 3000);
      }
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);

    const open = () => {
      setActive(state, conv.id);
      persist();
      renderSidebar();
      renderChat();
      closeMobileSidebar();
      els.composerInput.focus();
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });
    els.chatList.appendChild(item);
  }

  if (query && filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No chats match that search.';
    els.chatList.appendChild(empty);
  }
}

function startRename(item, conv) {
  const titleEl = item.querySelector('.sidebar-item-title');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = conv.title;
  input.maxLength = 120;
  input.setAttribute('aria-label', 'Chat name');
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = (save) => {
    if (save) {
      if (renameConversation(state, conv.id, input.value)) persist();
    }
    renderSidebar();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit(true);
    if (ev.key === 'Escape') commit(false);
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());
}

// ---------- chat rendering ----------

function messageNode(conv, msg, index, isLast) {
  const wrap = document.createElement('div');
  if (msg.role === 'user') {
    wrap.className = 'msg msg-user';
    const bubble = document.createElement('div');
    bubble.className = 'msg-user-bubble';
    bubble.textContent = msg.text;
    wrap.appendChild(bubble);
    return wrap;
  }

  wrap.className = 'msg msg-assistant';
  wrap.dataset.msgIndex = String(index);

  const head = document.createElement('div');
  head.className = 'msg-head';
  head.innerHTML = '<span class="msg-mark" aria-hidden="true">G</span><span class="msg-name">Grok Replica</span>';
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'msg-body';
  if (msg.text) body.innerHTML = renderMarkdown(msg.text);
  wrap.appendChild(body);

  if (msg.error) {
    const err = document.createElement('div');
    err.className = 'msg-error';
    const strong = document.createElement('strong');
    strong.textContent = 'This reply did not go through.';
    err.appendChild(strong);
    const span = document.createElement('span');
    span.textContent = msg.error;
    err.appendChild(span);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try another model';
    retry.addEventListener('click', () => openSettings());
    err.appendChild(retry);
    wrap.appendChild(err);
  }

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy';
  copyBtn.addEventListener('click', async () => {
    await copyText(msg.text);
    showToast('Reply copied');
  });
  actions.appendChild(copyBtn);

  if (isLast) {
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Regenerate';
    regenBtn.addEventListener('click', () => regenerate(conv));
    actions.appendChild(regenBtn);
  }

  if (msg.usage) {
    const usage = document.createElement('span');
    usage.className = 'msg-usage';
    usage.textContent = formatUsage(msg.usage);
    actions.appendChild(usage);
  }

  wrap.appendChild(actions);
  return wrap;
}

function emptyStateNode() {
  const empty = document.createElement('div');
  empty.className = 'empty';
  const hasKey = Boolean((state.settings.apiKey || '').trim());
  empty.innerHTML =
    '<div class="empty-mark" aria-hidden="true">G</div>' +
    '<h1>Ask anything.</h1>' +
    (hasKey
      ? '<p>Replies come from Google Gemini with your own free key. Pick a suggestion or type your own question below.</p>'
      : '<p>Replies come from Google Gemini with your own free key. Add the key in <a href="#" id="emptySettingsLink">Settings</a> — it takes a minute and it is free — then ask away.</p>');
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const s of SUGGESTIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      els.composerInput.value = s;
      autoGrow();
      els.composerInput.focus();
    });
    chips.appendChild(chip);
  }
  empty.appendChild(chips);
  const link = empty.querySelector('#emptySettingsLink');
  if (link) link.addEventListener('click', (ev) => { ev.preventDefault(); openSettings(); });
  return empty;
}

function keyNeededNode() {
  const box = document.createElement('div');
  box.className = 'key-needed';
  box.innerHTML =
    '<strong>An API key is needed to chat.</strong>' +
    '<p>This app has no key of its own and never fakes a reply. Paste your free Gemini key in Settings — it stays in this browser.</p>';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn primary';
  openBtn.textContent = 'Open Settings';
  openBtn.addEventListener('click', openSettings);
  box.appendChild(openBtn);
  const link = document.createElement('a');
  link.href = 'https://aistudio.google.com/apikey';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Get a free key';
  link.className = 'btn';
  box.appendChild(link);
  return box;
}

function renderChat() {
  const conv = getActive(state);
  els.chatRoot.innerHTML = '';
  if (!conv || conv.messages.length === 0) {
    els.chatRoot.appendChild(emptyStateNode());
    updateSendState();
    return;
  }
  const lastIndex = conv.messages.length - 1;
  conv.messages.forEach((msg, i) => {
    els.chatRoot.appendChild(messageNode(conv, msg, i, i === lastIndex && msg.role === 'assistant'));
  });
  updateSendState();
}

function scrollToBottom(force = false) {
  const el = els.chatScroll;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  if (force || nearBottom) el.scrollTop = el.scrollHeight;
}

// ---------- sending ----------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function updateSendState() {
  const hasText = els.composerInput.value.trim().length > 0;
  els.sendBtn.disabled = generating || !hasText;
  els.stopBtn.hidden = !generating;
}

function autoGrow() {
  const ta = els.composerInput;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  updateSendState();
}

async function sendCurrent() {
  const text = els.composerInput.value.trim();
  if (!text || generating) return;
  await sendMessage(text);
}

async function sendMessage(text) {
  const key = (state.settings.apiKey || '').trim();
  let conv = getActive(state);
  if (!conv) {
    conv = createConversation(state, text);
    renderSidebar();
  }
  addMessage(state, conv.id, 'user', text);
  persist();
  els.composerInput.value = '';
  autoGrow();
  renderChat();
  scrollToBottom(true);

  if (!key) {
    els.chatRoot.appendChild(keyNeededNode());
    scrollToBottom(true);
    return;
  }

  const assistantMsg = addMessage(state, conv.id, 'assistant', '');
  persist();
  renderChat();
  const bodyEl = els.chatRoot.querySelector(`[data-msg-index="${conv.messages.length - 1}"] .msg-body`);
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  if (bodyEl) bodyEl.appendChild(typing);

  generating = true;
  abortController = new AbortController();
  updateSendState();

  const history = conv.messages.slice(0, -1);
  let lastUsage = null;
  let rendered = false;
  try {
    const { text: full, usage } = await streamReply({
      model: state.settings.model,
      apiKey: key,
      history,
      userText: text,
      signal: abortController.signal,
      onToken: (soFar) => {
        rendered = true;
        assistantMsg.text = soFar;
        if (bodyEl) {
          bodyEl.innerHTML = renderMarkdown(soFar);
          scrollToBottom();
        }
      },
      onUsage: (u) => { lastUsage = u; },
    });
    assistantMsg.text = full;
    assistantMsg.usage = usage ?? lastUsage;
    assistantMsg.error = null;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (!assistantMsg.text) assistantMsg.text = '';
      assistantMsg.error = null;
      if (!rendered && bodyEl) bodyEl.innerHTML = '';
    } else {
      const message = err instanceof GeminiError
        ? err.message
        : (err?.message || 'Something went wrong while talking to Google.');
      assistantMsg.error = message;
      if (bodyEl && !assistantMsg.text) bodyEl.innerHTML = '';
    }
  } finally {
    generating = false;
    abortController = null;
    persist();
    renderChat();
    renderSidebar();
    scrollToBottom(true);
    els.composerInput.focus();
  }
}

async function regenerate(conv) {
  if (generating || !conv) return;
  const lastUserIdx = [...conv.messages].map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'user').pop()?.i;
  if (lastUserIdx == null) return;
  // drop the last assistant reply (and anything after the last user msg)
  conv.messages.splice(lastUserIdx + 1);
  const text = conv.messages[lastUserIdx].text;
  persist();
  renderChat();
  scrollToBottom(true);

  const key = (state.settings.apiKey || '').trim();
  if (!key) {
    els.chatRoot.appendChild(keyNeededNode());
    return;
  }
  const assistantMsg = addMessage(state, conv.id, 'assistant', '');
  persist();
  renderChat();
  const bodyEl = els.chatRoot.querySelector(`[data-msg-index="${conv.messages.length - 1}"] .msg-body`);
  generating = true;
  abortController = new AbortController();
  updateSendState();
  const history = conv.messages.slice(0, -1);
  try {
    const { text: full, usage } = await streamReply({
      model: state.settings.model,
      apiKey: key,
      history,
      userText: text,
      signal: abortController.signal,
      onToken: (soFar) => {
        assistantMsg.text = soFar;
        if (bodyEl) { bodyEl.innerHTML = renderMarkdown(soFar); scrollToBottom(); }
      },
    });
    assistantMsg.text = full;
    assistantMsg.usage = usage ?? null;
    assistantMsg.error = null;
  } catch (err) {
    if (!(err && err.name === 'AbortError')) {
      assistantMsg.error = err instanceof GeminiError ? err.message : (err?.message || 'Something went wrong while talking to Google.');
    }
  } finally {
    generating = false;
    abortController = null;
    persist();
    renderChat();
    renderSidebar();
    scrollToBottom(true);
  }
}

function stopGenerating() {
  if (abortController) abortController.abort();
}

function newChat() {
  if (generating) stopGenerating();
  const conv = createConversation(state, '');
  persist();
  renderSidebar();
  renderChat();
  closeMobileSidebar();
  els.composerInput.focus();
}

// ---------- sidebar on mobile ----------

function openMobileSidebar() {
  els.sidebar.classList.add('open');
  els.scrim.classList.add('show');
}
function closeMobileSidebar() {
  els.sidebar.classList.remove('open');
  els.scrim.classList.remove('show');
}

// ---------- settings ----------

function openSettings() {
  els.apiKeyInput.value = state.settings.apiKey || '';
  els.apiKeyInput.type = 'password';
  els.toggleKeyVisibility.textContent = 'Show';
  els.settingsModelSelect.value = isValidModel(state.settings.model) ? state.settings.model : DEFAULT_MODEL;
  els.settingsModal.classList.add('open');
  setTimeout(() => els.apiKeyInput.focus(), 50);
}
function closeSettings() {
  els.settingsModal.classList.remove('open');
}

function saveSettings() {
  const key = els.apiKeyInput.value.trim();
  const model = els.settingsModelSelect.value;
  state.settings.apiKey = key;
  if (isValidModel(model)) state.settings.model = model;
  els.modelSelect.value = state.settings.model;
  persist();
  renderKeyState();
  closeSettings();
  showToast(key ? 'Key saved in this browser' : 'Key removed');
  renderChat();
}

// ---------- share (copy transcript as Markdown) ----------

function conversationToMarkdown(conv) {
  const lines = [`# ${conv.title || 'Chat'}`];
  for (const m of conv.messages) {
    lines.push('', m.role === 'user' ? '## You' : '## Grok Replica', '', m.text);
  }
  return lines.join('\n');
}

// ---------- wiring ----------

els.newChatBtn.addEventListener('click', newChat);
els.wordmark.addEventListener('click', (ev) => { ev.preventDefault(); newChat(); });
els.menuBtn.addEventListener('click', openMobileSidebar);
els.closeSidebarBtn.addEventListener('click', closeMobileSidebar);
els.scrim.addEventListener('click', closeMobileSidebar);
els.searchInput.addEventListener('input', renderSidebar);
els.sendBtn.addEventListener('click', sendCurrent);
els.stopBtn.addEventListener('click', stopGenerating);
els.settingsBtn.addEventListener('click', openSettings);
els.saveSettingsBtn.addEventListener('click', saveSettings);
els.toggleKeyVisibility.addEventListener('click', () => {
  const show = els.apiKeyInput.type === 'password';
  els.apiKeyInput.type = show ? 'text' : 'password';
  els.toggleKeyVisibility.textContent = show ? 'Hide' : 'Show';
});
els.clearDataBtn.addEventListener('click', () => {
  if (els.clearDataBtn.dataset.armed) {
    state = clearState(storage);
    els.clearDataBtn.dataset.armed = '';
    els.clearDataBtn.textContent = 'Erase all chats';
    persist();
    applyTheme();
    renderKeyState();
    renderSidebar();
    renderChat();
    closeSettings();
    showToast('All chats erased');
  } else {
    els.clearDataBtn.dataset.armed = '1';
    els.clearDataBtn.textContent = 'Tap again to erase';
    setTimeout(() => {
      els.clearDataBtn.dataset.armed = '';
      els.clearDataBtn.textContent = 'Erase all chats';
    }, 3000);
  }
});
els.settingsModal.addEventListener('click', (ev) => {
  if (ev.target === els.settingsModal) closeSettings();
});
els.themeBtn.addEventListener('click', () => {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  persist();
  applyTheme();
});
els.modelSelect.addEventListener('change', () => {
  const model = els.modelSelect.value;
  if (isValidModel(model)) {
    state.settings.model = model;
    persist();
    renderKeyState();
    showToast(`Model: ${modelLabel(model)}`);
  }
});
els.settingsModelSelect.addEventListener('change', () => {
  els.modelSelect.value = els.settingsModelSelect.value;
});
els.copyLinkBtn.addEventListener('click', async () => {
  const conv = getActive(state);
  if (!conv || conv.messages.length === 0) {
    showToast('Nothing to copy yet');
    return;
  }
  await copyText(conversationToMarkdown(conv));
  showToast('Chat copied as Markdown');
});
els.composerInput.addEventListener('input', autoGrow);
els.composerInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendCurrent();
  }
});

// copy buttons inside code blocks (event delegation — code is re-rendered)
els.chatRoot.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-copy-code]');
  if (!btn) return;
  const conv = getActive(state);
  if (!conv) return;
  const bodyEl = btn.closest('.msg-body');
  if (!bodyEl) return;
  // find which code block: re-extract from the message text
  const msgIndex = Number(btn.closest('.msg-assistant')?.dataset.msgIndex ?? -1);
  const msg = conv.messages[msgIndex];
  if (!msg) return;
  const { blocks } = extractCodeBlocks(msg.text);
  const block = getCodeBlockById(blocks, btn.dataset.copyCode);
  if (!block) return;
  await copyText(block.code);
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

document.addEventListener('keydown', (ev) => {
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    newChat();
  }
  if (ev.key === 'Escape') {
    if (els.settingsModal.classList.contains('open')) closeSettings();
    else if (generating) stopGenerating();
    else closeMobileSidebar();
  }
});

// ---------- init ----------

function init() {
  // open a chat from ?chat=<id> when it exists (local link)
  const params = new URLSearchParams(location.search);
  const chatId = params.get('chat');
  if (chatId && getConversation(state, chatId)) setActive(state, chatId);
  else if (!getActive(state) && state.conversations.length > 0) {
    state.activeId = sortConversations(state)[0].id;
  }
  els.modelSelect.value = isValidModel(state.settings.model) ? state.settings.model : DEFAULT_MODEL;
  applyTheme();
  renderKeyState();
  renderSidebar();
  renderChat();
  autoGrow();
}

init();
