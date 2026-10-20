require('dotenv').config({ quiet: true });

const env = process.env;
const port = Number(env.PORT) || 3000;

// The sandbox business account the demo vendors get paid into. Override it for every vendor with
// VENDOR_PAYPAL_EMAIL, or for one vendor with VENDOR_PAYPAL_EMAIL_<VENDOR ID> (e.g. ..._ATLASBASE).
const DEFAULT_VENDOR_EMAIL = 'sb-92u6j30533513@business.example.com';

module.exports = {
    port,
    geminiApiKey: env.GEMINI_API_KEY || '',
    // "low" keeps each decision around 7s instead of ~16s; it still catches the injection attack.
    geminiThinkingLevel: env.GEMINI_THINKING_LEVEL || 'low',
    geminiTranscribeModel: env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-flash',
    geminiLiveTranscribeModel: env.GEMINI_LIVE_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-live',
    // Writes the copy for websites that missions launch. Fast, and separate from the Pro model's quota.
    geminiSiteModel: env.GEMINI_SITE_MODEL || 'gemini-3.5-flash',
    paypalClientId: env.PAYPAL_CLIENT_ID || '',
    paypalClientSecret: env.PAYPAL_CLIENT_SECRET || '',
    // The agent reaches the vendors over HTTP, like any other agent would. By default they are
    // mounted on this same server; point this elsewhere to run them separately (npm run vendors).
    vendorBaseUrl: env.VENDOR_BASE_URL || `http://127.0.0.1:${port}/vendors`,
    demoVideoUrl: env.DEMO_VIDEO_URL || '',
    sessionMinutes: 30,
    approvalMinutes: 10,
    maxSessions: 500,
    maxTasksPerSession: 20,
    maxTranscriptionsPerSession: 40,
    // With guardrails off, payouts bigger than this are recorded but not sent, so one person
    // clicking the $400 attack a few times can't drain the shared sandbox account.
    unguardedPayoutLimitCents: Math.round((Number(env.UNGUARDED_PAYOUT_LIMIT) || 50) * 100),
    maxVoiceTokensPerSession: 120,
    // Real hosting for the sites missions build (optional). The page is pushed to its own folder in
    // a public GitHub repo with a deploy key that can only touch that repo, and Render serves the
    // folder as a static site. Without all three, sites are only served here at /sites/<slug>.
    sitesRepo: env.SITES_REPO || '', // owner/name
    sitesGitUrl: env.SITES_REPO ? `git@github.com:${env.SITES_REPO}.git` : '',
    sitesDeployKeyFile: env.SITES_DEPLOY_KEY_FILE || '',
    renderApiKey: env.RENDER_API_KEY || '',
    // Only needed if the Render key can see more than one workspace.
    renderOwnerId: env.RENDER_OWNER_ID || '',
    // Anyone can launch a mission, so new Render sites are capped per day and taken down after a week.
    sitesPerDay: Number(env.SITES_PER_DAY) || 10,
    sitesKeepDays: Number(env.SITES_KEEP_DAYS) || 7,
    // Where "See how it works" on a hosted site links back to. Render sets RENDER_EXTERNAL_URL itself.
    publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'https://github.com/muriithiKabogo/paypal-budget-agent',
    vendorEmail(vendorId) {
        return env[`VENDOR_PAYPAL_EMAIL_${vendorId.toUpperCase()}`] || env.VENDOR_PAYPAL_EMAIL || DEFAULT_VENDOR_EMAIL;
    },
};
