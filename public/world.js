// The agent's world: a mission drawn as a night-market street. The agent walks from shop to shop,
// compares prices, gets each deal checked by its guard (Gemini), pays through PayPal, haggles, and
// finally builds the site on the empty lot at the end of the street.
//
// Every scene comes from a real entry in the mission log (or, while a mission runs, from what the
// agent is doing right now); nothing here is scripted. Plain SVG and the Web Animations API, and
// no CSS transitions, so the element keeps animating when the page re-renders around it.
(function () {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const XHTML = 'http://www.w3.org/1999/xhtml';
    const VIEW_H = 400;
    const GROUND = 324;
    const SHOP_W = 150;
    const SHOP_GAP = 26;
    const BLOCK_GAP = 112;
    const HOME_X = 120;
    const ORDER = ['domain', 'hosting', 'ssl', 'email', 'logo'];
    const STREET = { domain: 'Domains', hosting: 'Hosting', ssl: 'Certificates', email: 'Email', logo: 'Design' };
    const LABEL = { domain: 'Domain', hosting: 'Hosting', ssl: 'SSL certificate', email: 'Email', logo: 'Logo' };
    const ACCENT = { dotlark: '#4FC3F7', harborname: '#7E8CFF', render: '#A78BFA', pinehost: '#2DD4BF', lockstep: '#FACC15', postwell: '#F472B6', mailcrest: '#60A5FA', pixelfern: '#E879F9' };
    const LIME = '#C8F560';
    const ORANGE = '#FF8E4F';
    const WALK_PX_PER_MS = 0.34;

    const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESCAPES[c]);
    const money = (cents) => `$${(cents / 100).toFixed(2)}`;
    const price = (cents) => (cents === 0 ? 'FREE' : money(cents));
    const accent = (id) => ACCENT[id] || '#94A3B8';
    // A small string hash, mixed well enough that 'star1' and 'star2' land far apart.
    function hash(s) {
        let h = [...String(s)].reduce((acc, c) => Math.imul(acc ^ c.charCodeAt(0), 16777619), 2166136261);
        h ^= h >>> 16;
        h = Math.imul(h, 0x45d9f3b);
        h ^= h >>> 16;
        return h >>> 0;
    }
    const initialsOf = (name) => String(name || '').replace(/['’]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'A';

    function layout(vendors) {
        let x = 300;
        const shops = new Map();
        const blocks = new Map();
        for (const capability of ORDER) {
            const here = vendors.filter((v) => v.capability === capability);
            if (!here.length) continue;
            const start = x;
            for (const v of here) {
                shops.set(v.id, { ...v, x, cx: x + SHOP_W / 2, door: x + SHOP_W - 44, height: 150 + (hash(v.id) % 3) * 22 });
                x += SHOP_W + SHOP_GAP;
            }
            const end = x - SHOP_GAP;
            blocks.set(capability, { start, end, cx: (start + end) / 2 });
            x = end + BLOCK_GAP;
        }
        const lot = { x, w: 300, cx: x + 150 };
        return { shops, blocks, lot, width: x + 300 + 140 };
    }

    // ---------- Drawing ----------

    function skyMarkup(width, viewW) {
        const stars = Array.from({ length: 70 }, (_, i) => {
            const h = hash(`star${i}`);
            return `<circle class="w-star" cx="${h % viewW}" cy="${(h >>> 8) % 190}" r="${((h >>> 4) % 3) * 0.4 + 0.6}" fill="#DDE6F0" opacity="${0.25 + ((h >>> 12) % 6) / 10}"/>`;
        }).join('');
        const towers = [];
        for (let x = -40, i = 0; x < width * 0.45 + viewW; i += 1) {
            const h = hash(`tower${i}`);
            const w = 50 + (h % 70);
            const t = 90 + ((h >>> 6) % 120);
            const lit = Array.from({ length: 5 }, (_, j) => {
                const k = hash(`lit${i}${j}`);
                return k % 3 ? '' : `<rect x="${x + 8 + (k % Math.max(8, w - 16))}" y="${GROUND - t + 12 + ((k >>> 5) % Math.max(10, t - 40))}" width="4" height="5" fill="#F6D58E" opacity="0.35"/>`;
            }).join('');
            towers.push(`<rect x="${x}" y="${GROUND - t}" width="${w}" height="${t}" fill="#12161C"/>${lit}`);
            x += w + 6 + (h % 30);
        }
        return {
            fixed: `<defs><linearGradient id="w-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07090C"/><stop offset="1" stop-color="#141A22"/></linearGradient>
                <radialGradient id="w-lamp"><stop offset="0" stop-color="#F6D58E" stop-opacity="0.35"/><stop offset="1" stop-color="#F6D58E" stop-opacity="0"/></radialGradient></defs>
                <rect width="${viewW}" height="${VIEW_H}" fill="url(#w-sky)"/>${stars}
                <circle cx="${Math.round(viewW * 0.6)}" cy="58" r="20" fill="#E9EEF3" opacity="0.9"/><circle cx="${Math.round(viewW * 0.6) + 9}" cy="52" r="18" fill="#0B0E12" opacity="0.92"/>`,
            far: towers.join(''),
        };
    }

    function shopMarkup(s) {
        const c = accent(s.id);
        const top = GROUND - s.height;
        const windows = Array.from({ length: 4 }, (_, i) => {
            const lit = hash(`${s.id}w${i}`) % 3 !== 0;
            return `<rect x="${18 + (i % 2) * 64}" y="${top + 52 + Math.floor(i / 2) * 30}" width="48" height="18" rx="2" fill="${lit ? '#F6D58E' : '#0B0E12'}" opacity="${lit ? 0.22 : 1}"/>`;
        }).join('');
        const stripes = Array.from({ length: 7 }, (_, i) => `<rect x="${4 + i * 20.5}" y="${GROUND - 92}" width="10" height="20" fill="#0E1012" opacity="0.28"/>`).join('');
        return `<g class="w-shop" data-shop="${esc(s.id)}" transform="translate(${s.x} 0)">
  <g class="w-shop-body">
    <rect x="0" y="${top}" width="${SHOP_W}" height="${s.height}" rx="5" fill="#161A20" stroke="#262C33"/>
    ${windows}
    <rect x="12" y="${top + 12}" width="${SHOP_W - 24}" height="28" rx="6" fill="#0B0D10" stroke="${c}" stroke-width="1.5"/>
    <text x="${SHOP_W / 2}" y="${top + 31}" text-anchor="middle" class="w-sign" fill="${c}">${esc(s.name)}</text>
    <path d="M0 ${GROUND - 92} H${SHOP_W} L${SHOP_W + 6} ${GROUND - 70} H-6 Z" fill="${c}" opacity="0.82"/>${stripes}
    <rect x="14" y="${GROUND - 58}" width="64" height="42" rx="3" fill="${c}" opacity="0.16" stroke="${c}" stroke-opacity="0.4"/>
    <rect x="${SHOP_W - 62}" y="${GROUND - 64}" width="38" height="64" rx="3" fill="#0B0D10" stroke="${c}" stroke-opacity="0.55"/>
    <circle cx="${SHOP_W - 30}" cy="${GROUND - 32}" r="2" fill="${c}"/>
  </g>
  <g class="w-tag" opacity="0" style="transform-box: fill-box; transform-origin: 50% 100%">
    <rect x="${SHOP_W / 2 - 40}" y="${top - 38}" width="80" height="28" rx="14" fill="#0E1012" stroke="${c}" stroke-width="1.5"/>
    <text x="${SHOP_W / 2}" y="${top - 19}" text-anchor="middle" class="w-price" fill="#EEF0EE"></text>
  </g>
  <g class="w-mark" opacity="0" style="transform-box: fill-box; transform-origin: 50% 50%">
    <circle cx="${SHOP_W - 10}" cy="${top + 12}" r="14" fill="${LIME}"/>
    <path class="w-mark-icon" d="M${SHOP_W - 17} ${top + 12} l5 5 l9 -10" fill="none" stroke="#0E1012" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</g>`;
    }

    function homeMarkup() {
        return `<g class="w-home">
  <rect x="${HOME_X - 70}" y="${GROUND - 120}" width="140" height="120" rx="6" fill="#161A20" stroke="#262C33"/>
  <rect x="${HOME_X - 58}" y="${GROUND - 108}" width="116" height="28" rx="6" fill="#0B0D10" stroke="${LIME}" stroke-width="1.5"/>
  <text x="${HOME_X}" y="${GROUND - 89}" text-anchor="middle" class="w-sign" fill="${LIME}">ALLOWANCE</text>
  <rect x="${HOME_X - 18}" y="${GROUND - 62}" width="36" height="62" rx="3" fill="#0B0D10" stroke="${LIME}" stroke-opacity="0.5"/>
  <rect x="${HOME_X - 110}" y="${GROUND - 18}" width="44" height="6" rx="2" fill="#2A3036"/>
  <rect x="${HOME_X - 106}" y="${GROUND - 12}" width="4" height="12" fill="#2A3036"/><rect x="${HOME_X - 76}" y="${GROUND - 12}" width="4" height="12" fill="#2A3036"/>
</g>`;
    }

    function lotMarkup(lot) {
        const fence = Array.from({ length: 16 }, (_, i) => `<rect x="${lot.x + 6 + i * 18.5}" y="${GROUND - 26}" width="4" height="26" fill="#2A3036"/>`).join('');
        return `<g class="w-lot">
  <rect x="${lot.x}" y="${GROUND - 2}" width="${lot.w}" height="4" fill="#3A3226"/>
  <rect x="${lot.x + 4}" y="${GROUND - 20}" width="${lot.w - 8}" height="3" fill="#2A3036"/>${fence}
  <rect x="${lot.x + 96}" y="${GROUND - 66}" width="108" height="30" rx="4" fill="#0B0D10" stroke="#3A4148"/>
  <text x="${lot.cx}" y="${GROUND - 46}" text-anchor="middle" class="w-sign-small" fill="#9BA4AC">BUILD HERE</text>
  <g class="w-crane" opacity="0">
    <rect x="${lot.x + lot.w - 30}" y="${GROUND - 260}" width="8" height="260" fill="#FACC15" opacity="0.8"/>
    <rect x="${lot.x + 40}" y="${GROUND - 262}" width="${lot.w - 50}" height="7" fill="#FACC15" opacity="0.8"/>
    <line class="w-crane-line" x1="${lot.x + 90}" y1="${GROUND - 255}" x2="${lot.x + 90}" y2="${GROUND - 200}" stroke="#B9C0C6" stroke-width="1.5"/>
  </g>
  <g class="w-site" opacity="0" style="transform-box: fill-box; transform-origin: 50% 100%">
    <rect x="${lot.x + 40}" y="${GROUND - 210}" width="${lot.w - 80}" height="208" rx="8" fill="#FBF4EA" stroke="#3A4148"/>
    <rect x="${lot.x + 40}" y="${GROUND - 210}" width="${lot.w - 80}" height="20" rx="8" fill="#E7DCCB"/>
    <circle cx="${lot.x + 54}" cy="${GROUND - 200}" r="3" fill="#C9B9A2"/><circle cx="${lot.x + 64}" cy="${GROUND - 200}" r="3" fill="#C9B9A2"/>
    <g class="w-site-logo"><circle cx="${lot.cx}" cy="${GROUND - 152}" r="26" fill="#A0522D"/><text x="${lot.cx}" y="${GROUND - 144}" text-anchor="middle" class="w-site-initials" fill="#FBF4EA"></text></g>
    <text x="${lot.cx}" y="${GROUND - 106}" text-anchor="middle" class="w-site-name" fill="#2B1D12"></text>
    <rect x="${lot.cx - 70}" y="${GROUND - 92}" width="140" height="6" rx="3" fill="#D8CBB6"/>
    <rect x="${lot.cx - 52}" y="${GROUND - 80}" width="104" height="6" rx="3" fill="#D8CBB6"/>
    <rect x="${lot.cx - 40}" y="${GROUND - 60}" width="80" height="22" rx="11" fill="#A0522D"/>
    <text class="w-site-lock" x="${lot.cx}" y="${GROUND - 20}" text-anchor="middle" fill="#7A6A55"></text>
  </g>
  <g class="w-cloud" opacity="0">
    <path d="M${lot.cx - 50} ${GROUND - 268} a22 22 0 0 1 20 -28 a28 28 0 0 1 52 -6 a20 20 0 0 1 28 22 a16 16 0 0 1 -6 32 h-86 a16 16 0 0 1 -8 -20 z" fill="#1E2430" stroke="#A78BFA" stroke-width="1.5"/>
    <text x="${lot.cx}" y="${GROUND - 256}" text-anchor="middle" class="w-sign-small" fill="#D5DADE">Render</text>
  </g>
  <g class="w-flag" opacity="0">
    <rect x="${lot.x + 26}" y="${GROUND - 270}" width="4" height="270" fill="#B9C0C6"/>
    <g class="w-flag-cloth" style="transform-box: fill-box; transform-origin: 0% 50%">
      <path d="M${lot.x + 30} ${GROUND - 268} h70 l-12 16 l12 16 h-70 z" fill="${LIME}"/>
      <text x="${lot.x + 58}" y="${GROUND - 247}" text-anchor="middle" class="w-flag-text" fill="#0E1012">LIVE</text>
    </g>
  </g>
  <text class="w-url" x="${lot.cx}" y="${GROUND + 34}" text-anchor="middle" fill="${LIME}" opacity="0"></text>
</g>`;
    }

    function streetMarkup(L) {
        const lamps = [];
        for (let x = 220; x < L.width; x += 330) {
            lamps.push(`<g><circle cx="${x}" cy="${GROUND - 128}" r="46" fill="url(#w-lamp)"/><rect x="${x - 2}" y="${GROUND - 126}" width="4" height="126" fill="#2A3036"/><rect x="${x - 10}" y="${GROUND - 132}" width="20" height="8" rx="3" fill="#3A4148"/><circle cx="${x}" cy="${GROUND - 122}" r="3.5" fill="#F6D58E"/></g>`);
        }
        // Street-name signs stand in the gap before each block, where the shops don't cover them.
        const signs = [...L.blocks].map(([cap, b]) => {
            const x = b.start - BLOCK_GAP / 2;
            return `<g><rect x="${x - 1.5}" y="${GROUND - 64}" width="3" height="64" fill="#3A4148"/><rect x="${x - 44}" y="${GROUND - 84}" width="88" height="22" rx="4" fill="#1F4D3A" stroke="#2E6B52"/><text x="${x}" y="${GROUND - 69}" text-anchor="middle" class="w-street" fill="#D7F5E6">${esc(STREET[cap].toUpperCase())}</text></g>`;
        }).join('');
        const dashes = Array.from({ length: Math.ceil(L.width / 60) }, (_, i) => `<rect x="${i * 60 + 10}" y="${GROUND + 44}" width="30" height="3" rx="1.5" fill="#3A4148"/>`).join('');
        return `<rect x="-200" y="${GROUND}" width="${L.width + 400}" height="12" fill="#20252B"/>
<rect x="-200" y="${GROUND + 12}" width="${L.width + 400}" height="${VIEW_H - GROUND}" fill="#101317"/>${dashes}${lamps.join('')}${signs}`;
    }

    const agentMarkup = () => `<g class="w-agent"><g class="w-agent-body">
  <ellipse cx="0" cy="0" rx="15" ry="4" fill="#000" opacity="0.4"/>
  <rect class="w-leg" x="-8" y="-22" width="6" height="22" rx="3" fill="#8C96A0" style="transform-box: fill-box; transform-origin: 50% 0%"/>
  <rect class="w-leg" x="2" y="-22" width="6" height="22" rx="3" fill="#8C96A0" style="transform-box: fill-box; transform-origin: 50% 0%"/>
  <g class="w-parcels"></g>
  <rect x="-13" y="-54" width="26" height="34" rx="10" fill="#E8EDF2"/>
  <circle cx="0" cy="-67" r="13" fill="#E8EDF2"/>
  <rect x="-9" y="-72" width="18" height="7" rx="3.5" fill="${LIME}"/>
</g></g>`;

    const guardMarkup = () => `<g class="w-guard"><g class="w-guard-body">
  <ellipse cx="0" cy="0" rx="14" ry="4" fill="#000" opacity="0.4"/>
  <rect class="w-leg" x="-8" y="-20" width="6" height="20" rx="3" fill="#3B4A63" style="transform-box: fill-box; transform-origin: 50% 0%"/>
  <rect class="w-leg" x="2" y="-20" width="6" height="20" rx="3" fill="#3B4A63" style="transform-box: fill-box; transform-origin: 50% 0%"/>
  <rect x="-12" y="-50" width="24" height="32" rx="8" fill="#2E3D57"/>
  <circle cx="0" cy="-62" r="12" fill="#C9D6EA"/>
  <path d="M-13 -66 h26 v-6 a13 9 0 0 0 -26 0 z" fill="#2E3D57"/>
  <path d="M8 -46 h16 v12 c0 9 -8 14 -8 14 c0 0 -8 -5 -8 -14 z" fill="#8AB4F8" stroke="#0E1012" stroke-width="1"/>
  <path d="M16 -42 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 z" fill="#0E1012"/>
</g><text class="w-zzz" x="14" y="-84" fill="#9BA4AC" opacity="0">z z z</text></g>`;

    // ---------- The world ----------

    function create({ vendors, guardrails = true, budgetCents = 0, tags = {} }) {
        const narrow = window.matchMedia('(max-width: 640px)').matches;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const viewW = narrow ? 600 : 960;
        const L = layout(vendors);
        const sky = skyMarkup(L.width, viewW);

        const el = document.createElement('section');
        el.className = 'world';
        el.setAttribute('aria-label', "The agent's mission, drawn as a street of vendor shops");
        el.innerHTML = `
<div class="w-stage">
  <svg class="w-svg" viewBox="0 0 ${viewW} ${VIEW_H}" role="img" aria-label="The agent walking between vendor shops">
    ${sky.fixed}
    <g class="w-far">${sky.far}</g>
    <g class="w-cam">
      ${streetMarkup(L)}
      ${homeMarkup()}
      ${[...L.shops.values()].map(shopMarkup).join('')}
      ${lotMarkup(L.lot)}
      <g class="w-fx"></g>
      ${guardMarkup()}
      ${agentMarkup()}
      <g class="w-bubbles"></g>
    </g>
  </svg>
  <div class="w-hud">
    <div class="w-card w-list"><span class="w-label">Shopping list <b class="w-version">PLAN v1</b></span><ol class="w-items"></ol></div>
    <div class="w-card w-wallet"><span class="w-label">Spent</span><span class="w-spent">$0.00</span><span class="w-of">of ${money(budgetCents)}</span><span class="w-guard-chip"></span></div>
  </div>
  <button class="w-replay" type="button" hidden>
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg><span>Watch the journey</span>
  </button>
</div>
<div class="w-caption" aria-live="polite"><span class="log-tag">READY</span><p>The agent's street. Every scene is a real step of the mission.</p></div>`;

        const $ = (sel) => el.querySelector(sel);
        const cam = $('.w-cam');
        const far = $('.w-far');
        const agent = $('.w-agent');
        const guard = $('.w-guard');
        const bubbles = $('.w-bubbles');
        const fx = $('.w-fx');
        const replayBtn = $('.w-replay');

        let state;
        let speed = 1;
        let instant = false;
        let gen = 0;
        const queue = [];
        let running = false;
        let seen = 0;
        let nowBubble = null;
        let nowKey = '';
        let business = null;
        let destroyed = false;

        // ----- Motion helpers -----
        const ms = (base) => (instant || reduced ? 0 : base / speed);
        const wait = (base) => {
            const d = ms(base);
            return d ? new Promise((r) => { setTimeout(r, d); }) : Promise.resolve();
        };
        function move(node, frames, base, easing = 'ease-in-out', iterations = 1) {
            const last = frames[frames.length - 1];
            const d = ms(base);
            if (!d) {
                Object.assign(node.style, last);
                return Promise.resolve();
            }
            const a = node.animate(frames, { duration: d, easing, iterations, fill: 'forwards' });
            return a.finished.then(() => { Object.assign(node.style, last); a.cancel(); }).catch(() => {});
        }
        const fade = (node, to, base = 260) => move(node, [{ opacity: getComputedStyle(node).opacity }, { opacity: String(to) }], base);
        const place = (node, x, y = GROUND) => { node.style.transform = `translate(${x}px, ${y}px)`; };
        const pop = (node) => move(node, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1.08)' }, { opacity: 1, transform: 'scale(1)' }], 320);

        function camTarget(x) {
            return Math.max(0, Math.min(L.width - viewW, x - viewW * 0.45));
        }
        function camera(x, base) {
            const to = camTarget(x);
            const from = state.cam;
            state.cam = to;
            return Promise.all([
                move(cam, [{ transform: `translateX(${-from}px)` }, { transform: `translateX(${-to}px)` }], base),
                move(far, [{ transform: `translateX(${-from * 0.35}px)` }, { transform: `translateX(${-to * 0.35}px)` }], base),
            ]);
        }

        async function walk(who, toX) {
            const key = who === agent ? 'agentX' : 'guardX';
            const from = state[key];
            if (Math.abs(from - toX) < 1) return;
            state[key] = toX;
            const base = Math.max(300, Math.abs(toX - from) / WALK_PX_PER_MS);
            const legs = [...who.querySelectorAll('.w-leg')];
            const d = ms(base);
            if (d) {
                legs.forEach((leg, i) => {
                    const a = leg.animate([{ transform: `rotate(${i ? -22 : 22}deg)` }, { transform: `rotate(${i ? 22 : -22}deg)` }], { duration: 240, direction: 'alternate', iterations: Math.max(1, Math.round(d / 240)) });
                    a.finished.catch(() => {});
                });
            }
            await move(who, [{ transform: `translate(${from}px, ${GROUND}px)` }, { transform: `translate(${toX}px, ${GROUND}px)` }], base, 'ease-in-out');
        }

        async function walkAgent(toX, withGuard = true) {
            const base = Math.max(300, Math.abs(toX - state.agentX) / WALK_PX_PER_MS);
            const steps = [walk(agent, toX), camera(toX, base)];
            if (withGuard && !state.asleep) steps.push(wait(160).then(() => walk(guard, toX - 50)));
            await Promise.all(steps);
        }

        // ----- Bubbles -----
        function bubbleNode(x, y, text, tone) {
            const width = 250;
            const fo = document.createElementNS(NS, 'foreignObject');
            fo.setAttribute('x', String(x - width / 2));
            fo.setAttribute('y', String(y - 170));
            fo.setAttribute('width', String(width));
            fo.setAttribute('height', '170');
            const wrap = document.createElementNS(XHTML, 'div');
            wrap.className = 'w-bubble-wrap';
            const b = document.createElementNS(XHTML, 'div');
            b.className = `w-bubble ${tone || ''}`;
            b.textContent = text;
            wrap.appendChild(b);
            fo.appendChild(wrap);
            bubbles.appendChild(fo);
            return fo;
        }
        async function say(where, text, { tone = '', hold } = {}) {
            if (instant) return;
            const node = bubbleNode(where.x, where.y, text, tone);
            await move(node, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], 200);
            await wait(hold || Math.min(3400, 1000 + text.length * 26));
            await move(node, [{ opacity: 1 }, { opacity: 0 }], 200);
            node.remove();
        }
        const atAgent = () => ({ x: state.agentX, y: GROUND - 88 });
        const atGuard = () => ({ x: state.guardX, y: GROUND - 82 });
        const atShop = (id) => {
            const s = L.shops.get(id);
            return s ? { x: s.cx, y: GROUND - s.height - 44 } : atAgent();
        };

        // ----- Shops, list, wallet -----
        const shopEl = (id) => el.querySelector(`[data-shop="${CSS.escape(id)}"]`);
        function tag(id, text, tone) {
            const shop = shopEl(id);
            if (!shop) return Promise.resolve();
            const t = shop.querySelector('.w-tag');
            t.querySelector('text').textContent = text;
            t.querySelector('rect').setAttribute('stroke', tone === 'warn' ? ORANGE : tone === 'ok' ? LIME : accent(id));
            return pop(t);
        }
        function untag(id) {
            const shop = shopEl(id);
            if (shop) fade(shop.querySelector('.w-tag'), 0, 200);
        }
        function mark(id, kind) {
            const shop = shopEl(id);
            if (!shop) return Promise.resolve();
            const m = shop.querySelector('.w-mark');
            m.querySelector('circle').setAttribute('fill', kind === 'ok' ? LIME : ORANGE);
            const icon = m.querySelector('.w-mark-icon');
            const top = GROUND - L.shops.get(id).height;
            icon.setAttribute('d', kind === 'ok' ? `M${SHOP_W - 17} ${top + 12} l5 5 l9 -10` : `M${SHOP_W - 15} ${top + 6} l10 12 M${SHOP_W - 5} ${top + 6} l-10 12`);
            return pop(m);
        }
        function dim(capability, except) {
            for (const [id, s] of L.shops) {
                if (s.capability !== capability) continue;
                fade(shopEl(id).querySelector('.w-shop-body'), id === except ? 1 : 0.45, 300);
            }
        }
        function undim(capability) {
            for (const [id, s] of L.shops) if (s.capability === capability) fade(shopEl(id).querySelector('.w-shop-body'), 1, 300);
        }

        function renderList() {
            $('.w-list').hidden = !state.list.length;
            $('.w-version').textContent = `PLAN v${state.version}`;
            $('.w-items').innerHTML = state.list.map((it) => {
                const icon = { done: '✓', dropped: '–', skipped: '✕' }[it.status] || '';
                const note = it.status === 'done' ? it.vendor : it.status === 'dropped' ? `included with ${it.vendor || 'the host'}` : it.status === 'skipped' ? 'not bought' : '';
                return `<li class="w-item ${it.status}${it.isNew ? ' new' : ''}"><span class="w-check">${icon}</span><span class="w-item-name">${esc(LABEL[it.capability] || it.capability)}</span>${note ? `<span class="w-item-note">${esc(note)}</span>` : ''}</li>`;
            }).join('');
        }
        function listSet(capability, status, vendor) {
            const it = state.list.find((i) => i.capability === capability);
            if (it) Object.assign(it, { status, vendor: vendor || it.vendor });
            else state.list.push({ capability, status, vendor });
            renderList();
        }
        function spend(cents) {
            state.spent += cents;
            const node = $('.w-spent');
            node.textContent = money(state.spent);
            node.classList.toggle('over', budgetCents > 0 && state.spent > budgetCents);
        }
        function renderGuardChip() {
            // Asleep on the bench: slumped, with its z's showing for the whole run.
            guard.querySelector('.w-guard-body').style.transform = state.asleep ? 'translate(4px, 6px) rotate(-12deg)' : '';
            guard.querySelector('.w-zzz').style.opacity = state.asleep ? '1' : '0';
            const chip = $('.w-guard-chip');
            chip.textContent = state.asleep ? 'Guard asleep: no checks' : 'Gemini on guard';
            chip.classList.toggle('off', state.asleep);
        }

        // ----- Effects -----
        async function coin(id, label) {
            const s = L.shops.get(id);
            if (!s) return;
            const g = document.createElementNS(NS, 'g');
            g.innerHTML = `<circle r="10" fill="${LIME}" stroke="#0E1012" stroke-width="1.5"/><text y="4.5" text-anchor="middle" class="w-coin">$</text>`;
            fx.appendChild(g);
            const x0 = state.agentX + 10;
            const y0 = GROUND - 46;
            const x1 = s.door + 19;
            const y1 = GROUND - 40;
            floatText(x1, GROUND - 110, label, LIME);
            await move(g, [
                { transform: `translate(${x0}px, ${y0}px)` },
                { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 90}px)` },
                { transform: `translate(${x1}px, ${y1}px)` },
            ], 700, 'ease-in-out');
            g.remove();
        }
        async function parcel(id) {
            const s = L.shops.get(id);
            if (!s) return;
            const c = accent(id);
            const g = document.createElementNS(NS, 'g');
            g.innerHTML = `<rect x="-9" y="-9" width="18" height="18" rx="3" fill="${c}"/><path d="M-9 -2 h18 M0 -9 v18" stroke="#0E1012" stroke-width="1.5" opacity="0.5"/>`;
            fx.appendChild(g);
            await move(g, [
                { transform: `translate(${s.door + 19}px, ${GROUND - 34}px)` },
                { transform: `translate(${(s.door + state.agentX) / 2}px, ${GROUND - 110}px)` },
                { transform: `translate(${state.agentX - 16}px, ${GROUND - 40}px)` },
            ], 650, 'ease-in-out');
            g.remove();
            const stack = agent.querySelector('.w-parcels');
            const n = stack.children.length;
            if (n < 5) {
                const box = document.createElementNS(NS, 'rect');
                Object.entries({ x: -24, y: -40 - n * 9, width: 12, height: 9, rx: 2, fill: c }).forEach(([k, v]) => box.setAttribute(k, String(v)));
                stack.appendChild(box);
            }
        }
        function floatText(x, y, text, color) {
            if (instant) return;
            const t = document.createElementNS(NS, 'text');
            Object.entries({ x, y, 'text-anchor': 'middle', class: 'w-float', fill: color }).forEach(([k, v]) => t.setAttribute(k, String(v)));
            t.textContent = text;
            fx.appendChild(t);
            move(t, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.2 }, { opacity: 1, transform: 'translateY(-14px)', offset: 0.8 }, { opacity: 0, transform: 'translateY(-22px)' }], 1900).then(() => t.remove());
        }
        async function stamp(ok, text) {
            if (state.asleep || instant) return;
            await say(atGuard(), text || (ok ? 'Checked: fair price, no tricks.' : 'Stop.'), { tone: ok ? 'ok' : 'no', hold: ok ? 900 : 1700 });
        }
        async function inspect() {
            if (state.asleep || instant) return;
            await move(guard.querySelector('.w-guard-body'), [{ transform: 'translateX(0)' }, { transform: 'translateX(12px)' }, { transform: 'translateX(0)' }], 500);
        }
        function confetti() {
            if (instant || reduced) return;
            const colors = [LIME, '#4FC3F7', '#E879F9', '#FACC15', '#F472B6'];
            for (let i = 0; i < 26; i += 1) {
                const r = document.createElementNS(NS, 'rect');
                const x = L.lot.cx + ((hash(`c${i}`) % 240) - 120);
                Object.entries({ width: 6, height: 10, rx: 1.5, fill: colors[i % colors.length] }).forEach(([k, v]) => r.setAttribute(k, String(v)));
                fx.appendChild(r);
                move(r, [{ transform: `translate(${x}px, ${GROUND - 300}px) rotate(0deg)`, opacity: 1 }, { transform: `translate(${x + ((i % 5) - 2) * 18}px, ${GROUND - 10}px) rotate(${360 + i * 40}deg)`, opacity: 0 }], 1600 + (i % 7) * 120, 'ease-in').then(() => r.remove());
            }
        }

        // ----- What's happening right now (live missions, between log entries) -----
        function clearNow() {
            if (nowBubble) nowBubble.remove();
            nowBubble = null;
            nowKey = '';
        }
        function showNow(now) {
            if (running || instant || !now || !now.text) return clearNow();
            const key = `${now.text}|${now.approval}`;
            if (key === nowKey) return undefined;
            clearNow();
            nowKey = key;
            const where = now.guard && !state.asleep ? atGuard() : atAgent();
            nowBubble = bubbleNode(where.x, where.y, now.text, now.approval ? 'you pulse' : 'think');
            return undefined;
        }

        // ----- Scenes: one per kind of mission log entry -----
        const quoteOf = (text) => {
            const m = /"(.+)"/.exec(text);
            return m ? `“${m[1]}”` : text;
        };
        const doorX = (id) => {
            const s = L.shops.get(id);
            return s ? s.door + 19 : state.agentX;
        };

        const scenes = {
            async plan(e) {
                state.list = (e.steps || []).map((capability) => ({ capability, status: 'todo' }));
                renderList();
                await say(atAgent(), `Shopping list: ${(e.steps || []).map((c) => (LABEL[c] || c).toLowerCase()).join(', ')}.`);
            },
            async unguarded() {
                state.asleep = true;
                renderGuardChip();
                await walk(guard, HOME_X - 88);
                await say(atAgent(), "No guard today. I'll take everyone at their word.", { tone: 'no', hold: 1800 });
            },
            async compare(e) {
                const b = L.blocks.get(e.capability);
                if (b) await walkAgent(b.cx);
                await Promise.all((e.quotes || []).map((q) => tag(q.vendorId, price(q.cents))));
                await wait(1100);
            },
            async choose(e) {
                dim(e.capability, e.vendorId);
                // With one vendor there was no comparison, so this is the first time its price shows.
                tag(e.vendorId, price(e.cents));
                [...L.shops.values()].filter((s) => s.capability === e.capability && s.id !== e.vendorId).forEach((s) => untag(s.id));
                await walkAgent(doorX(e.vendorId) - 30);
                await inspect();
            },
            async ask(e) {
                // Gemini checks before you're asked.
                await stamp(true);
                state.stamped = e.purchaseId;
                await say(atAgent(), `${money(e.cents)} is over your ask-me amount, so I asked you.`, { tone: 'you' });
                await say(atAgent(), `You approved ${money(e.cents)}.`, { tone: 'ok', hold: 900 });
            },
            async trusted(e) {
                await say(atShop(e.vendorId), '“The owner pre-approved our Growth plan.”', { tone: 'vendor' });
                await tag(e.vendorId, money(e.cents), 'warn');
                await say(atAgent(), 'Sounds official. Adding it!', { tone: 'no', hold: 1100 });
            },
            async pay(e) {
                if (state.stamped !== e.purchaseId) await stamp(true);
                await coin(e.vendorId, e.simulated ? `Simulated payout · ${money(e.cents)}` : `PayPal payout · ${money(e.cents)}`);
                spend(e.cents);
                await parcel(e.vendorId);
                await mark(e.vendorId, 'ok');
                untag(e.vendorId);
                undim(e.capability);
                listSet(e.capability, 'done', e.vendor);
            },
            async free(e) {
                if (state.stamped !== e.purchaseId) await stamp(true, 'Checked: free, nothing to pay.');
                floatText(doorX(e.vendorId), GROUND - 110, 'FREE · no payout', LIME);
                await parcel(e.vendorId);
                await mark(e.vendorId, 'ok');
                untag(e.vendorId);
                undim(e.capability);
                listSet(e.capability, 'done', e.vendor);
            },
            async alert(e) {
                await say(atShop(e.vendorId), quoteOf(e.text), { tone: 'vendor', hold: 3200 });
                if (e.includes) state.includedBy[e.capability] = e.vendor;
            },
            async replan(e) {
                state.version = e.version || state.version + 1;
                (e.dropped || []).forEach((c) => listSet(c, 'dropped', state.includedBy[c]));
                (e.added || []).forEach((noun) => {
                    const capability = Object.keys(LABEL).find((c) => noun.includes(LABEL[c].toLowerCase())) || noun;
                    if (!state.list.some((i) => i.capability === capability)) state.list.push({ capability, status: 'todo', isNew: true });
                });
                renderList();
                await say(atAgent(), e.text, { tone: 'ok', hold: 2600 });
            },
            async switch(e) {
                await stamp(false, (e.flags || []).includes('prompt_injection') ? 'Stop: there are instructions hidden in this quote.' : "Stop: this one doesn't look right.");
                await mark(e.vendorId, 'no');
                untag(e.vendorId);
                dim(e.capability, e.to);
                await tag(e.to, price(e.cents));
                await walkAgent(doorX(e.to) - 30);
                await inspect();
            },
            async search(e) {
                await say(atAgent(), `You said no at ${money(e.cents)}. Anyone for ${money(e.ceiling)} or less?`, { tone: 'you' });
            },
            async negotiate(e) {
                await walkAgent(doorX(e.vendorId) - 30);
                await say(atShop(e.vendorId), `How about ${money(e.cents)}?`, { tone: 'vendor', hold: 1300 });
                await tag(e.vendorId, money(e.cents), 'ok');
                await say(atAgent(), 'Deal, if my guard agrees.', { hold: 900 });
                await inspect();
            },
            async blocked(e) {
                if (e.capability) listSet(e.capability, 'skipped');
                undim(e.capability);
                await say(atAgent(), e.text, { tone: 'no', hold: 3000 });
            },
            async skip(e) {
                if (e.capability) listSet(e.capability, 'skipped');
                await say(atAgent(), e.text, { hold: 1800 });
            },
            async build() {
                await walkAgent(L.lot.x - 30);
                $('.w-site-name').textContent = business ? business.name : 'Your site';
                $('.w-site-initials').textContent = initialsOf(business && business.name);
                await fade($('.w-crane'), 1, 400);
                const site = $('.w-site');
                await move(site, [{ opacity: 1, transform: 'scaleY(0.02)' }, { opacity: 1, transform: 'scaleY(1)' }], 1800, 'cubic-bezier(.2,.7,.2,1)');
            },
            async deploy() {
                await fade($('.w-cloud'), 1, 400);
                if (!instant && !reduced) {
                    for (let i = 0; i < 3; i += 1) {
                        const a = document.createElementNS(NS, 'path');
                        a.setAttribute('d', 'M0 0 l-7 9 h4 v10 h6 v-10 h4 z');
                        a.setAttribute('fill', '#A78BFA');
                        fx.appendChild(a);
                        move(a, [{ transform: `translate(${L.lot.cx + (i - 1) * 30}px, ${GROUND - 210}px)`, opacity: 0 }, { transform: `translate(${L.lot.cx + (i - 1) * 30}px, ${GROUND - 236}px)`, opacity: 1, offset: 0.4 }, { transform: `translate(${L.lot.cx + (i - 1) * 30}px, ${GROUND - 262}px)`, opacity: 0 }], 900, 'ease-out', 2).then(() => a.remove());
                    }
                }
                await wait(1400);
            },
            async online(e) {
                const host = String(e.url || '').replace(/^https?:\/\//, '');
                $('.w-site-lock').textContent = host ? '🔒 HTTPS · on Render' : '';
                const url = $('.w-url');
                url.textContent = host;
                await fade($('.w-cloud'), 0, 300);
                await fade($('.w-crane'), 0, 300);
                await fade($('.w-flag'), 1, 200);
                await move($('.w-flag-cloth'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 500);
                await fade(url, 1, 300);
            },
            async done() {
                if ($('.w-site').style.opacity !== '1') return;
                await fade($('.w-flag'), 1, 200);
                confetti();
                await say(atAgent(), `${business ? business.name : 'The site'} is live.`, { tone: 'ok', hold: 1600 });
            },
            async info(e) {
                await say(atAgent(), e.text, { hold: 1800 });
            },
        };

        function caption(e) {
            const [label, tone] = tags[e.kind] || ['NOTE', ''];
            const box = $('.w-caption');
            box.innerHTML = `<span class="log-tag ${esc(tone)}">${esc(label)}${e.version ? ` · v${esc(e.version)}` : ''}</span><p>${esc(e.text)}</p>`;
        }

        async function pump() {
            if (running) return;
            running = true;
            clearNow();
            const mine = gen;
            while (queue.length && mine === gen && !destroyed) {
                const e = queue.shift();
                // A replay plays at its own pace; fall behind a live mission and it speeds up to catch it.
                speed = state.replaying ? 1 : queue.length > 4 ? 2.6 : queue.length > 1 ? 1.6 : 1;
                if (!instant) caption(e);
                try {
                    await (scenes[e.kind] || scenes.info)(e);
                } catch (err) {
                    // A scene that fails shouldn't stop the story.
                }
            }
            running = false;
            if (mine === gen && state.pendingNow) showNow(state.pendingNow);
            if (mine === gen && state.ended && !queue.length) replayBtn.hidden = false;
        }

        function reset() {
            gen += 1;
            queue.length = 0;
            running = false;
            clearNow();
            bubbles.innerHTML = '';
            fx.innerHTML = '';
            agent.querySelector('.w-parcels').innerHTML = '';
            state = { agentX: HOME_X + 30, guardX: HOME_X - 10, cam: 0, asleep: !guardrails, list: [], version: 1, spent: 0, includedBy: {}, ended: false, pendingNow: null, stamped: null };
            el.querySelectorAll('.w-tag, .w-mark, .w-crane, .w-site, .w-cloud, .w-flag, .w-url').forEach((n) => { n.getAnimations().forEach((a) => a.cancel()); n.style.opacity = '0'; n.style.transform = ''; });
            el.querySelectorAll('.w-shop-body').forEach((n) => { n.style.opacity = '1'; });
            place(agent, state.agentX);
            place(guard, guardrails ? state.guardX : HOME_X - 88);
            cam.style.transform = 'translateX(0px)';
            far.style.transform = 'translateX(0px)';
            $('.w-spent').textContent = '$0.00';
            $('.w-spent').classList.remove('over');
            renderList();
            renderGuardChip();
            replayBtn.hidden = true;
        }

        // Plays entries without animating them, to catch up to where a mission already is.
        async function jump(entries) {
            instant = true;
            for (const e of entries) {
                try {
                    await (scenes[e.kind] || scenes.info)(e);
                } catch (err) {
                    // keep going
                }
            }
            instant = false;
            if (entries.length) caption(entries[entries.length - 1]);
        }

        reset();

        return {
            el,
            // Feed it the mission as the page polls. Entries more than a few seconds old when the
            // world first sees them are caught up instantly; newer ones play out.
            update({ mission, active, now }) {
                if (destroyed || !mission) return;
                if (mission.business) business = mission.business;
                const log = mission.log || [];
                const fresh = log.slice(seen);
                const first = seen === 0;
                seen = log.length;
                if (first && fresh.length) {
                    const cutoff = Date.now() - 8000;
                    const old = active ? fresh.filter((e) => Date.parse(e.at) < cutoff) : fresh;
                    const rest = fresh.slice(old.length);
                    jump(old).then(() => {
                        queue.push(...rest);
                        state.ended = !active;
                        if (!active) replayBtn.hidden = false;
                        pump();
                    });
                } else if (fresh.length) {
                    queue.push(...fresh);
                    pump();
                }
                if (!active) {
                    state.ended = true;
                    state.pendingNow = null;
                    if (!running && !queue.length) replayBtn.hidden = false;
                } else {
                    state.pendingNow = now;
                    showNow(now);
                }
            },
            replay(mission) {
                reset();
                state.ended = true;
                state.replaying = true;
                if (mission.business) business = mission.business;
                queue.push(...(mission.log || []));
                pump();
            },
            onReplay(handler) {
                replayBtn.addEventListener('click', handler);
            },
            destroy() {
                destroyed = true;
                gen += 1;
                queue.length = 0;
            },
        };
    }

    window.AllowanceWorld = { create };
}());
