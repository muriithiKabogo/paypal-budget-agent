// The JSON API the web app talks to. Everything is scoped to the visitor's sandbox session.
const express = require('express');
const config = require('./config');
const sessions = require('./sessions');
const agent = require('./agent');
const gemini = require('./gemini');
const paypal = require('./paypal');
const { publicCatalog, DEFAULT_RULES } = require('./catalog');
const { validateRules } = require('./rules');
const { findAttack, publicAttacks } = require('./attacks');

const COOKIE = 'allowance_sid';
const router = express.Router();

function readCookie(req) {
    for (const part of (req.headers.cookie || '').split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === COOKIE) return decodeURIComponent(rest.join('='));
    }
    return null;
}

function setCookie(req, res, value, maxAgeSeconds) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

function needSession(req, res, next) {
    const session = sessions.get(readCookie(req));
    if (!session) return res.status(401).json({ error: 'no_session', message: 'Your sandbox session has ended.' });
    req.sandbox = session;
    return next();
}

const isActive = (task) => ['planning', 'running', 'waiting_approval'].includes(task.status);

function taskPayload(session, task) {
    return {
        task,
        purchases: task.purchaseIds.map((id) => session.purchases.get(id)),
        // Other blocked attempts this session, for the "blocked" screen.
        others: [...session.purchases.values()]
            .filter((p) => p.taskId !== task.id && ['blocked', 'denied'].includes(p.outcome))
            .reverse()
            .slice(0, 10),
        session: sessions.toPublic(session),
    };
}

function findOwned(session, map, id) {
    return session[map].get(id) || null;
}

router.get('/config', (req, res) => {
    res.json({
        model: gemini.MODEL,
        sessionMinutes: config.sessionMinutes,
        approvalMinutes: config.approvalMinutes,
        demoVideoUrl: config.demoVideoUrl || null,
        geminiConfigured: gemini.isConfigured(),
        transcription: gemini.isConfigured(),
        liveTranscription: gemini.isConfigured(),
        paypalConfigured: paypal.isConfigured(),
    });
});

router.get('/catalog', (req, res) => {
    res.json({ ...publicCatalog(), attacks: publicAttacks() });
});

// No session is a normal state here (the landing page asks), so it's a 200 with null, not an error.
router.get('/session', (req, res) => {
    const session = sessions.get(readCookie(req));
    res.json({ session: session ? sessions.toPublic(session) : null });
});

// Starts a fresh session (and ends the old one), with the rules from the "Set the rules" screen.
router.post('/session', (req, res) => {
    let rules = DEFAULT_RULES;
    if (req.body && req.body.rules) {
        const result = validateRules(req.body.rules);
        if (!result.ok) return res.status(400).json({ error: 'invalid_rules', errors: result.errors, message: 'Some rules need fixing.' });
        rules = result.rules;
    }
    const old = readCookie(req);
    if (old) sessions.end(old);
    const session = sessions.create(rules);
    setCookie(req, res, session.id, config.sessionMinutes * 60);
    return res.status(201).json({ session: sessions.toPublic(session) });
});

router.put('/session/rules', needSession, (req, res) => {
    const session = req.sandbox;
    if (session.activeTaskId) return res.status(409).json({ error: 'task_running', message: 'Wait for the running task to finish before changing the rules.' });
    const result = validateRules(req.body && req.body.rules, { spentCents: session.spentCents });
    if (!result.ok) return res.status(400).json({ error: 'invalid_rules', errors: result.errors, message: 'Some rules need fixing.' });
    session.rules = result.rules;
    return res.json({ session: sessions.toPublic(session) });
});

// The guardrails switch. Off means no rules, no Gemini check and no asking: the agent buys what it
// plans and takes vendors at their word. Sandbox money only; big payouts are simulated.
router.put('/session/guardrails', needSession, (req, res) => {
    const session = req.sandbox;
    if (typeof (req.body && req.body.on) !== 'boolean') return res.status(400).json({ error: 'invalid_switch', message: 'Send { "on": true } or { "on": false }.' });
    if (session.activeTaskId) return res.status(409).json({ error: 'task_running', message: 'Wait for the running task to finish before switching the guardrails.' });
    session.guardrails = req.body.on;
    return res.json({ session: sessions.toPublic(session) });
});

router.delete('/session', (req, res) => {
    const id = readCookie(req);
    if (id) sessions.end(id);
    setCookie(req, res, '', 0);
    res.status(204).end();
});

router.post('/tasks', needSession, (req, res) => {
    const session = req.sandbox;
    if (session.activeTaskId) {
        return res.status(409).json({ error: 'task_running', taskId: session.activeTaskId, message: 'The agent is already working on a task.' });
    }
    if (session.taskCount >= config.maxTasksPerSession) {
        return res.status(429).json({ error: 'task_limit', message: `This session has used its ${config.maxTasksPerSession} tasks. Reset to start a fresh one.` });
    }
    const attackId = req.body && req.body.attackId;
    const prompt = typeof (req.body && req.body.prompt) === 'string' ? req.body.prompt.trim() : '';
    if (attackId && !findAttack(attackId)) return res.status(400).json({ error: 'unknown_attack', message: 'That attack does not exist.' });
    if (!attackId && (prompt.length < 3 || prompt.length > 500)) {
        return res.status(400).json({ error: 'invalid_prompt', message: 'Describe the task in 3 to 500 characters.' });
    }
    // A website goal becomes a mission, whether it came from the mission card, typing or the mic.
    const mission = !attackId && ((req.body && req.body.mission === true) || /\b(launch|build|create|set ?up|start|make)\b[\s\S]{0,60}\b(website|web ?site|site|landing page|web ?page|online store)\b/i.test(prompt));
    const task = agent.startTask(session, { prompt, attackId, mission });
    return res.status(201).json(taskPayload(session, task));
});

router.get('/tasks/:id', needSession, (req, res) => {
    const task = findOwned(req.sandbox, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: 'not_found', message: 'No such task in this session.' });
    return res.json(taskPayload(req.sandbox, task));
});

router.post('/tasks/:id/stop', needSession, (req, res) => {
    const task = findOwned(req.sandbox, 'tasks', req.params.id);
    if (!task) return res.status(404).json({ error: 'not_found', message: 'No such task in this session.' });
    if (isActive(task)) agent.stopTask(task);
    return res.json(taskPayload(req.sandbox, task));
});

router.get('/purchases/:id', needSession, (req, res) => {
    const session = req.sandbox;
    const purchase = findOwned(session, 'purchases', req.params.id);
    if (!purchase) return res.status(404).json({ error: 'not_found', message: 'No such purchase in this session.' });
    const task = session.tasks.get(purchase.taskId);
    const others = [...session.purchases.values()].filter((p) => p.id !== purchase.id && ['blocked', 'denied'].includes(p.outcome)).reverse().slice(0, 10);
    return res.json({ purchase, task, others, session: sessions.toPublic(session) });
});

router.post('/purchases/:id/decision', needSession, (req, res) => {
    const purchase = findOwned(req.sandbox, 'purchases', req.params.id);
    if (!purchase) return res.status(404).json({ error: 'not_found', message: 'No such purchase in this session.' });
    const decision = req.body && req.body.decision;
    if (!['approve', 'skip'].includes(decision)) return res.status(400).json({ error: 'invalid_decision', message: 'Decision must be "approve" or "skip".' });
    if (!agent.decide(purchase.id, decision)) return res.status(409).json({ error: 'not_waiting', message: 'This purchase is no longer waiting for your OK.' });
    return res.json({ ok: true });
});

router.post('/purchases/:id/refresh', needSession, async (req, res) => {
    const purchase = findOwned(req.sandbox, 'purchases', req.params.id);
    if (!purchase) return res.status(404).json({ error: 'not_found', message: 'No such purchase in this session.' });
    try {
        await agent.refreshPayout(purchase);
    } catch (err) {
        return res.status(502).json({ error: 'paypal_unreachable', message: `Couldn't reach PayPal: ${err.message}` });
    }
    return res.json({ purchase });
});

// Live dictation in browsers without a built-in speech service: a single-use token the browser uses
// to stream mic audio to Gemini's streaming transcription model. The console asks for one on every
// visit (to have the connection ready), so it has its own, higher cap.
router.post('/voice-token', needSession, async (req, res) => {
    const session = req.sandbox;
    if (!gemini.isConfigured()) {
        return res.status(503).json({ error: 'transcription_unavailable', message: 'Voice input needs a Gemini API key on the server. Type the task instead.' });
    }
    if (session.voiceTokens >= config.maxVoiceTokensPerSession) {
        return res.status(429).json({ error: 'transcription_limit', message: 'This session has used up its voice input. Type the task, or reset for a fresh session.' });
    }
    session.voiceTokens += 1;
    try {
        return res.json(await gemini.takeLiveToken());
    } catch (err) {
        return res.status(502).json({ error: 'token_failed', message: `Live dictation couldn't start (${err.message}).` });
    }
});

// The mic button's last fallback: a short WAV in, text out (no streaming).
router.post('/transcribe', needSession, async (req, res) => {
    const session = req.sandbox;
    const { audio, mimeType } = req.body || {};
    if (!gemini.isConfigured()) {
        return res.status(503).json({ error: 'transcription_unavailable', message: 'Voice input needs a Gemini API key on the server. Type the task instead.' });
    }
    if (mimeType !== 'audio/wav' || typeof audio !== 'string' || !audio || !/^[A-Za-z0-9+/]+=*$/.test(audio)) {
        return res.status(400).json({ error: 'invalid_audio', message: "That recording couldn't be read. Try again, or type the task." });
    }
    if (session.transcriptions >= config.maxTranscriptionsPerSession) {
        return res.status(429).json({ error: 'transcription_limit', message: 'This session has used up its voice input. Type the task, or reset for a fresh session.' });
    }
    session.transcriptions += 1;
    try {
        return res.json({ text: await gemini.transcribe({ audioBase64: audio, mimeType }) });
    } catch (err) {
        return res.status(502).json({ error: 'transcription_failed', message: `Couldn't transcribe that (${err.message}). Try again, or type the task.` });
    }
});

router.get('/ledger', needSession, (req, res) => {
    const session = req.sandbox;
    const purchases = [...session.purchases.values()]
        .filter((p) => p.status === 'done')
        .reverse()
        .map((p) => ({ ...p, taskPrompt: session.tasks.get(p.taskId).prompt }));
    res.json({ purchases, session: sessions.toPublic(session) });
});

router.use((req, res) => res.status(404).json({ error: 'not_found', message: 'No such API route.' }));

module.exports = { router };
