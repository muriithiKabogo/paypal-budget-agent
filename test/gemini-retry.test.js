// Gemini hiccups (overloaded, a per-minute limit) get another try; a daily quota does not.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const gemini = require('../src/gemini');
const { DEFAULT_RULES } = require('../src/catalog');

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

const answer = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const failure = (status, body = {}) => ({ ok: false, status, json: async () => body });
const retryInfo = (delay) => ({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] } });
const plan = () => gemini.planTask({ prompt: 'Find articles', rules: DEFAULT_RULES, leftCents: 5000 });

test('an overloaded Gemini gets another try', async () => {
    const replies = [failure(503), answer({ summary: 'Two articles.', purchases: [] })];
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return replies.shift(); };
    assert.equal((await plan()).summary, 'Two articles.');
    assert.equal(calls, 2);
});

test('a per-minute limit waits as long as Google says, then tries again', async () => {
    const replies = [failure(429, retryInfo('0.1s')), answer({ summary: 'ok', purchases: [] })];
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return replies.shift(); };
    assert.equal((await plan()).summary, 'ok');
    assert.equal(calls, 2);
});

test('a daily quota fails straight away', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return failure(429, retryInfo('66000s')); };
    await assert.rejects(plan(), /usage limit/);
    assert.equal(calls, 1);
});

test('a bad request is not retried', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return failure(400, { error: { message: 'Invalid argument' } }); };
    await assert.rejects(plan(), /Gemini returned 400: Invalid argument/);
    assert.equal(calls, 1);
});
