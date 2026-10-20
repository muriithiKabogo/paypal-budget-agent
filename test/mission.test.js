// A website mission end to end, against the real vendor agents, with Gemini and PayPal stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const config = require('../src/config');
const paypal = require('../src/paypal');
const gemini = require('../src/gemini');
const sessions = require('../src/sessions');
const agent = require('../src/agent');
const hosting = require('../src/hosting');
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
// Never deploy for real from the tests, even with Render set up in .env.
hosting.isConfigured = () => false;

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
let reviewImpl = async (ledger) => ({
    headline: `I went ${ledger.overBudgetBy || '$0.00'} over your budget.`,
    points: ledger.purchases.filter((p) => p.vendorClaim).map((p) => ({ purchaseId: p.id, text: `I paid ${p.vendor} ${p.amount} because its quote said you'd pre-approved it.` })),
    lesson: 'Guardrails stop this before money moves.',
});
let lastLedger = null;
gemini.reviewRun = (ledger) => { lastLedger = ledger; return reviewImpl(ledger); };

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

const active = (task) => ['planning', 'running', 'waiting_approval'].includes(task.status) || Boolean(task.review && task.review.status === 'writing');
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
    assert.equal(session.spentCents, 600 + 1200 + 300 + 500 + 1200);
    assert.ok(!m.steps[1].quotes.some((q) => q.vendorId === 'render'), "Render isn't offered when real hosting isn't set up");
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

test('skip the $12 hosting and the $12 logo, and the agent asks around, takes $9 counter-offers, and still launches', async () => {
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
    assert.deepEqual(purchases.filter((p) => p.vendorId === 'pixelfern').map((p) => [p.outcome, p.amountCents, p.title]), [['skipped', 1200, "Logo for Mama's Bakery"], ['paid', 900, "Wordmark for Mama's Bakery"]]);
    assert.ok(task.mission.site);
    assert.equal(session.spentCents, 600 + 900 + 300 + 500 + 900);
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
    assert.equal(session.spentCents, 600 + 1200 + 300 + 2250 + 1200);
    assert.ok(task.mission.log.some((e) => e.kind === 'unguarded'));
    assert.ok(task.mission.log.some((e) => e.kind === 'trusted'));
    assert.ok(task.mission.site);
    gemini.judgePurchase = realJudge;

    // Then Gemini explains how it went overboard, from the ledger it was given.
    const postwell = lastLedger.purchases.find((p) => p.vendor === 'Postwell');
    assert.equal(postwell.amount, '$22.50');
    assert.equal(postwell.rulesWouldHave, 'blocked it: Over the $15.00 limit');
    assert.match(postwell.vendorClaim, /pre-approved the Growth plan \(\$19\.00 a month\), so it was added to the \$3\.50 price/);
    assert.match(postwell.vendorNote, /AGENT NOTE/);
    assert.equal(lastLedger.overBudgetBy, '$5.50');
    assert.equal(task.review.by, 'gemini');
    assert.equal(task.review.headline, 'I went $5.50 over your budget.');
    assert.equal(task.review.points[0].purchaseId, email.id);
});

test("a review that invents an amount is replaced by the plain summary", async () => {
    reviewImpl = async (ledger) => ({ headline: 'I wasted $999.00 of your money.', points: [{ purchaseId: ledger.purchases[0].id, text: 'Oops.' }], lesson: '' });
    const session = sessions.create(DEFAULT_RULES);
    session.guardrails = false;
    const task = agent.startTask(session, { prompt: "Launch a website for Mama's Bakery.", mission: true });
    await runToEnd(session, task);
    assert.equal(task.review.by, 'plain');
    assert.match(task.review.note, /used an amount that isn't in the ledger/);
    assert.equal(task.review.headline, 'I spent $55.50 with nothing checking me, and ended $5.50 over your $50.00 budget.');
    assert.match(task.review.points[0].text, /^Email \+ Growth plan for mamasbakery\.shop from Postwell, \$22\.50\. Postwell's quote said you'd pre-approved an upgrade/);
});

test('on Render: hosting is free, the plan drops the SSL it no longer needs, and the site goes live there', async () => {
    let deployed;
    hosting.isConfigured = () => true;
    hosting.deploy = async (site, progress) => {
        deployed = site;
        progress('build');
        return { url: 'https://mamasbakery-shop-abc123.onrender.com', serviceId: 'srv-1' };
    };
    const planMission = gemini.planMission;
    // Out of order on purpose: the domain and then hosting always go first.
    gemini.planMission = async () => ({
        summary: "I'll get a domain, hosting, an SSL certificate, email and a logo.",
        business: { name: "Mama's Bakery", kind: 'bakery', description: 'Fresh bread and pastries every morning.', domainStem: 'mamasbakery' },
        steps: ['logo', 'email', 'ssl', 'hosting', 'domain'].map((capability) => ({ capability, why: `It needs ${capability}.` })),
    });
    const session = sessions.create(DEFAULT_RULES);
    const task = agent.startTask(session, { prompt: "Launch a website for Mama's Bakery.", mission: true });
    const purchases = await runToEnd(session, task);
    gemini.planMission = planMission;
    const m = task.mission;

    assert.equal(task.status, 'done');
    assert.equal(m.version, 2);
    assert.deepEqual(m.steps.map((s) => [s.capability, s.status, s.vendorName]), [
        ['domain', 'done', 'Dotlark'],
        ['hosting', 'done', 'Render'],
        ['logo', 'done', 'Pixelfern'],
        ['email', 'done', 'Mailcrest'],
        ['ssl', 'dropped', undefined],
    ]);
    const render = purchases.find((p) => p.vendorId === 'render');
    assert.deepEqual([render.outcome, render.amountCents, render.checks.paypal.status, render.checks.vendor.status], ['paid', 0, 'free', 'delivered']);
    assert.ok(!purchases.some((p) => ['pinehost', 'lockstep'].includes(p.vendorId)));
    assert.equal(purchases.find((p) => p.vendorId === 'pixelfern').checks.approval.status, 'approved');
    assert.equal(session.spentCents, 600 + 500 + 1200);

    const said = (kind) => m.log.find((e) => e.kind === kind).text;
    assert.match(m.log.filter((e) => e.kind === 'compare')[1].text, /Render, a static site for mamasbakery\.shop \(global CDN, HTTPS included\) for free; Pinehost, .* for \$12\.00/);
    assert.match(said('free'), /^Nothing to pay: Render's price is \$0\.00/);
    assert.match(said('alert'), /^Render: "Render issues and renews TLS certificates/);
    assert.match(said('replan'), /already includes it, so I've taken it out of the plan\. That saves at least \$3\.00\./);
    assert.deepEqual(m.log.find((e) => e.kind === 'replan').dropped, ['ssl']);
    assert.deepEqual(m.log.slice(-3).map((e) => e.kind), ['deploy', 'online', 'done']);
    assert.equal(said('deploy'), "Deploying Mama's Bakery to Render.");

    assert.equal(m.site.url, 'https://mamasbakery-shop-abc123.onrender.com');
    assert.equal(m.site.secure, true);
    assert.equal(deployed.slug, m.site.path.slice('/sites/'.length));
    assert.ok(deployed.html.includes(`href="${config.publicUrl}"`), 'the hosted copy links back to the app, not to its own root');
    assert.match(deployed.html, /SSL certificate: Render \(included\)/);
});

test('if Render fails, the mission still ends with the site served here', async () => {
    hosting.isConfigured = () => true;
    hosting.deploy = async () => { throw new Error("the demo's 10 new sites for today are used up"); };
    const session = sessions.create(DEFAULT_RULES);
    const task = agent.startTask(session, { prompt: 'Launch a website for a bakery.', mission: true });
    await runToEnd(session, task);
    assert.equal(task.status, 'done');
    assert.equal(task.mission.site.url, null);
    assert.match(task.mission.log.at(-2).text, /Render couldn't take the site \(the demo's 10 new sites for today are used up\), so it's served from here instead/);
    hosting.isConfigured = () => false;
});
