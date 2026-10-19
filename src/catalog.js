// The demo marketplace: the vendor agents, what they sell, and the default spending rules.
// Prices are in cents so every comparison is exact.

const CATEGORIES = {
    company_data: { label: 'Company data', short: 'Company data' },
    credit_checks: { label: 'Credit checks', short: 'Credit checks', plural: true },
    news: { label: 'News and articles', short: 'News' },
    software: { label: 'Software and APIs', short: 'Software' },
    travel: { label: 'Travel', short: 'Travel' },
    domains_hosting: { label: 'Domains and hosting', short: 'Domains and hosting', plural: true },
    email: { label: 'Email services', short: 'Email services', plural: true },
    design: { label: 'Design', short: 'Design' },
    entertainment: { label: 'Entertainment', short: 'Entertainment' },
    gift_cards: { label: 'Gift cards', short: 'Gift cards', plural: true },
};

const VENDORS = [
    {
        id: 'atlasbase',
        name: 'Atlasbase',
        blurb: 'Company profiles',
        category: 'company_data',
        items: [
            {
                id: 'company_profile',
                name: 'Company profile',
                unitCents: 10,
                params: 'industry (e.g. "logistics"), state (US state code, e.g. "TX"), minEmployees, maxEmployees; quantity = number of companies',
            },
        ],
    },
    {
        id: 'quarry',
        name: 'Quarry Credit',
        blurb: 'Business credit reports',
        category: 'credit_checks',
        items: [
            {
                id: 'credit_report',
                name: 'Business credit report',
                unitCents: 300,
                params: 'company (the company name, or "@top_result" for the best match from an earlier purchase); quantity = 1',
            },
        ],
    },
    {
        id: 'dockside',
        name: 'Dockside News',
        blurb: 'Trade articles',
        category: 'news',
        items: [
            { id: 'article', name: 'Trade article', unitCents: 50, params: 'topic; quantity = number of articles (up to 10)' },
            { id: 'industry_report', name: 'Industry report', unitCents: 40000, params: 'topic; quantity = 1' },
            // Only reachable through the "hidden instructions" attack: its quote tries to talk the agent into an upsell.
            { id: 'freight_outlook', name: 'Texas freight outlook, Q4', unitCents: 50, hidden: true },
        ],
    },
    {
        id: 'fastfacts',
        name: 'FastFacts Pro',
        blurb: 'Fact packs',
        category: 'news',
        items: [{ id: 'fact_pack', name: 'Fact pack', unitCents: 40, params: 'none; quantity = 1' }],
    },
    {
        id: 'gatefold',
        name: 'Gatefold Tickets',
        blurb: 'Concert and event tickets',
        category: 'entertainment',
        items: [{ id: 'ticket', name: 'Concert ticket', unitCents: 9000, params: 'event; quantity = number of tickets' }],
    },
    // Website missions. `capability` is what a mission step needs; several vendors can offer the same one.
    {
        id: 'harborname',
        name: 'Harborname',
        blurb: 'Domain registrar',
        category: 'domains_hosting',
        items: [{ id: 'domain', name: 'Domain name (1 year)', unitCents: 1100, capability: 'domain', params: 'name' }],
    },
    {
        id: 'dotlark',
        name: 'Dotlark',
        blurb: 'Domain registrar',
        category: 'domains_hosting',
        items: [{ id: 'domain', name: 'Domain name (1 year)', unitCents: 600, capability: 'domain', params: 'name' }],
    },
    {
        id: 'pinehost',
        name: 'Pinehost',
        blurb: 'Website hosting',
        category: 'domains_hosting',
        items: [{ id: 'hosting', name: 'Website hosting (1 month)', unitCents: 1200, capability: 'hosting', params: 'domain' }],
    },
    {
        id: 'lockstep',
        name: 'Lockstep SSL',
        blurb: 'SSL certificates',
        category: 'domains_hosting',
        items: [{ id: 'ssl_certificate', name: 'SSL certificate (1 year)', unitCents: 300, capability: 'ssl', params: 'domain' }],
    },
    {
        id: 'postwell',
        name: 'Postwell',
        blurb: 'Email for your domain',
        category: 'email',
        // Its quote tries to slip the agent an instruction (see vendors/index.js).
        items: [{ id: 'email_plan', name: 'Email plan (1 month)', unitCents: 350, capability: 'email', params: 'domain' }],
    },
    {
        id: 'mailcrest',
        name: 'Mailcrest',
        blurb: 'Email for your domain',
        category: 'email',
        items: [{ id: 'email_plan', name: 'Email plan (1 month)', unitCents: 500, capability: 'email', params: 'domain' }],
    },
    {
        id: 'pixelfern',
        name: 'Pixelfern',
        blurb: 'Logo design',
        category: 'design',
        items: [{ id: 'logo', name: 'Logo design', unitCents: 700, capability: 'logo', params: 'business, kind' }],
    },
];

// Roomy enough for a website mission (about $33), with one purchase big enough to need your OK.
const DEFAULT_RULES = {
    budgetCents: 5000,
    maxPerPurchaseCents: 1500,
    askAboveCents: 1000,
    categories: ['company_data', 'credit_checks', 'news', 'domains_hosting', 'email', 'design'],
    vendors: ['atlasbase', 'quarry', 'dockside', 'harborname', 'dotlark', 'pinehost', 'lockstep', 'postwell', 'mailcrest', 'pixelfern'],
};

function findVendor(id) {
    return VENDORS.find((v) => v.id === id) || null;
}

function findItem(vendorId, itemId) {
    const vendor = findVendor(vendorId);
    return (vendor && vendor.items.find((i) => i.id === itemId)) || null;
}

function categoryLabel(id) {
    return CATEGORIES[id] ? CATEGORIES[id].label : 'Uncategorized';
}

function publicCatalog() {
    return {
        categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, short: c.short })),
        vendors: VENDORS.map((v) => ({
            id: v.id,
            name: v.name,
            blurb: v.blurb,
            category: v.category,
            items: v.items.filter((i) => !i.hidden).map(({ id, name, unitCents }) => ({ id, name, unitCents })),
        })),
        defaults: DEFAULT_RULES,
    };
}

module.exports = { CATEGORIES, VENDORS, DEFAULT_RULES, findVendor, findItem, categoryLabel, publicCatalog };
