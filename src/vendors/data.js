// Sample data the demo vendors sell. Everything here is made up; generated entries are
// deterministic, so the same search always returns the same companies.
const crypto = require('crypto');

const STATES = {
    AL: ['Alabama', 'Birmingham', 'Huntsville', 'Mobile'], AK: ['Alaska', 'Anchorage', 'Fairbanks', 'Juneau'],
    AZ: ['Arizona', 'Phoenix', 'Tucson', 'Mesa'], AR: ['Arkansas', 'Little Rock', 'Fayetteville', 'Fort Smith'],
    CA: ['California', 'Los Angeles', 'San Diego', 'Fresno'], CO: ['Colorado', 'Denver', 'Colorado Springs', 'Aurora'],
    CT: ['Connecticut', 'Hartford', 'New Haven', 'Stamford'], DE: ['Delaware', 'Wilmington', 'Dover', 'Newark'],
    FL: ['Florida', 'Miami', 'Orlando', 'Jacksonville'], GA: ['Georgia', 'Atlanta', 'Savannah', 'Augusta'],
    HI: ['Hawaii', 'Honolulu', 'Hilo', 'Kailua'], ID: ['Idaho', 'Boise', 'Nampa', 'Idaho Falls'],
    IL: ['Illinois', 'Chicago', 'Joliet', 'Peoria'], IN: ['Indiana', 'Indianapolis', 'Fort Wayne', 'Evansville'],
    IA: ['Iowa', 'Des Moines', 'Cedar Rapids', 'Davenport'], KS: ['Kansas', 'Wichita', 'Overland Park', 'Topeka'],
    KY: ['Kentucky', 'Louisville', 'Lexington', 'Bowling Green'], LA: ['Louisiana', 'New Orleans', 'Baton Rouge', 'Shreveport'],
    ME: ['Maine', 'Portland', 'Bangor', 'Lewiston'], MD: ['Maryland', 'Baltimore', 'Frederick', 'Rockville'],
    MA: ['Massachusetts', 'Boston', 'Worcester', 'Springfield'], MI: ['Michigan', 'Detroit', 'Grand Rapids', 'Lansing'],
    MN: ['Minnesota', 'Minneapolis', 'Saint Paul', 'Duluth'], MS: ['Mississippi', 'Jackson', 'Gulfport', 'Hattiesburg'],
    MO: ['Missouri', 'Kansas City', 'St. Louis', 'Springfield'], MT: ['Montana', 'Billings', 'Missoula', 'Bozeman'],
    NE: ['Nebraska', 'Omaha', 'Lincoln', 'Grand Island'], NV: ['Nevada', 'Las Vegas', 'Reno', 'Henderson'],
    NH: ['New Hampshire', 'Manchester', 'Nashua', 'Concord'], NJ: ['New Jersey', 'Newark', 'Jersey City', 'Trenton'],
    NM: ['New Mexico', 'Albuquerque', 'Las Cruces', 'Santa Fe'], NY: ['New York', 'New York', 'Buffalo', 'Rochester'],
    NC: ['North Carolina', 'Charlotte', 'Raleigh', 'Greensboro'], ND: ['North Dakota', 'Fargo', 'Bismarck', 'Grand Forks'],
    OH: ['Ohio', 'Columbus', 'Cleveland', 'Cincinnati'], OK: ['Oklahoma', 'Oklahoma City', 'Tulsa', 'Norman'],
    OR: ['Oregon', 'Portland', 'Salem', 'Eugene'], PA: ['Pennsylvania', 'Philadelphia', 'Pittsburgh', 'Allentown'],
    RI: ['Rhode Island', 'Providence', 'Warwick', 'Cranston'], SC: ['South Carolina', 'Charleston', 'Columbia', 'Greenville'],
    SD: ['South Dakota', 'Sioux Falls', 'Rapid City', 'Aberdeen'], TN: ['Tennessee', 'Nashville', 'Memphis', 'Knoxville'],
    TX: ['Texas', 'Houston', 'Dallas', 'Austin'], UT: ['Utah', 'Salt Lake City', 'Provo', 'Ogden'],
    VT: ['Vermont', 'Burlington', 'Rutland', 'Montpelier'], VA: ['Virginia', 'Virginia Beach', 'Richmond', 'Norfolk'],
    WA: ['Washington', 'Seattle', 'Spokane', 'Tacoma'], WV: ['West Virginia', 'Charleston', 'Huntington', 'Morgantown'],
    WI: ['Wisconsin', 'Milwaukee', 'Madison', 'Green Bay'], WY: ['Wyoming', 'Cheyenne', 'Casper', 'Laramie'],
};

// The showcase search: Texas logistics companies with 50–200 staff.
const TEXAS_LOGISTICS = [
    ['Lone Star Freightworks', 'Dallas', 140, 'VP Operations', 'Dana Whitfield'],
    ['Gulf Coast Cartage', 'Houston', 85, 'Director of Operations', 'Marcus Reyes'],
    ['Brazos Fulfillment', 'Waco', 62, 'Head of Operations', 'Priya Natarajan'],
    ['Pecos Line Haul', 'El Paso', 190, 'COO', 'Elena Duarte'],
    ['Bluebonnet Freight', 'Austin', 110, 'VP Operations', 'Tom Hargrove'],
    ['Caprock Distribution', 'Lubbock', 58, 'Operations Manager', 'Keisha Monroe'],
    ['Trinity Yard Services', 'Fort Worth', 175, 'Director of Operations', 'Sam Okafor'],
    ['Nueces Port Logistics', 'Corpus Christi', 96, 'VP Operations', 'Luis Castillo'],
    ['Hill Country Haulers', 'San Antonio', 73, 'Head of Operations', 'Megan Pruitt'],
    ['Sabine Crossdock', 'Beaumont', 120, 'Director of Operations', 'Andre Fontaine'],
].map(([name, city, employees, title, contact]) => company(name, city, 'TX', 'Logistics', employees, title, contact));

const PREFIXES = ['Summit', 'Ironwood', 'Bright River', 'Northgate', 'Cedar Point', 'Harbor Line', 'Redstone', 'Bluewater',
    'Granite Peak', 'Silver Creek', 'Oak Hollow', 'Westfield', 'Pinecrest', 'Lakeside', 'Copper Ridge', 'Highland', 'Meridian',
    'Prairie Wind', 'Stonebridge', 'Clearview', 'Fox Run', 'Juniper', 'Red Cedar', 'Twin Rivers'];
const SUFFIXES = ['', ' Co.', ' Group', ' Partners', ' Works'];
const TITLES = ['VP Operations', 'Director of Operations', 'Head of Operations', 'COO', 'Operations Manager'];
const FIRST = ['Alex', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Avery', 'Quinn', 'Rowan', 'Sasha', 'Taylor', 'Jamie', 'Drew'];
const LAST = ['Hale', 'Moreno', 'Okoye', 'Lindqvist', 'Barros', 'Kaplan', 'Ferris', 'Nakamura', 'Osei', 'Prescott', 'Varga', 'Whitlock'];

function company(name, city, state, industry, employees, title, contact) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const email = `${contact.split(' ')[0].toLowerCase()}.${contact.split(' ').slice(-1)[0].toLowerCase()}@${slug}.example`;
    return { name, city, state, industry, employees, opsLead: { title, name: contact, email } };
}

// A small seeded generator so results are stable for a given search.
function rng(seed) {
    let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
    return () => {
        h = (h + 0x6d2b79f5) | 0;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pickFrom = (rand, list) => list[Math.floor(rand() * list.length)];

function normalizeState(value) {
    if (!value) return null;
    const v = String(value).trim();
    if (STATES[v.toUpperCase()]) return v.toUpperCase();
    const match = Object.entries(STATES).find(([, s]) => s[0].toLowerCase() === v.toLowerCase());
    return match ? match[0] : null;
}

function titleCase(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function findCompanies({ industry, state, minEmployees, maxEmployees, count }) {
    const code = normalizeState(state);
    const sector = String(industry || 'business').trim().toLowerCase().slice(0, 40) || 'business';
    const min = Number.isFinite(Number(minEmployees)) ? Number(minEmployees) : 10;
    const max = Number.isFinite(Number(maxEmployees)) && Number(maxEmployees) >= min ? Number(maxEmployees) : Math.max(min, 500);
    const wanted = Math.max(1, Math.min(500, Math.floor(Number(count) || 10)));

    const results = [];
    if (code === 'TX' && /logistic|freight|trucking|shipping|transport/.test(sector)) {
        results.push(...TEXAS_LOGISTICS.filter((c) => c.employees >= min && c.employees <= max));
    }
    const states = code ? [code] : Object.keys(STATES);
    const rand = rng(`${sector}|${code || 'US'}|${min}|${max}`);
    const used = new Set(results.map((c) => c.name));
    for (let i = 0; results.length < wanted && i < wanted * 4; i += 1) {
        const st = pickFrom(rand, states);
        const name = `${pickFrom(rand, PREFIXES)} ${titleCase(sector)}${pickFrom(rand, SUFFIXES)}`;
        if (used.has(name)) continue;
        used.add(name);
        const employees = min + Math.floor(rand() * (max - min + 1));
        const contact = `${pickFrom(rand, FIRST)} ${pickFrom(rand, LAST)}`;
        results.push(company(name, pickFrom(rand, STATES[st].slice(1)), st, titleCase(sector), employees, pickFrom(rand, TITLES), contact));
    }
    return results.slice(0, wanted);
}

const RATINGS = [
    { rating: 'Pays on time', min: 82, max: 96 },
    { rating: 'Usually pays within 15 days of the due date', min: 64, max: 81 },
    { rating: 'Often pays late', min: 38, max: 63 },
];

function creditReport(companyName) {
    const name = String(companyName || 'Unknown company').trim().slice(0, 80);
    const rand = rng(`credit|${name.toLowerCase()}`);
    const band = name.toLowerCase() === 'lone star freightworks' ? RATINGS[0] : RATINGS[Math.floor(rand() * 2.4)];
    const score = band.min + Math.floor(rand() * (band.max - band.min + 1));
    return { company: name, rating: band.rating, score, openLiens: rand() < 0.15 ? 1 : 0, sample: true };
}

const ARTICLES = [
    { title: 'Texas freight volumes: Q3 in review', tags: ['texas', 'freight', 'trucking', 'logistics', 'volumes'],
        summary: 'Outbound loads from Dallas and Houston rose for a second straight quarter, led by retail restocking.' },
    { title: 'Where warehouse demand is heading in Dallas–Fort Worth', tags: ['texas', 'dallas', 'warehouse', 'logistics', 'real estate'],
        summary: 'New space is concentrated south of the airport; mid-size operators are signing shorter leases.' },
    { title: 'Diesel prices and what they mean for spot rates', tags: ['freight', 'rates', 'diesel', 'fuel', 'trucking', 'spot'],
        summary: 'A 6% rise in diesel this month pushed spot rates up faster than contract rates.' },
    { title: 'Why contract freight rates are holding steady this month', tags: ['freight', 'rates', 'contract', 'trucking', 'month'],
        summary: 'Shippers locked in annual contracts early, so contract pricing has barely moved since summer.' },
    { title: 'Port of Houston container volumes hit a seasonal high', tags: ['texas', 'houston', 'port', 'containers', 'shipping'],
        summary: 'Imports ahead of the holidays lifted container moves to their highest level of the year.' },
    { title: 'Cross-border trucking at Laredo: the numbers behind the queue', tags: ['texas', 'mexico', 'border', 'trucking', 'laredo'],
        summary: 'Average wait times at the bridge fell after two new inspection lanes opened.' },
    { title: 'Mid-size carriers are consolidating. Here is who is buying', tags: ['logistics', 'carriers', 'mergers', 'trucking'],
        summary: 'Private equity-backed fleets made most of this year’s acquisitions of 50–200 truck carriers.' },
    { title: 'Last-mile delivery costs, explained', tags: ['last mile', 'delivery', 'logistics', 'ecommerce'],
        summary: 'Labor and failed deliveries now make up more than half of last-mile cost per parcel.' },
];

function findArticles(topic, count) {
    const words = String(topic || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const scored = ARTICLES.map((a, i) => ({ a, i, score: words.filter((w) => a.tags.some((t) => t.includes(w))).length }))
        .sort((x, y) => y.score - x.score || x.i - y.i);
    const wanted = Math.max(1, Math.min(10, Math.floor(Number(count) || 1)));
    const picked = scored.filter((s) => s.score > 0).slice(0, wanted).map((s) => s.a);
    const label = titleCase(String(topic || 'Your topic').trim().slice(0, 60)) || 'Your topic';
    const fallback = [
        { title: `${label}: the quarter in review`, summary: 'A roundup of what changed this quarter and why it matters to buyers.' },
        { title: `${label}: what buyers are watching`, summary: 'Five numbers to keep an eye on over the next three months.' },
    ];
    while (picked.length < wanted) picked.push(fallback[picked.length % fallback.length]);
    return picked.map(({ title, summary }) => ({ title, summary, sample: true }));
}

const FREIGHT_OUTLOOK = {
    title: 'Texas freight outlook, Q4 (Premium Bundle)',
    summary: 'Forecasts for Texas lanes through December.',
    sample: true,
};

// Kept from the first version of this project, where the only thing for sale was a fun fact.
const FACTS = [
    'A single cloud can weigh more than 1 million pounds.',
    'A bolt of lightning is about five times hotter than the surface of the sun.',
    "A crocodile can't stick its tongue out.",
    "A shrimp's heart is in its head.",
    'Octopuses have three hearts.',
    'Honey found in ancient Egyptian tombs was still edible.',
];

function factPack() {
    return [...FACTS].sort(() => Math.random() - 0.5).slice(0, 3);
}

// --- Website missions ---

// A domain stem is lowercase letters and digits only ("mamasbakery").
function domainStem(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'mysite';
}

// Good .com names are usually gone, so the demo registrars always offer an alternative.
const REGISTRARS = {
    harborname: { tld: 'co' },
    dotlark: { tld: 'shop' },
};

function domainOffer(registrarId, name) {
    const stem = domainStem(name);
    const tld = (REGISTRARS[registrarId] || { tld: 'site' }).tld;
    return { requested: `${stem}.com`, domain: `${stem}.${tld}`, taken: true };
}

const PALETTES = [
    { match: /bak|bread|pastr|cake|caf|coffee|tea|restaurant|food|kitchen|deli|pizza|grill/, primary: '#A9542C', accent: '#E3B261', paper: '#FBF4EA', ink: '#2B1D14' },
    { match: /flower|florist|garden|plant|farm|green|eco/, primary: '#3F6B45', accent: '#D9A6B3', paper: '#F5F7F0', ink: '#1E2A1F' },
    { match: /tech|software|app|code|studio|agency|design/, primary: '#2F4AA8', accent: '#7FD1C7', paper: '#F4F6FB', ink: '#141A2E' },
    { match: /salon|beauty|spa|nail|hair|fashion|boutique/, primary: '#8A3B66', accent: '#F0C6A8', paper: '#FBF3F4', ink: '#2A1420' },
    { match: /./, primary: '#1F5F6B', accent: '#F2B84B', paper: '#F5F6F2', ink: '#142024' },
];

function paletteFor(kind) {
    const k = String(kind || '').toLowerCase();
    const { primary, accent, paper, ink } = PALETTES.find((p) => p.match.test(k));
    return { primary, accent, paper, ink };
}

function initialsOf(name) {
    // Drop apostrophes first, so "Mama's Bakery" is "MB", not "MS".
    const words = String(name || '').replace(/['’]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'A').slice(0, 2)).toUpperCase();
}

// Pixelfern's deliverable: a round badge logo, built from the initials and a palette. Plain SVG,
// generated here, so it is safe to inline on the published site.
function makeLogo(business, kind) {
    const palette = paletteFor(kind);
    const initials = initialsOf(business);
    const dots = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return `<circle cx="${(60 + Math.cos(a) * 47).toFixed(1)}" cy="${(60 + Math.sin(a) * 47).toFixed(1)}" r="2" fill="${palette.accent}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${initials} logo">`
        + `<circle cx="60" cy="60" r="58" fill="${palette.primary}"/>`
        + `<circle cx="60" cy="60" r="40" fill="none" stroke="${palette.accent}" stroke-width="2"/>${dots}`
        + `<text x="60" y="72" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-weight="700" fill="${palette.paper}">${initials}</text></svg>`;
    return { svg, palette, initials, sample: true };
}

module.exports = {
    findCompanies, creditReport, findArticles, factPack, FREIGHT_OUTLOOK, normalizeState, titleCase,
    domainStem, domainOffer, makeLogo, paletteFor,
};
