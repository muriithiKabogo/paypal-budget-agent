const express = require('express');
const path = require('path');
const config = require('./config');
const gemini = require('./gemini');
const paypal = require('./paypal');
const hosting = require('./hosting');
const { router: api } = require('./api');
const { vendorRouter } = require('./vendors');
const { sitesRouter } = require('./sites');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Voice clips (up to 30 s of 16 kHz WAV, base64) need more room than every other request.
app.use('/api/transcribe', express.json({ limit: '1.5mb' }));
app.use(express.json({ limit: '20kb' }));

app.use('/vendors', vendorRouter);
app.use('/api', api);
app.use('/sites', sitesRouter);
app.use(express.static(PUBLIC_DIR));

// The web app routes on the client, so any other page load gets the app shell.
app.use((req, res, next) => {
    if (req.method !== 'GET' || /^\/(api|vendors|sites)\//.test(req.path)) return next();
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'The request body is not valid JSON.' });
    if (err.type === 'entity.too.large') {
        const message = req.path === '/api/transcribe' ? 'That recording is too long. Keep it under 30 seconds.' : 'That request is too large.';
        return res.status(413).json({ error: 'too_large', message });
    }
    console.error(err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong on the server.' });
});

if (require.main === module) {
    app.listen(config.port, () => {
        console.log(`Allowance is running at http://localhost:${config.port}`);
        if (!gemini.isConfigured()) console.warn('GEMINI_API_KEY is not set: planning fails and every purchase is denied (fail-safe).');
        if (!paypal.isConfigured()) console.warn('PayPal sandbox credentials are not set: approved purchases fail at the payment step.');
        if (!hosting.isConfigured()) return console.log('Mission sites are served here only (set SITES_REPO, SITES_DEPLOY_KEY_FILE and RENDER_API_KEY to host them on Render).');
        console.log(`Mission sites go live on Render, from ${config.sitesRepo}.`);
        const cleanup = () => hosting.cleanup()
            .then((gone) => gone.length && console.log(`Took down ${gone.length} expired demo site(s): ${gone.join(', ')}`))
            .catch((err) => console.warn(`Couldn't clean up old demo sites: ${err.message}`));
        cleanup();
        return setInterval(cleanup, CLEANUP_EVERY_MS).unref();
    });
}

module.exports = { app };
