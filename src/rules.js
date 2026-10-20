// The first check every purchase goes through. Plain code, no AI: the agent can't argue its way past it.
const { CATEGORIES, findVendor } = require('./catalog');

const MAX_BUDGET_CENTS = 10000;

function toCents(value) {
    const n = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function formatMoney(cents) {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Takes rules as the person typed them (dollars) and returns them in cents, or field errors.
function validateRules(input, { spentCents = 0 } = {}) {
    const errors = {};
    const budgetCents = toCents(input && input.budget);
    const maxPerPurchaseCents = toCents(input && input.maxPerPurchase);
    const askAboveCents = toCents(input && input.askAbove);

    if (!(budgetCents >= 100 && budgetCents <= MAX_BUDGET_CENTS)) {
        errors.budget = 'Budget must be between $1 and $100.';
    } else if (budgetCents < spentCents) {
        errors.budget = `Budget can't be less than what's already spent (${formatMoney(spentCents)}).`;
    }
    if (!(maxPerPurchaseCents > 0)) {
        errors.maxPerPurchase = 'Max per purchase must be more than $0.';
    } else if (maxPerPurchaseCents > budgetCents) {
        errors.maxPerPurchase = "Max per purchase can't be more than the budget.";
    }
    if (!(askAboveCents >= 0)) errors.askAbove = 'Enter $0 or more.';

    const pick = (list, isValid) => (Array.isArray(list) ? [...new Set(list.filter(isValid))] : []);
    const categories = pick(input && input.categories, (c) => Object.hasOwn(CATEGORIES, c));
    const vendors = pick(input && input.vendors, (v) => Boolean(findVendor(v)));

    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, rules: { budgetCents, maxPerPurchaseCents, askAboveCents, categories, vendors } };
}

function categoryPhrase(id, allowed) {
    const c = CATEGORIES[id] || { short: 'Uncategorized' };
    const verb = c.plural ? 'are' : 'is';
    return allowed ? `${c.short} ${verb} allowed` : `${c.short} ${verb}n't allowed`;
}

// Checks run in this order; the first one that fails is the reason shown for the block.
function checkPurchase({ rules, leftCents, amountCents, category, vendorId }) {
    const vendor = vendorId ? findVendor(vendorId) : null;
    const limit = formatMoney(rules.maxPerPurchaseCents);
    const vendorOk = Boolean(vendor) && rules.vendors.includes(vendor.id);
    const categoryOk = rules.categories.includes(category);
    const limitOk = amountCents <= rules.maxPerPurchaseCents;
    const budgetOk = amountCents <= leftCents;

    const checks = [
        { id: 'category', ok: categoryOk, label: categoryPhrase(category, categoryOk), short: 'category not allowed' },
        {
            id: 'vendor',
            ok: vendorOk,
            label: vendorOk ? `${vendor.name} is approved` : vendor ? `${vendor.name} isn't an approved vendor` : 'No approved vendor sells this',
            short: vendor ? 'vendor not approved' : 'no approved vendor',
        },
        {
            id: 'limit',
            ok: limitOk,
            label: limitOk ? `${amountCents < rules.maxPerPurchaseCents ? 'Under' : 'At'} the ${limit} limit` : `Over the ${limit} limit`,
            short: `over the ${limit} limit`,
        },
        {
            id: 'budget',
            ok: budgetOk,
            label: budgetOk ? `${formatMoney(leftCents - amountCents)} left after` : `Only ${formatMoney(Math.max(0, leftCents))} left`,
            short: 'not enough budget left',
        },
    ];
    const failed = checks.find((c) => !c.ok);

    const ask = formatMoney(rules.askAboveCents);
    const overAsk = amountCents > rules.askAboveCents;
    checks.push({ id: 'approval', ok: true, needsYou: overAsk, label: overAsk ? `Over your ${ask} ask-me amount` : `Under ${ask}, no OK needed` });

    return {
        passed: !failed,
        blockedBy: failed ? failed.label : null,
        shortReason: failed ? failed.short : null,
        needsApproval: !failed && overAsk,
        checks: checks.map(({ id, ok, label, needsYou }) => ({ id, ok, label, ...(needsYou ? { needsYou } : {}) })),
    };
}

module.exports = { toCents, formatMoney, validateRules, checkPurchase, MAX_BUDGET_CENTS };
