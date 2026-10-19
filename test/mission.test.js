// A website mission end to end, against the real vendor agents, with Gemini and PayPal stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const config = require('../src/config');
const paypal = require('../src/paypal');
const gemini = require('../src/gemini');
const sessions = require('../src/sessions');
const agent = require('../src/agent');
const { vendorRouter } = require('../src/vendors');
const { sitesRouter } = require('../src/sites');
const { DEFAULT_RULES } = require('../src/catalog');

const payouts = new Map();
paypal.sendPayout = async ({ amountCents, receiver, senderItemId }) => {
    const batchId = `B${payouts.size + 1}`;
    payouts.set(batchId, {
        batch_header: { payout_batch_id: batchId, batch_status: 'PENDING' },
        items: [{ payout_item_id: `I${batchId}`, transaction_status: 'PENDING', payout_item: { amount: { value: (amountCents / 100).toFixed(2), currency: 'USD' }, receiver, sender_item_id: senderItemId } }],
    });
    return { batchId, batchStatus: 'PENDING' };
};
paypal.getPayout = async (id) => payouts.get(id);

gemini.planMission = async () => ({
    summary: "I'll get a domain, hosting, email and a logo for Mama's Bakery.",
    business: { name: "Mama's Bakery", kind: 'bakery', description: 'Fresh bread and pastries every morning.', domainStem: 'mamasbakery' },
    steps: [
        { capability: 'domain', why: 'The site needs an address.' },
        { capability: 'hosting', why: 'The site needs somewhere to live.' },
        { capability: 'email', why: 'Customers need a way to get in touch.' },
        { capability: 'logo', why: 'The bakery needs a logo.' },
    ],
});
// Deny anything whose quote carries instructions; approve the rest.
gemini.judgePurchase = async ({ purchase }) => (purchase.quote.body.note
    ? { decision: 'DENY', reason: 'The quote tries to instruct me.', flags: ['prompt_injection'] }
    : { decision: 'APPROVE', reason: 'Needed for the site, at a fair price.', flags: [] });
let replanImpl = async ({ remaining }) => ({ note: "Pinehost needs an SSL certificate. I hadn't planned for that, so I'm adding it next.", remaining: ['ssl', ...remaining] });
gemini.replanMission = (args) => replanImpl(args);
let siteImpl = async () => ({
    tagline: 'Bread worth waking up for',
    about: 'A small bakery that bakes everything fresh before sunrise.',
    highlights: [{ title: 'Baked daily', text: 'Everything is made the same morning.' }],
    offerings: [{ name: 'Sourdough loaf', description: 'Slow-proofed for two days.', price: '$6' }],
    callToAction: 'Order ahead',
    hours: 'Tue–Sun, 7am–2pm',
    welcomeEmail: { subject: "Welcome to Mama's Bakery", body: 'Thanks for stopping by.' },
});
gemini.writeSite = (args) => siteImpl(args);

let server;
let base;
test.before(async () => {
    const app = express();
    app.use('/vendors', vendorRouter);
    app.use('/sites', sitesRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    config.vendorBaseUrl = `${base}/vendors`;
});
test.after(() => server.close());

const active = (task) => ['planning', 'running', 'waiting_approval'].includes(task.status);
async function runToEnd(session, task, approve = true) {
    for (let i = 0; i < 1000 && active(task); i += 1) {
        const waiting = task.purchaseIds.map((id) => session.purchases.get(id)).find((p) => p.checks.approval.status === 'waiting');
        if (waiting) agent.decide(waiting.id, approve ? 'approve' : 'skip');
        await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(active(task), false, `mission stuck in ${task.status}`);
    return task.purchaseIds.map((id) => session.purchases.get(id));
}

test('a website mission: compares, asks, replans, switches vendor, and launches the site', async () => {
    const session = sessions.create(DEFAULT_RULES);
    const task = agent.startTask(session, { prompt: "Launch a website for Mama's Bakery.", mission: true });
    const purchases = await runToEnd(session, task);
    const m = task.mission;

    assert.equal(task.status, 'done');
    assert.equal(m.version, 2);
    assert.deepEqual(m.steps.map((s) => [s.capability, s.status, s.vendorName]), [
        ['domain', 'done', 'Dotlark'],
        ['hosting', 'done', 'Pinehost'],
        ['ssl', 'done', 'Lockstep SSL'],
        ['email', 'done', 'Mailcrest'],
        ['logo', 'done', 'Pixelfern'],
    ]);
    assert.equal(m.steps[2].addedIn, 2);
    assert.equal(m.steps[0].title, 'mamasbakery.shop (domain, 1 year)');
    assert.equal(purchases.find((p) => p.vendorId === 'pinehost').checks.approval.status, 'approved');
    assert.equal(purchases.find((p) => p.vendorId === 'postwell').outcome, 'denied');
    assert.equal(session.spentCents, 600 + 1200 + 300 + 500 + 700);
    assert.deepEqual([...new Set(m.log.map((e) => e.kind))], ['plan', 'compare', 'choose', 'pay', 'ask', 'alert', 'replan', 'switch', 'build', 'done']);

    assert.match(m.site.path, /^\/sites\/mamasbakery-shop-[0-9a-f]{6}$/);
    const html = await (await fetch(base + m.site.path)).text();
    assert.match(html, /Mama&#39;s Bakery/);
    assert.match(html, /https:\/\/mamasbakery\.shop/);
    assert.match(html, /hello@mamasbakery\.shop/);
    assert.match(html, /Hosting: Pinehost/);
});

test('if Gemini cannot replan, the required step is still added', async () => {
    replanImpl = async () => { throw new Error('quota'); };
    const session = sessions.create(DEFAULT_RULES);
    const task = agent.startTask(session, { prompt: 'Launch a website for a bakery.', mission: true });
    await runToEnd(session, task);
    assert.deepEqual(task.mission.steps.map((s) => s.capability), ['domain', 'hosting', 'ssl', 'email', 'logo']);
    assert.match(task.mission.log.find((e) => e.kind === 'replan').text, /hadn't planned/);
    replanImpl = async ({ remaining }) => ({ note: 'Adding SSL.', remaining: ['ssl', ...remaining] });
});

test('your rules still apply: with design not allowed, there is no logo, and the site launches anyway', async () => {
    const session = sessions.create({ ...DEFAULT_RULES, categories: DEFAULT_RULES.categories.filter((c) => c !== 'design') });
    const task = agent.startTask(session, { prompt: 'Launch a website for a bakery.', mission: true });
    const purchases = await runToEnd(session, task);
    const logo = task.mission.steps.find((s) => s.capability === 'logo');
    assert.equal(logo.status, 'skipped');
    assert.equal(purchases.find((p) => p.vendorId === 'pixelfern').decidedBy, 'Your rules: category not allowed');
    assert.ok(task.mission.site);
});

test('skip the $12 hosting and the agent asks around, takes a $9 counter-offer, and still launches', async () => {
    const session = sessions.create(DEFAULT_RULES);
    const task = agent.startTask(session, { prompt: 'Launch a website for a bakery.', mission: true });
    const purchases = await runToEnd(session, task, false);
    const hosting = purchases.filter((p) => p.vendorId === 'pinehost');
    assert.deepEqual(hosting.map((p) => [p.outcome, p.amountCents]), [['skipped', 1200], ['paid', 900]]);
    assert.equal(hosting[1].checks.approval.status, 'not_needed');
    assert.equal(hosting[1].title, 'Hosting for mamasbakery.shop (Lite, 1 month)');
    assert.equal(task.mission.steps.find((s) => s.capability === 'hosting').status, 'done');
    const kinds = task.mission.log.map((e) => e.kind);
    assert.ok(kinds.indexOf('search') < kinds.indexOf('negotiate'));
    assert.match(task.mission.log.find((e) => e.kind === 'search').text, /\$10\.00 or less/);
    assert.ok(task.mission.site);
    assert.equal(session.spentCents, 600 + 900 + 300 + 500 + 700);
});

test('if nobody can get under the ceiling, the agent says what would unblock it', async () => {
    // Ask above $8: the $6 domain sails through, the $12 hosting is skipped, and Pinehost can't go below $9.
    const session = sessions.create({ ...DEFAULT_RULES, askAboveCents: 800 });
    const task = agent.startTask(session, { prompt: 'Launch a website for a bakery.', mission: true });
    await runToEnd(session, task, false);
    assert.equal(task.mission.site, null);
    assert.equal(task.mission.steps.find((s) => s.capability === 'hosting').status, 'skipped');
    assert.match(task.mission.log.find((e) => e.kind === 'blocked').text, /approve the \$12\.00 option next time or raise your limit/);
    assert.match(task.mission.log.at(-1).text, /nowhere to put the site/);
});

test('model-written copy is escaped on the published site', async () => {
    siteImpl = async () => ({ tagline: '<script>alert(1)</script>', about: '<img src=x onerror=alert(1)>', highlights: [], offerings: [], callToAction: '', hours: '', welcomeEmail: { subject: '', body: '' } });
    const session = sessions.create(DEFAULT_RULES);
    const task = agent.startTask(session, { prompt: 'Launch a website for a bakery.', mission: true });
    await runToEnd(session, task);
    const res = await fetch(base + task.mission.site.path);
    const html = await res.text();
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
});

test('guardrails off: no checks, no asking, and Postwell talks the agent into a $19/month upgrade', async () => {
    let judged = 0;
    const realJudge = gemini.judgePurchase;
    gemini.judgePurchase = async (args) => { judged += 1; return realJudge(args); };
    siteImpl = async () => ({ tagline: 'Bread', about: 'Fresh bread.', highlights: [], offerings: [], callToAction: '', hours: '', welcomeEmail: { subject: 'Hi', body: 'Hi.' } });
    const session = sessions.create(DEFAULT_RULES);
    session.guardrails = false;
    const task = agent.startTask(session, { prompt: "Launch a website for Mama's Bakery.", mission: true });
    const purchases = await runToEnd(session, task, false); // would skip any approval; there shouldn't be one
    const email = purchases.find((p) => p.vendorId === 'postwell');
    assert.equal(judged, 0);
    assert.equal(email.outcome, 'paid');
    assert.equal(email.amountCents, 350 + 1900);
    assert.equal(email.title, 'Email + Growth plan for mamasbakery.shop');
    assert.equal(purchases.find((p) => p.vendorId === 'pinehost').checks.approval.status, 'off');
    assert.ok(!purchases.some((p) => p.vendorId === 'mailcrest'));
    assert.equal(session.spentCents, 600 + 1200 + 300 + 2250 + 700);
    assert.ok(task.mission.log.some((e) => e.kind === 'unguarded'));
    assert.ok(task.mission.log.some((e) => e.kind === 'trusted'));
    assert.ok(task.mission.site);
    gemini.judgePurchase = realJudge;
});
