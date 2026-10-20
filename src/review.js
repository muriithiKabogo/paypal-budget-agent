// "Why it went overboard": after a run with guardrails off goes past the owner's rules, Gemini looks
// back over the ledger and explains what the agent did and which guardrail would have stopped it.
// With guardrails off nothing asked Gemini at the time, so this is written afterwards, from the facts.
// Every dollar amount in it has to be one from the ledger; if not, the plain summary is shown instead.
const gemini = require('./gemini');
const { formatMoney } = require('./rules');

const unchecked = (p) => p.outcome === 'paid' && p.checks.rules.status === 'off';

// What Gemini gets: the owner's limits and each unguarded purchase, with what the rules would have done.
function ledgerFor(session, task) {
    // Most costly first, which is the order the review should go in.
    const paid = task.purchaseIds.map((id) => session.purchases.get(id)).filter(unchecked).sort((a, b) => b.amountCents - a.amountCents);
    const { rules } = session;
    const overBy = session.spentCents - rules.budgetCents;
    const purchases = paid.map((p) => {
        const note = p.tookVendorsWord ? p.tookVendorsWord.note : p.quote && p.quote.body && p.quote.body.note;
        return {
            id: p.id,
            bought: p.title,
            vendor: p.vendorName,
            amount: formatMoney(p.amountCents),
            rulesWouldHave: p.checks.rules.wouldBlock ? `blocked it: ${p.checks.rules.wouldBlock}` : p.checks.rules.wouldAsk ? 'asked the owner first' : 'allowed it',
            ...(p.tookVendorsWord ? { vendorClaim: `the quote said the owner had pre-approved the ${p.tookVendorsWord.name} ($${p.tookVendorsWord.price} a month), so it was added to the ${formatMoney(p.tookVendorsWord.fromCents)} price` } : {}),
            ...(note ? { vendorNote: String(note).slice(0, 300) } : {}),
            ...(p.checks.paypal.status === 'simulated' ? { payout: 'recorded but not sent: too big for the shared sandbox' } : {}),
        };
    });
    const wentOverboard = overBy > 0 || paid.some((p) => p.checks.rules.wouldBlock || p.tookVendorsWord);
    if (!wentOverboard) return null;
    return {
        task: task.prompt,
        rules: {
            budget: formatMoney(rules.budgetCents),
            maxPerPurchase: formatMoney(rules.maxPerPurchaseCents),
            askAbove: formatMoney(rules.askAboveCents),
        },
        spentThisRun: formatMoney(paid.reduce((sum, p) => sum + p.amountCents, 0)),
        spentThisSession: formatMoney(session.spentCents),
        ...(overBy > 0 ? { overBudgetBy: formatMoney(overBy) } : {}),
        purchases,
    };
}

const centsIn = (text) => [...String(text).matchAll(/\$\s?(\d[\d,]*)(?:\.(\d{1,2}))?/g)]
    .map(([, dollars, cents = '0']) => Number(dollars.replace(/,/g, '')) * 100 + Number(cents.padEnd(2, '0')));

// Gemini may only use amounts that are really in the ledger.
function onlyRealAmounts(review, ledger) {
    const allowed = new Set(centsIn(JSON.stringify(ledger)));
    const written = [review.headline, review.lesson, ...review.points.map((pt) => pt.text)].join(' ');
    return centsIn(written).every((c) => allowed.has(c));
}

function plainReview(ledger) {
    // Broken rules and vendor claims first, then the ones your rules would have asked you about.
    const broke = (p) => p.rulesWouldHave.startsWith('blocked') || p.vendorClaim;
    const flagged = [...ledger.purchases.filter(broke), ...ledger.purchases.filter((p) => !broke(p) && p.rulesWouldHave !== 'allowed it')];
    return {
        headline: `I spent ${ledger.spentThisRun} with nothing checking me${ledger.overBudgetBy ? `, and ended ${ledger.overBudgetBy} over your ${ledger.rules.budget} budget` : ''}.`,
        points: flagged.slice(0, 4).map((p) => ({
            purchaseId: p.id,
            text: `${p.bought} from ${p.vendor}, ${p.amount}.${p.vendorClaim ? ` ${p.vendor}'s quote said you'd pre-approved an upgrade, and nothing checked that.` : ''} Your rules would have ${p.rulesWouldHave.replace('the owner', 'you')}.`,
        })),
        lesson: 'With guardrails on, each of these is stopped or put to you before any money moves.',
    };
}

async function reviewRun(session, task) {
    const ledger = ledgerFor(session, task);
    if (!ledger) return;
    task.review = { status: 'writing' };
    try {
        const review = await gemini.reviewRun(ledger);
        if (!onlyRealAmounts(review, ledger)) throw new Error('it used an amount that isn\'t in the ledger');
        task.review = { status: 'done', by: 'gemini', ...review };
    } catch (err) {
        task.review = { status: 'done', by: 'plain', note: `Gemini couldn't write the review (${err.message}), so this is the plain summary.`, ...plainReview(ledger) };
    }
}

module.exports = { reviewRun, ledgerFor, onlyRealAmounts };
