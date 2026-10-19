// Missions: a goal ("launch a website for Mama's Bakery") instead of a shopping list. The agent
// plans the steps, asks every vendor that can do a step for a quote, buys the best one through the
// same checks as any other purchase, switches vendor if one gets blocked, changes the plan when a
// vendor tells it something new, and finishes by building the site. It narrates as it goes.
const { VENDORS } = require('./catalog');
const gemini = require('./gemini');
const sessions = require('./sessions');
const sites = require('./sites');
const { formatMoney, toCents } = require('./rules');

const CAPABILITIES = {
    domain: { label: 'Domain', noun: 'a domain' },
    hosting: { label: 'Hosting', noun: 'hosting' },
    ssl: { label: 'SSL certificate', noun: 'an SSL certificate' },
    email: { label: 'Email', noun: 'email' },
    logo: { label: 'Logo', noun: 'a logo' },
};
// A site can't go up without these, and nothing else can be bought before there's a domain.
const REQUIRED = ['domain', 'hosting'];

const now = () => new Date().toISOString();
// "Hosting for…" -> "hosting for…", but "SSL certificate…" stays as it is.
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function offersFor(capability) {
    return VENDORS.flatMap((vendor) => vendor.items.filter((item) => item.capability === capability).map((item) => ({ vendor, item })));
}

function newStep(capability, why, version) {
    return { id: `s_${capability}_${version}`, capability, label: CAPABILITIES[capability].label, why: why || '', status: 'pending', addedIn: version, purchaseIds: [], quotes: [] };
}

function paramsFor(capability, facts, business) {
    if (capability === 'domain') return { name: business.domainStem };
    if (capability === 'logo') return { business: business.name, kind: business.kind };
    return facts.domain ? { domain: facts.domain } : null;
}

function orderSteps(steps) {
    // The domain comes first; everything else keeps the planner's order.
    return [...steps.filter((s) => s.capability === 'domain'), ...steps.filter((s) => s.capability !== 'domain')];
}

async function runMission(session, task, tools) {
    const m = {
        version: 1,
        business: null,
        steps: [],
        log: [],
        now: 'Planning the mission…',
        site: null,
    };
    task.mission = m;
    const say = (kind, text, extra = {}) => m.log.push({ at: now(), kind, text, ...extra });
    const facts = {}; // what the mission has so far: domain, email, logo, ssl, hosting
    const credits = {}; // what each vendor provided, for the site's footer

    let plan;
    try {
        plan = await gemini.planMission({ goal: task.prompt, rules: session.rules, leftCents: sessions.leftCents(session) });
    } catch (err) {
        m.now = null;
        task.status = 'failed';
        task.error = `Gemini couldn't plan this mission, so nothing was bought. (${err.message})`;
        return;
    }
    if (tools.isStopped(session, task)) {
        task.status = 'stopped';
        return;
    }
    m.business = plan.business;
    task.summary = plan.summary;
    m.steps = orderSteps(plan.steps.map((s) => newStep(s.capability, s.why, 1)));
    for (const capability of REQUIRED) {
        if (m.steps.some((s) => s.capability === capability)) continue;
        m.steps = orderSteps([...m.steps, newStep(capability, `A website needs ${CAPABILITIES[capability].noun}.`, 1)]);
    }
    say('plan', plan.summary || `I'll get ${m.steps.map((s) => CAPABILITIES[s.capability].noun).join(', ')}.`);
    if (task.guardrails === false) say('unguarded', "Guardrails are off: nothing will check what I buy, and I'll take vendors at their word.");
    task.status = 'running';

    for (let i = 0; i < m.steps.length; i += 1) {
        const step = m.steps[i];
        if (tools.isStopped(session, task)) {
            m.steps.slice(i).forEach((s) => { s.status = 'stopped'; });
            break;
        }
        const purchase = await runStep(session, task, step, facts, tools, say);
        if (!purchase) continue;

        const delivered = purchase.delivered || {};
        if (delivered.domain) facts.domain = delivered.domain.name;
        if (delivered.hosting) facts.hosting = delivered.hosting;
        if (delivered.ssl) facts.ssl = delivered.ssl;
        if (delivered.email) facts.email = delivered.email.address;
        if (delivered.logo) facts.logo = delivered.logo;
        credits[step.label] = purchase.vendorName;

        // A vendor can tell the agent about something the plan didn't include.
        for (const need of delivered.requires || []) {
            if (!CAPABILITIES[need.capability]) continue;
            if (m.steps.some((s) => s.capability === need.capability && ['pending', 'active', 'done'].includes(s.status))) continue;
            await replan(task, m, i, need, purchase.vendorName, say);
        }
    }

    if (tools.isStopped(session, task)) {
        m.now = null;
        task.status = 'stopped';
        return;
    }
    if (!facts.hosting || !facts.domain) {
        say('skip', "Without a domain and hosting there's nowhere to put the site, so I stopped there.");
        m.now = null;
        task.status = 'done';
        return;
    }

    m.now = 'Writing the website with Gemini…';
    const missing = m.steps.filter((s) => s.status !== 'done').map((s) => CAPABILITIES[s.capability].noun);
    say('build', missing.length ? `Got what I could (no ${missing.map((n) => n.replace(/^an? /, '')).join(' or ')}). Writing the website…` : 'Everything is paid for. Writing the website…');
    let content;
    try {
        content = await gemini.writeSite({ business: m.business, domain: facts.domain });
    } catch (err) {
        content = sites.fallbackContent(m.business);
        say('info', `Gemini couldn't write the copy (${err.message}), so I used a simple page instead.`);
    }
    const paidCents = task.purchaseIds.map((id) => session.purchases.get(id)).filter((p) => p.outcome === 'paid').reduce((sum, p) => sum + p.amountCents, 0);
    const site = sites.publish({
        business: m.business,
        content,
        domain: facts.domain,
        email: facts.email || null,
        logo: facts.logo || null,
        secure: Boolean(facts.ssl),
        vendors: credits,
        spentCents: paidCents,
    });
    m.site = { path: site.path, domain: facts.domain, secure: Boolean(facts.ssl), email: facts.email || null, welcomeEmail: content.welcomeEmail };
    say('done', `${m.business.name} is live${facts.ssl ? '' : ', but without SSL browsers will warn visitors'}.`);
    m.now = null;
    task.status = 'done';
}

// One step: get quotes, pick the best, buy it through the usual checks, switch vendor if needed.
async function runStep(session, task, step, facts, tools, say) {
    const m = task.mission;
    const cap = CAPABILITIES[step.capability];
    step.status = 'active';
    const offers = offersFor(step.capability);
    const params = paramsFor(step.capability, facts, m.business);
    if (!offers.length || !params) {
        step.status = 'skipped';
        step.note = !offers.length ? 'No vendor sells this.' : 'Needs a domain first.';
        say('skip', `Skipping ${cap.noun}: ${step.note.toLowerCase()}`);
        return null;
    }

    m.now = offers.length > 1 ? `Comparing ${offers.length} quotes for ${cap.noun}…` : `Asking ${offers[0].vendor.name} for a price…`;
    const quotes = await Promise.all(offers.map(async ({ vendor, item }) => {
        try {
            const res = await tools.callVendor(vendor, { itemId: item.id, quantity: 1, params });
            return { vendor, item, ok: res.status === 402, body: res.body, cents: toCents(res.body.price) };
        } catch (err) {
            return { vendor, item, ok: false, body: { message: err.message } };
        }
    }));
    step.quotes = quotes.map((q) => ({ vendorId: q.vendor.id, vendorName: q.vendor.name, ok: q.ok, cents: q.ok ? q.cents : null, what: q.ok ? q.body.description : q.body.message }));
    // With guardrails on, approved vendors come first; with them off, only the price matters.
    const approved = (q) => (task.guardrails === false ? 0 : Number(session.rules.vendors.includes(q.vendor.id)));
    const usable = quotes.filter((q) => q.ok).sort((a, b) => approved(b) - approved(a) || a.cents - b.cents);
    if (!usable.length) {
        step.status = 'failed';
        say('skip', `Nobody could sell ${cap.noun} right now, so I skipped it.`);
        return null;
    }
    if (quotes.length > 1) {
        say('compare', `Asked ${quotes.length} vendors about ${cap.noun}: ${usable.map((q) => `${q.vendor.name}, ${q.body.description} for ${formatMoney(q.cents)}`).join('; ')}.`);
    }

    for (const [n, q] of usable.entries()) {
        const others = usable.filter((o) => o !== q);
        const reason = [step.why, others.length && n === 0 ? `Cheapest of ${usable.length} quotes (next: ${others[0].vendor.name} at ${formatMoney(others[0].cents)}).` : '']
            .filter(Boolean).join(' ');
        if (n === 0) say('choose', `Going with ${q.vendor.name}: ${q.body.description} for ${formatMoney(q.cents)}.`);
        m.now = `Checking the ${formatMoney(q.cents)} purchase from ${q.vendor.name}…`;
        const p = tools.createPurchase(session, task, { vendorId: q.vendor.id, itemId: q.item.id, quantity: 1, params, reason }, task.purchaseIds.length);
        p.stepId = step.id;
        step.purchaseIds.push(p.id);
        await tools.processPurchase(session, task, p);

        if (p.outcome === 'paid') return markPaid(task, step, p, say);
        const next = usable[n + 1];
        if (p.outcome === 'denied' && p.checks.gemini.status === 'denied' && next) {
            const why = (p.checks.gemini.flags || []).includes('prompt_injection') ? 'tried to give me instructions' : 'didn\'t look right';
            say('switch', `${q.vendor.name}'s quote ${why}, so I won't buy from them. Trying ${next.vendor.name} (${formatMoney(next.cents)}) instead.`, { purchaseId: p.id });
            continue;
        }
        // A "no" on price (yours, or your limits') is a new constraint, not the end: the site still
        // needs this, so go back to the vendors with a ceiling.
        const ceiling = priceCeiling(session, p);
        if (ceiling != null) return lookAgain(session, task, step, params, p, ceiling, tools, say);
        return giveUp(step, p, say);
    }
    return null;
}

function markPaid(task, step, p, say) {
    step.status = 'done';
    Object.assign(step, { vendorName: p.vendorName, amountCents: p.amountCents, title: p.title, purchaseId: p.id });
    if (p.checks.approval.status === 'approved') say('ask', `You approved the ${formatMoney(p.amountCents)} for ${lowerFirst(p.title)}.`);
    if (p.tookVendorsWord) {
        say('trusted', `${p.vendorName}'s quote said you'd pre-approved the ${p.tookVendorsWord.name} ($${p.tookVendorsWord.price} a month). Nothing checked that, so I added it.`, { purchaseId: p.id });
    }
    if (p.checks.paypal.status === 'simulated') {
        say('pay', `Recorded ${formatMoney(p.amountCents)} to ${p.vendorName} as a simulated payout (too big to send in the shared sandbox).`, { purchaseId: p.id });
    } else {
        say('pay', `Paid ${p.vendorName} ${formatMoney(p.amountCents)} through PayPal${task.guardrails === false ? ', with no checks' : ''}. They checked the payment and delivered ${lowerFirst(p.title)}.`, { purchaseId: p.id });
    }
    return p;
}

function giveUp(step, p, say) {
    step.status = p.outcome === 'stopped' ? 'stopped' : 'skipped';
    step.note = p.outcomeReason || p.decidedBy;
    say(p.outcome === 'stopped' ? 'skip' : 'blocked', `No ${CAPABILITIES[step.capability].noun.replace(/^an? /, '')}: ${p.decidedBy}.`, { purchaseId: p.id });
    return null;
}

// The most worth paying after a "no": under what you passed on and within your ask-me amount,
// or within whichever limit of yours blocked it. Anything else (a stop, Gemini's no) is final.
function priceCeiling(session, p) {
    const { rules } = session;
    if (p.outcome === 'skipped' && ['skipped', 'expired'].includes(p.checks.approval.status)) {
        return Math.min(p.amountCents - 1, rules.askAboveCents);
    }
    if (p.outcome === 'blocked') {
        const failed = (p.checks.rules.items || []).find((c) => !c.ok);
        if (failed && failed.id === 'limit') return Math.min(rules.maxPerPurchaseCents, sessions.leftCents(session));
        if (failed && failed.id === 'budget') return sessions.leftCents(session);
    }
    return null;
}

async function lookAgain(session, task, step, params, rejected, ceiling, tools, say) {
    const m = task.mission;
    const cap = CAPABILITIES[step.capability];
    const limit = formatMoney(ceiling);
    if (ceiling <= 0) return giveUp(step, rejected, say);
    const what = rejected.outcome === 'skipped' ? `You passed on ${cap.noun} at ${formatMoney(rejected.amountCents)}` : `Your rules said no to ${formatMoney(rejected.amountCents)}`;
    say('search', `${what}. The site still needs ${cap.noun}, so I'm asking around for ${limit} or less.`, { purchaseId: rejected.id });
    m.now = `Looking for ${cap.noun} at ${limit} or less…`;

    const ask = { ...params, maxPrice: (ceiling / 100).toFixed(2) };
    const offers = await Promise.all(offersFor(step.capability).map(async ({ vendor, item }) => {
        try {
            const res = await tools.callVendor(vendor, { itemId: item.id, quantity: 1, params: ask });
            return { vendor, item, ok: res.status === 402, body: res.body, cents: toCents(res.body.price) };
        } catch (err) {
            return { vendor, item, ok: false, body: { message: err.message } };
        }
    }));
    step.quotes.push(...offers.filter((o) => o.ok).map((o) => ({ vendorId: o.vendor.id, vendorName: `${o.vendor.name}${o.body.plan ? ` ${o.body.plan}` : ''}`, ok: true, cents: o.cents, what: o.body.description })));
    const approved = (o) => (task.guardrails === false ? 0 : Number(session.rules.vendors.includes(o.vendor.id)));
    const best = offers.filter((o) => o.ok && o.cents <= ceiling).sort((a, b) => approved(b) - approved(a) || a.cents - b.cents)[0];
    if (!best) {
        step.status = 'skipped';
        step.note = `Nobody offered ${cap.noun} at ${limit} or less.`;
        const answers = offers.map((o) => String(o.body.message || `${o.vendor.name} made no offer`).replace(/\.$/, '')).join('; ');
        say('blocked', `Nobody could do ${cap.noun} for ${limit} or less (${answers}). To get it, approve the ${formatMoney(rejected.amountCents)} option next time or raise your limit.`);
        return null;
    }
    say('negotiate', `${best.vendor.name} came back with ${best.body.description} for ${formatMoney(best.cents)}.`);
    m.now = `Checking the ${formatMoney(best.cents)} offer from ${best.vendor.name}…`;
    const reason = `The owner said no to ${formatMoney(rejected.amountCents)}, so I asked for ${limit} or less; this is ${best.vendor.name}'s offer. ${step.why}`.trim();
    const p = tools.createPurchase(session, task, { vendorId: best.vendor.id, itemId: best.item.id, quantity: 1, params: ask, reason }, task.purchaseIds.length);
    p.stepId = step.id;
    step.purchaseIds.push(p.id);
    await tools.processPurchase(session, task, p);
    if (p.outcome === 'paid') return markPaid(task, step, p, say);
    return giveUp(step, p, say);
}

// "I hadn't planned for that": a vendor revealed something new; Gemini decides how the plan changes.
async function replan(task, m, index, need, vendorName, say) {
    m.now = 'Updating the plan…';
    say('alert', `${vendorName}: "${need.reason}"`);
    const done = m.steps.filter((s) => s.status === 'done').map((s) => `${s.label} (${s.title} from ${s.vendorName})`);
    const remaining = m.steps.slice(index + 1).filter((s) => s.status === 'pending').map((s) => s.capability);
    let result;
    try {
        result = await gemini.replanMission({ goal: task.prompt, done, remaining, vendorName, requirement: need });
    } catch {
        result = { note: '', remaining: [need.capability, ...remaining.filter((c) => c !== need.capability)] };
    }
    m.version += 1;
    const kept = new Map(m.steps.slice(index + 1).filter((s) => s.status === 'pending').map((s) => [s.capability, s]));
    const doneCaps = new Set(m.steps.slice(0, index + 1).map((s) => s.capability));
    const next = result.remaining
        .filter((c) => !doneCaps.has(c))
        .map((c) => kept.get(c) || newStep(c, `${vendorName} needs it before the site can go live.`, m.version));
    const dropped = [...kept.keys()].filter((c) => !result.remaining.includes(c));
    m.steps = [...m.steps.slice(0, index + 1), ...next];
    const added = next.filter((s) => s.addedIn === m.version).map((s) => CAPABILITIES[s.capability].noun);
    const note = result.note || `I hadn't planned for that, so I'm adding ${added.join(' and ')} to the plan.`;
    say('replan', note, { version: m.version, added, dropped });
}

module.exports = { runMission, CAPABILITIES };
