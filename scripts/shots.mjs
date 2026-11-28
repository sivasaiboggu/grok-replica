// Real Chrome renders for review: desktop 1280px + phone 390px,
// empty state and a seeded sample chat (light + dark).
// The sample chat is a screenshot fixture only: it is seeded through
// localStorage by this script, titled "Sample chat", and is not part of
// the app — the app itself never invents a reply.
// Run: node scripts/shots.mjs — writes screenshots/*.png
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const CHROME = process.env.CHROME_BIN
  || ['/opt/meta-chromium/chrome', '/usr/bin/chromium-browser', 'google-chrome']
    .find((c) => c.startsWith('/') ? fs.existsSync(c) : true);

// This VM's Hatch Chrome needs a WebGL domain policy (contract file +
// SHA-256) just to start.
function chromeArgs(debugPort, firstUrl) {
  const policy = 'hatch-webgl-allowed-domains-v1\nexample.com\n';
  const file = path.join(os.tmpdir(), 'grok-replica-webgl-policy.txt');
  fs.writeFileSync(file, policy);
  const sha = createHash('sha256').update(policy).digest('hex');
  return [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'grok-replica-chrome-'))}`,
    `--hatch-webgl-allowed-domains-file=${file}`,
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1280,900',
    firstUrl,
  ];
}

// Pages load over file://, not http://127.0.0.1: this Chrome build blocks
// navigations to local-network servers when initiated through DevTools,
// while file:// pages load fine with --allow-file-access-from-files
// (ES module imports included).
const pageUrl = (page) => `file://${ROOT}/${page}`;
const DEBUG_PORT = 9226;

const SAMPLE_STATE = {
  version: 1,
  settings: { apiKey: '', model: 'gemini-3.8-flash', theme: 'dark' },
  conversations: [
    {
      id: 'sample-chat',
      title: 'Sample chat — recursion',
      createdAt: 1763856000000,
      updatedAt: 1763856000000,
      messages: [
        { role: 'user', text: 'Explain recursion with a short example', usage: null, error: null, ts: 1763856000000 },
        {
          role: 'assistant',
          text: 'Recursion is when a function calls itself to solve a smaller piece of the same problem.\n\n## The shape of it\n\nEvery recursive function has two parts:\n\n- **Base case** — the smallest input, answered directly.\n- **Recursive case** — the input made smaller, then the function runs again.\n\n```python\ndef factorial(n):\n    if n <= 1:      # base case\n        return 1\n    return n * factorial(n - 1)  # recursive case\n\nprint(factorial(5))  # 120\n```\n\n`factorial(5)` calls `factorial(4)`, which calls `factorial(3)`, until it reaches `factorial(1)` and unwinds. The call stack holds each unfinished call, so deep recursion can run out of stack space — that is the main thing to watch.',
          usage: { prompt: 18, candidates: 142, total: 160 },
          error: null,
          ts: 1763856001000,
        },
        { role: 'user', text: 'Show me a long line of code', usage: null, error: null, ts: 1763856002000 },
        {
          role: 'assistant',
          // Fixture for the mobile code-block check: one unbroken line
          // far wider than a phone. It must scroll inside its block,
          // never push the column wider or slice at the screen edge.
          text: 'Here is one long line:\n\n```js\nconst url = "https://api.example.com/v1/users/1234567890/profile?include=posts,comments,followers&token=abcdef0123456789";\n```\n\nThe line above is longer than the phone screen — it scrolls inside the block.',
          usage: { prompt: 9, candidates: 61, total: 70 },
          error: null,
          ts: 1763856003000,
        },
      ],
    },
  ],
  activeId: 'sample-chat',
};

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const done = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return done;
  }

  async waitForEvent(method, timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i >= 0) return this.events.splice(i, 1)[0];
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${method}`);
      await delay(100);
    }
  }

  async evaluate(expression) {
    const res = await this.call('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  }

  close() { try { this.ws.close(); } catch (err) { /* already closed */ } }
}

const SHOTS = [
  { name: 'desktop-empty.png', width: 1280, url: 'index.html', seed: false, theme: 'dark', waitMs: 2500 },
  { name: 'desktop-chat.png', width: 1280, url: 'index.html', seed: true, theme: 'dark', waitMs: 2500 },
  { name: 'desktop-light-chat.png', width: 1280, url: 'index.html', seed: true, theme: 'light', waitMs: 2500 },
  { name: 'mobile-empty.png', width: 390, url: 'index.html', seed: false, theme: 'dark', waitMs: 2500 },
  { name: 'mobile-chat.png', width: 390, url: 'index.html', seed: true, theme: 'dark', waitMs: 2500 },
  { name: 'mobile-light-chat.png', width: 390, url: 'index.html', seed: true, theme: 'light', waitMs: 2500 },
];

async function main() {
  fs.mkdirSync(path.join(ROOT, 'screenshots'), { recursive: true });
  const first = SHOTS[0];
  const chrome = spawn(CHROME, chromeArgs(DEBUG_PORT, pageUrl(first.url)));
  try {
    let wsUrl = null;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch (err) { /* not up yet */ }
      await delay(200);
    }
    if (!wsUrl) throw new Error('Chrome DevTools did not come up');
    const cdp = new Cdp(wsUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    for (const shot of SHOTS) {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: shot.width, height: 844, deviceScaleFactor: 1, mobile: shot.width < 600,
      });
      await cdp.call('Page.navigate', { url: pageUrl(shot.url) });
      await cdp.waitForEvent('Page.loadEventFired');
      await delay(600);
      // seed or clear localStorage, then reload so the app reads it
      const seedState = shot.seed
        ? { ...SAMPLE_STATE, settings: { ...SAMPLE_STATE.settings, theme: shot.theme } }
        : { version: 1, settings: { apiKey: '', model: 'gemini-3.8-flash', theme: shot.theme }, conversations: [], activeId: null };
      await cdp.evaluate(`localStorage.setItem('grok-replica:v1', ${JSON.stringify(JSON.stringify(seedState))})`);
      const stored = await cdp.evaluate(`localStorage.getItem('grok-replica:v1') !== null`);
      if (!stored) throw new Error('localStorage seeding failed on file:// — cannot render this shot');
      await cdp.call('Page.navigate', { url: pageUrl(shot.url) });
      await cdp.waitForEvent('Page.loadEventFired');
      await delay(shot.waitMs);
      const overflow = await cdp.evaluate(
        `JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth })`,
      );
      const { data } = await cdp.call('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
      });
      fs.writeFileSync(path.join(ROOT, 'screenshots', shot.name), Buffer.from(data, 'base64'));
      console.log('wrote', shot.name, overflow);
    }
    cdp.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
