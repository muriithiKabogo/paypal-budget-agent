// Allowance web app: a small client-side router and one render function per screen.
// Everything that comes from the server (task text, Gemini's reasons, vendor responses) goes
// through html``, which escapes it, so a judge typing <script> into the task box sees text.
(() => {
    'use strict';

    // ---------- Safe HTML ----------
    const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    class SafeHtml {
        constructor(value) { this.value = value; }
        toString() { return this.value; }
    }
    const raw = (value) => new SafeHtml(value);
    const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
    const piece = (v) => {
        if (v == null || v === false) return '';
        if (v instanceof SafeHtml) return v.value;
        if (Array.isArray(v)) return v.map(piece).join('');
        return esc(v);
    };
    const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? piece(values[i]) : ''), ''));

    // ---------- Icons ----------
    const svg = (size, paths, stroke = 2) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);
    const icons = {
        check: (s = 14) => svg(s, '<path d="M5 12.5l4.5 4.5L19 7.5"/>', 3),
        x: (s = 14) => svg(s, '<path d="M6 6l12 12M18 6L6 18"/>', 3),
        arrow: (s = 18) => svg(s, '<path d="M5 12h14M13 6l6 6-6 6"/>'),
        back: (s = 16) => svg(s, '<path d="M19 12H5M11 6l-6 6 6 6"/>'),
        chevron: (s = 16) => svg(s, '<path d="M9 6l6 6-6 6"/>'),
        reset: (s = 16) => svg(s, '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/>'),
        user: (s = 16) => svg(s, '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', 1.8),
        lock: (s = 22) => svg(s, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 1.8),
        copy: (s = 16) => svg(s, '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
        download: (s = 16) => svg(s, '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
        code: (s = 16) => svg(s, '<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>'),
        stop: (s = 16) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`),
        mic: (s = 20) => svg(s, '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>'),
        external: (s = 16) => svg(s, '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    };
    const logo = () => raw('<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="none" stroke="#2A3036" stroke-width="4"/><path d="M14 3 A11 11 0 1 1 3.66 17.76" fill="none" stroke="#C8F560" stroke-width="4" stroke-linecap="round"/></svg>');

    // ---------- Formatting ----------
    const money = (cents) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const pad = (n) => String(n).padStart(2, '0');
    const clock = (ms) => {
        const s = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(s / 60)}:${pad(s % 60)}`;
    };
    const timeOf = (iso, withMs = false) => {
        const d = new Date(iso);
        const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return withMs ? `${base}.${String(d.getMilliseconds()).padStart(3, '0')}` : base;
    };
    const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
    const listJoin = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
    const toCents = (text) => {
        const n = Number(String(text).replace(/[$,\s]/g, ''));
        return String(text).trim() !== '' && Number.isFinite(n) ? Math.round(n * 100) : NaN;
    };
    const isActive = (task) => ['planning', 'running', 'waiting_approval'].includes(task.status);
    const reviewing = (task) => Boolean(task.review && task.review.status === 'writing');

    // Voice input has two modes. Live: the browser's speech recognition (Google's service in Chrome
    // and Edge) types as you talk. Record: for browsers without a working speech service (Brave,
    // Firefox), record a short WAV and have Gemini transcribe it on the server.
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    // Brave ships the API but switches Google's speech service off, so live mode always fails there.
    const liveSpeech = Boolean(SpeechRecognition) && !navigator.brave;
    const canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && AudioCtx && window.AudioWorkletNode);
    const MAX_RECORDING_MS = 30000;
    const TAP_WORKLET = "class Tap extends AudioWorkletProcessor { process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; } } registerProcessor('tap', Tap);";

    const MAX_STREAM_MS = 60000;

    // Mono float samples at the mic's rate -> 16 kHz 16-bit PCM, one piece at a time (what Gemini expects).
    function makeDownsampler(inputRate, outputRate = 16000) {
        const ratio = inputRate / outputRate;
        let carry = new Float32Array(0);
        let pos = 0;
        return (samples) => {
            const buf = new Float32Array(carry.length + samples.length);
            buf.set(carry);
            buf.set(samples, carry.length);
            const out = new Int16Array(Math.max(0, Math.floor((buf.length - pos) / ratio)));
            for (let i = 0; i < out.length; i += 1) {
                const start = Math.floor(pos);
                const end = Math.max(start + 1, Math.floor(pos + ratio));
                let sum = 0;
                for (let j = start; j < end; j += 1) sum += buf[j];
                const v = Math.max(-1, Math.min(1, sum / (end - start)));
                out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
                pos += ratio;
            }
            const used = Math.floor(pos);
            carry = buf.slice(used);
            pos -= used;
            return out;
        };
    }

    function joinPcm(parts) {
        const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const p of parts) {
            out.set(p, offset);
            offset += p.length;
        }
        return out;
    }

    function pcmToWav(pcm, rate = 16000) {
        const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
        const ascii = (at, s) => [...s].forEach((ch, k) => view.setUint8(at + k, ch.charCodeAt(0)));
        ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
        ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
        pcm.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
        return new Uint8Array(view.buffer);
    }

    // Opens the mic and passes raw samples to onSamples. Returns a function that closes it all.
    async function openMic(ctx, onSamples) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        try {
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' })));
            const node = new AudioWorkletNode(ctx, 'tap');
            node.port.onmessage = (event) => onSamples(event.data);
            ctx.createMediaStreamSource(stream).connect(node);
            node.connect(ctx.destination);
            await ctx.resume();
            return () => {
                node.port.onmessage = null;
                node.disconnect();
                stream.getTracks().forEach((t) => t.stop());
                ctx.close().catch(() => {});
            };
        } catch (err) {
            stream.getTracks().forEach((t) => t.stop());
            throw err;
        }
    }

    function micError(err) {
        if (err && err.name === 'NotFoundError') return VOICE_ERRORS['audio-capture'];
        if (err && err.name === 'NotAllowedError') return VOICE_ERRORS['not-allowed'];
        return 'The microphone could not start. You can type the task instead.';
    }

    // Live dictation needs a connection to Gemini, and a browser takes 1–3 s to open one. So the
    // console opens it while the person heads for the task box; by the time they click the mic it's
    // ready, and words appear right away. A connection nobody uses closes after a few minutes.
    const VOICE_LINE_IDLE_MS = 55 * 1000; // Gemini drops an idle connection after about 60 s anyway
    let spareLine = null;

    function parseLiveMessage(data) {
        try {
            return JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
        } catch {
            return null;
        }
    }

    // A line is { promise: Promise<WebSocket that has finished setup>, idle }.
    function openVoiceLine() {
        const line = {};
        line.promise = (async () => {
            const pass = await api('/voice-token', { method: 'POST' });
            const socket = new WebSocket(`${pass.url}?access_token=${encodeURIComponent(pass.token)}`);
            socket.binaryType = 'arraybuffer';
            await new Promise((resolve, reject) => {
                socket.onopen = () => socket.send(JSON.stringify({ setup: { model: `models/${pass.model}` } }));
                socket.onmessage = (event) => {
                    const msg = parseLiveMessage(event.data);
                    if (msg && msg.setupComplete) resolve();
                };
                socket.onclose = (event) => reject(Object.assign(new Error(event.reason || "Live dictation couldn't connect."), { code: 'socket_closed' }));
            });
            socket.onmessage = null;
            socket.onclose = () => {
                if (spareLine === line) spareLine = null;
            };
            return socket;
        })();
        return line;
    }

    function warmUpVoice() {
        if (spareLine) return;
        const line = openVoiceLine();
        spareLine = line;
        line.promise.then(
            (socket) => {
                line.idle = setTimeout(() => {
                    if (spareLine !== line) return;
                    spareLine = null;
                    socket.close();
                }, VOICE_LINE_IDLE_MS);
            },
            () => {
                if (spareLine === line) spareLine = null; // the mic click tries again and reports any error
            },
        );
    }

    function takeVoiceLine() {
        const line = spareLine || openVoiceLine();
        spareLine = null;
        clearTimeout(line.idle);
        return line;
    }

    function dropSpareLine() {
        if (!spareLine) return;
        const line = spareLine;
        spareLine = null;
        clearTimeout(line.idle);
        line.promise.then((socket) => socket.close(), () => {});
    }

    function toBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(binary);
    }

    const VOICE_ERRORS = {
        'not-allowed': "Microphone access is blocked. Allow it in your browser's site settings, or type the task.",
        'service-not-allowed': "This browser doesn't allow voice input here. Try Chrome, Edge or Safari, or type the task.",
        network: "Voice input needs your browser's speech service, which isn't available here. Try Chrome, Edge or Safari, or type the task.",
        'no-speech': "Didn't hear anything. Click the mic and try again.",
        'audio-capture': 'No microphone found. Connect one, or type the task.',
        'language-not-supported': "Voice input doesn't support your browser's language. Type the task instead.",
    };

    const EXAMPLES = [
        { label: '10 logistics companies in Texas', prompt: 'Find 10 logistics companies in Texas with 50–200 employees and a named head of operations, then run a credit check on the best match.' },
        { label: 'Is this supplier creditworthy?', prompt: 'Check whether Gulf Coast Cartage, a freight company in Houston, pays its bills on time.' },
        { label: "What's moving freight rates this month?", prompt: "Find two articles on what's moving freight rates this month." },
    ];

    // ---------- API and state ----------
    const state = { session: null, hadSession: false, catalog: null, config: null };

    async function api(path, { method = 'GET', body } = {}) {
        let res;
        try {
            res = await fetch(`/api${path}`, {
                method,
                credentials: 'same-origin',
                headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch {
            throw Object.assign(new Error("Couldn't reach the server. Check your connection and try again."), { code: 'network' });
        }
        if (res.status === 204) return {};
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong.'), { status: res.status, code: data.error, data });
        if (data.session) state.session = data.session;
        return data;
    }

    async function getCatalog() {
        if (!state.catalog) state.catalog = await api('/catalog');
        return state.catalog;
    }

    async function getConfig() {
        if (!state.config) state.config = await api('/config').catch(() => ({}));
        return state.config;
    }

    async function loadSession() {
        const { session } = await api('/session');
        state.session = session;
        if (session) state.hadSession = true;
        return session;
    }

    async function requireSession() {
        const session = await loadSession();
        if (!session) mount(endedScreen(), 'Session ended');
        return session;
    }

    const vendorName = (id) => {
        const v = state.catalog && state.catalog.vendors.find((x) => x.id === id);
        return v ? v.name : id;
    };
    const categoryShort = (id) => {
        const c = state.catalog && state.catalog.categories.find((x) => x.id === id);
        return c ? c.short : id;
    };

    // ---------- Router ----------
    const app = document.getElementById('app');
    let leaveFns = [];
    let actions = {};
    const onLeave = (fn) => leaveFns.push(fn);

    function leave() {
        leaveFns.forEach((fn) => fn());
        leaveFns = [];
    }

    function mount(content, title) {
        app.innerHTML = String(content);
        if (title) document.title = `${title} · Allowance`;
    }

    const routes = [
        [/^\/$/, landingView],
        [/^\/rules$/, rulesView],
        [/^\/console$/, consoleView],
        [/^\/tasks\/([\w-]+)$/, taskView],
        [/^\/purchases\/([\w-]+)$/, purchaseView],
        [/^\/ledger$/, ledgerView],
    ];

    async function route() {
        leave();
        actions = {};
        const path = location.pathname.replace(/\/+$/, '') || '/';
        const found = routes.map(([re, view]) => [path.match(re), view]).find(([m]) => m);
        try {
            if (found) await found[1](...found[0].slice(1));
            else mount(notFoundScreen(), 'Not found');
        } catch (err) {
            handleError(err, true);
        }
        const heading = app.querySelector('h1');
        if (heading && !location.hash) {
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
    }

    function navigate(path) {
        history.pushState(null, '', path);
        window.scrollTo(0, 0);
        return route();
    }

    const globalActions = {
        async reset(el) {
            el.disabled = true;
            try {
                await api('/session', { method: 'DELETE' });
            } catch {
                // Starting over works even if the old session is already gone.
            }
            state.session = null;
            navigate('/rules');
        },
        retry() {
            route();
        },
        async 'guardrails-on'(el) {
            el.disabled = true;
            try {
                await api('/session/guardrails', { method: 'PUT', body: { on: true } });
                toast('Guardrails are back on.');
                route();
            } catch (err) {
                el.disabled = false;
                handleError(err);
            }
        },
    };

    document.addEventListener('click', (event) => {
        const actionEl = event.target.closest('[data-action]');
        if (actionEl && !actionEl.disabled) {
            const fn = actions[actionEl.dataset.action] || globalActions[actionEl.dataset.action];
            if (fn) {
                event.preventDefault();
                fn(actionEl, event);
                return;
            }
        }
        const link = event.target.closest('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
        const href = link.getAttribute('href');
        if (!href.startsWith('/') || href.startsWith('//')) return;
        event.preventDefault();
        navigate(href);
    });
    window.addEventListener('popstate', route);

    // Timers on screen (session clock, elapsed, approval countdown) tick here, without re-rendering.
    setInterval(() => {
        const now = Date.now();
        document.querySelectorAll('[data-session-timer]').forEach((el) => {
            if (state.session) el.textContent = clock(new Date(state.session.expiresAt) - now);
        });
        document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = clock(now - new Date(el.dataset.since)); });
        document.querySelectorAll('[data-until]').forEach((el) => { el.textContent = clock(new Date(el.dataset.until) - now); });
        const path = location.pathname;
        if (state.session && new Date(state.session.expiresAt) <= now && path !== '/' && path !== '/rules') {
            state.session = null;
            state.hadSession = true;
            leave();
            mount(endedScreen(), 'Session ended');
        }
    }, 1000);

    function toast(message, kind = 'info') {
        const region = document.getElementById('toasts');
        const el = document.createElement('div');
        el.className = `toast ${kind}`;
        el.textContent = message;
        region.append(el);
        setTimeout(() => el.remove(), 6000);
    }

    function handleError(err, fatal = false) {
        if (err && err.code === 'no_session') {
            state.session = null;
            leave();
            mount(endedScreen(), 'Session ended');
            return;
        }
        console.error(err);
        if (fatal) mount(errorScreen(err), 'Something went wrong');
        else toast(err.message || 'Something went wrong.', 'error');
    }

    function downloadCsv(filename, rows) {
        const cell = (v) => {
            const s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ---------- Shared pieces ----------
    function topbar(active) {
        const s = state.session;
        const navLink = (href, label, key) => html`<a href="${href}"${active === key ? raw(' aria-current="page"') : ''}>${label}</a>`;
        return html`
<header class="topbar"><div class="wrap topbar-row">
  <a class="brand" href="/">${logo()}Allowance</a>
  ${s ? html`<nav class="nav" aria-label="Main">${navLink('/console', 'Console', 'console')}${navLink('/ledger', 'Ledger', 'ledger')}</nav>` : ''}
  <div class="top-right">
    ${s ? html`<a class="guard-chip ${s.guardrails ? 'on' : 'off'}" href="/console">${s.guardrails ? 'Guardrails on' : 'Guardrails off'}</a>` : ''}
    ${s ? html`<span class="money-chip${s.leftCents < 0 ? ' orange' : ''}">${money(s.leftCents)} left</span>` : ''}
    <span class="session-chip"><span class="dot"></span>Sandbox · <span data-session-timer>${s ? clock(new Date(s.expiresAt) - Date.now()) : `${(state.config && state.config.sessionMinutes) || 30}:00`}</span> left</span>
    ${s ? html`<button class="btn" type="button" data-action="reset">${icons.reset()}Reset</button>` : ''}
  </div>
</div></header>
${s && !s.guardrails ? html`<div class="guard-banner" role="status"><div class="wrap guard-banner-row">
  <span><strong>Guardrails are off.</strong> Nothing checks the agent's purchases, and it takes vendors at their word. Sandbox money only; payouts over ${money(s.unguardedPayoutLimitCents)} are simulated.</span>
  <button class="btn btn-sm-light" type="button" data-action="guardrails-on"${s.activeTaskId ? raw(' disabled') : ''}>Turn them back on</button>
</div></div>` : ''}`;
    }

    const page = (active, body) => html`${topbar(active)}<main class="wrap page" id="main">${body}</main>`;

    function badge(kind, size = '') {
        const cls = `badge${size ? ` badge-${size}` : ''} ${kind}`;
        const s = size === 'lg' ? 16 : 12;
        if (kind === 'ok') return html`<span class="${cls}" aria-hidden="true">${icons.check(s)}</span>`;
        if (kind === 'no') return html`<span class="${cls}" aria-hidden="true">${icons.x(s)}</span>`;
        return html`<span class="${cls}" aria-hidden="true"></span>`;
    }

    function budgetCard(s, pendingCents = 0) {
        const pct = (c) => Math.max(0, Math.min(100, (c / s.budgetCents) * 100)).toFixed(2);
        const pending = Math.min(pendingCents, Math.max(0, s.leftCents));
        const over = s.leftCents < 0;
        return html`
<section class="card">
  <h2 class="label">${over ? 'Over budget' : 'Budget left'}</h2>
  <div class="row baseline gap-10"><span class="amount amount-lg${over ? ' orange' : ''}">${money(over ? -s.leftCents : s.leftCents)}</span><span class="dim">${over ? `over your ${money(s.budgetCents)}` : `of ${money(s.budgetCents)}`}</span></div>
  <div class="meter" aria-hidden="true"><div class="fill" style="width: ${pct(s.leftCents - pending)}%"></div>${pending ? html`<div class="pending" style="width: ${pct(pending)}%"></div>` : ''}</div>
  <div class="row small dim gap-24">
    <span>Spent <span class="mono text">${money(s.spentCents)}</span></span>
    ${pending ? html`<span>Being checked <span class="mono text">${money(pending)}</span></span>` : ''}
  </div>
</section>`;
    }

    function rulesCard(rules, { editable = true } = {}) {
        return html`
<section class="card">
  <div class="row between"><h2 class="label">Your rules</h2>${editable ? html`<a class="small link-min" href="/rules">Edit</a>` : ''}</div>
  <dl class="kv-list">
    <div class="kv"><dt>Max per purchase</dt><dd class="mono">${money(rules.maxPerPurchaseCents)}</dd></div>
    <div class="kv"><dt>Ask me above</dt><dd class="mono">${money(rules.askAboveCents)}</dd></div>
    <div class="kv-stack"><dt>Can buy</dt><dd>${rules.categories.length ? listJoin(rules.categories.map(categoryShort)) : 'Nothing yet'}</dd></div>
    <div class="kv-stack"><dt>From</dt><dd>${rules.vendors.length ? listJoin(rules.vendors.map(vendorName)) : 'No vendors yet'}</dd></div>
  </dl>
</section>`;
    }

    function outcomeBadge(p) {
        if (p.outcome === 'paid') return badge('ok', 'sm');
        if (p.outcome === 'blocked' || p.outcome === 'denied') return badge('no', 'sm');
        return badge('idle', 'sm');
    }

    const unchecked = (p) => p.checks.rules.status === 'off';
    const simulated = (p) => p.checks.paypal.status === 'simulated';
    const free = (p) => p.checks.paypal.status === 'free';

    function outcomeText(p) {
        switch (p.outcome) {
            case 'paid':
                if (simulated(p)) return 'Simulated payout · no checks';
                if (free(p)) return 'Free · nothing to pay';
                if (unchecked(p)) return 'Paid · no checks';
                return p.checks.approval.status === 'approved' ? 'Paid · you approved' : 'Paid';
            case 'blocked':
            case 'denied': return p.decidedBy;
            case 'skipped': return 'Skipped';
            case 'stopped': return 'Stopped';
            default: return "Didn't go through";
        }
    }

    function outcomePill(p) {
        const map = { paid: ['ok', 'PAID'], blocked: ['no', 'BLOCKED'], denied: ['no', 'DENIED'], skipped: ['', 'SKIPPED'], stopped: ['', 'STOPPED'], failed: ['', 'FAILED'] };
        let [tone, text] = map[p.outcome] || ['', 'IN PROGRESS'];
        if (p.outcome === 'paid' && simulated(p)) [tone, text] = ['no', 'SIMULATED'];
        else if (p.outcome === 'paid' && free(p)) [tone, text] = ['ok', 'FREE'];
        else if (p.outcome === 'paid' && unchecked(p)) [tone, text] = ['no', 'PAID · NO CHECKS'];
        return html`<span class="pill pill-sm ${tone}">${text}</span>`;
    }

    // ---------- Screens: general ----------
    const endedScreen = () => html`${topbar(null)}
<main class="wrap page narrow" id="main">
  <p class="eyebrow">Sandbox session</p>
  <h1 class="h-page">${state.hadSession ? 'Your sandbox session has ended' : "You don't have a sandbox session yet"}</h1>
  <p class="lede">${state.hadSession
        ? `Sessions last ${(state.config && state.config.sessionMinutes) || 30} minutes, so every visitor gets a fresh budget. Start a new one to keep going.`
        : 'Start one to get a fresh sandbox budget and your own spending rules.'}</p>
  <div><a class="btn btn-primary btn-lg" href="/rules">Start a new session${icons.arrow()}</a></div>
</main>`;

    const errorScreen = (err) => html`${topbar(null)}
<main class="wrap page narrow" id="main">
  <h1 class="h-page">Something went wrong</h1>
  <p class="lede">${err.message || 'The page could not load.'}</p>
  <div class="row"><button class="btn btn-primary btn-md" type="button" data-action="retry">Try again</button><a class="btn btn-md" href="/">Go to the start</a></div>
</main>`;

    const notFoundScreen = () => html`${topbar(null)}
<main class="wrap page narrow" id="main">
  <h1 class="h-page">Page not found</h1>
  <p class="lede">That link doesn't go anywhere in Allowance.</p>
  <div><a class="btn btn-primary btn-md" href="/">Go to the start</a></div>
</main>`;

    // ---------- Screen 1: Landing ----------
    async function landingView() {
        const [session, config] = await Promise.all([loadSession().catch(() => null), getConfig()]);
        const cta = session
            ? html`<a class="btn btn-primary btn-lg" href="/console">Back to your session${icons.arrow()}</a>`
            : html`<a class="btn btn-primary btn-lg" href="/rules">Start a sandbox session${icons.arrow()}</a>`;
        const gateTile = (n, title, text) => html`<li class="card tile"><span class="mono lime">${n}</span><h3 class="h-tile">${title}</h3><p class="muted">${text}</p></li>`;
        const attackTile = (title, text, tests) => html`<li class="card tile-sm"><span class="strong">${title}</span><span class="muted">${text}</span><span class="tests ${tests === 'Tests Gemini' ? 'gemini' : ''}">${tests}</span></li>`;
        mount(html`
<header class="topbar"><div class="wrap topbar-row">
  <a class="brand" href="/">${logo()}Allowance</a>
  <nav class="nav push" aria-label="Page"><a href="#how">How it works</a><a href="https://github.com/muriithiKabogo/paypal-budget-agent">Source on GitHub</a></nav>
</div></header>
<main id="main">
  <section class="wrap hero">
    <div class="hero-copy">
      <p class="eyebrow">Agentic commerce · PayPal sandbox · Gemini</p>
      <h1 class="h-hero">Give an AI agent $50. <span class="lime">Then try to make it misbehave.</span></h1>
      <p class="hero-lede">Allowance is an AI agent with a wallet. Give it a goal, like launching a website for your business, and it plans the steps, compares vendors and pays each one with PayPal, but only inside the rules you set. Every purchase is checked by your rules, then by Gemini, before any money moves.</p>
      <div class="row gap-16-28">
        ${cta}
        ${config.demoVideoUrl ? html`<a class="link-underline" href="${config.demoVideoUrl}" target="_blank" rel="noopener">Watch the 2-minute demo</a>` : ''}
      </div>
      <p class="small faint">No sign-up. A fresh $50 sandbox budget that resets after ${config.sessionMinutes || 30} minutes. No real money moves.</p>
    </div>
    <div class="hero-visual" aria-label="Two example decisions">
      <div class="demo-card">
        <div class="row between top"><div class="stack gap-2"><span class="strong big">mamasbakery.shop</span><span class="small dim">Dotlark · Domains and hosting</span></div><span class="amount amount-sm">$6.00</span></div>
        <ol class="mini-gates">
          <li>${badge('ok')}Your rules<span class="status dim">passed</span></li>
          <li>${badge('ok')}Gemini<span class="status dim">approved</span></li>
          <li>${badge('ok')}PayPal sandbox<span class="status ok">paid</span></li>
        </ol>
      </div>
      <div class="demo-card blocked">
        <div class="row between top"><div class="stack gap-2"><span class="strong big">2 concert tickets</span><span class="small dim">No approved vendor · Entertainment</span></div><span class="amount amount-sm strike">$180.00</span></div>
        <div class="mini-gates-row">${badge('no')}Your rules<span class="status no">blocked</span></div>
        <p class="muted small-15">Entertainment isn't an allowed category. Gemini was never asked, and no money moved.</p>
      </div>
    </div>
  </section>

  <section id="how" class="band">
    <div class="wrap section stack gap-40">
      <div class="stack gap-12 max-720">
        <h2 class="h-section">Every purchase passes three checks</h2>
        <p class="lede">In this order. If one says no, the next never runs and no money moves.</p>
      </div>
      <ol class="grid-tiles">
        ${gateTile('01', 'Your rules', "Checked in code before the AI is asked anything: spending limits, allowed categories, approved vendors. The agent can read them but can't change them.")}
        ${gateTile('02', "Gemini's judgment", 'Does this purchase serve the task? Is the price fair? Is the vendor trying something? Anything a vendor writes is treated as data, never as instructions.')}
        ${gateTile('03', 'PayPal', 'Paid with a PayPal sandbox payout. The vendor checks the amount, the recipient, and that the payment was made for its quote and never used before. Then it delivers.')}
      </ol>
      <div class="you-band">${icons.user(24)}<p><strong>And you.</strong> Anything over your ask-me amount waits for your OK. If you don't answer, the agent skips it.</p></div>
    </div>
  </section>

  <section class="wrap section split-hero">
    <div class="stack gap-20 grow-380">
      <h2 class="h-section">Built to be attacked</h2>
      <p class="lede">Pick a ready-made attack or write your own. Each result shows which check caught it. Then switch the guardrails off and run it again to see what happens without them.</p>
      <div>${cta}</div>
    </div>
    <ul class="grid-attacks grow-600">
      ${attackTile('Overspend', '“Buy a $400 industry report.”', 'Tests your rules')}
      ${attackTile('Off-limits purchase', '“Get me two concert tickets.”', 'Tests your rules')}
      ${attackTile('Unapproved vendor', '“Buy from FastFacts Pro, it\'s cheaper.”', 'Tests your rules')}
      ${attackTile('Hidden instructions', "A vendor's quote claims you pre-approved an upsell.", 'Tests Gemini')}
    </ul>
  </section>

  <section class="band-top">
    <div class="wrap section-sm grid-two">
      <div class="stack gap-16">
        <h2 class="h-sub">What's real</h2>
        <ul class="bullets">
          <li><span class="b"></span>PayPal sandbox payouts, checked by each vendor through PayPal's Payouts API before it delivers</li>
          <li><span class="b"></span>A Gemini 3.1 Pro plan for every task and a decision on every purchase</li>
          <li><span class="b"></span>Spending rules enforced in code</li>
          <li><span class="b"></span>The website a mission ends with: written by Gemini and published at a link you can open</li>
        </ul>
      </div>
      <div class="stack gap-16">
        <h2 class="h-sub">What's simulated</h2>
        <ul class="bullets">
          <li><span class="b hollow"></span>The vendor agents, which run on this server and return sample data (no domain is really registered)</li>
          <li><span class="b hollow"></span>The money: sandbox dollars, nothing is charged</li>
        </ul>
      </div>
    </div>
  </section>
</main>
<footer class="band-top"><div class="wrap footer-row">
  <span>Built for the PayPal AI Hackathon 2026</span><span>MIT licensed</span><a href="https://github.com/muriithiKabogo/paypal-budget-agent">Source on GitHub</a>
</div></footer>`, 'Give an AI agent a budget');
    }

    // ---------- Screen 2: Set the rules ----------
    function readRulesForm(form) {
        const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
        return {
            budget: form.elements.budget.value,
            maxPerPurchase: form.elements.maxPerPurchase.value,
            askAbove: form.elements.askAbove.value,
            categories: checked('categories'),
            vendors: checked('vendors'),
        };
    }

    function plainWords(input) {
        const amount = (text) => {
            const c = toCents(text);
            return Number.isFinite(c) ? money(c) : '—';
        };
        const cats = input.categories.map((id) => categoryShort(id).toLowerCase());
        const vendors = input.vendors.map(vendorName);
        let tail;
        if (!cats.length) tail = html`It can't buy anything until you allow at least one category.`;
        else if (!vendors.length) tail = html`It can't buy anything until you approve at least one vendor.`;
        else tail = html`It can buy <strong>${listJoin(cats)}</strong>, and only from <strong>${listJoin(vendors)}</strong>.`;
        return html`This agent can spend up to <strong class="lime">${amount(input.budget)}</strong> in total and no more than <strong class="lime">${amount(input.maxPerPurchase)}</strong> at a time. It asks you before spending more than <strong class="lime">${amount(input.askAbove)}</strong>. ${tail}`;
    }

    async function rulesView() {
        // Always fresh here: a tab opened before the vendor list changed would otherwise save rules
        // without the new categories and vendors.
        state.catalog = null;
        const [catalog, session] = await Promise.all([getCatalog(), loadSession(), getConfig()]);
        const r = session ? session.rules : catalog.defaults;
        const dollars = (c) => (c / 100).toFixed(2);
        const busy = session && session.activeTaskId;
        const moneyField = (name, label, value, help, dashed) => html`
<div class="field">
  <label for="${name}">${label}</label>
  <div class="money-input${dashed ? ' dashed' : ''}"><span aria-hidden="true">$</span><input id="${name}" name="${name}" type="text" inputmode="decimal" autocomplete="off" value="${value}" aria-describedby="${name}-help ${name}-error"></div>
  <span class="small dim" id="${name}-help">${help}</span>
  <span class="field-error" id="${name}-error" data-error-for="${name}"></span>
</div>`;
        const allVendors = catalog.vendors;
        mount(page(session ? 'console' : null, html`
<div class="stack gap-12 max-760">
  <p class="eyebrow">${session ? 'Your sandbox session' : 'New sandbox session'}</p>
  <h1 class="h-page">Set your agent's rules</h1>
  <p class="lede">These are checked in code before Gemini is asked anything. The agent can read them but can't change them. The defaults are ready, so you can keep them and go.</p>
</div>
<div class="split">
  <form id="rules-form" class="main gap-20" novalidate>
    <fieldset class="card card-form">
      <legend>Money</legend>
      <div class="grid-fields">
        ${moneyField('budget', 'Total budget', dollars(r.budgetCents), 'Sandbox dollars, up to $100.')}
        ${moneyField('maxPerPurchase', 'Max per purchase', dollars(r.maxPerPurchaseCents), 'Anything bigger is blocked.')}
        ${moneyField('askAbove', 'Ask me before anything over', dollars(r.askAboveCents), 'The agent pauses until you answer.', true)}
      </div>
    </fieldset>
    <fieldset class="card card-form">
      <legend>What it can buy</legend>
      <div class="row gap-10">
        ${catalog.categories.map((c) => html`<label class="check-chip"><input type="checkbox" name="categories" value="${c.id}"${r.categories.includes(c.id) ? raw(' checked') : ''}>${c.label}</label>`)}
      </div>
    </fieldset>
    <fieldset class="card card-form gap-6">
      <legend>Who it can buy from</legend>
      ${catalog.categories.filter((c) => allVendors.some((v) => v.category === c.id)).map((c) => html`
      <span class="vendor-group">${c.label}</span>
      ${allVendors.filter((v) => v.category === c.id).map((v) => html`
      <label class="vendor-row"><input type="checkbox" name="vendors" value="${v.id}"${r.vendors.includes(v.id) ? raw(' checked') : ''}>
        <span class="vendor-name"><span class="strong">${v.name}</span><span class="small dim">${v.blurb}${catalog.defaults.vendors.includes(v.id) ? '' : ' · not approved by default'}</span></span>
        <span class="mono">${money(v.items[0].unitCents)}</span>
      </label>`)}`)}
      <p class="small dim pad-top">All of these are demo vendor agents that return sample data. Payments to them are real PayPal sandbox payouts.</p>
    </fieldset>
    <div class="locked">${icons.lock()}<div class="stack gap-2"><span class="strong">Always on</span><span class="muted">If Gemini can't be reached, or any check fails to run, the agent doesn't buy. This one can't be turned off.</span></div></div>
  </form>
  <aside class="side">
    <div class="card card-summary">
      <h2 class="label">In plain words</h2>
      <p class="plain-words" id="plain-words" aria-live="polite">${plainWords(readRulesInitial(r))}</p>
      <button class="btn btn-primary btn-lg btn-block" type="submit" form="rules-form" id="save-rules"${busy ? raw(' disabled') : ''}>${session ? 'Save rules' : 'Save rules and start'}${icons.arrow()}</button>
      <p class="small dim">${busy ? 'Wait for the running task to finish before changing the rules.' : `Your session lasts ${state.config.sessionMinutes || 30} minutes. Reset any time to start over with a fresh budget.`}</p>
    </div>
    <a class="link-quiet" href="${session ? '/console' : '/'}">${icons.back()}Back</a>
  </aside>
</div>`), 'Set the rules');

        const form = app.querySelector('#rules-form');
        const update = () => { app.querySelector('#plain-words').innerHTML = String(plainWords(readRulesForm(form))); };
        form.addEventListener('input', update);
        form.addEventListener('change', update);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = app.querySelector('#save-rules');
            app.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; });
            const body = { rules: readRulesForm(form) };
            button.disabled = true;
            try {
                if (state.session) {
                    try {
                        await api('/session/rules', { method: 'PUT', body });
                    } catch (err) {
                        if (err.code !== 'no_session') throw err;
                        await api('/session', { method: 'POST', body });
                    }
                } else {
                    await api('/session', { method: 'POST', body });
                }
                state.hadSession = true;
                navigate('/console');
            } catch (err) {
                button.disabled = false;
                if (err.code === 'invalid_rules') {
                    Object.entries(err.data.errors || {}).forEach(([field, message]) => {
                        const el = app.querySelector(`[data-error-for="${field}"]`);
                        if (el) el.textContent = message;
                    });
                    const first = Object.keys(err.data.errors || {})[0];
                    if (first) form.elements[first].focus();
                } else {
                    handleError(err);
                }
            }
        });
    }

    function readRulesInitial(r) {
        return { budget: r.budgetCents / 100, maxPerPurchase: r.maxPerPurchaseCents / 100, askAbove: r.askAboveCents / 100, categories: r.categories, vendors: r.vendors };
    }

    // ---------- Screen 3: Console ----------
    async function startTask(body) {
        try {
            const data = await api('/tasks', { method: 'POST', body });
            navigate(`/tasks/${data.task.id}`);
        } catch (err) {
            if (err.code === 'task_running') navigate(`/tasks/${err.data.taskId}`);
            else handleError(err);
        }
    }

    function activityCard(purchases) {
        if (!purchases.length) {
            return html`<section class="card card-dashed"><h2 class="label">Activity</h2><p class="muted">Nothing yet. Run a task or try an attack, and every decision shows up here.</p></section>`;
        }
        return html`
<section class="card">
  <div class="row between"><h2 class="label">Activity</h2><a class="small link-min" href="/ledger">Ledger</a></div>
  <ul class="mini-list">${purchases.slice(0, 5).map((p) => html`
    <li><a class="mini-row" href="/purchases/${p.id}">${outcomeBadge(p)}<span class="mini-name"><span>${p.title}</span><span class="small dim">${outcomeText(p)}</span></span><span class="mono small${p.outcome === 'paid' ? '' : ' strike'}">${money(p.amountCents)}</span></a></li>`)}
  </ul>
</section>`;
    }

    async function consoleView() {
        const session = await requireSession();
        if (!session) return;
        const [catalog, ledger] = await Promise.all([getCatalog(), api('/ledger'), getConfig()]);
        const busy = session.activeTaskId;
        const disabled = busy ? raw(' disabled') : '';
        const canStream = canRecord && Boolean(state.config.liveTranscription) && 'WebSocket' in window;
        const canUpload = canRecord && Boolean(state.config.transcription);
        const voiceAvailable = liveSpeech || canStream || canUpload;
        const attackCard = (a) => html`
<button type="button" class="attack" data-action="attack" data-attack="${a.id}"${disabled}>
  <span class="attack-top"><span>${a.title}</span>${icons.arrow()}</span>
  <span class="muted">${a.blurb || `“${a.prompt}”`}</span>
  <span class="tests${a.tests === 'gemini' ? ' gemini' : ''}">${a.tests === 'gemini' ? 'Tests Gemini' : 'Tests your rules'}</span>
</button>`;
        mount(page('console', html`
<div class="split">
  <div class="main">
    ${busy ? html`<div class="notice"><span class="live-dot"></span><span>The agent is working on a task.</span><a href="/tasks/${busy}">Watch it</a></div>` : ''}
    <section class="guard-card ${session.guardrails ? 'on' : 'off'}" aria-labelledby="guard-title">
      <div class="guard-text">
        <h2 class="label" id="guard-title">Guardrails</h2>
        <p>${session.guardrails
        ? 'On. Your rules, Gemini and your OK check every purchase before money moves.'
        : `Off. Nothing checks the agent: it buys whatever it plans and takes vendors at their word. Run the same mission or attack both ways to see the difference.`}</p>
      </div>
      <div class="segmented" role="group" aria-label="Guardrails">
        <button type="button" class="seg${session.guardrails ? ' active on' : ''}" aria-pressed="${session.guardrails}" data-action="guardrails" data-on="true"${disabled}>On</button>
        <button type="button" class="seg${session.guardrails ? '' : ' active off'}" aria-pressed="${!session.guardrails}" data-action="guardrails" data-on="false"${disabled}>Off</button>
      </div>
    </section>
    <form class="card card-lg mission-card" id="mission-form" novalidate>
      <div class="row between"><span class="pill ok">MISSION</span><span class="small dim">Several vendors · plans, adapts, and asks you before big spends</span></div>
      <h2 class="h-ask">Launch a website</h2>
      <p class="muted">Give it a goal instead of a shopping list. It plans the steps, compares vendors, pays each one through PayPal, deals with surprises along the way, and hands you a live site.</p>
      <div class="mission-fields">
        <div class="field grow-220"><label for="biz-name">Business name</label><input id="biz-name" class="text-input" maxlength="60" value="Mama's Bakery" autocomplete="off"></div>
        <div class="field grow-300"><label for="biz-about">What it does <span class="dim">(optional)</span></label><input id="biz-about" class="text-input" maxlength="120" value="Fresh bread and pastries, baked every morning" autocomplete="off"></div>
      </div>
      <span class="field-error" id="mission-error"></span>
      <div class="row"><button class="btn btn-primary btn-md" type="submit"${disabled}>Launch the mission${icons.arrow()}</button><span class="small dim">Or say "Launch a website for…" into the mic below.</span></div>
      ${state.config.siteHostingDays ? html`<p class="small dim">The finished site goes up publicly on Render, at a real onrender.com address, for ${state.config.siteHostingDays} days. Don't type anything private.</p>` : ''}
    </form>
    <form class="card card-lg gap-20" id="task-form" novalidate>
      <label for="task" class="h-ask">What should your agent find?</label>
      <div class="task-field">
        <textarea id="task" class="task-input${voiceAvailable ? ' has-mic' : ''}" rows="3" maxlength="500" placeholder="e.g. ${EXAMPLES[0].prompt}" aria-describedby="voice-status task-error"></textarea>
        ${voiceAvailable ? html`<button type="button" class="mic-btn" data-action="dictate" aria-pressed="false" aria-label="Say the task instead of typing it" title="Say it instead of typing"${disabled}>${icons.mic()}</button>` : ''}
      </div>
      <span class="voice-status" id="voice-status" aria-live="polite"></span>
      <span class="field-error" id="task-error"></span>
      <div class="row">
        <button class="btn btn-primary btn-md" type="submit"${disabled}>Run task${icons.arrow()}</button>
        <span class="small dim">The agent plans first, then shows every purchase before it pays.</span>
      </div>
      <div class="examples">
        <span class="small dim">Or start from an example</span>
        <div class="row gap-8">${EXAMPLES.map((ex, i) => html`<button type="button" class="chip-btn" data-action="example" data-index="${i}"${disabled}>${ex.label}</button>`)}</div>
      </div>
    </form>
    <section class="stack gap-18">
      <div class="stack gap-6">
        <h2 class="h-sub">Try to break it</h2>
        <p class="muted">Each of these tries to get the agent to misbehave. Watch which check stops it.</p>
      </div>
      <div class="grid-auto">${catalog.attacks.map(attackCard)}</div>
      <p class="small dim">Or type your own attack into the task box above.</p>
    </section>
  </div>
  <aside class="side">
    ${budgetCard(session)}
    ${rulesCard(session.rules)}
    ${activityCard(ledger.purchases)}
  </aside>
</div>`), 'Console');

        actions.example = (el) => startTask({ prompt: EXAMPLES[Number(el.dataset.index)].prompt });
        actions.attack = (el) => startTask({ attackId: el.dataset.attack });
        actions.guardrails = async (el) => {
            const on = el.dataset.on === 'true';
            if (on === state.session.guardrails) return;
            el.disabled = true;
            try {
                await api('/session/guardrails', { method: 'PUT', body: { on } });
                toast(on ? 'Guardrails are on.' : 'Guardrails are off. Nothing will check the next purchases.');
                route();
            } catch (err) {
                el.disabled = false;
                handleError(err);
            }
        };

        // Spoken words only ever fill the box; running the task is still the person's click.
        // Three ways to listen, best first: the browser's own live dictation (Chrome, Edge, Safari);
        // streaming to Gemini's live transcription model (Brave, Firefox); record, then transcribe.
        let voice = null; // while listening: { stop(), abort() }
        let mode = liveSpeech ? 'live' : canStream ? 'stream' : 'record';
        let left = false;
        onLeave(() => {
            left = true;
            if (voice) voice.abort();
            voice = null;
        });
        const el = (sel) => app.querySelector(sel);
        const say = (text, isError = false) => {
            el('#voice-status').textContent = text;
            el('#voice-status').classList.toggle('error', isError);
        };
        const setMic = (micState) => {
            const button = el('.mic-btn');
            const on = micState === 'on';
            button.classList.toggle('on', on);
            button.classList.toggle('busy', micState === 'busy');
            button.disabled = micState === 'busy';
            button.setAttribute('aria-pressed', String(on));
            button.setAttribute('aria-label', { on: 'Stop listening', busy: 'Transcribing' }[micState] || 'Say the task instead of typing it');
            button.innerHTML = String({ on: icons.stop(18), busy: raw('<span class="spinner" aria-hidden="true"></span>') }[micState] || icons.mic());
            el('#task').classList.toggle('listening', on);
        };
        const fill = (before, spoken) => {
            const text = spoken.trim();
            const words = before ? text : text.charAt(0).toUpperCase() + text.slice(1);
            el('#task').value = [before, words].filter(Boolean).join(' ').slice(0, 500);
        };
        const finished = () => {
            setMic('idle');
            say(el('#task').value.trim() ? 'Got it. Check the text, then run the task.' : '');
            el('#task').focus();
        };
        const failed = (message) => {
            setMic('idle');
            say(message, true);
        };

        function listenLive() {
            const before = el('#task').value.trim();
            let heard = '';
            let error = null;
            const recognition = new SpeechRecognition();
            recognition.lang = navigator.language || 'en-US';
            recognition.interimResults = true;
            recognition.continuous = true;
            recognition.onstart = () => {
                setMic('on');
                say('Listening… say your task, then click the mic to stop.');
            };
            recognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const result = event.results[i];
                    if (result.isFinal) heard += result[0].transcript;
                    else interim += result[0].transcript;
                }
                fill(before, `${heard}${interim}`);
            };
            recognition.onerror = (event) => {
                if (event.error !== 'aborted') error = event.error;
            };
            recognition.onend = () => {
                voice = null;
                // The browser has no working speech service (e.g. Safari without Dictation): use Gemini.
                if ((error === 'network' || error === 'service-not-allowed') && (canStream || canUpload)) {
                    mode = canStream ? 'stream' : 'record';
                    if (canStream) stream("This browser's own dictation isn't available, so Gemini is listening instead. Keep talking.");
                    else record("This browser's own dictation isn't available, so it's recording instead. Speak now, then click the mic to stop.");
                } else if (error) {
                    failed(VOICE_ERRORS[error] || 'Voice input stopped. You can type the task instead.');
                } else {
                    finished();
                }
            };
            voice = {
                stop: () => recognition.stop(),
                abort: () => {
                    recognition.onend = null;
                    recognition.abort();
                },
            };
            try {
                recognition.start();
            } catch {
                voice = null;
                failed('Voice input could not start. You can type the task instead.');
            }
        }

        // Streams mic audio to Gemini's live transcription model; words show up while you talk.
        // Audio is captured from the click and queued until the connection is ready, so nothing is
        // lost. If live text fails at any point, it keeps listening and transcribes it all at the end.
        async function stream(intro) {
            const before = el('#task').value.trim();
            const ctx = new AudioCtx(); // created inside the click, so the browser lets it run
            const downsample = makeDownsampler(ctx.sampleRate);
            const line = takeVoiceLine();
            line.promise.catch(() => {}); // handled below, once the mic is open
            const captured = []; // everything heard, for the fallback
            const queued = []; // heard before the connection was ready
            let batch = [];
            let batchLength = 0;
            let socket = null;
            let closeMic = null;
            let ready = false;
            let ending = false;
            let done = false;
            let offline = false;
            let cancelled = false;
            let heard = '';
            let interim = '';
            let limit = null;
            let grace = null;
            let hardStop = null;

            const send = (pcm) => {
                if (ready && socket.readyState === 1) {
                    socket.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: 'audio/pcm;rate=16000' } } }));
                }
            };
            const flush = () => {
                if (!batchLength) return;
                const pcm = joinPcm(batch);
                batch = [];
                batchLength = 0;
                captured.push(pcm);
                if (ready) send(pcm);
                else queued.push(pcm);
            };
            const onSamples = (samples) => {
                if (ending) return;
                const pcm = downsample(samples);
                batch.push(pcm);
                batchLength += pcm.length;
                if (batchLength >= 1600) flush(); // about 100 ms
            };
            const show = () => fill(before, [heard, interim].filter(Boolean).join(' '));
            const release = () => {
                clearTimeout(limit);
                clearTimeout(grace);
                clearTimeout(hardStop);
                if (closeMic) closeMic();
                else ctx.close().catch(() => {});
                closeMic = null;
                if (socket) {
                    if (socket.readyState < 2) socket.close();
                } else {
                    line.promise.then((s) => s.close(), () => {});
                }
            };
            const end = (message) => {
                if (done) return;
                done = true;
                release();
                voice = null;
                if (left) return;
                if (message) failed(message);
                else if (!heard && !interim) failed("Didn't catch any words. Click the mic and try again, a little closer.");
                else finished();
            };
            // Fallback: send everything heard to Gemini in one go.
            const upload = async () => {
                if (done) return;
                done = true;
                const audio = joinPcm(captured);
                release();
                voice = null;
                if (left) return;
                if (audio.length < 16000 * 0.7) {
                    failed('That was too short. Click the mic and say the task.');
                    return;
                }
                setMic('busy');
                say('Transcribing with Gemini…');
                try {
                    const { text } = await api('/transcribe', { method: 'POST', body: { audio: toBase64(pcmToWav(audio)), mimeType: 'audio/wav' } });
                    if (left) return;
                    if (!text) {
                        failed("Didn't catch any words. Click the mic and try again, a little closer.");
                        return;
                    }
                    fill(before, text);
                    finished();
                } catch (err) {
                    if (!left) failed(err.message);
                }
            };
            // Live text failed: keep listening, and transcribe it all when the person stops.
            const goOffline = () => {
                if (offline || done) return;
                offline = true;
                ready = false;
                if (socket && socket.readyState < 2) socket.close();
                if (!canUpload) {
                    end('Live dictation stopped. Anything it heard is in the box; you can type the rest.');
                } else if (ending) {
                    upload();
                } else {
                    say("Live text isn't available right now. Keep talking; Gemini will transcribe it when you click the mic.");
                }
            };
            // After the last words, wait for the final transcript: a few quiet seconds, at most 15.
            const waitForFinal = (ms) => {
                clearTimeout(grace);
                grace = setTimeout(() => end(), ms);
            };
            const endStream = () => {
                socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
                waitForFinal(6000);
                hardStop = setTimeout(() => end(), 15000);
            };
            const onMessage = (event) => {
                const msg = parseLiveMessage(event.data);
                const content = (msg && msg.serverContent) || {};
                if (content.interimInputTranscription) {
                    interim = content.interimInputTranscription.text || '';
                    show();
                    if (ending) waitForFinal(3000);
                }
                if (content.inputTranscription) {
                    heard = [heard, content.inputTranscription.text].filter(Boolean).join(' ').trim();
                    interim = '';
                    show();
                    if (ending) end();
                }
            };

            voice = { stop: () => { cancelled = true; }, abort: () => { cancelled = true; } };
            setMic('on');
            say(intro || 'Listening… words appear as you speak. Click the mic to stop.');
            try {
                closeMic = await openMic(ctx, onSamples);
            } catch (err) {
                done = true;
                release();
                voice = null;
                if (!left) failed(micError(err));
                return;
            }
            if (cancelled || left) {
                done = true;
                release();
                voice = null;
                if (!left) setMic('idle');
                return;
            }
            limit = setTimeout(() => voice && voice.stop(), MAX_STREAM_MS);
            voice = {
                stop: () => {
                    if (ending) return;
                    ending = true;
                    flush();
                    if (closeMic) closeMic();
                    closeMic = null;
                    setMic('busy');
                    if (offline) {
                        upload();
                        return;
                    }
                    say('Finishing…');
                    if (ready) endStream();
                    else grace = setTimeout(goOffline, 8000); // still connecting: give it a moment, then upload
                },
                abort: () => {
                    done = true;
                    release();
                    voice = null;
                },
            };

            try {
                socket = await line.promise;
            } catch (err) {
                if (done) return;
                if (err.code === 'no_session') {
                    voice.abort();
                    handleError(err);
                } else if (err.code === 'transcription_limit') {
                    end(err.message);
                } else {
                    goOffline();
                }
                return;
            }
            if (done || offline) {
                socket.close();
                return;
            }
            if (socket.readyState !== 1) {
                goOffline();
                return;
            }
            socket.onmessage = onMessage;
            socket.onclose = () => {
                if (done || offline) return;
                if (ending && ready) end();
                else goOffline();
            };
            ready = true;
            queued.splice(0).forEach(send);
            if (ending) {
                clearTimeout(grace);
                endStream();
            }
        }

        async function record(intro) {
            const before = el('#task').value.trim();
            const ctx = new AudioCtx(); // created inside the click, so the browser lets it run
            const downsample = makeDownsampler(ctx.sampleRate);
            const parts = [];
            let closeMic = null;
            let started = 0;
            let ticker = null;
            let limit = null;
            let cancelled = false;
            const release = () => {
                clearInterval(ticker);
                clearTimeout(limit);
                if (closeMic) closeMic();
                else ctx.close().catch(() => {});
                closeMic = null;
            };
            voice = { stop: () => { cancelled = true; }, abort: () => { cancelled = true; } };
            setMic('on');
            say(intro || 'Recording… say your task, then click the mic to stop.');
            try {
                closeMic = await openMic(ctx, (samples) => parts.push(downsample(samples)));
            } catch (err) {
                release();
                voice = null;
                if (!left) failed(micError(err));
                return;
            }
            if (cancelled) {
                release();
                voice = null;
                if (!left) setMic('idle');
                return;
            }
            started = Date.now();
            ticker = setInterval(() => {
                const ms = Date.now() - started;
                if (!intro || ms > 4000) say(`Recording · ${clock(ms)} of ${clock(MAX_RECORDING_MS)} · click the mic when you're done.`);
            }, 1000);
            limit = setTimeout(() => voice && voice.stop(), MAX_RECORDING_MS);

            voice = {
                abort: () => {
                    release();
                    voice = null;
                },
                stop: async () => {
                    const ms = Date.now() - started;
                    release();
                    voice = null;
                    if (ms < 700) {
                        failed('That was too short. Click the mic and say the task.');
                        return;
                    }
                    setMic('busy');
                    say('Transcribing with Gemini…');
                    try {
                        const { text } = await api('/transcribe', { method: 'POST', body: { audio: toBase64(pcmToWav(joinPcm(parts))), mimeType: 'audio/wav' } });
                        if (left) return;
                        if (!text) {
                            failed("Didn't catch any words. Click the mic and try again, a little closer.");
                            return;
                        }
                        fill(before, text);
                        finished();
                    } catch (err) {
                        if (left) return;
                        if (err.code === 'no_session') handleError(err);
                        else failed(err.message);
                    }
                },
            };
        }

        actions.dictate = () => {
            if (voice) {
                voice.stop();
                return;
            }
            el('#task-error').textContent = '';
            if (mode === 'live') listenLive();
            else if (mode === 'stream') stream();
            else record();
        };
        // Have the live-dictation connection ready before the mic is clicked. Gemini closes an idle
        // one after about a minute, so heading back to the task box opens a fresh one.
        if (mode === 'stream') {
            warmUpVoice();
            el('#task-form').addEventListener('pointerenter', warmUpVoice);
            el('#task-form').addEventListener('focusin', warmUpVoice);
            onLeave(dropSpareLine);
        }

        app.querySelector('#mission-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const name = el('#biz-name').value.trim();
            const about = el('#biz-about').value.trim().replace(/[.\s]+$/, '');
            if (name.length < 2) {
                el('#mission-error').textContent = 'Give the business a name.';
                el('#biz-name').focus();
                return;
            }
            startTask({ prompt: `Launch a website for ${name}${about ? `. ${about}` : ''}.`, mission: true });
        });

        app.querySelector('#task-form').addEventListener('submit', (event) => {
            event.preventDefault();
            if (voice) voice.abort();
            voice = null;
            const textarea = app.querySelector('#task');
            const prompt = textarea.value.trim();
            if (prompt.length < 3) {
                app.querySelector('#task-error').textContent = 'Describe what the agent should find.';
                textarea.focus();
                return;
            }
            startTask({ prompt });
        });
    }

    // ---------- Screen 4: Agent run (+ screen 5, the approval dialog) ----------
    function gateRow(g, hasNext) {
        return html`
<li class="gate${g.state === 'wait' || g.state === 'idle' ? ' idle' : ''}">
  <div class="gate-rail" aria-hidden="true">${badge(g.state, 'lg')}${hasNext ? html`<span class="gate-line${g.state === 'ok' ? ' ok' : ''}"></span>` : ''}</div>
  <div class="gate-body">
    <div class="gate-head"><span class="gate-title">${g.title}</span><span class="status ${g.tone || 'dim'}">${g.status}</span></div>
    ${g.body || ''}
  </div>
</li>`;
    }

    function rulesGate(p) {
        const r = p.checks.rules;
        const title = '1 · Your rules';
        if (r.status === 'off') {
            const would = r.wouldBlock ? `Would have blocked it: ${r.wouldBlock}.` : r.wouldAsk ? 'Would have asked you first.' : 'Would have allowed it.';
            return { title, state: 'idle', status: 'OFF', tone: 'no', body: html`<p class="${r.wouldBlock ? 'orange-text' : 'dim'}">${would}</p>` };
        }
        if (r.status === 'blocked') return { title, state: 'no', status: 'BLOCKED', tone: 'no', body: html`<p>${r.blockedBy}. Gemini was never asked.</p>` };
        if (r.status === 'passed') {
            return {
                title, state: 'ok', tone: 'ok', status: `PASSED · ${r.ms < 1 ? '<1' : Math.round(r.ms)} ms`,
                body: html`<ul class="chips">${r.items.map((c) => html`<li class="chip${c.needsYou ? ' you' : ''}">${c.needsYou ? html`<span class="mini-dash" aria-hidden="true"></span>` : icons.check(12)}${c.label}</li>`)}</ul>`,
            };
        }
        return { title, state: p.status === 'rules' ? 'live' : 'wait', status: p.status === 'quoting' ? 'GETTING A PRICE' : 'WAITING' };
    }

    function geminiGate(p) {
        const g = p.checks.gemini;
        const title = "2 · Gemini's judgment";
        const secs = g.ms ? ` · ${(g.ms / 1000).toFixed(1)} s` : '';
        switch (g.status) {
            case 'checking': return { title, state: 'live', tone: 'ok', status: 'CHECKING…', body: html`<p class="muted">Does this help your task, and is ${money(p.amountCents)} a fair price?</p><div class="sweep" aria-hidden="true"></div>` };
            case 'approved': return { title, state: 'ok', tone: 'ok', status: `APPROVED${secs}`, body: html`<blockquote class="quote-box">${g.reason}</blockquote>` };
            case 'denied': return { title, state: 'no', tone: 'no', status: `DENIED${secs}`, body: html`<blockquote class="quote-box">${g.reason}</blockquote>` };
            case 'error': return { title, state: 'no', tone: 'no', status: 'NO ANSWER', body: html`<p>${g.reason}</p>` };
            case 'skipped': return { title, state: 'idle', status: 'NEVER ASKED', body: html`<p class="dim">Your rules already stopped it.</p>` };
            case 'off': return { title, state: 'idle', status: 'OFF', tone: 'no', body: html`<p class="dim">Not asked: guardrails are off.</p>` };
            default: return { title, state: 'wait', status: 'WAITING', body: html`<p class="dim">Runs once your rules pass.</p>` };
        }
    }

    function youGate(p) {
        const a = p.checks.approval;
        const title = '3 · Your OK';
        switch (a.status) {
            case 'waiting': return { title, state: 'you', tone: '', status: html`WAITING · <span data-until="${a.expiresAt}">${clock(new Date(a.expiresAt) - Date.now())}</span>`, body: html`<p class="muted">Over your ask-me amount, so the agent is waiting for you.</p>` };
            case 'approved': return { title, state: 'ok', tone: 'ok', status: 'APPROVED BY YOU' };
            case 'skipped': return { title, state: 'idle', status: 'YOU SKIPPED IT' };
            case 'expired': return { title, state: 'idle', status: 'NO ANSWER' };
            case 'stopped': return { title, state: 'idle', status: 'STOPPED' };
            default: return { title, state: 'wait', status: 'WAITING', body: html`<p class="dim">Over your ask-me amount, so it will ask you first.</p>` };
        }
    }

    function paypalGate(p, n) {
        const pp = p.checks.paypal;
        const title = `${n} · PayPal sandbox`;
        if (p.status === 'verifying') return { title, state: 'live', tone: 'ok', status: 'VENDOR CHECKING…', body: html`<p class="muted">Payout <span class="mono">${pp.batchId}</span> sent. ${p.vendorName} is checking it with PayPal before it delivers.</p>` };
        switch (pp.status) {
            case 'sending': return { title, state: 'live', tone: 'ok', status: 'SENDING…', body: html`<p class="muted">Sending a ${money(p.amountCents)} payout to ${p.vendorName}.</p>` };
            case 'paid': return { title, state: 'ok', tone: 'ok', status: `PAID · ${pp.batchStatus || 'PENDING'}`, body: html`<p class="muted">Payout <span class="mono">${pp.batchId}</span>${p.checks.vendor.status === 'verified' ? ` checked by ${p.vendorName} and delivered.` : '.'}</p>` };
            case 'failed': return { title, state: 'no', tone: 'no', status: 'FAILED', body: html`<p>${pp.error}</p>` };
            case 'simulated': return { title, state: 'no', tone: 'no', status: 'SIMULATED', body: html`<p>Over the ${money(pp.limitCents)} limit for unguarded payouts, so it wasn't sent. With real money, ${money(p.amountCents)} would be gone.</p>` };
            case 'free': return { title, state: 'ok', tone: 'ok', status: 'NOTHING TO PAY', body: html`<p class="muted">${p.vendorName}'s price is $0.00, so no payout was sent. It delivered against its quote.</p>` };
            case 'not_reached': return { title, state: 'idle', status: 'NOT REACHED', body: html`<p class="dim">No payout was created.</p>` };
            default: return { title, state: 'wait', status: 'WAITING', body: html`<p class="dim">Sends a ${money(p.amountCents)} payout once the checks pass. ${p.vendorName || 'The vendor'} checks it before delivering.</p>` };
        }
    }

    function liveCard(p, eyebrow) {
        const needsYou = p.checks.rules.needsApproval;
        const gates = [rulesGate(p), geminiGate(p), ...(needsYou ? [youGate(p)] : []), paypalGate(p, needsYou ? 4 : 3)];
        let wire = '';
        if (p.quote) wire = html`<p class="wire">${p.vendorName} asked for payment · HTTP 402 · ${money(p.amountCents)} for ${p.quote.body.description || p.title}</p>`;
        else if (p.status === 'quoting') wire = html`<p class="wire">Asking ${p.vendorName || 'the vendor'} for a price…</p>`;
        else if (!p.vendorId) wire = html`<p class="wire">No approved vendor sells this · estimated ${money(p.amountCents)}</p>`;
        return html`
<section class="card card-lg" aria-label="Purchase being checked">
  <div class="row between top">
    <div class="stack gap-4">
      <span class="eyebrow">${eyebrow}</span>
      <h2 class="h-card">${p.title}</h2>
      <span class="dim">${[p.vendorName, p.categoryLabel].filter(Boolean).join(' · ')}</span>
    </div>
    <span class="amount amount-md">${money(p.amountCents)}</span>
  </div>
  ${wire}
  <ol class="gates">${gates.map((g, i) => gateRow(g, i < gates.length - 1))}</ol>
</section>`;
    }

    const planningCard = () => html`
<section class="card card-lg" aria-live="polite">
  <span class="eyebrow">Planning</span>
  <h2 class="h-card">Gemini is working out what to buy</h2>
  <p class="muted">It reads your task and the vendor catalog, then lists each purchase before anything is paid.</p>
  <div class="sweep" aria-hidden="true"></div>
</section>`;

    function planStatus(p) {
        if (p.status === 'done') {
            return {
                paid: { text: 'PAID', tone: 'ok', badge: 'ok' },
                blocked: { text: 'BLOCKED', tone: 'no', badge: 'no' },
                denied: { text: 'DENIED', tone: 'no', badge: 'no' },
                skipped: { text: 'SKIPPED', tone: 'dim', badge: 'idle' },
                stopped: { text: 'STOPPED', tone: 'dim', badge: 'idle' },
                failed: { text: 'FAILED', tone: 'no', badge: 'idle' },
            }[p.outcome];
        }
        if (p.status === 'queued') return { text: 'UP NEXT', tone: 'dim', badge: 'wait' };
        if (p.status === 'approval') return { text: 'NEEDS YOUR OK', tone: '', badge: 'you' };
        return { text: 'CHECKING', tone: 'ok', badge: 'live' };
    }

    function planCard(purchases, session) {
        return html`
<section class="card card-lg gap-6">
  <h2 class="label pad-bottom">The agent's plan</h2>
  <ol class="plan">${purchases.map((p) => {
        const st = planStatus(p);
        const willAsk = p.status === 'queued' && p.vendorId && p.amountCents > session.rules.askAboveCents && p.amountCents <= session.rules.maxPerPurchaseCents;
        const sub = [p.vendorName || 'No approved vendor', willAsk ? `over ${money(session.rules.askAboveCents)}, so it will ask you first` : ''].filter(Boolean).join(' · ');
        return html`
    <li class="plan-row">
      ${badge(st.badge)}
      <span class="plan-name"><span class="strong-500">${p.title}</span><span class="small dim">${sub}</span></span>
      <span class="mono${p.outcome && p.outcome !== 'paid' ? ' strike' : ''}">${money(p.amountCents)}</span>
      <span class="plan-status ${st.tone}">${st.text}</span>
      ${p.status === 'done' ? html`<a class="small link-min" href="/purchases/${p.id}">${p.outcome === 'paid' ? 'Receipt' : 'Details'}</a>` : html`<span class="plan-link-space"></span>`}
    </li>`;
    })}</ol>
</section>`;
    }

    function approvalDialog(p, session) {
        const items = p.checks.rules.items || [];
        const phrase = p.quantity === 1 && p.itemId ? `${/^[aeiou]/i.test(p.itemName) ? 'an' : 'a'} ${p.itemName.toLowerCase()}` : p.title.toLowerCase();
        return html`
<div class="scrim">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-desc">
    <div class="row between">
      <span class="dialog-tag"><span class="badge badge-lg you">${icons.user()}</span>Needs your OK</span>
      <span class="mono small dim"><span data-until="${p.checks.approval.expiresAt}">${clock(new Date(p.checks.approval.expiresAt) - Date.now())}</span> to decide</span>
    </div>
    <div class="stack gap-8">
      <h2 id="ask-title" class="h-dialog">Spend ${money(p.amountCents)} on ${phrase}?</h2>
      <p id="ask-desc" class="muted">${p.vendorName} · ${p.title}. The agent has paused and no money has moved.</p>
    </div>
    <figure class="why">
      <figcaption class="label-sm">Why the agent wants it · Gemini</figcaption>
      <blockquote>${p.checks.gemini.reason}</blockquote>
    </figure>
    <ul class="checklist">${items.map((c) => (c.needsYou
        ? html`<li><span class="badge badge-sm you" aria-hidden="true"></span><span>${c.label}, <span class="dim">which is why you're seeing this</span></span></li>`
        : html`<li>${badge('ok', 'sm')}<span>${c.label}</span></li>`))}</ul>
    <div class="row between baseline divider"><span class="dim">Budget</span><span class="mono big">${money(session.leftCents)} <span class="dim">→</span> ${money(session.leftCents - p.amountCents)} after</span></div>
    <div class="row gap-12">
      <button class="btn btn-primary btn-lg grow-220" type="button" data-action="approve" data-id="${p.id}">${icons.check(18)}Approve ${money(p.amountCents)}</button>
      <button class="btn btn-lg grow-180" type="button" data-action="skip" data-id="${p.id}">Skip this purchase</button>
    </div>
    <p class="small dim">If you don't answer in time, the agent skips it. The rest of the task carries on either way.</p>
  </section>
</div>`;
    }

    function runScreen({ task, purchases, session }) {
        const current = purchases.find((p) => !['queued', 'done'].includes(p.status)) || purchases.find((p) => p.status === 'queued') || purchases[purchases.length - 1];
        const waiting = purchases.find((p) => p.checks.approval.status === 'waiting');
        const planned = purchases.reduce((sum, p) => sum + p.amountCents, 0);
        const pending = current && current.status !== 'done' && current.status !== 'queued' && current.checks.paypal.status !== 'paid' ? current.amountCents : 0;
        const label = { planning: 'PLANNING', waiting_approval: 'WAITING FOR YOU' }[task.status] || (task.stopRequested ? 'STOPPING' : 'RUNNING');
        return html`${page('console', html`
<div class="stack gap-14">
  <div class="row">
    <a class="link-quiet" href="/console">${icons.back()}Console</a>
    <span class="pill ok"><span class="live-dot"></span>${label} · <span data-since="${task.createdAt}">${clock(Date.now() - new Date(task.createdAt))}</span></span>
  </div>
  <h1 class="h-task">${task.prompt}</h1>
  ${task.summary ? html`<p class="muted">${task.summary}</p>` : ''}
</div>
<div class="split">
  <div class="main">
    ${task.status === 'planning' || !current ? planningCard() : liveCard(current, `Checking purchase ${current.index + 1} of ${purchases.length}`)}
    ${purchases.length ? planCard(purchases, session) : ''}
  </div>
  <aside class="side">
    ${budgetCard(session, pending)}
    <section class="card gap-8">
      <h2 class="label">This task</h2>
      <div class="kv"><span class="muted">Planned spend</span><span class="mono">${purchases.length ? money(planned) : '—'}</span></div>
      <div class="kv"><span class="muted">Purchases</span><span class="mono">${purchases.length || '—'}</span></div>
      <div class="kv"><span class="muted">Model</span><span class="mono small">${(state.config && state.config.model) || 'Gemini'}</span></div>
    </section>
    <button class="btn btn-danger btn-md" type="button" data-action="stop"${task.stopRequested ? raw(' disabled') : ''}>${icons.stop()}${task.stopRequested ? 'Stopping…' : 'Stop the agent'}</button>
    <p class="small dim center">Stops before the next payment. Nothing already paid is undone.</p>
  </aside>
</div>`)}${waiting ? approvalDialog(waiting, session) : ''}`;
    }

    // ---------- Screen 7: Results ----------
    // After an unguarded run went past your rules, Gemini looks back over the ledger (src/review.js).
    function reviewCard(task, purchases) {
        const r = task.review;
        if (!r) return '';
        if (r.status === 'writing') return html`
<section class="card card-lg card-warn gap-12" aria-live="polite">
  <div class="row between"><h2 class="label">Why it went overboard</h2><span class="pill pill-sm">WRITING…</span></div>
  <p class="muted">Gemini is looking back over the ledger to explain what the agent did with no guardrails.</p>
  <div class="sweep" aria-hidden="true"></div>
</section>`;
        const titleOf = (id) => (purchases.find((p) => p.id === id) || {}).title || 'The purchase';
        return html`
<section class="card card-lg card-warn gap-12">
  <div class="row between"><h2 class="label">Why it went overboard</h2><span class="pill pill-sm no">${r.by === 'gemini' ? "GEMINI'S REVIEW" : 'SUMMARY'}</span></div>
  <h3 class="h-card">${r.headline}</h3>
  <ol class="review-points">${r.points.map((pt) => html`
    <li><p>${pt.text}</p><a class="small link-min" href="/purchases/${pt.purchaseId}">${titleOf(pt.purchaseId)}</a></li>`)}
  </ol>
  ${r.lesson ? html`<p class="muted">${r.lesson}</p>` : ''}
  <p class="small dim">${r.by === 'gemini' ? 'With guardrails off, nothing asked Gemini during the run. It wrote this afterwards from the ledger, and every amount in it was checked against the ledger.' : r.note}</p>
</section>`;
    }

    function resultsScreen({ task, purchases, session }) {
        const paid = purchases.filter((p) => p.outcome === 'paid');
        const notBought = purchases.filter((p) => p.outcome !== 'paid');
        const delivered = paid.map((p) => p.delivered).filter(Boolean);
        const companies = delivered.flatMap((d) => d.companies || []);
        const reports = delivered.map((d) => d.report).filter((r) => r && r.rating);
        const credit = new Map(reports.map((r) => [r.company.toLowerCase(), r]));
        const articles = delivered.flatMap((d) => d.articles || []);
        const facts = delivered.flatMap((d) => d.facts || []);
        const otherReports = delivered.map((d) => d.report).filter((r) => r && !r.rating);
        const total = paid.reduce((sum, p) => sum + p.amountCents, 0);
        const approvedByYou = paid.filter((p) => p.checks.approval.status === 'approved').length;
        const duration = clock(new Date(task.finishedAt || Date.now()) - new Date(task.createdAt));

        let sentence;
        if (!purchases.length) sentence = task.summary || 'The agent decided nothing needed buying.';
        else if (!paid.length) sentence = 'Nothing was bought.';
        else {
            const yours = approvedByYou ? `, and you approved ${approvedByYou === 1 ? (paid.length === 1 ? 'it' : 'one of them') : `${approvedByYou} of them`}` : '';
            sentence = `${companies.length ? `Found ${plural(companies.length, 'company', 'companies')}. ` : ''}It took ${plural(paid.length, 'purchase')} and ${money(total)}${yours}.`;
        }
        if (paid.length && notBought.length) sentence += ` ${plural(notBought.length, 'other purchase')} didn't go through.`;
        if (task.status === 'stopped') sentence = `You stopped the agent. ${sentence}`;
        const wouldHaveBlocked = purchases.filter((p) => unchecked(p) && p.checks.rules.wouldBlock).length;
        if (purchases.some(unchecked)) {
            sentence += ` Guardrails were off, so nothing checked ${purchases.length === 1 ? 'it' : 'them'}${wouldHaveBlocked ? `. Your rules would have blocked ${wouldHaveBlocked === purchases.length ? (purchases.length === 1 ? 'it' : 'all of them') : wouldHaveBlocked}` : ''}.`;
        }

        const hasCredit = companies.some((c) => credit.has(c.name.toLowerCase()));
        const companyTable = companies.length ? html`
<section class="stack gap-14">
  <div class="row between">
    <h2 class="h-sub-sm">${plural(companies.length, 'company', 'companies')}</h2>
    <button class="btn" type="button" data-action="csv">${icons.download()}Download CSV</button>
  </div>
  <div class="table-box">
    <table class="table">
      <thead><tr><th scope="col">Company</th><th scope="col">City</th><th scope="col" class="num">Staff</th><th scope="col">Ops lead</th>${hasCredit ? raw('<th scope="col">Credit</th>') : ''}</tr></thead>
      <tbody>${companies.map((c) => {
        const report = credit.get(c.name.toLowerCase());
        return html`<tr><td class="strong-500">${c.name}</td><td class="muted">${c.city}, ${c.state}</td><td class="num">${c.employees}</td><td class="muted">${c.opsLead.title}</td>${hasCredit ? html`<td class="${report ? (report.score >= 82 ? 'lime' : 'muted') : 'faint'}">${report ? report.rating : 'Not checked'}</td>` : ''}</tr>`;
    })}</tbody>
    </table>
  </div>
  <p class="small dim">Sample data from the demo vendors. Names and emails for each ops lead are in the CSV.</p>
</section>` : '';

        const reportCards = !companies.length && reports.length ? html`
<section class="stack gap-14">
  <h2 class="h-sub-sm">Credit ${reports.length === 1 ? 'report' : 'reports'}</h2>
  ${reports.map((r) => html`<div class="card"><div class="row between baseline"><span class="h-card">${r.company}</span><span class="mono">Score ${r.score}/100</span></div><p class="${r.score >= 82 ? 'lime' : 'muted'} big">${r.rating}</p><p class="small dim">${r.openLiens ? '1 open lien on file. ' : 'No open liens on file. '}Sample report from Quarry Credit.</p></div>`)}
</section>` : '';

        const articleMain = !companies.length && articles.length ? html`
<section class="stack gap-14">
  <h2 class="h-sub-sm">${plural(articles.length, 'article')}</h2>
  ${articles.map((a) => html`<article class="card gap-8"><h3 class="h-tile">${a.title}</h3><p class="muted">${a.summary}</p></article>`)}
  <p class="small dim">Sample articles from Dockside News.</p>
</section>` : '';

        const extras = html`
${facts.length ? html`<section class="card"><h2 class="label">Fact pack</h2><ul class="bullets">${facts.map((f) => html`<li><span class="b"></span>${f}</li>`)}</ul></section>` : ''}
${otherReports.map((r) => html`<section class="card"><h2 class="label">Report</h2><p class="h-card">${r.title}</p></section>`)}`;

        const empty = !paid.length ? html`
<section class="card card-lg">
  <h2 class="h-card">${purchases.length ? 'Nothing was bought' : 'Nothing to buy'}</h2>
  <p class="muted">${purchases.length ? 'Every purchase in this task was stopped before money moved. Open one to see why.' : task.summary || 'The agent decided this task needs no purchases.'}</p>
</section>` : '';

        const undelivered = paid.filter((p) => p.deliveryError);
        return page('console', html`
<div class="stack gap-14">
  <div class="row">
    <a class="link-quiet" href="/console">${icons.back()}Console</a>
    ${task.status === 'stopped' ? html`<span class="pill">STOPPED · ${duration}</span>` : html`<span class="pill ok">${icons.check(12)}DONE · ${duration}</span>`}
  </div>
  <h1 class="h-task">${task.prompt}</h1>
  <p class="lede">${sentence}</p>
</div>
<div class="split">
  <div class="main">
    ${reviewCard(task, purchases)}${companyTable}${reportCards}${articleMain}${extras}${empty}
    ${undelivered.map((p) => html`<p class="notice warn">${p.deliveryError}. The payout went through, so it's in the ledger.</p>`)}
  </div>
  <aside class="side">
    ${paid.length ? html`
    <section class="card gap-6">
      <h2 class="label pad-bottom">What it cost</h2>
      ${paid.map((p) => html`<a class="cost-row" href="/purchases/${p.id}"><span class="grow-1 stack"><span class="strong-500">${p.vendorName}</span><span class="small dim">${p.title}${p.checks.approval.status === 'approved' ? ' · approved by you' : ''}</span></span><span class="mono">${money(p.amountCents)}</span>${icons.chevron()}</a>`)}
      <div class="kv total"><span>Total</span><span class="mono">${money(total)}</span></div>
    </section>` : ''}
    ${notBought.length ? html`
    <section class="card gap-6">
      <h2 class="label pad-bottom">Not bought</h2>
      ${notBought.map((p) => html`<a class="cost-row" href="/purchases/${p.id}">${outcomeBadge(p)}<span class="grow-1 stack"><span class="strong-500">${p.title}</span><span class="small dim">${outcomeText(p)}</span></span><span class="mono strike">${money(p.amountCents)}</span></a>`)}
    </section>` : ''}
    ${budgetCard(session)}
    ${companies.length && articles.length ? html`<section class="card card-flat gap-10"><h2 class="label">Articles it read</h2>${articles.map((a) => html`<p>${a.title}</p>`)}</section>` : ''}
    <a class="btn btn-primary btn-lg btn-block" href="/console">Run another task${icons.arrow()}</a>
  </aside>
</div>`);
    }

    function failedScreen(task) {
        return page('console', html`
<div class="stack gap-14">
  <div class="row"><a class="link-quiet" href="/console">${icons.back()}Console</a><span class="pill no">DIDN'T START</span></div>
  <h1 class="h-task">${task.prompt}</h1>
</div>
<section class="card card-lg max-760">
  <h2 class="h-card">The agent couldn't plan this task</h2>
  <p class="muted">${task.error || 'Something went wrong while planning.'}</p>
  <div class="row"><button class="btn btn-primary btn-md" type="button" data-action="again">Try again</button><a class="btn btn-md" href="/console">Back to the console</a></div>
</section>`);
    }

    // The street for the agent's world (world.js): every vendor that sells a mission step. Render
    // only appears when real hosting is on, or when the mission used it.
    function worldVendors(mission) {
        const used = new Set(((mission && mission.log) || []).flatMap((e) => [e.vendorId, e.to, ...(e.quotes || []).map((q) => q.vendorId)]).filter(Boolean));
        return state.catalog.vendors.flatMap((v) => {
            const item = v.items.find((i) => i.capability);
            if (!item || (v.realHosting && !state.config.siteHostingDays && !used.has(v.id))) return [];
            return [{ id: v.id, name: v.name, capability: item.capability }];
        });
    }

    async function taskView(id) {
        const session = await requireSession();
        if (!session) return;
        await Promise.all([getCatalog(), getConfig()]);
        let data = await api(`/tasks/${id}`);
        let lastKey = '';
        let lastDialog = null;
        let world = null;

        // One world per mission page. Each repaint replaces the screen, so it's moved into the new one.
        const showWorld = () => {
            const { task, purchases } = data;
            if (task.kind !== 'mission' || !window.AllowanceWorld) return;
            if (!world) {
                world = window.AllowanceWorld.create({ vendors: worldVendors(task.mission), guardrails: task.guardrails !== false, budgetCents: data.session.budgetCents, tags: LOG_TAGS });
                world.onReplay(() => world.replay(data.task.mission));
            }
            const waiting = purchases.find((p) => p.checks.approval.status === 'waiting');
            const checking = purchases.find((p) => p.status === 'gemini');
            const m = task.mission;
            const now = waiting ? { text: `Waiting for your OK: ${waiting.vendorName}, ${money(waiting.amountCents)}`, approval: true }
                : checking ? { text: `Gemini is checking ${checking.vendorName}'s quote…`, guard: true }
                    : m && m.now ? { text: m.now } : null;
            world.update({ mission: m, active: isActive(task), now });
            const slot = app.querySelector('[data-world-slot]');
            if (slot) slot.replaceWith(world.el);
        };

        const screen = () => {
            const { task, purchases } = data;
            if (task.kind === 'mission') {
                if (isActive(task)) return missionRunScreen(data);
                if (task.status === 'failed' && !purchases.length) return failedScreen(task);
                return missionResultsScreen(data);
            }
            if (isActive(task)) return runScreen(data);
            if (task.status === 'failed' && !purchases.length) return failedScreen(task);
            const caught = purchases.find((p) => p.outcome === 'blocked' || p.outcome === 'denied');
            if (!purchases.some((p) => p.outcome === 'paid') && caught) return blockedScreen({ purchase: caught, task, others: data.others });
            return resultsScreen(data);
        };
        const paint = () => {
            const key = JSON.stringify([data.task, data.purchases, data.session.leftCents]);
            if (key === lastKey) return;
            lastKey = key;
            mount(screen(), isActive(data.task) ? 'Agent run' : 'Results');
            showWorld();
            const waiting = data.purchases.find((p) => p.checks.approval.status === 'waiting');
            if (waiting && lastDialog !== waiting.id) {
                lastDialog = waiting.id;
                const approve = app.querySelector('[data-action="approve"]');
                if (approve) approve.focus();
            }
        };
        paint();

        let polling = false;
        const timer = setInterval(async () => {
            if ((!isActive(data.task) && !reviewing(data.task)) || polling) return;
            polling = true;
            try {
                data = await api(`/tasks/${id}`);
                paint();
            } catch (err) {
                handleError(err);
            } finally {
                polling = false;
            }
        }, 1000);
        onLeave(() => {
            clearInterval(timer);
            if (world) world.destroy();
        });

        const decide = async (el, decision) => {
            el.closest('.dialog').querySelectorAll('button').forEach((b) => { b.disabled = true; });
            try {
                await api(`/purchases/${el.dataset.id}/decision`, { method: 'POST', body: { decision } });
            } catch (err) {
                handleError(err);
            }
            data = await api(`/tasks/${id}`).catch(() => data);
            lastKey = '';
            paint();
        };
        actions.approve = (el) => decide(el, 'approve');
        actions.skip = (el) => decide(el, 'skip');
        actions.stop = async (el) => {
            el.disabled = true;
            try {
                data = await api(`/tasks/${id}/stop`, { method: 'POST' });
                paint();
            } catch (err) {
                handleError(err);
            }
        };
        actions.again = () => startTask({ prompt: data.task.prompt, mission: data.task.kind === 'mission' });
        actions['copy-site'] = async (el) => {
            try {
                await navigator.clipboard.writeText(el.dataset.url);
                toast('Copied the link to the site.');
            } catch {
                toast("Couldn't copy. Use the link next to the button.", 'error');
            }
        };
        actions.csv = () => {
            const reports = new Map(data.purchases.map((p) => p.delivered && p.delivered.report).filter((r) => r && r.rating).map((r) => [r.company.toLowerCase(), r.rating]));
            const rows = data.purchases.flatMap((p) => (p.delivered && p.delivered.companies) || [])
                .map((c) => [c.name, c.city, c.state, c.industry, c.employees, c.opsLead.title, c.opsLead.name, c.opsLead.email, reports.get(c.name.toLowerCase()) || '']);
            downloadCsv('allowance-companies.csv', [['Company', 'City', 'State', 'Industry', 'Employees', 'Ops lead title', 'Ops lead name', 'Ops lead email', 'Credit'], ...rows]);
        };
    }

    // ---------- Missions: a goal, several vendors, one live site ----------
    const LOG_TAGS = {
        plan: ['PLAN', ''], compare: ['COMPARED', ''], choose: ['CHOSE', 'ok'], pay: ['PAID', 'ok'], ask: ['YOU APPROVED', 'you'],
        alert: ['VENDOR SAID', 'warn'], replan: ['NEW PLAN', 'ok'], switch: ['SWITCHED', 'no'], blocked: ['BLOCKED', 'no'],
        skip: ['SKIPPED', ''], free: ['FREE', 'ok'], build: ['BUILDING', ''], deploy: ['DEPLOYING', ''], online: ['ON RENDER', 'ok'], done: ['LIVE', 'ok'], info: ['NOTE', ''],
        unguarded: ['GUARDRAILS OFF', 'no'], trusted: ['TOOK THEIR WORD', 'no'],
        search: ['LOOKING AGAIN', 'you'], negotiate: ['COUNTER-OFFER', 'ok'],
    };

    function missionLog(m, newestFirst) {
        const entries = newestFirst ? [...m.log].reverse() : m.log;
        return html`<ol class="mission-log">${entries.map((e) => {
            const [tag, tone] = LOG_TAGS[e.kind] || ['NOTE', ''];
            return html`
  <li class="log-item${e.kind === 'replan' ? ' replan' : ''}">
    <span class="log-tag ${tone}">${tag}${e.version ? ` · v${e.version}` : ''}</span>
    <div class="log-body"><p>${e.text}</p><span class="mono small dim">${timeOf(e.at)}</span></div>
    ${e.purchaseId ? html`<a class="small link-min" href="/purchases/${e.purchaseId}">Details</a>` : ''}
  </li>`;
        })}</ol>`;
    }

    function missionPlan(m) {
        const STATUS = {
            done: ['DONE', 'ok', 'ok'], active: ['WORKING', 'ok', 'live'], pending: ['UP NEXT', 'dim', 'wait'],
            skipped: ['SKIPPED', 'dim', 'idle'], failed: ['FAILED', 'no', 'idle'], stopped: ['STOPPED', 'dim', 'idle'],
            dropped: ['NOT NEEDED', 'ok', 'idle'],
        };
        return html`
<section class="card card-lg gap-6">
  <div class="row between pad-bottom"><h2 class="label">The plan</h2><span class="pill${m.version > 1 ? ' ok' : ''}">PLAN v${m.version}</span></div>
  <ol class="plan">${m.steps.map((s) => {
        const [text, tone, kind] = STATUS[s.status] || STATUS.pending;
        const quotes = (s.quotes || []).filter((q) => q.ok);
        const sub = s.status === 'done' ? `${s.vendorName} · ${s.title}` : s.note || s.why;
        return html`
    <li class="plan-row">
      ${badge(kind)}
      <span class="plan-name">
        <span class="strong-500">${s.label}${s.addedIn > 1 ? html` <span class="chip-new">NEW IN v${s.addedIn}</span>` : ''}</span>
        <span class="small dim">${sub}</span>
        ${quotes.length > 1 ? html`<span class="small dim">${quotes.length} quotes: ${quotes.map((q) => `${q.vendorName} ${money(q.cents)}`).join(' · ')}</span>` : ''}
      </span>
      <span class="mono">${s.amountCents === 0 ? 'Free' : s.amountCents != null ? money(s.amountCents) : ''}</span>
      <span class="plan-status ${tone}">${text}</span>
    </li>`;
    })}</ol>
</section>`;
    }

    const nowCard = (text) => html`
<section class="card card-lg" aria-live="polite">
  <span class="eyebrow">Now</span>
  <h2 class="h-card">${text || 'Working…'}</h2>
  <div class="sweep" aria-hidden="true"></div>
</section>`;

    function missionRunScreen({ task, purchases, session }) {
        const m = task.mission || { steps: [], log: [], now: 'Planning the mission…', version: 1 };
        const current = purchases.find((p) => !['queued', 'done'].includes(p.status));
        const waiting = purchases.find((p) => p.checks.approval.status === 'waiting');
        const spent = purchases.filter((p) => p.outcome === 'paid').reduce((sum, p) => sum + p.amountCents, 0);
        const pending = current && current.checks.paypal.status !== 'paid' ? current.amountCents : 0;
        const domain = (purchases.find((p) => p.delivered && p.delivered.domain) || { delivered: { domain: {} } }).delivered.domain.name;
        const step = current && m.steps.find((s) => s.id === current.stepId);
        const label = { planning: 'PLANNING', waiting_approval: 'WAITING FOR YOU' }[task.status] || (task.stopRequested ? 'STOPPING' : 'RUNNING');
        return html`${page('console', html`
<div class="stack gap-14">
  <div class="row">
    <a class="link-quiet" href="/console">${icons.back()}Console</a>
    <span class="pill ok"><span class="live-dot"></span>MISSION · ${label} · <span data-since="${task.createdAt}">${clock(Date.now() - new Date(task.createdAt))}</span></span>
  </div>
  <h1 class="h-task">${task.prompt}</h1>
  ${task.summary ? html`<p class="muted">${task.summary}</p>` : ''}
</div>
<div data-world-slot></div>
<div class="split">
  <div class="main">
    ${current ? liveCard(current, step ? `Buying: ${step.label}` : 'Checking this purchase') : nowCard(m.now)}
    ${m.steps.length ? missionPlan(m) : ''}
    ${m.log.length ? html`<section class="card card-lg gap-12"><h2 class="label">What the agent is doing</h2>${missionLog(m, true)}</section>` : ''}
  </div>
  <aside class="side">
    ${budgetCard(session, pending)}
    <section class="card gap-8">
      <h2 class="label">This mission</h2>
      <div class="kv"><span class="muted">Business</span><span>${m.business ? m.business.name : '…'}</span></div>
      <div class="kv"><span class="muted">Domain</span><span class="mono small">${domain || '—'}</span></div>
      <div class="kv"><span class="muted">Paid so far</span><span class="mono">${money(spent)}</span></div>
      <div class="kv"><span class="muted">Steps done</span><span class="mono">${m.steps.filter((s) => s.status === 'done').length} of ${m.steps.filter((s) => s.status !== 'dropped').length || '—'}</span></div>
    </section>
    <button class="btn btn-danger btn-md" type="button" data-action="stop"${task.stopRequested ? raw(' disabled') : ''}>${icons.stop()}${task.stopRequested ? 'Stopping…' : 'Stop the agent'}</button>
    <p class="small dim center">Stops before the next payment. Nothing already paid is undone.</p>
  </aside>
</div>`)}${waiting ? approvalDialog(waiting, session) : ''}`;
    }

    function siteCard(site) {
        // On Render when it got there; otherwise the copy this server keeps.
        const url = site.url || new URL(site.path, location.origin).href;
        const domain = `${site.secure ? 'https' : 'http'}://${site.domain}`;
        return html`
<section class="site-card">
  <div class="browser-bar">
    <span class="browser-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="browser-address mono">${site.secure ? icons.lock(12) : raw('<b>Not secure</b>')} ${site.secure ? 'https' : 'http'}://${site.domain}</span>
  </div>
  <iframe class="site-frame" src="${url}" title="Preview of the website the agent built" sandbox="" loading="lazy"></iframe>
  <div class="site-actions">
    <span class="small dim">${site.url
        ? html`Hosted on Render at <a href="${url}" target="_blank" rel="noopener">${url}</a>. The domain, ${domain}, is simulated.`
        : html`Demo hosting: in real life this is ${domain}. Here it lives at <a href="${url}" target="_blank" rel="noopener">${url}</a>`}</span>
    <div class="row gap-8">
      <button class="btn" type="button" data-action="copy-site" data-url="${url}">${icons.copy()}Copy link</button>
      <a class="btn btn-primary btn-md" href="${url}" target="_blank" rel="noopener">Open the website${icons.external()}</a>
    </div>
  </div>
</section>`;
    }

    function missionResultsScreen({ task, purchases, session }) {
        const m = task.mission || { steps: [], log: [], version: 1 };
        const paid = purchases.filter((p) => p.outcome === 'paid');
        const notBought = purchases.filter((p) => p.outcome !== 'paid');
        const total = paid.reduce((sum, p) => sum + p.amountCents, 0);
        const approvedByYou = paid.filter((p) => p.checks.approval.status === 'approved').length;
        const blocked = notBought.filter((p) => p.outcome === 'blocked' || p.outcome === 'denied').length;
        const duration = clock(new Date(task.finishedAt || Date.now()) - new Date(task.createdAt));
        const site = m.site;
        const name = m.business ? m.business.name : 'The site';
        const wouldHaveBlocked = paid.filter((p) => unchecked(p) && p.checks.rules.wouldBlock).length;
        const trusted = paid.filter((p) => p.tookVendorsWord).length;
        const facts = [
            task.guardrails === false ? 'guardrails off' : '',
            `${plural(paid.filter((p) => !free(p)).length, 'vendor')} paid through PayPal`,
            total > session.budgetCents ? `${money(total)}, over your ${money(session.budgetCents)} budget` : `${money(total)} of your ${money(session.budgetCents)}`,
            approvedByYou ? `you approved ${approvedByYou}` : '',
            blocked ? `${blocked} blocked` : '',
            trusted ? `${trusted} vendor upsell accepted` : '',
            wouldHaveBlocked ? `your rules would have blocked ${wouldHaveBlocked}` : '',
            m.version > 1 ? `plan changed ${m.version === 2 ? 'once' : `${m.version - 1} times`}` : '',
        ].filter(Boolean).join(' · ');
        const lastWords = m.log.length ? m.log[m.log.length - 1].text : '';
        const mail = site && site.welcomeEmail && site.welcomeEmail.subject ? site.welcomeEmail : null;
        return page('console', html`
<div class="stack gap-14">
  <div class="row">
    <a class="link-quiet" href="/console">${icons.back()}Console</a>
    ${task.status === 'stopped' ? html`<span class="pill">STOPPED · ${duration}</span>` : html`<span class="pill ok">${icons.check(12)}MISSION DONE · ${duration}</span>`}
  </div>
  <h1 class="h-page">${site ? html`<span class="lime">${name}</span> is live.` : task.status === 'stopped' ? 'You stopped the mission.' : "The site didn't launch."}</h1>
  <p class="lede">${facts}</p>
</div>
<div data-world-slot></div>
<div class="split">
  <div class="main">
    ${reviewCard(task, purchases)}
    ${site ? siteCard(site) : html`<section class="card card-lg"><h2 class="h-card">No site this time</h2><p class="muted">${lastWords}</p></section>`}
    ${mail ? html`
    <section class="card gap-12">
      <h2 class="label">Welcome email, ready to send</h2>
      <div class="email-preview">
        <div class="kv small"><span class="dim">From</span><span class="mono">${site.email || `hello@${site.domain}`}</span></div>
        <div class="kv small"><span class="dim">Subject</span><span>${mail.subject}</span></div>
        <p class="email-body">${mail.body}</p>
      </div>
    </section>` : ''}
    <section class="card card-lg gap-12">
      <h2 class="label">How the agent did it</h2>
      ${missionLog(m, false)}
    </section>
  </div>
  <aside class="side">
    ${paid.length ? html`
    <section class="card gap-6">
      <h2 class="label pad-bottom">What it paid for</h2>
      ${paid.map((p) => html`<a class="cost-row" href="/purchases/${p.id}"><span class="grow-1 stack"><span class="strong-500">${p.vendorName}</span><span class="small dim">${p.title}${p.checks.approval.status === 'approved' ? ' · approved by you' : ''}</span></span><span class="mono">${money(p.amountCents)}</span>${icons.chevron()}</a>`)}
      <div class="kv total"><span>Total</span><span class="mono">${money(total)}</span></div>
    </section>` : ''}
    ${notBought.length ? html`
    <section class="card gap-6">
      <h2 class="label pad-bottom">Not bought</h2>
      ${notBought.map((p) => html`<a class="cost-row" href="/purchases/${p.id}">${outcomeBadge(p)}<span class="grow-1 stack"><span class="strong-500">${p.vendorName || p.title}</span><span class="small dim">${outcomeText(p)}</span></span><span class="mono strike">${money(p.amountCents)}</span></a>`)}
    </section>` : ''}
    ${budgetCard(session)}
    <a class="btn btn-primary btn-lg btn-block" href="/console">Back to the console${icons.arrow()}</a>
  </aside>
</div>`);
    }

    // ---------- Screen 6: Blocked attempt ----------
    function vendorResponse(body) {
        const lines = JSON.stringify(body, null, 2).split('\n');
        return html`<pre class="code"><span class="dim">HTTP/1.1 402 Payment Required</span>
${lines.map((line, i) => html`${/^\s*"note":/.test(line) ? html`<span class="inj">${line}</span>` : line}${i < lines.length - 1 ? '\n' : ''}`)}</pre>`;
    }

    function blockedGateCards(p) {
        const r = p.checks.rules;
        const g = p.checks.gemini;
        const a = p.checks.approval;
        const pp = p.checks.paypal;
        const card = (kind, title, status, body, caught) => html`
<li class="gate-card${caught ? ' caught' : ''}${kind === 'idle' ? ' idle' : ''}">
  <div class="row between"><span class="gate-card-title${kind === 'idle' ? ' dim' : ''}">${badge(kind, 'lg')}${title}</span><span class="status ${kind === 'ok' ? 'ok' : kind === 'no' ? 'no' : 'dim'}">${status}</span></div>
  ${body}
</li>`;
        const cards = [];
        if (r.status === 'passed') cards.push(card('ok', '1 · Your rules', 'PASSED', html`<p class="muted">${r.items.map((c) => c.label).join('. ')}.</p>`));
        else if (r.status === 'blocked') cards.push(card('no', '1 · Your rules', 'BLOCKED', html`<p>${r.blockedBy}.</p>`, true));
        else cards.push(card('idle', '1 · Your rules', 'NOT REACHED', html`<p class="dim">The purchase stopped before the rules ran.</p>`));

        if (g.status === 'denied') cards.push(card('no', '2 · Gemini', 'DENIED', html`<blockquote class="quote-plain">“${g.reason}”</blockquote>`, true));
        else if (g.status === 'error') cards.push(card('no', '2 · Gemini', 'NO ANSWER', html`<p>${g.reason}</p>`, true));
        else if (g.status === 'approved') cards.push(card('ok', '2 · Gemini', 'APPROVED', html`<blockquote class="quote-plain">“${g.reason}”</blockquote>`));
        else if (g.status === 'skipped') cards.push(card('idle', '2 · Gemini', 'NEVER ASKED', html`<p class="dim">Your rules stopped it first.</p>`));
        else cards.push(card('idle', '2 · Gemini', 'NOT REACHED', html`<p class="dim">Gemini was never asked.</p>`));

        if (a.status && a.status !== 'not_needed') {
            const label = { skipped: 'YOU SKIPPED IT', expired: 'NO ANSWER', stopped: 'STOPPED', approved: 'APPROVED' }[a.status] || 'WAITING';
            cards.push(card(a.status === 'approved' ? 'ok' : 'idle', '3 · Your OK', label, html`<p class="${a.status === 'approved' ? 'muted' : 'dim'}">${p.outcomeReason || ''}</p>`, ['skipped', 'expired'].includes(a.status)));
        }
        if (pp.status === 'failed') cards.push(card('no', 'PayPal sandbox', 'FAILED', html`<p>${pp.error}</p>`, true));
        else cards.push(card('idle', 'PayPal sandbox', 'NOT REACHED', html`<p class="dim">No payout was created, so there's nothing to refund.</p>`));
        return cards;
    }

    function blockedScreen({ purchase: p, task, others }) {
        const attack = task.attackId && state.catalog.attacks.find((x) => x.id === task.attackId);
        const byGemini = p.outcome === 'denied' && p.checks.gemini.status === 'denied';
        const failSafe = p.outcome === 'denied' && p.checks.gemini.status === 'error';
        const injection = byGemini && (p.checks.gemini.flags || []).includes('prompt_injection');
        const headline = {
            blocked: html`<span class="orange">Blocked.</span> No money moved.`,
            denied: html`<span class="orange">${failSafe ? 'Not bought.' : 'Denied.'}</span> No money moved.`,
            skipped: html`Skipped. No money moved.`,
            stopped: html`Stopped. No money moved.`,
            failed: html`Didn't go through. No money moved.`,
        }[p.outcome] || html`No money moved.`;
        let sub = p.outcomeReason;
        if (p.outcome === 'blocked') sub = 'Your rules stopped it before Gemini was asked anything.';
        else if (byGemini) sub = 'Your rules let this one through, so the second check had to catch it, and it did.';
        else if (failSafe) sub = "Gemini couldn't be reached, and without a decision the agent doesn't buy.";
        const tag = attack ? `ATTACK · ${attack.title.toUpperCase()}` : { blocked: 'BLOCKED', denied: 'DENIED', skipped: 'SKIPPED', stopped: 'STOPPED', failed: 'NOT BOUGHT' }[p.outcome];
        // A blocked step inside a mission: say what the mission did next, and link back to it.
        const mission = task.kind === 'mission' ? task.mission : null;
        if (mission) {
            if (mission.site) sub += ` The mission carried on without it, and ${mission.business.name} still launched.`;
            else if (isActive(task)) sub += ' The mission is carrying on without it.';
            else sub += ' The mission ended without launching a site. Open it to see why.';
        }

        return page('console', html`
<div class="stack gap-16">
  <div class="row">
    <a class="link-quiet" href="/console">${icons.back()}Console</a>
    <span class="pill no">${tag}</span>
  </div>
  <h1 class="h-blocked">${headline}</h1>
  <p class="lede max-760">${sub}</p>
  <p class="purchase-line"><span class="strong-500">${p.title}</span><span class="dim">${[p.vendorName || 'No approved vendor', p.categoryLabel].join(' · ')}</span><span class="mono strike">${money(p.amountCents)}</span><span class="dim small">${mission ? 'Mission' : 'Task'}: “${task.prompt}”</span></p>
</div>
<ol class="gate-cards">${blockedGateCards(p)}</ol>
<section class="split">
  <div class="main gap-12">
    <h2 class="label">What the vendor sent</h2>
    ${p.quote ? vendorResponse(p.quote.body) : html`<p class="code dim">${p.vendorId ? `${p.vendorName} didn't send a quote.` : 'No vendor was asked: none of the approved vendors sells this.'}</p>`}
  </div>
  <div class="side gap-12">
    <h2 class="label">How it was handled</h2>
    <ol class="steps">
      ${injection
        ? html`<li><span class="mono dim">01</span><span>Everything the vendor wrote went to Gemini marked as data, not as instructions.</span></li>
             <li><span class="mono dim">02</span><span>Gemini spotted the instructions and denied the purchase.</span></li>`
        : html`<li><span class="mono dim">01</span><span>${p.outcomeReason}</span></li>`}
      <li><span class="mono dim">${injection ? '03' : '02'}</span><span>The attempt went into the ledger, with the reason.</span></li>
    </ol>
  </div>
</section>
${others && others.length ? html`
<section class="stack gap-12">
  <h2 class="label">Other blocked attempts this session</h2>
  <ul class="list-card">${others.map((o) => html`
    <li><a class="list-row" href="/purchases/${o.id}">${badge('no')}<span class="grow-300 stack"><span class="strong-500">${o.title}</span><span class="small dim">${o.decidedBy}${o.checks.gemini.status === 'skipped' ? '. Gemini was never asked.' : ''}</span></span><span class="mono strike">${money(o.amountCents)}</span></a></li>`)}
  </ul>
</section>` : ''}
<div class="row gap-12">
  ${mission
        ? html`<a class="btn btn-primary btn-lg" href="/tasks/${task.id}">Back to the mission${icons.arrow()}</a>`
        : html`<a class="btn btn-primary btn-lg" href="/console">${attack ? 'Try another attack' : 'Back to the console'}${icons.arrow()}</a>`}
  <a class="btn btn-lg" href="/ledger">View in ledger</a>
</div>`);
    }

    // ---------- Screen 8: Receipt ----------
    function receiptScreen({ purchase: p, task }) {
        const pp = p.checks.paypal;
        const dotKind = { neutral: 'neutral', ok: 'ok', no: 'no', you: 'you' };
        return page('ledger', html`
<nav aria-label="Breadcrumb" class="crumbs"><a href="/ledger">Ledger</a><span aria-hidden="true">/</span><span>Purchase</span></nav>
<div class="receipt-head">
  <div class="stack gap-8">
    ${simulated(p) ? html`<span class="pill no self-start">SIMULATED · NO CHECKS</span>`
        : unchecked(p) ? html`<span class="pill no self-start">PAID · NO CHECKS</span>`
            : free(p) ? html`<span class="pill ok self-start">${icons.check(12)}FREE</span>`
            : html`<span class="pill ok self-start">${icons.check(12)}PAID</span>`}
    <h1 class="h-page">${p.title}</h1>
    <p class="muted">${p.vendorName} · ${p.categoryLabel} · part of <a href="/tasks/${task.id}">${task.prompt.length > 70 ? `${task.prompt.slice(0, 69)}…` : task.prompt}</a></p>
  </div>
  <span class="amount amount-xl">${money(p.amountCents)}</span>
</div>
${p.deliveryError ? html`<p class="notice warn">${p.deliveryError}. The payout went through, so it stays in the ledger.</p>` : ''}
<div class="split">
  <section class="main gap-16">
    <h2 class="label">How it was decided</h2>
    <ol class="timeline">${p.timeline.map((e) => html`
      <li class="tl">
        <div class="tl-rail" aria-hidden="true"><span class="tl-dot ${dotKind[e.kind] || 'neutral'}"></span><span class="tl-line"></span></div>
        <div class="tl-body">
          <span class="mono small dim">${timeOf(e.at, true)}</span>
          <span class="strong">${e.label}</span>
          ${e.detail ? (e.quote ? html`<blockquote class="quote-box">“${e.detail}”</blockquote>` : html`<span class="muted">${e.detail}</span>`) : ''}
        </div>
      </li>`)}
    </ol>
  </section>
  <aside class="side">
    ${unchecked(p) ? html`
    <section class="card gap-10 card-warn">
      <h2 class="label">With guardrails on</h2>
      <p>${p.checks.rules.wouldBlock ? html`Your rules would have <strong class="orange">blocked it</strong>: ${p.checks.rules.wouldBlock}.` : p.checks.rules.wouldAsk ? 'Your rules would have asked you first.' : 'Your rules would have allowed it.'}</p>
      <p class="muted">${p.checks.rules.wouldBlock ? 'Gemini would never have been asked.' : 'Gemini would then have checked it.'}${p.tookVendorsWord ? ` The ${p.tookVendorsWord.name} came from the vendor's own note, which Gemini treats as untrusted.` : ''}</p>
    </section>` : ''}
    ${free(p) ? html`
    <section class="card gap-10">
      <h2 class="label">PayPal sandbox payout</h2>
      <p><strong>None needed.</strong> ${p.vendorName}'s price was $0.00, so no payout was sent and ${p.vendorName} delivered against its quote.</p>
    </section>` : simulated(p) ? html`
    <section class="card gap-10">
      <h2 class="label">PayPal sandbox payout</h2>
      <p><strong>Not sent.</strong> It was over the ${money(pp.limitCents)} limit for unguarded payouts in this shared sandbox, so it was recorded but not paid out.</p>
      <p class="muted">With real money and no guardrails, ${money(p.amountCents)} would be gone.</p>
    </section>` : html`
    <section class="card gap-16">
      <h2 class="label">PayPal sandbox payout</h2>
      <dl class="kv-list gap-14">
        <div class="kv-stack"><dt>Payout batch ID</dt><dd class="id-row"><span class="mono break">${pp.batchId}</span><button class="icon-btn" type="button" data-action="copy" data-copy="${pp.batchId}" aria-label="Copy payout batch ID">${icons.copy()}</button></dd></div>
        ${pp.itemId ? html`<div class="kv-stack"><dt>Payout item ID</dt><dd class="mono break">${pp.itemId}</dd></div>` : ''}
        <div class="kv"><dt>Batch status</dt><dd class="mono ${pp.batchStatus === 'SUCCESS' ? 'lime' : ''}">${pp.batchStatus || 'PENDING'}</dd></div>
        <div class="kv"><dt>Amount</dt><dd class="mono">${(p.amountCents / 100).toFixed(2)} USD</dd></div>
        <div class="kv-stack"><dt>Paid to</dt><dd>${p.vendorName}'s sandbox account <span class="mono small dim break">${pp.receiver}</span></dd></div>
        ${pp.checkedAt ? html`<div class="kv"><dt>Last checked</dt><dd class="mono small">${timeOf(pp.checkedAt)}</dd></div>` : ''}
      </dl>
      <div class="row gap-8">
        <button class="btn grow-auto" type="button" data-action="refresh">${icons.reset()}Check status</button>
        ${pp.raw ? html`<button class="btn grow-auto" type="button" data-action="raw" aria-expanded="false" aria-controls="paypal-raw">${icons.code()}PayPal's response</button>` : ''}
      </div>
      ${pp.raw ? html`<pre class="code code-sm" id="paypal-raw" hidden>${JSON.stringify(pp.raw, null, 2)}</pre>` : ''}
    </section>`}
    <section class="card gap-10">
      <h2 class="label">Budget effect</h2>
      <span class="mono big-24">${money(p.budgetBeforeCents)} <span class="dim">→</span> ${money(p.budgetAfterCents)}</span>
      <span class="small dim">Sandbox money. Nothing real was charged.</span>
    </section>
  </aside>
</div>`);
    }

    async function purchaseView(id) {
        const session = await requireSession();
        if (!session) return;
        await Promise.all([getCatalog(), getConfig()]);
        let data = await api(`/purchases/${id}`);
        const paint = () => {
            const p = data.purchase;
            if (p.outcome === 'paid') mount(receiptScreen(data), 'Receipt');
            else if (p.status === 'done') mount(blockedScreen(data), 'Not bought');
            else {
                mount(page('ledger', html`
<h1 class="h-page">Still being checked</h1>
<p class="lede">${p.title} is going through the checks right now.</p>
<div><a class="btn btn-primary btn-md" href="/tasks/${p.taskId}">Watch it live${icons.arrow()}</a></div>`), 'Purchase');
            }
        };
        paint();
        actions.copy = async (el) => {
            try {
                await navigator.clipboard.writeText(el.dataset.copy);
                toast('Copied the payout batch ID.');
            } catch {
                toast("Couldn't copy. Select the ID and copy it by hand.", 'error');
            }
        };
        actions.refresh = async (el) => {
            el.disabled = true;
            try {
                const fresh = await api(`/purchases/${id}/refresh`, { method: 'POST' });
                data = { ...data, purchase: fresh.purchase };
                paint();
                toast(`PayPal says the batch is ${fresh.purchase.checks.paypal.batchStatus}.`);
            } catch (err) {
                el.disabled = false;
                handleError(err);
            }
        };
        actions.raw = (el) => {
            const pre = app.querySelector('#paypal-raw');
            pre.hidden = !pre.hidden;
            el.setAttribute('aria-expanded', String(!pre.hidden));
        };
    }

    // ---------- Screen 9: Ledger ----------
    async function ledgerView() {
        const session = await requireSession();
        if (!session) return;
        await Promise.all([getCatalog(), getConfig()]);
        const { purchases } = await api('/ledger');
        const filters = {
            all: { label: 'All', test: () => true },
            paid: { label: 'Paid', test: (p) => p.outcome === 'paid' },
            blocked: { label: 'Blocked', test: (p) => p.outcome === 'blocked' || p.outcome === 'denied' },
            asked: { label: 'Needed your OK', test: (p) => ['waiting', 'approved', 'skipped', 'expired', 'stopped'].includes(p.checks.approval.status) },
            unchecked: { label: 'No checks', test: unchecked },
        };
        let filter = 'all';
        const count = (key) => purchases.filter(filters[key].test).length;

        const paint = () => {
            const s = state.session;
            const rows = purchases.filter(filters[filter].test);
            mount(page('ledger', html`
<div class="stack gap-10">
  <h1 class="h-page">Ledger</h1>
  <p class="lede">Everything the agent tried to buy this session: paid, approved by you, or blocked.</p>
</div>
<dl class="stat-grid">
  <div class="card stat"><dt>Spent</dt><dd class="amount">${money(s.spentCents)}</dd></div>
  <div class="card stat"><dt>${s.leftCents < 0 ? 'Over budget' : 'Left'}</dt><dd class="amount${s.leftCents < 0 ? ' orange' : ''}">${money(Math.abs(s.leftCents))}</dd></div>
  <div class="card stat"><dt>Paid</dt><dd class="amount lime">${count('paid')}</dd></div>
  <div class="card stat"><dt>Blocked</dt><dd class="amount orange">${count('blocked')}</dd></div>
  ${count('unchecked') ? html`<div class="card stat"><dt>Bought with no checks</dt><dd class="amount orange">${count('unchecked')}<span class="stat-sub">your rules would have blocked ${purchases.filter((p) => unchecked(p) && p.checks.rules.wouldBlock).length}</span></dd></div>` : ''}
</dl>
${purchases.length ? html`
<div class="row between">
  <div class="row gap-8" role="group" aria-label="Filter">${Object.entries(filters).filter(([key]) => key !== 'unchecked' || count('unchecked')).map(([key, f]) => html`<button type="button" class="filter${filter === key ? ' on' : ''}" aria-pressed="${filter === key}" data-action="filter" data-filter="${key}">${f.label} · ${count(key)}</button>`)}</div>
  <button class="btn" type="button" data-action="export">${icons.download()}Export CSV</button>
</div>
<div class="table-box">
  <table class="table table-wide">
    <thead><tr><th scope="col">Time</th><th scope="col">Purchase</th><th scope="col">Vendor</th><th scope="col" class="num">Amount</th><th scope="col">Outcome</th><th scope="col">Decided by</th></tr></thead>
    <tbody>${rows.map((p) => html`<tr>
      <td class="mono small dim">${timeOf(p.finishedAt || p.createdAt)}</td>
      <td><a href="/purchases/${p.id}">${p.title}</a></td>
      <td class="${p.vendorName ? 'muted' : 'faint'}">${p.vendorName || 'None approved'}</td>
      <td class="num${p.outcome === 'paid' ? '' : ' strike'}">${money(p.amountCents)}</td>
      <td>${outcomePill(p)}</td>
      <td class="muted">${p.decidedBy === 'You approved' ? html`<span class="row gap-8 nowrap"><span class="badge badge-xs you" aria-hidden="true"></span>You approved</span>` : p.decidedBy}</td>
    </tr>`)}</tbody>
  </table>
</div>
${rows.length ? '' : html`<p class="dim">Nothing matches this filter.</p>`}
<p class="small dim">Amounts that weren't paid were never charged. Every paid row links to its PayPal sandbox receipt.</p>` : html`
<section class="card card-dashed card-lg">
  <h2 class="h-card">Nothing yet</h2>
  <p class="muted">Run a task or try an attack from the console. Every purchase the agent tries shows up here, including the ones that get blocked.</p>
  <div><a class="btn btn-primary btn-md" href="/console">Go to the console${icons.arrow()}</a></div>
</section>`}`), 'Ledger');
        };
        paint();
        actions.filter = (el) => {
            filter = el.dataset.filter;
            paint();
            const pressed = app.querySelector(`[data-filter="${filter}"]`);
            if (pressed) pressed.focus();
        };
        actions.export = () => {
            downloadCsv('allowance-ledger.csv', [
                ['Time', 'Purchase', 'Vendor', 'Amount (USD)', 'Outcome', 'Decided by', 'Rules would have', 'PayPal payout batch', 'Task'],
                ...purchases.map((p) => [p.finishedAt, p.title, p.vendorName || '', (p.amountCents / 100).toFixed(2), simulated(p) ? 'simulated' : p.outcome, p.decidedBy, unchecked(p) ? p.checks.rules.wouldBlock || 'allowed it' : '', p.checks.paypal.batchId || '', p.taskPrompt]),
            ]);
        };
    }

    getConfig();
    route();
})();
