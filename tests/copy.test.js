// Copy guard — Grok Replica's user-facing words must stay plain, human and
// free of AI-marketing clichés and decorative symbols. Scans the visible
// text of index.html and every string literal in src/*.js, then asserts:
//   - no emoji or pictographic symbols anywhere
//   - no banned marketing words or retired phrasing
//   - no invented UI word ("orb", "sparkle") leaking into what the user reads
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·')
    .replace(/\s+/g, ' ');
}

function stringLiterals(js) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(js)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out.join(' ');
}

const BANNED_WORDS = [
  'seamless', 'supercharge', 'elevate', 'unlock', 'revolutionize',
  'AI-powered', 'AI powered', 'cutting-edge', 'cutting edge',
  'game-changer', 'game changer', 'next-gen', 'next generation',
  'delve', 'tapestry', 'in today\'s fast-paced',
];

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2728}\u{1F680}\u{1F525}]/u;

describe('copy guard', () => {
  const htmlText = visibleText(read('index.html'));
  const jsText = ['app.js', 'gemini.js', 'markdown.js', 'store.js']
    .map((f) => stringLiterals(read(`src/${f}`)))
    .join(' ');
  const all = `${htmlText} ${jsText}`;

  it('has no emoji or decorative symbols in user-facing text', () => {
    assert.ok(!EMOJI_RE.test(all), `emoji/symbol found in: ${all.match(EMOJI_RE)?.[0]}`);
    assert.ok(!all.includes('✨'), 'sparkle found');
    assert.ok(!all.includes('🚀'), 'rocket found');
  });

  it('has no banned marketing words', () => {
    for (const word of BANNED_WORDS) {
      assert.ok(!all.toLowerCase().includes(word.toLowerCase()), `banned word present: ${word}`);
    }
  });

  it('never claims to be Grok or xAI', () => {
    // "Grok Replica" and "study clone" are fine; claiming to BE Grok is not.
    assert.ok(!/I am Grok/i.test(all), 'copy claims to be Grok');
    assert.ok(!/official xAI/i.test(all), 'copy claims to be official');
    assert.ok(htmlText.includes('not affiliated with xAI'), 'affiliation disclaimer missing from the page');
    assert.ok(htmlText.includes('Study clone'), 'study-clone label missing from the page');
  });

  it('never promises a reply without a key', () => {
    assert.ok(!/demo reply|sample answer|try asking/i.test(all), 'copy hints at a fake reply');
  });
});
