// Runs a task: plan it, then take each purchase through the checks, in order:
//   1. your rules (code)  2. Gemini's judgment  3. your OK, if it's over the ask-me amount
//   4. PayPal sandbox payout  5. the vendor's own check of that payment, then delivery.
// Anything that fails or can't be decided stops that purchase before money moves.
const crypto = require('crypto');
const config = require('./config');
const paypal = require('./paypal');
const gemini = require('./gemini');
const sessions = require('./sessions');
const { findVendor, findItem, categoryLabel } = require('./catalog');
const { checkPurchase, formatMoney, toCents } = require('./rules');
const { findAttack } = require('./attacks');

const RESERVED_PARAMS = new Set(['qty', 'quote', 'payment']);
const waiters = new Map(); // purchaseId -> settle(decision), while a purchase waits for the owner's OK

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function titleFor(p) {
    switch (p.itemId) {
        case 'company_profile': return plural(p.quantity, 'company profile');
        case 'article': return plural(p.quantity, 'trade article');
        case 'credit_report':
            return p.params.company && p.params.company !== '@top_result' ? `Credit report: ${p.params.company}` : 'Credit report on the top prospect';
        default: return p.quantity > 1 && p.itemId ? `${p.quantity} × ${p.itemName}` : p.itemName;
    }
}

function describeDelivery(d) {
    if (!d) return 'Nothing';
    if (d.companies) return plural(d.companies.length, 'company profile');
    if (d.articles) return plural(d.articles.length, 'article');
    if (d.facts) return plural(d.facts.length, 'fact');
    if (d.report && d.report.rating) return `Credit report on ${d.report.company}`;
    if (d.report) return d.report.title;
    return 'Delivered';
}

function flagLabel(flags) {
    if (flags.includes('prompt_injection')) return 'hidden instructions';
    if (flags.includes('price_mismatch')) return 'price looks wrong';
    if (flags.includes('not_needed')) return 'not needed for the task';
    if (flags.includes('suspicious')) return 'looks suspicious';
    return 'said no';
}

function log(p, kind, label, detail, extra = {}) {
    p.timeline.push({ at: now(), kind, label, detail: detail || '', ...extra });
}

function finish(p, outcome, decidedBy, outcomeReason) {
    Object.assign(p, { status: 'done', outcome, decidedBy, outcomeReason, finishedAt: now() });
}

const notReached = (p) => {
    p.checks.paypal = { status: 'not_reached' };
    p.checks.vendor = { status: 'not_reached' };
};

const isStopped = (session, task) => session.ended || task.stopRequested;

function createPurchase(session, task, step, index) {
    const vendor = step.vendorId ? findVendor(step.vendorId) : null;
    const item = vendor ? findItem(vendor.id, step.itemId) : null;
    const p = {
        id: newId('p'),
        taskId: task.id,
        index,
        createdAt: now(),
        finishedAt: null,
        vendorId: item ? vendor.id : null,
        vendorName: item ? vendor.name : null,
        itemId: item ? item.id : null,
        itemName: item ? item.name : step.itemName || 'Unlisted item',
        quantity: step.quantity,
        params: { ...(step.params || {}) },
        category: item ? vendor.category : step.category || 'other',
        reason: step.reason || '',
        amountCents: item ? item.unitCents * step.quantity : step.estimatedCents || 0,
        status: 'queued',
        outcome: null,
        decidedBy: null,
        outcomeReason: null,
        quote: null,
        checks: {
            rules: { status: 'pending' },
            gemini: { status: 'pending' },
            approval: { status: 'not_needed' },
            paypal: { status: 'waiting' },
            vendor: { status: 'waiting' },
        },
        delivered: null,
        deliveryError: null,
        budgetBeforeCents: null,
        budgetAfterCents: null,
        timeline: [],
    };
    p.categoryLabel = categoryLabel(p.category);
    p.title = titleFor(p);
    session.purchases.set(p.id, p);
    task.purchaseIds.push(p.id);
    return p;
}

async function callVendor(vendor, p, extra = {}) {
    const url = new URL(`${config.vendorBaseUrl}/${vendor.id}/${p.itemId}`);
    url.searchParams.set('qty', String(p.quantity));
    for (const [key, value] of Object.entries(p.params)) if (!RESERVED_PARAMS.has(key)) url.searchParams.set(key, String(value));
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value));
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

function topCompany(session, task) {
    for (const id of task.purchaseIds) {
        const companies = session.purchases.get(id).delivered && session.purchases.get(id).delivered.companies;
        if (companies && companies.length) return companies[0];
    }
    return null;
}

function earlierPurchases(session, task, current) {
    return task.purchaseIds
        .map((id) => session.purchases.get(id))
        .filter((p) => p.index < current.index)
        .map((p) => `${p.title} from ${p.vendorName || 'no vendor'}: ${p.outcome || p.status}`);
}

function waitForApproval(task, p) {
    const expiresAt = Date.now() + config.approvalMinutes * 60 * 1000;
    p.status = 'approval';
    p.checks.approval = { status: 'waiting', expiresAt: new Date(expiresAt).toISOString() };
    task.status = 'waiting_approval';
    return new Promise((resolve) => {
        const timer = setTimeout(() => settle('expired'), expiresAt - Date.now());
        function settle(decision) {
            clearTimeout(timer);
            waiters.delete(p.id);
            resolve(decision);
        }
        waiters.set(p.id, settle);
    }).then((decision) => {
        task.status = 'running';
        p.checks.approval = { status: { approve: 'approved', skip: 'skipped', expired: 'expired', stopped: 'stopped' }[decision], decidedAt: now() };
        return decision;
    });
}

async function refreshPayout(p) {
    if (!p.checks.paypal.batchId) return p;
    const body = await paypal.getPayout(p.checks.paypal.batchId);
    const item = (body.items || [])[0];
    Object.assign(p.checks.paypal, {
        batchStatus: body.batch_header && body.batch_header.batch_status,
        itemId: item ? item.payout_item_id : null,
        itemStatus: item ? item.transaction_status : null,
        raw: paypal.forDisplay(body),
        checkedAt: now(),
    });
    return p;
}

async function processPurchase(session, task, p) {
    const vendor = p.vendorId ? findVendor(p.vendorId) : null;

    if (p.params.company === '@top_result') {
        const top = topCompany(session, task);
        if (!top) {
            notReached(p);
            return finish(p, 'skipped', 'Nothing to check', 'No company was found earlier in this task, so there was nothing to check. No money moved.');
        }
        p.params.company = top.name;
        p.title = titleFor(p);
    }

    // The vendor names its price with an HTTP 402 before any money moves.
    p.status = 'quoting';
    if (vendor) {
        let res;
        try {
            res = await callVendor(vendor, p);
        } catch (err) {
            notReached(p);
            log(p, 'no', `Couldn't reach ${vendor.name}`, err.message);
            return finish(p, 'failed', `${vendor.name} unreachable`, `Couldn't reach ${vendor.name}, so nothing was bought. No money moved.`);
        }
        if (res.status !== 402) {
            const message = res.body.message || `${vendor.name} couldn't sell this.`;
            notReached(p);
            log(p, 'no', `${vendor.name} couldn't sell this`, message);
            return finish(p, 'failed', `${vendor.name} declined`, `${message} No money moved.`);
        }
        p.quote = { id: res.body.quoteId, priceCents: toCents(res.body.price), body: res.body };
        p.amountCents = p.quote.priceCents;
        p.quantity = res.body.quantity || p.quantity;
        p.title = typeof res.body.title === 'string' && res.body.title ? res.body.title.slice(0, 80) : titleFor(p);
        log(p, 'neutral', `${vendor.name} asked for payment`, `HTTP 402 · ${formatMoney(p.amountCents)} for ${res.body.description || p.title}`);
        if (task.guardrails === false) await takeVendorsWord(vendor, p, res.body);
    } else {
        log(p, 'neutral', 'No approved vendor sells this', `The agent estimated ${formatMoney(p.amountCents)}.`);
    }

    // With guardrails on, three checks decide. With them off nothing does, though the rules still
    // run silently so you can see what they would have said.
    if (task.guardrails === false) {
        if (skipChecks(session, p, vendor)) return undefined;
        if (p.amountCents > config.unguardedPayoutLimitCents) return simulatePayout(session, p);
    } else if (await stoppedByChecks(session, task, p)) {
        return undefined;
    }
    return payAndCollect(session, task, p, vendor);
}

// Guardrails off: a "pre-approved" add-on in the quote gets added, because nothing questions it.
async function takeVendorsWord(vendor, p, quote) {
    const addOn = quote.addOn;
    if (addOn && addOn.preApproved && addOn.id) {
        const upsell = await callVendor(vendor, p, { addon: addOn.id }).catch(() => null);
        if (!upsell || upsell.status !== 402) return;
        p.quote = { id: upsell.body.quoteId, priceCents: toCents(upsell.body.price), body: upsell.body };
        p.amountCents = p.quote.priceCents;
        p.title = typeof upsell.body.title === 'string' && upsell.body.title ? upsell.body.title.slice(0, 80) : p.title;
        p.tookVendorsWord = { name: addOn.name, price: addOn.price, billing: addOn.billing };
        log(p, 'no', `Took ${vendor.name}'s word for it`, `The quote said you'd pre-approved the ${addOn.name} ($${addOn.price} a month), and nothing checked that, so it was added. New total: ${formatMoney(p.amountCents)}.`);
    } else if (quote.note) {
        log(p, 'no', 'Nobody read the fine print', `The quote carried a note aimed at the agent ("${String(quote.note).slice(0, 120)}"). With guardrails off, nothing checked it.`);
    }
}

function skipChecks(session, p, vendor) {
    const verdict = checkPurchase({ rules: session.rules, leftCents: sessions.leftCents(session), amountCents: p.amountCents, category: p.category, vendorId: p.vendorId });
    p.checks.rules = { status: 'off', items: verdict.checks, wouldBlock: verdict.blockedBy, wouldAsk: verdict.needsApproval };
    p.checks.gemini = { status: 'off' };
    p.checks.approval = { status: 'off' };
    const would = verdict.blockedBy ? `Your rules would have blocked it: ${verdict.blockedBy}.` : verdict.needsApproval ? 'Your rules would have asked you first.' : 'Your rules would have allowed it.';
    log(p, 'no', 'No checks: guardrails are off', `${would} Gemini wasn't asked.`);
    if (vendor) return false;
    notReached(p);
    finish(p, 'failed', 'No vendor sells this', 'Even with no guardrails, no vendor sells this, so there was nothing to buy.');
    return true;
}

function simulatePayout(session, p) {
    p.budgetBeforeCents = session.rules.budgetCents - session.spentCents;
    session.spentCents += p.amountCents;
    p.budgetAfterCents = session.rules.budgetCents - session.spentCents;
    p.checks.paypal = { status: 'simulated', limitCents: config.unguardedPayoutLimitCents };
    p.checks.vendor = { status: 'not_reached' };
    log(p, 'no', 'Payout simulated, not sent', `It's over the ${formatMoney(config.unguardedPayoutLimitCents)} limit for unguarded payouts in this shared sandbox. With real money, ${formatMoney(p.amountCents)} would be gone.`);
    finish(p, 'paid', 'No checks (guardrails off)', null);
}

// Returns true when a check stopped the purchase (it's already finished, with the reason).
async function stoppedByChecks(session, task, p) {
    // Check 1: the owner's rules, in code.
    p.status = 'rules';
    const started = process.hrtime.bigint();
    const verdict = checkPurchase({
        rules: session.rules,
        leftCents: sessions.leftCents(session),
        amountCents: p.amountCents,
        category: p.category,
        vendorId: p.vendorId,
    });
    p.checks.rules = {
        status: verdict.passed ? 'passed' : 'blocked',
        items: verdict.checks,
        blockedBy: verdict.blockedBy,
        needsApproval: verdict.needsApproval,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
    };
    if (!verdict.passed) {
        p.checks.gemini = { status: 'skipped' };
        notReached(p);
        log(p, 'no', 'Blocked by your rules', verdict.blockedBy);
        finish(p, 'blocked', `Your rules: ${verdict.shortReason}`, `${verdict.blockedBy}. Gemini was never asked, and no money moved.`);
        return true;
    }
    log(p, 'ok', 'Your rules passed', verdict.checks.map((c) => c.label).join(' · '));
    if (isStopped(session, task)) {
        notReached(p);
        finish(p, 'stopped', 'You stopped the agent', 'You stopped the agent before this purchase. No money moved.');
        return true;
    }

    // Check 2: Gemini's judgment. No answer means no purchase.
    p.status = 'gemini';
    p.checks.gemini = { status: 'checking', startedAt: now() };
    const t0 = Date.now();
    let judgment;
    try {
        judgment = await gemini.judgePurchase({ task, purchase: p, leftCents: sessions.leftCents(session), earlier: earlierPurchases(session, task, p) });
    } catch (err) {
        p.checks.gemini = { status: 'error', reason: `I couldn't get a decision (${err.message}), so I didn't buy.`, ms: Date.now() - t0 };
        notReached(p);
        log(p, 'no', 'No decision from Gemini', 'Fail-safe: without a decision, the agent does not buy.');
        finish(p, 'denied', 'Fail-safe: no answer from Gemini', `Gemini couldn't be reached (${err.message}), and without a decision the agent doesn't buy. No money moved.`);
        return true;
    }
    const approved = judgment.decision === 'APPROVE';
    p.checks.gemini = { status: approved ? 'approved' : 'denied', reason: judgment.reason, flags: judgment.flags, ms: Date.now() - t0 };
    if (!approved) {
        notReached(p);
        log(p, 'no', 'Gemini denied', judgment.reason, { quote: true });
        finish(p, 'denied', `Gemini: ${flagLabel(judgment.flags)}`, judgment.reason);
        return true;
    }
    log(p, 'ok', 'Gemini approved', judgment.reason, { quote: true });

    // Check 3: the owner's OK, for anything over their ask-me amount.
    if (verdict.needsApproval) {
        const decision = isStopped(session, task) ? 'stopped' : await waitForApproval(task, p);
        if (decision !== 'approve') {
            const why = {
                skip: ['You skipped it', 'You skipped this purchase. No money moved.'],
                expired: ['No answer in time', `Nobody approved it within ${config.approvalMinutes} minutes, so the agent skipped it. No money moved.`],
                stopped: ['You stopped the agent', 'You stopped the agent before this purchase. No money moved.'],
            }[decision];
            notReached(p);
            log(p, 'you', why[0], '');
            finish(p, decision === 'stopped' ? 'stopped' : 'skipped', why[0], why[1]);
            return true;
        }
        log(p, 'you', 'You approved', `${formatMoney(p.amountCents)}, over your ${formatMoney(session.rules.askAboveCents)} ask-me amount`);
    }
    if (p.amountCents > sessions.leftCents(session)) {
        notReached(p);
        log(p, 'no', 'Blocked by your rules', 'Not enough budget left');
        finish(p, 'blocked', 'Your rules: not enough budget left', 'Not enough budget left. No money moved.');
        return true;
    }
    return false;
}

async function payAndCollect(session, task, p, vendor) {
    // Pay the vendor's registered account (never an address taken from the quote).
    p.status = 'paying';
    p.checks.paypal = { status: 'sending' };
    const receiver = config.vendorEmail(vendor.id);
    session.reservedCents += p.amountCents;
    let payout;
    try {
        payout = await paypal.sendPayout({ amountCents: p.amountCents, receiver, senderItemId: p.quote.id, note: `${p.title} from ${vendor.name}` });
    } catch (err) {
        session.reservedCents -= p.amountCents;
        p.checks.paypal = { status: 'failed', error: err.message };
        p.checks.vendor = { status: 'not_reached' };
        log(p, 'no', 'PayPal payout failed', err.message);
        return finish(p, 'failed', 'PayPal payout failed', `PayPal didn't accept the payout (${err.message}), so no money moved.`);
    }
    session.reservedCents -= p.amountCents;
    p.budgetBeforeCents = session.rules.budgetCents - session.spentCents;
    session.spentCents += p.amountCents;
    p.budgetAfterCents = session.rules.budgetCents - session.spentCents;
    p.checks.paypal = { status: 'paid', batchId: payout.batchId, batchStatus: payout.batchStatus, receiver };
    log(p, 'ok', 'PayPal sandbox payout sent', `Batch ${payout.batchId} · ${payout.batchStatus}`);

    // The vendor checks the payment with PayPal itself before it delivers.
    p.status = 'verifying';
    let delivery;
    try {
        delivery = await callVendor(vendor, p, { quote: p.quote.id, payment: payout.batchId });
    } catch (err) {
        delivery = { status: 0, body: { message: err.message } };
    }
    if (delivery.status === 200) {
        p.checks.vendor = { status: 'verified', checks: delivery.body.checks };
        p.delivered = delivery.body.data;
        log(p, 'ok', `${vendor.name} checked the payment`, `Amount matches · paid to ${vendor.name} · made for this quote · not used before`);
        log(p, 'ok', 'Delivered', describeDelivery(p.delivered));
    } else {
        p.checks.vendor = { status: 'rejected', checks: delivery.body.checks || null, message: delivery.body.message || '' };
        p.deliveryError = `${vendor.name} didn't deliver: ${delivery.body.message || 'no reason given'}`;
        log(p, 'no', `${vendor.name} didn't deliver`, delivery.body.message || '');
    }
    await refreshPayout(p).catch(() => {});
    const decidedBy = task.guardrails === false ? 'No checks (guardrails off)' : p.checks.approval.status === 'approved' ? 'You approved' : 'Your rules + Gemini';
    return finish(p, 'paid', decidedBy, null);
}

async function run(session, task, attack) {
    if (task.kind === 'mission') {
        // Required here, not at the top: mission.js uses this file's purchase pipeline.
        return require('./mission').runMission(session, task, { createPurchase, processPurchase, callVendor, isStopped });
    }
    let plan;
    if (attack) {
        plan = structuredClone(attack.plan);
    } else {
        try {
            plan = await gemini.planTask({ prompt: task.prompt, rules: session.rules, leftCents: sessions.leftCents(session) });
        } catch (err) {
            task.status = 'failed';
            task.error = `Gemini couldn't plan this task, so nothing was bought. (${err.message})`;
            return;
        }
    }
    if (isStopped(session, task)) {
        task.status = 'stopped';
        return;
    }
    task.summary = plan.summary || '';
    plan.purchases.forEach((step, i) => createPurchase(session, task, step, i));
    task.status = 'running';
    for (const id of task.purchaseIds) {
        const p = session.purchases.get(id);
        if (isStopped(session, task)) {
            notReached(p);
            finish(p, 'stopped', 'You stopped the agent', 'You stopped the agent before this purchase. No money moved.');
            continue;
        }
        await processPurchase(session, task, p);
    }
    task.status = isStopped(session, task) ? 'stopped' : 'done';
}

function startTask(session, { prompt, attackId, mission }) {
    const attack = attackId ? findAttack(attackId) : null;
    const task = {
        id: newId('t'),
        kind: attack ? 'attack' : mission ? 'mission' : 'task',
        guardrails: session.guardrails !== false,
        prompt: attack ? attack.prompt : prompt,
        attackId: attack ? attack.id : null,
        mission: null,
        status: 'planning',
        createdAt: now(),
        finishedAt: null,
        summary: '',
        error: null,
        purchaseIds: [],
        stopRequested: false,
    };
    session.tasks.set(task.id, task);
    session.activeTaskId = task.id;
    session.taskCount += 1;
    run(session, task, attack)
        .catch((err) => {
            console.error(`Task ${task.id} crashed:`, err);
            task.status = 'failed';
            task.error = 'Something went wrong on the server, so the agent stopped. Nothing was bought after the error.';
            if (task.mission) task.mission.now = null;
            for (const id of task.purchaseIds) {
                const p = session.purchases.get(id);
                if (p.status !== 'done') finish(p, 'failed', 'Server error', 'The agent stopped because of a server error.');
            }
            session.reservedCents = 0;
        })
        .finally(() => {
            task.finishedAt = now();
            if (session.activeTaskId === task.id) session.activeTaskId = null;
        });
    return task;
}

function decide(purchaseId, decision) {
    const settle = waiters.get(purchaseId);
    if (!settle) return false;
    settle(decision);
    return true;
}

function stopTask(task) {
    task.stopRequested = true;
    for (const id of task.purchaseIds) decide(id, 'stopped');
}

sessions.onEnd((session) => {
    for (const task of session.tasks.values()) stopTask(task);
});

module.exports = { startTask, stopTask, decide, refreshPayout };
