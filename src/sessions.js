// Every visitor gets their own sandbox session: a fresh budget, their own rules and ledger,
// gone after 30 minutes. Kept in memory on purpose; nothing here needs to outlive a restart.
const crypto = require('crypto');
const config = require('./config');
const { DEFAULT_RULES } = require('./catalog');

const sessions = new Map();
const endListeners = [];

function create(rules = DEFAULT_RULES) {
    if (sessions.size >= config.maxSessions) {
        const oldest = [...sessions.values()].reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
        end(oldest.id);
    }
    const now = Date.now();
    const session = {
        id: crypto.randomBytes(24).toString('base64url'),
        createdAt: now,
        expiresAt: now + config.sessionMinutes * 60 * 1000,
        rules: structuredClone(rules),
        spentCents: 0,
        reservedCents: 0,
        tasks: new Map(),
        purchases: new Map(),
        activeTaskId: null,
        taskCount: 0,
        transcriptions: 0,
        voiceTokens: 0,
        guardrails: true,
        ended: false,
    };
    sessions.set(session.id, session);
    return session;
}

function get(id) {
    const session = id ? sessions.get(id) : null;
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        end(id);
        return null;
    }
    return session;
}

function end(id) {
    const session = sessions.get(id);
    if (!session) return;
    session.ended = true;
    sessions.delete(id);
    for (const fn of endListeners) fn(session);
}

function onEnd(fn) {
    endListeners.push(fn);
}

function leftCents(session) {
    return session.rules.budgetCents - session.spentCents - session.reservedCents;
}

function toPublic(session) {
    return {
        expiresAt: new Date(session.expiresAt).toISOString(),
        rules: session.rules,
        budgetCents: session.rules.budgetCents,
        spentCents: session.spentCents,
        reservedCents: session.reservedCents,
        leftCents: session.rules.budgetCents - session.spentCents,
        activeTaskId: session.activeTaskId,
        taskCount: session.taskCount,
        maxTasks: config.maxTasksPerSession,
        guardrails: session.guardrails,
        unguardedPayoutLimitCents: config.unguardedPayoutLimitCents,
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now > s.expiresAt) end(id);
}, 60 * 1000).unref();

module.exports = { create, get, end, onEnd, leftCents, toPublic };
