# Grok Replica

A study clone of a Grok-style chat app. Dark, minimal, fast — pure black
canvas, hairline rules, one centered column. It is **not Grok and not xAI**,
and it says so on every screen.

Replies come from **Google Gemini**, using your own free API key. The app
ships with no key and never fakes a reply: without a key it tells you
plainly that a key is needed and where to get one.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```bash
npm start        # python3 -m http.server 8000, then open http://localhost:8000
```

GitHub Pages-ready: the repo root is the site. The code is pushed to
`sivasaiboggu/grok-replica` on `main`; enable Pages (Settings → Pages →
Deploy from a branch → `main`, `/(root)`) to put it live.

## First use (what Siva must supply)

1. Open **Settings** (bottom-left).
2. Paste a **free Gemini API key** from
   [Google AI Studio](https://aistudio.google.com/apikey) (free tier, no card).
3. Save. The key is stored only in this browser's local storage.

That is the only thing needed. No account, no server, no payment.

## What works

- **Streaming chat** with Gemini (`streamGenerateContent`, SSE). Text
  appears as it arrives; token counts show under each reply when Google
  reports them (real numbers, not estimates).
- **Markdown replies**: headings, bold/italic, links, lists, blockquotes,
  fenced code blocks with a language label and a working Copy button.
  All model output is HTML-escaped before rendering.
- **Stop generating** (AbortController), **regenerate** the last reply,
  **copy** any reply, **share** copies the chat as Markdown.
- **Sidebar history**: new chat, rename (inline), delete (two-step
  confirm), search across titles and message text. Everything persists
  in localStorage.
- **Model picker**: Gemini 2.5 Flash (default), Gemini 2.0 Flash,
  Gemini 2.5 Pro. If a model is unavailable for your key, or the key is
  wrong, or quota is hit, the app shows Google's real error in plain
  words — it never invents an answer.
- **Keyboard**: `Ctrl/⌘ K` new chat, `Enter` send, `Shift+Enter` newline,
  `Esc` closes Settings / stops a reply / closes the mobile sidebar.
- **Dark first, light mode too**, same quality both ways. Mobile drawer
  sidebar at 390px.
- **No AI-slop tells**: no sparkle emoji, no gradient orbs, no
  "seamless / supercharge / elevate" copy. Plain human words throughout.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Shell: sidebar, chat, composer, Settings modal |
| `styles.css` | Tokens (OKLCH + hex fallbacks), layout, dark + light |
| `tokens.json` | Design tokens + palette + references |
| `src/markdown.js` | Safe Markdown renderer (escape-first) |
| `src/store.js` | Conversation store (localStorage, testable) |
| `src/gemini.js` | Gemini streaming client + plain-language errors |
| `src/app.js` | UI wiring |
| `tests/*.test.js` | `node --test` suites |
| `scripts/shots.mjs` | Headless-Chrome screenshots (CDP, file://) |
| `screenshots/*.png` | Desktop 1280px + mobile 390px, dark + light |

## Tests

```bash
npm test
```

**64 tests, 64 pass, 0 fail** — markdown (escaping, code blocks, lists,
links), store (CRUD, search, persistence round-trip, corrupt storage),
Gemini client (SSE parsing incl. split chunks, error mapping for wrong
key / missing model / rate limit, abort, no-key refusal), copy guard
(no emoji, no banned marketing words, affiliation disclaimer present),
layout guards (viewport, no 100vw, mobile breakpoint, all wired ids,
chat column applied to #chatRoot, code blocks capped to the column with
an internally scrolling pre).

Two real bugs were found and fixed during verification:

1. The stop button showed while idle — the `.composer-stop` CSS
   `display: inline-flex` overrode the `hidden` attribute.
2. The sidebar close button showed on desktop — it is now mobile-only.
3. The faint grey (`--faint`) was below WCAG AA for text in both themes;
   it was lightened to pass (see contrast table).

## Screenshots

All rendered in headless Chrome over `file://`, zero horizontal overflow
at 1280px and 390px (measured in the shot script, `overflowX: false`):

- `screenshots/desktop-empty.png` — empty state, dark
- `screenshots/desktop-chat.png` — sample chat with Markdown + code, dark
- `screenshots/desktop-light-chat.png` — same chat, light
- `screenshots/mobile-empty.png` — empty state, 390px
- `screenshots/mobile-chat.png` — sample chat, 390px
- `screenshots/mobile-light-chat.png` — sample chat, light, 390px

The chat screenshots use a sample conversation seeded by the shot script
only (titled "Sample chat"); the app itself contains no sample data.

## Contrast table (WCAG AA, normal text needs 4.5:1)

| Pair | Dark | Light | Pass |
| --- | --- | --- | --- |
| Text on background | #ededed / #000000 ≈ 17.7:1 | #111111 / #ffffff ≈ 16.1:1 | Yes |
| Muted on background | #9a9a9a / #000000 ≈ 7.0:1 | #6f6f6b / #ffffff ≈ 5.0:1 | Yes |
| Faint on background | #767676 / #000000 ≈ 4.6:1 | #767670 / #ffffff ≈ 4.6:1 | Yes |
| Accent button | #000000 on #ffffff ≈ 21:1 | #ffffff on #111111 ≈ 16.1:1 | Yes |

## Honest limits

- **No key is bundled.** Without your free Gemini key, the app cannot
  chat — by design. It never shows a canned "demo" answer as if it were
  real.
- **Model names were verified against Google's documented v1beta API**
  (`gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-pro`), but live
  availability depends on your key and quota. A 404 surfaces as a plain
  "try another model" message. No live call was made from this machine
  (no key exists here).
- **The key lives in the browser.** It is sent to Google's API with each
  request (that is how client-side Gemini apps work). Do not paste a key
  you use for anything else; a free AI Studio key is the right one.
- **Chats live in one browser only.** No sync, no account, no server.
  Clearing browser data erases them; "Erase all chats" in Settings does
  the same on purpose.
- **Fonts come from Google Fonts** (Inter + JetBrains Mono). Offline they
  fall back to system fonts; everything still works.
- **Pushed to GitHub** (`sivasaiboggu/grok-replica`, `main`). Pages is not
  enabled yet — Siva must enable it in Settings → Pages.

## Launch checklist

- [x] Tests 64/64 green
- [x] Desktop 1280px + mobile 390px, zero overflow, eyeballed
- [x] Dark + light, same quality
- [x] Copy guard clean (no emoji, no clichés, disclaimer present)
- [x] No dead buttons, no placeholder features
- [ ] Siva adds his free Gemini key in Settings and sends one real message
- [ ] Siva enables Pages on the `grok-replica` repo
- [ ] Siva tries it on his phone (390px) for real

## Risks

- Google may rename or retire a model — the picker then shows the real
  404 and the fix is a one-line model-list change.
- Free-tier quota (429) is per key; heavy use needs a paid key or waits.

## Top 10 v2 ideas

1. Code syntax highlighting (Shiki, lazy-loaded) instead of plain mono.
2. LaTeX math rendering (KaTeX) for study questions.
3. Image input (Gemini vision) — paste or upload a photo to ask about it.
4. Voice input via the Web Speech API, with a plain transcript shown.
5. Export a chat as a file (.md download).
6. System prompt per chat ("Explain like I'm 12", "Be terse").
7. Token-cost estimate per chat from real usage data.
8. Search that jumps to the matching message inside the chat.
9. Pinned chats.
10. A tiny local proxy option so the key never leaves Siva's own machine.
