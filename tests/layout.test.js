// Grok Replica — static layout checks: the page must not overflow at
// 390px or 1280px, and the shell must be complete. These catch the
// classes of bug that screenshots alone can miss.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('layout guards', () => {
  const html = read('index.html');
  const css = read('styles.css');

  it('has a viewport meta tag for mobile', () => {
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes('width=device-width'));
  });

  it('uses border-box everywhere', () => {
    assert.ok(css.includes('* { box-sizing: border-box; }'));
  });

  it('has no 100vw widths (the classic horizontal-overflow bug)', () => {
    assert.ok(!/width:\s*100vw/.test(css), '100vw found in CSS');
  });

  it('has no fixed pixel width on the chat column or composer', () => {
    assert.ok(!/\.chat\s*{[^}]*width:\s*\d+px/.test(css));
    assert.ok(!/\.composer\s*{[^}]*width:\s*\d+px/.test(css));
  });

  it('constrains the chat column with a max-width', () => {
    assert.ok(css.includes('--column-w: 768px'));
    assert.ok(css.includes('max-width: var(--column-w)'));
  });

  it('applies the chat column to #chatRoot, where messages actually render', () => {
    // Regression: messages render into #chatRoot, not a .chat element,
    // so a .chat-only rule left the column with no max-width, no
    // centering and no gutter — code blocks ran edge to edge on a phone.
    assert.ok(/\.chat,\s*#chatRoot\s*{[^}]*max-width:\s*var\(--column-w\)/.test(css));
    assert.ok(/\.chat,\s*#chatRoot\s*{[^}]*padding:\s*16px 16px 12px/.test(css) || css.includes('.chat, #chatRoot { padding: 16px 16px 12px; }'));
    assert.ok(html.includes('id="chatRoot"'));
  });

  it('keeps code blocks inside the column on a phone', () => {
    // The min-width: 0 chain stops a long unbroken line in a <pre>
    // from forcing its ancestors wider; the pre scrolls inside the
    // block instead. The head label truncates rather than pushing the
    // Copy button out of the block.
    assert.ok(css.includes('.chat-scroll { flex: 1; min-width: 0;'));
    assert.ok(css.includes('.msg-body { font-size: 15.5px; line-height: 1.65; word-break: break-word; overflow-wrap: anywhere; min-width: 0; }'));
    assert.ok(css.includes('.code-block { margin: 0 0 14px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; max-width: 100%; min-width: 0; }'));
    assert.ok(/\.code-block pre \{[^}]*overflow-x: auto;[^}]*max-width: 100%;/.test(css));
    assert.ok(css.includes('.code-block-head > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'));
  });

  it('has a mobile breakpoint that hides the sidebar off-canvas', () => {
    assert.ok(css.includes('@media (max-width: 768px)'));
    assert.ok(css.includes('transform: translateX(-102%)'));
  });

  it('keeps the composer usable on small screens', () => {
    assert.ok(css.includes('.composer-hint { display: none; }'), 'hint not hidden on mobile');
  });

  it('respects prefers-reduced-motion', () => {
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  });

  it('wires every id the app JS expects', () => {
    const ids = [
      'sidebar', 'scrim', 'menuBtn', 'closeSidebarBtn', 'wordmark',
      'newChatBtn', 'searchInput', 'chatList', 'settingsBtn', 'themeBtn',
      'themeBtnLabel', 'keyState', 'modelSelect', 'copyLinkBtn',
      'chatScroll', 'chatRoot', 'composerInput', 'sendBtn', 'stopBtn',
      'settingsModal', 'apiKeyInput', 'toggleKeyVisibility',
      'settingsModelSelect', 'saveSettingsBtn', 'clearDataBtn', 'toast',
    ];
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `missing element #${id}`);
    }
  });

  it('loads the app as a module and links the stylesheet', () => {
    assert.ok(html.includes('<script type="module" src="src/app.js">'));
    assert.ok(html.includes('<link rel="stylesheet" href="styles.css">'));
  });

  it('has no external script dependency besides fonts', () => {
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ['src/app.js']);
  });
});
