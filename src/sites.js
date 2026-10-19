// Websites launched by missions, served at /sites/<slug>. Each page is built from Gemini's copy and
// what the agent bought (domain, logo, email, SSL). The copy is model output, so every bit of it is
// escaped, and the logo is redrawn here from its initials and colors rather than trusting markup.
const crypto = require('crypto');
const express = require('express');
const { paletteFor } = require('./vendors/data');

const MAX_SITES = 500;
const sites = new Map(); // slug -> { html, createdAt }

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c));

function fallbackContent(business) {
    return {
        tagline: business.name,
        about: business.description || `Welcome to ${business.name}.`,
        highlights: [],
        offerings: [],
        callToAction: 'Get in touch',
        hours: '',
        welcomeEmail: { subject: `Welcome to ${business.name}`, body: `Thanks for getting in touch with ${business.name}. We'll be in touch soon.` },
    };
}

function logoSvg(initials, palette, size) {
    const dots = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return `<circle cx="${(60 + Math.cos(a) * 47).toFixed(1)}" cy="${(60 + Math.sin(a) * 47).toFixed(1)}" r="2" fill="${palette.accent}"/>`;
    }).join('');
    return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"><circle cx="60" cy="60" r="58" fill="${palette.primary}"/>`
        + `<circle cx="60" cy="60" r="40" fill="none" stroke="${palette.accent}" stroke-width="2"/>${dots}`
        + `<text x="60" y="72" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-weight="700" fill="${palette.paper}">${esc(initials)}</text></svg>`;
}

function render({ business, content, domain, email, logo, secure, vendors, spentCents }) {
    const fromLogo = logo && logo.palette && Object.values(logo.palette).every(isHex) ? logo.palette : null;
    const palette = fromLogo || paletteFor(business.kind);
    const initials = logo && /^[A-Z0-9]{1,2}$/.test(String(logo.initials)) ? logo.initials : null;
    const food = /bak|bread|pastr|cake|caf|coffee|tea|restaurant|food|kitchen|deli|pizza|grill/i.test(business.kind);
    const credits = Object.entries(vendors).map(([what, who]) => `${esc(what)}: ${esc(who)}`).join(' · ');
    const lock = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(business.name)}</title>
<style>
:root { --p: ${palette.primary}; --a: ${palette.accent}; --paper: ${palette.paper}; --ink: ${palette.ink}; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 17px; line-height: 1.6; }
a { color: var(--p); }
.demo { background: #0E1012; color: #D5DADE; font: 13px/1.5 ui-monospace, Menlo, monospace; padding: 9px 16px; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; text-align: center; }
.demo a { color: #C8F560; }
.address { display: flex; justify-content: center; padding: 10px 16px 0; }
.address span { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: rgba(0,0,0,0.05); font: 13px ui-monospace, Menlo, monospace; color: ${secure ? 'var(--ink)' : '#9A3412'}; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding-top: 22px; padding-bottom: 22px; }
.brand { display: flex; align-items: center; gap: 14px; font: 700 22px Georgia, "Times New Roman", serif; }
.wordmark { width: 40px; height: 40px; border-radius: 50%; background: var(--p); }
nav { display: flex; gap: 22px; }
nav a { color: var(--ink); text-decoration: none; font-size: 15px; }
.hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); align-items: center; gap: 40px; padding-top: 48px; padding-bottom: 80px; }
.eyebrow { margin: 0 0 14px; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--p); font-weight: 700; }
h1 { margin: 0 0 20px; font: 700 clamp(40px, 6vw, 66px)/1.04 Georgia, "Times New Roman", serif; letter-spacing: -0.02em; }
h2 { margin: 0 0 24px; font: 700 clamp(28px, 4vw, 38px)/1.1 Georgia, "Times New Roman", serif; }
.lead { margin: 0 0 28px; font-size: 19px; max-width: 540px; }
.btn { display: inline-block; padding: 14px 28px; border-radius: 999px; background: var(--p); color: var(--paper); font-weight: 700; text-decoration: none; }
.art { display: flex; justify-content: center; }
.art svg { width: min(280px, 70vw); height: auto; filter: drop-shadow(0 24px 40px rgba(0,0,0,0.18)); }
.band { background: #fff; padding: 72px 0; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 20px; }
.card { padding: 26px; border-radius: 18px; background: var(--paper); border-top: 4px solid var(--a); }
.card h3 { margin: 0 0 8px; font: 700 20px Georgia, serif; }
.card p { margin: 0; }
.menu { padding-top: 72px; padding-bottom: 72px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; padding: 18px 0; border-bottom: 1px dashed rgba(0,0,0,0.18); }
.row h3 { margin: 0; font: 700 19px Georgia, serif; }
.row p { margin: 4px 0 0; opacity: 0.8; }
.price { font: 700 18px Georgia, serif; color: var(--p); white-space: nowrap; }
.contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 24px; }
footer { padding: 32px 0 48px; font-size: 14px; opacity: 0.75; }
</style>
</head>
<body>
<div class="demo"><span>Demo site: planned, paid for and built by an AI agent with PayPal sandbox payouts (${esc(`$${(spentCents / 100).toFixed(2)}`)})</span><a href="/">See how it works</a></div>
<div class="address"><span>${secure ? lock : '<b>Not secure</b>'} ${secure ? 'https' : 'http'}://${esc(domain)}</span></div>
<header class="wrap">
  <div class="brand">${initials ? logoSvg(initials, palette, 40) : '<span class="wordmark" aria-hidden="true"></span>'}${esc(business.name)}</div>
  <nav>${content.highlights.length ? '<a href="#about">About</a>' : ''}${content.offerings.length ? `<a href="#offer">${food ? 'Menu' : 'Services'}</a>` : ''}<a href="#contact">Contact</a></nav>
</header>
<main>
<section class="wrap hero">
  <div>
    <p class="eyebrow">${esc(business.kind)}</p>
    <h1>${esc(content.tagline)}</h1>
    <p class="lead">${esc(content.about)}</p>
    <a class="btn" href="#contact">${esc(content.callToAction || 'Get in touch')}</a>
  </div>
  ${initials ? `<div class="art">${logoSvg(initials, palette, 280)}</div>` : ''}
</section>
${content.highlights.length ? `<section id="about" class="band"><div class="wrap cards">${content.highlights.map((h) => `<div class="card"><h3>${esc(h.title)}</h3><p>${esc(h.text)}</p></div>`).join('')}</div></section>` : ''}
${content.offerings.length ? `<section id="offer" class="wrap menu"><h2>${food ? 'On the menu' : 'What we offer'}</h2>${content.offerings.map((o) => `<div class="row"><div><h3>${esc(o.name)}</h3>${o.description ? `<p>${esc(o.description)}</p>` : ''}</div>${o.price ? `<span class="price">${esc(o.price)}</span>` : ''}</div>`).join('')}</section>` : ''}
<section id="contact" class="band"><div class="wrap contact">
  <div><h2>Say hello</h2><p>${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : 'Email coming soon.'}</p></div>
  ${content.hours ? `<div><h2>Hours</h2><p>${esc(content.hours)}</p></div>` : ''}
</div></section>
</main>
<footer class="wrap">© ${new Date().getFullYear()} ${esc(business.name)} · ${esc(domain)}<br>${credits}</footer>
</body>
</html>`;
}

function publish(details) {
    if (sites.size >= MAX_SITES) sites.delete(sites.keys().next().value);
    const slug = `${String(details.domain).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    sites.set(slug, { html: render(details), createdAt: Date.now() });
    return { slug, path: `/sites/${slug}` };
}

const router = express.Router();
router.get('/:slug', (req, res) => {
    const site = sites.get(req.params.slug);
    if (!site) return res.status(404).type('text').send('This demo site is gone. Demo sites only live in memory, so they disappear when the server restarts.');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
    res.set('X-Content-Type-Options', 'nosniff');
    return res.type('html').send(site.html);
});

module.exports = { publish, fallbackContent, render, sitesRouter: router };
