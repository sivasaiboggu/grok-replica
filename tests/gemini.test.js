// Grok Replica — tests for the Gemini streaming client.
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRequestBody, streamUrl, parseSseChunk, errorFromResponse,
  streamReply, formatUsage, isValidModel, GeminiError,
} from '../src/gemini.js';

function sseStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function okFetch(stream) {
  return async () => ({ ok: true, status: 200, body: stream });
}

function errorFetch(status, errorBody) {
  return async () => ({
    ok: false,
    status,
    json: async () => errorBody,
  });
}

describe('buildRequestBody', () => {
  it('maps assistant history to the model role and appends the new question', () => {
    const body = buildRequestBody(
      [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello' }],
      'And now?',
    );
    assert.deepEqual(body.contents, [
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello' }] },
      { role: 'user', parts: [{ text: 'And now?' }] },
    ]);
    assert.equal(body.generationConfig.temperature, 0.7);
  });

  it('drops error-only entries from history', () => {
    const body = buildRequestBody([{ role: 'system', text: 'x' }], 'Hi');
    assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'Hi' }] }]);
  });
});

describe('streamUrl', () => {
  it('points at the v1beta streaming endpoint', () => {
    const url = streamUrl('gemini-2.5-flash', 'KEY123');
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'));
    assert.ok(url.includes('key=KEY123'));
  });
});

describe('parseSseChunk', () => {
  it('collects text across data lines', () => {
    const chunk =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n';
    const out = parseSseChunk(chunk);
    assert.equal(out.text, 'Hello world');
    assert.equal(out.error, null);
  });

  it('keeps a partial line in the buffer for the next chunk', () => {
    const first = parseSseChunk('data: {"candidates":[{"content":{"parts":[{"text":"Hel');
    assert.equal(first.text, '');
    assert.ok(first.buffer.length > 0);
    const second = parseSseChunk('lo"}]}}]}\n', first.buffer);
    assert.equal(second.text, 'Hello');
  });

  it('ignores malformed JSON lines instead of crashing', () => {
    const out = parseSseChunk('data: {not json\n\ndata: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n');
    assert.equal(out.text, 'ok');
  });

  it('captures usage metadata when Google sends it', () => {
    const chunk = 'data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}\n';
    const out = parseSseChunk(chunk);
    assert.deepEqual(out.usage, { prompt: 10, candidates: 5, total: 15 });
  });

  it('surfaces an error carried inside the stream', () => {
    const chunk = 'data: {"error":{"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}\n';
    const out = parseSseChunk(chunk);
    assert.equal(out.error, 'Quota exceeded');
  });
});

describe('errorFromResponse', () => {
  it('explains a wrong key in plain words', async () => {
    const err = await errorFromResponse(await errorFetch(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })());
    assert.equal(err.status, 400);
    assert.equal(err.code, 'API_KEY_INVALID');
    assert.match(err.message, /key looks wrong/);
  });

  it('explains a missing model and suggests switching', async () => {
    const err = await errorFromResponse(await errorFetch(404, { error: { message: 'models/gemini-9.9 is not found', status: 'NOT_FOUND' } })());
    assert.equal(err.status, 404);
    assert.equal(err.code, 'MODEL_NOT_FOUND');
    assert.match(err.message, /Try another model/);
  });

  it('explains rate limiting', async () => {
    const err = await errorFromResponse(await errorFetch(429, { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } })());
    assert.equal(err.status, 429);
    assert.equal(err.code, 'RATE_LIMITED');
  });

  it('falls back to the status when the body is not JSON', async () => {
    const res = { ok: false, status: 500, json: async () => { throw new Error('no json'); } };
    const err = await errorFromResponse(res);
    assert.equal(err.status, 500);
    assert.match(err.message, /HTTP 500/);
  });
});

describe('streamReply', () => {
  it('streams text and calls onToken with the running total', async () => {
    const stream = sseStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"there"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}\n',
    ]);
    const seen = [];
    let usage = null;
    const { text, usage: returned } = await streamReply({
      model: 'gemini-2.5-flash',
      apiKey: 'KEY',
      history: [],
      userText: 'Hi',
      fetchImpl: okFetch(stream),
      onToken: (t) => seen.push(t),
      onUsage: (u) => { usage = u; },
    });
    assert.equal(text, 'Hello there');
    assert.deepEqual(seen, ['Hello ', 'Hello there']);
    assert.deepEqual(usage, { prompt: 4, candidates: 2, total: 6 });
    assert.deepEqual(returned, { prompt: 4, candidates: 2, total: 6 });
  });

  it('throws a plain GeminiError on a 404 instead of crashing', async () => {
    await assert.rejects(
      () => streamReply({
        model: 'gemini-2.5-flash', apiKey: 'KEY', history: [], userText: 'Hi',
        fetchImpl: errorFetch(404, { error: { message: 'not found', status: 'NOT_FOUND' } }),
      }),
      (err) => err instanceof GeminiError && err.code === 'MODEL_NOT_FOUND',
    );
  });

  it('refuses to call the API without a key', async () => {
    await assert.rejects(
      () => streamReply({ model: 'gemini-2.5-flash', apiKey: '  ', history: [], userText: 'Hi', fetchImpl: okFetch(sseStream([])) }),
      (err) => err instanceof GeminiError && err.code === 'NO_KEY',
    );
  });

  it('refuses an unknown model name', async () => {
    await assert.rejects(
      () => streamReply({ model: 'gemini-9.9', apiKey: 'KEY', history: [], userText: 'Hi', fetchImpl: okFetch(sseStream([])) }),
      (err) => err instanceof GeminiError && err.code === 'BAD_MODEL',
    );
  });

  it('lets an abort through as AbortError, not a GeminiError', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = async (_url, { signal }) => {
      if (signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 200, body: sseStream([]) };
    };
    await assert.rejects(
      () => streamReply({ model: 'gemini-2.5-flash', apiKey: 'KEY', history: [], userText: 'Hi', signal: controller.signal, fetchImpl }),
      (err) => err.name === 'AbortError',
    );
  });
});

describe('formatUsage', () => {
  it('formats token counts, or empty when unknown', () => {
    assert.equal(formatUsage({ prompt: 10, candidates: 5, total: 15 }), '10 prompt · 5 reply · 15 total tokens');
    assert.equal(formatUsage(null), '');
    assert.equal(formatUsage({}), '');
  });
});

describe('isValidModel', () => {
  it('accepts the shipped models only', () => {
    assert.equal(isValidModel('gemini-3.8-flash'), true);
    assert.equal(isValidModel('gemini-2.5-flash'), true);
    assert.equal(isValidModel('gemini-2.0-flash'), true);
    assert.equal(isValidModel('gemini-2.5-pro'), true);
    assert.equal(isValidModel('gpt-4'), false);
    assert.equal(isValidModel(''), false);
  });
});
