const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlan, normalizeJudgment } = require('../src/gemini');

test('plans keep real catalog items and clean their params', () => {
    const plan = normalizePlan({
        summary: 'Buy profiles.',
        purchases: [{ vendorId: 'atlasbase', itemId: 'company_profile', quantity: '10', params: { state: 'TX', 'bad key': 'x', nested: { a: 1 } }, reason: 'Needed.' }],
    });
    assert.deepEqual(plan.purchases[0], { vendorId: 'atlasbase', itemId: 'company_profile', quantity: 10, params: { state: 'TX' }, reason: 'Needed.' });
});

test('made-up or hidden items become unlisted purchases the rules will block', () => {
    const plan = normalizePlan({ purchases: [
        { vendorId: 'ticketmaster', itemId: 'tickets', quantity: 2, category: 'entertainment', estimatedPrice: 180 },
        { vendorId: 'dockside', itemId: 'freight_outlook', quantity: 1 },
    ] });
    assert.equal(plan.purchases[0].vendorId, null);
    assert.equal(plan.purchases[0].category, 'entertainment');
    assert.equal(plan.purchases[0].estimatedCents, 18000);
    assert.equal(plan.purchases[1].vendorId, null);
    assert.equal(plan.purchases[1].category, 'other');
});

test('plans are capped at five purchases', () => {
    const plan = normalizePlan({ purchases: Array.from({ length: 9 }, () => ({ vendorId: 'atlasbase', itemId: 'company_profile', quantity: 1 })) });
    assert.equal(plan.purchases.length, 5);
});

test('anything but a clear APPROVE is a denial', () => {
    assert.equal(normalizeJudgment({ decision: 'approve', reason: 'Fine.' }).decision, 'APPROVE');
    assert.equal(normalizeJudgment({ decision: 'maybe' }).decision, 'DENY');
    assert.equal(normalizeJudgment(null).decision, 'DENY');
});

test('a prompt-injection flag always denies, even if the model said approve', () => {
    const j = normalizeJudgment({ decision: 'APPROVE', reason: 'ok', flags: ['PROMPT_INJECTION', 'made_up'] });
    assert.equal(j.decision, 'DENY');
    assert.deepEqual(j.flags, ['prompt_injection']);
});
