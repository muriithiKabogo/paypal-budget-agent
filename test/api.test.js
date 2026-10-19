// The web app's API around sessions and voice input, with Gemini stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const gemini = require('../src/gemini');

let received = null;
gemini.isConfigured = () => true;
gemini.transcribe = async (input) => {
    received = input;
    return 'Find 10 logistics companies in Texas.';
};
gemini.takeLiveToken = async () => ({ token: 'auth_tokens/test', model: 'gemini-3.5-transcribe-live', url: 'wss://example.test/live' });
const { app } = require('../src/server');

let server;
let base;
let cookie = '';
test.before(async () => {
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, path, body) {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('no session is a normal answer, not an error', async () => {
    const res = await call('GET', '/api/session');
    assert.equal(res.status, 200);
    assert.equal(res.body.session, null);
});

test('voice input needs a session', async () => {
    const res = await call('POST', '/api/transcribe', { audio: 'UklGRg==', mimeType: 'audio/wav' });
    assert.equal(res.status, 401);
});

test('a WAV clip comes back as text', async () => {
    await call('POST', '/api/session', {});
    const res = await call('POST', '/api/transcribe', { audio: 'UklGRg==', mimeType: 'audio/wav' });
    assert.equal(res.status, 200);
    assert.equal(res.body.text, 'Find 10 logistics companies in Texas.');
    assert.deepEqual(received, { audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
});

test('live dictation gets a single-use token, never the API key', async () => {
    const res = await call('POST', '/api/voice-token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { token: 'auth_tokens/test', model: 'gemini-3.5-transcribe-live', url: 'wss://example.test/live' });
    assert.ok(!JSON.stringify(res.body).includes(process.env.GEMINI_API_KEY || 'no-key-set'));
});

test('anything that is not base64 WAV is refused', async () => {
    assert.equal((await call('POST', '/api/transcribe', { audio: 'UklGRg==', mimeType: 'audio/webm' })).status, 400);
    assert.equal((await call('POST', '/api/transcribe', { audio: '<script>', mimeType: 'audio/wav' })).status, 400);
});

test('recordings over the size limit get a clear 413', async () => {
    const res = await call('POST', '/api/transcribe', { audio: 'A'.repeat(1.6 * 1024 * 1024), mimeType: 'audio/wav' });
    assert.equal(res.status, 413);
    assert.match(res.body.message, /under 30 seconds/);
});

test('other requests keep the small body limit', async () => {
    const res = await call('POST', '/api/tasks', { prompt: 'x'.repeat(30 * 1024) });
    assert.equal(res.status, 413);
});
