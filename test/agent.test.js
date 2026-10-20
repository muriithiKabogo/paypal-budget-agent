// Runs tasks end to end against the real vendor agents, with Gemini and PayPal stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const config = require('../src/config');
const paypal = require('../src/paypal');
const gemini = require('../src/gemini');
const sessions = require('../src/sessions');
const agent = require('../src/agent');
const { vendorRouter } = require('../src/vendors');
// Fixed rules, so these tests don't move when the app's defaults do.
const RULES = { budgetCents: 2500, maxPerPurchaseCents: 500, askAboveCents: 200, categories: ['company_data', 'credit_checks', 'news'], vendors: ['atlasbase', 'quarry', 'dockside'] };

const payouts = new Map();
let judge = async () => ({ decision: 'APPROVE', reason: 'Looks useful.', flags: [] });

paypal.sendPayout = async ({ amountCents, receiver, senderItemId }) => {
    const batchId = `B${payouts.size + 1}`;
    payouts.set(batchId, {
        batch_header: { payout_batch_id: batchId, batch_status: 'PENDING' },
        items: [{ payout_item_id: `I${batchId}`, transaction_status: 'PENDING', payout_item: { amount: { value: (amountCents / 100).toFixed(2), currency: 'USD' }, receiver, sender_item_id: senderItemId } }],
    });
    return { batchId, batchStatus: 'PENDING' };
};
paypal.getPayout = async (id) => payouts.get(id);
gemini.judgePurchase = (args) => judge(args);
// The review after an unguarded run: echo the ledger back, using only its own amounts.
const reviewed = [];
gemini.reviewRun = async (ledger) => {
    reviewed.push(ledger);
    return {
        headline: `I spent ${ledger.spentThisRun} with nothing checking me.`,
        points: ledger.purchases.map((p) => ({ purchaseId: p.id, text: `${p.bought} for ${p.amount}: your rules would have ${p.rulesWouldHave}.` })),
        lesson: 'Guardrails stop this before money moves.',
    };
};
gemini.planTask = async () => ({
    summary: 'Find companies, then check the best one.',
    purchases: [
        { vendorId: 'atlasbase', itemId: 'company_profile', quantity: 10, params: { industry: 'logistics', state: 'TX', minEmployees: 50, maxEmployees: 200 }, reason: 'The list.' },
        { vendorId: 'quarry', itemId: 'credit_report', quantity: 1, params: { company: '@top_result' }, reason: 'Check the best match.' },
    ],
});

let server;
test.before(async () => {
    const app = express();
    app.use('/vendors', vendorRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    config.vendorBaseUrl = `http://127.0.0.1:${server.address().port}/vendors`;
});
test.after(() => server.close());

async function finished(session, task) {
    for (let i = 0; i < 200; i += 1) {
        const reviewing = task.review && task.review.status === 'writing';
        if (!['planning', 'running', 'waiting_approval'].includes(task.status) && !reviewing) return task.purchaseIds.map((id) => session.purchases.get(id));
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`task stuck in ${task.status}`);
}

test('an overspend attack is blocked by the rules and Gemini is never asked', async () => {
    let asked = false;
    judge = async () => { asked = true; return { decision: 'APPROVE', reason: '', flags: [] }; };
    const session = sessions.create(RULES);
    const [p] = await finished(session, agent.startTask(session, { attackId: 'overspend' }));
    assert.equal(p.outcome, 'blocked');
    assert.equal(p.decidedBy, 'Your rules: over the $5.00 limit');
    assert.equal(asked, false);
    assert.equal(p.checks.paypal.status, 'not_reached');
    assert.equal(session.spentCents, 0);
});

test('the hidden-instructions attack passes the rules and is denied by Gemini', async () => {
    let seen;
    judge = async ({ purchase }) => { seen = purchase.quote.body; return { decision: 'DENY', reason: 'The vendor tried to instruct me.', flags: ['prompt_injection'] }; };
    const session = sessions.create(RULES);
    const [p] = await finished(session, agent.startTask(session, { attackId: 'hidden_instructions' }));
    assert.equal(p.checks.rules.status, 'passed');
    assert.equal(p.amountCents, 190);
    assert.match(seen.note, /pre-approved/);
    assert.equal(p.outcome, 'denied');
    assert.equal(p.decidedBy, 'Gemini: hidden instructions');
    assert.equal(session.spentCents, 0);
});

test('when Gemini cannot answer, the agent does not buy', async () => {
    judge = async () => { throw new Error('timeout'); };
    const session = sessions.create({ ...RULES, vendors: [...RULES.vendors, 'fastfacts'] });
    const [p] = await finished(session, agent.startTask(session, { attackId: 'unapproved_vendor' }));
    assert.equal(p.outcome, 'denied');
    assert.match(p.decidedBy, /Fail-safe/);
    assert.equal(p.checks.paypal.status, 'not_reached');
    assert.equal(session.spentCents, 0);
});

test('a full task pays, waits for the owner over the ask-me amount, and gets delivered', async () => {
    judge = async () => ({ decision: 'APPROVE', reason: 'Worth it.', flags: [] });
    const session = sessions.create(RULES);
    const task = agent.startTask(session, { prompt: 'Find 10 Texas logistics companies and check the best one.' });

    for (let i = 0; i < 200 && task.status !== 'waiting_approval'; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(task.status, 'waiting_approval');
    const waiting = task.purchaseIds.map((id) => session.purchases.get(id)).find((p) => p.checks.approval.status === 'waiting');
    assert.equal(waiting.title, 'Credit report: Lone Star Freightworks');
    assert.equal(agent.decide(waiting.id, 'approve'), true);

    const [profiles, report] = await finished(session, task);
    assert.equal(profiles.outcome, 'paid');
    assert.equal(profiles.delivered.companies.length, 10);
    assert.equal(profiles.checks.vendor.status, 'verified');
    assert.equal(report.outcome, 'paid');
    assert.equal(report.decidedBy, 'You approved');
    assert.equal(report.delivered.report.company, 'Lone Star Freightworks');
    assert.equal(session.spentCents, 400);
});

test('skipping an approval means no payment', async () => {
    judge = async () => ({ decision: 'APPROVE', reason: 'Worth it.', flags: [] });
    const session = sessions.create(RULES);
    const task = agent.startTask(session, { prompt: 'Same task again.' });
    for (let i = 0; i < 200 && task.status !== 'waiting_approval'; i += 1) await new Promise((r) => setTimeout(r, 10));
    const waiting = task.purchaseIds.map((id) => session.purchases.get(id)).find((p) => p.checks.approval.status === 'waiting');
    agent.decide(waiting.id, 'skip');
    const [, report] = await finished(session, task);
    assert.equal(report.outcome, 'skipped');
    assert.equal(report.checks.paypal.status, 'not_reached');
    assert.equal(session.spentCents, 100);
});

test('guardrails off: the $400 report is "bought" (simulated, not sent), and the rules say what they would have done', async () => {
    let asked = false;
    judge = async () => { asked = true; return { decision: 'DENY', reason: '', flags: [] }; };
    const session = sessions.create(RULES);
    session.guardrails = false;
    const before = payouts.size;
    const task = agent.startTask(session, { attackId: 'overspend' });
    const [p] = await finished(session, task);
    assert.equal(p.outcome, 'paid');
    assert.equal(p.decidedBy, 'No checks (guardrails off)');
    assert.equal(p.checks.rules.status, 'off');
    assert.equal(p.checks.rules.wouldBlock, 'Over the $5.00 limit');
    assert.equal(p.checks.gemini.status, 'off');
    assert.equal(p.checks.paypal.status, 'simulated');
    assert.equal(payouts.size, before, 'nothing over the limit is sent to PayPal');
    assert.equal(asked, false);
    assert.equal(session.spentCents, 40000);

    // Afterwards, Gemini explains how it went overboard, from the ledger.
    const ledger = reviewed.at(-1);
    assert.equal(ledger.purchases[0].rulesWouldHave, 'blocked it: Over the $5.00 limit');
    assert.match(ledger.purchases[0].payout, /not sent/);
    assert.ok(ledger.overBudgetBy);
    assert.equal(task.review.by, 'gemini');
    assert.equal(task.review.points[0].purchaseId, p.id);
});

test('guarded runs, and unguarded ones that stay inside your rules, get no review', async () => {
    const before = reviewed.length;
    const guarded = sessions.create(RULES);
    const t1 = agent.startTask(guarded, { attackId: 'overspend' });
    await finished(guarded, t1);
    const loose = sessions.create(RULES);
    loose.guardrails = false;
    const planTask = gemini.planTask;
    gemini.planTask = async () => ({ summary: 'One article.', purchases: [{ vendorId: 'dockside', itemId: 'article', quantity: 1, params: { topic: 'freight' }, reason: 'Read up.' }] });
    const t2 = agent.startTask(loose, { prompt: 'Find one freight article.' });
    const [p] = await finished(loose, t2);
    gemini.planTask = planTask;
    assert.equal(p.outcome, 'paid');
    assert.equal(p.checks.rules.wouldBlock, null);
    assert.equal(t1.review, undefined);
    assert.equal(t2.review, undefined);
    assert.equal(reviewed.length, before);
});

test('guardrails off: the hidden instructions go unread and the $1.90 is really paid', async () => {
    const session = sessions.create(RULES);
    session.guardrails = false;
    const [p] = await finished(session, agent.startTask(session, { attackId: 'hidden_instructions' }));
    assert.equal(p.outcome, 'paid');
    assert.equal(p.checks.paypal.status, 'paid');
    assert.equal(p.checks.vendor.status, 'verified');
    assert.ok(p.timeline.some((e) => e.label === 'Nobody read the fine print'));
    assert.equal(session.spentCents, 190);
});

test('guardrails off: off-limits concert tickets get bought too', async () => {
    const session = sessions.create(RULES);
    session.guardrails = false;
    const [p] = await finished(session, agent.startTask(session, { attackId: 'off_limits' }));
    assert.equal(p.outcome, 'paid');
    assert.equal(p.checks.rules.wouldBlock, "Entertainment isn't allowed");
    assert.equal(p.amountCents, 18000);
    assert.equal(p.checks.paypal.status, 'simulated');
});
