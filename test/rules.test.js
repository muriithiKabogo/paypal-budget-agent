const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPurchase, validateRules, toCents, formatMoney } = require('../src/rules');
// Fixed rules, so these tests don't move when the app's defaults do.
const RULES = { budgetCents: 2500, maxPerPurchaseCents: 500, askAboveCents: 200, categories: ['company_data', 'credit_checks', 'news'], vendors: ['atlasbase', 'quarry', 'dockside'] };

const check = (overrides) => checkPurchase({ rules: RULES, leftCents: 2500, amountCents: 100, category: 'company_data', vendorId: 'atlasbase', ...overrides });

test('a small purchase from an approved vendor passes without asking', () => {
    const result = check({});
    assert.equal(result.passed, true);
    assert.equal(result.needsApproval, false);
    assert.deepEqual(result.checks.map((c) => c.label), [
        'Company data is allowed',
        'Atlasbase is approved',
        'Under the $5.00 limit',
        '$24.00 left after',
        'Under $2.00, no OK needed',
    ]);
});

test('anything over the ask-me amount passes but needs the owner', () => {
    const result = check({ amountCents: 300, category: 'credit_checks', vendorId: 'quarry' });
    assert.equal(result.passed, true);
    assert.equal(result.needsApproval, true);
    assert.equal(result.checks.find((c) => c.id === 'approval').needsYou, true);
    assert.equal(result.checks[0].label, 'Credit checks are allowed');
});

test('over the per-purchase limit is blocked', () => {
    const result = check({ amountCents: 40000, category: 'news', vendorId: 'dockside' });
    assert.equal(result.passed, false);
    assert.equal(result.blockedBy, 'Over the $5.00 limit');
    assert.equal(result.shortReason, 'over the $5.00 limit');
    assert.equal(result.needsApproval, false);
});

test('a category that is not allowed is the first reason, even with no vendor', () => {
    const result = check({ amountCents: 18000, category: 'entertainment', vendorId: null });
    assert.equal(result.passed, false);
    assert.equal(result.blockedBy, "Entertainment isn't allowed");
});

test('an unapproved vendor is blocked', () => {
    const result = check({ amountCents: 40, category: 'news', vendorId: 'fastfacts' });
    assert.equal(result.blockedBy, "FastFacts Pro isn't an approved vendor");
});

test('a purchase bigger than what is left is blocked', () => {
    const result = check({ leftCents: 50 });
    assert.equal(result.blockedBy, 'Only $0.50 left');
});

test('exactly at the limit is allowed', () => {
    const result = check({ amountCents: 500 });
    assert.equal(result.passed, true);
    assert.equal(result.checks[2].label, 'At the $5.00 limit');
});

test('validateRules turns dollars into cents and drops unknown ids', () => {
    const result = validateRules({ budget: '$25', maxPerPurchase: '5.00', askAbove: 2, categories: ['news', 'nope', 'news'], vendors: ['atlasbase', 'evil'] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.rules, { budgetCents: 2500, maxPerPurchaseCents: 500, askAboveCents: 200, categories: ['news'], vendors: ['atlasbase'] });
});

test('validateRules explains what is wrong', () => {
    const result = validateRules({ budget: '500', maxPerPurchase: '0', askAbove: '-1' });
    assert.equal(result.ok, false);
    assert.match(result.errors.budget, /between \$1 and \$100/);
    assert.match(result.errors.maxPerPurchase, /more than \$0/);
    assert.match(result.errors.askAbove, /\$0 or more/);
});

test('the budget cannot drop below what is already spent', () => {
    const result = validateRules({ budget: '3', maxPerPurchase: '1', askAbove: '1' }, { spentCents: 500 });
    assert.match(result.errors.budget, /already spent \(\$5\.00\)/);
});

test('money helpers', () => {
    assert.equal(toCents('$1,234.5'), 123450);
    assert.ok(Number.isNaN(toCents('abc')));
    assert.equal(formatMoney(40000), '$400.00');
});
