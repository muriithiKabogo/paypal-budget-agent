// A small PayPal REST client: just the Payouts calls the agent and the vendors need.
//
// Why Payouts and not the Orders API: an Orders payment has to be approved by a buyer, or paid
// with a card the payee account can process. Sandbox vendor accounts can't take cards
// (PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING), so Payouts is the rail that lets one agent pay
// another with no human in the loop. The vendor binds each payout to its quote (sender_item_id).
const config = require('./config');

// Sandbox only, on purpose: this demo never moves real money.
const BASE_URL = 'https://api-m.sandbox.paypal.com';

let token = null; // { value, expiresAt }

class PayPalError extends Error {
    constructor(message, status, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

function isConfigured() {
    return Boolean(config.paypalClientId && config.paypalClientSecret);
}

async function getToken() {
    if (token && Date.now() < token.expiresAt) return token.value;
    if (!isConfigured()) throw new PayPalError('PayPal sandbox credentials are missing (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET).', 0);
    const auth = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');
    const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(`PayPal sign-in failed (${res.status}).`, res.status, body);
    token = { value: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in - 60) * 1000 };
    return token.value;
}

async function request(method, path, body) {
    const res = await fetch(BASE_URL + path, {
        method,
        headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) token = null;
    if (!res.ok) {
        const issue = json.details && json.details[0] && json.details[0].issue;
        throw new PayPalError(issue || json.message || `PayPal returned ${res.status}.`, res.status, json);
    }
    return json;
}

// Sends one payout. senderItemId is the vendor's quote id, so the vendor can tell this payment
// was made for that quote and nothing else.
async function sendPayout({ amountCents, receiver, senderItemId, note }) {
    const result = await request('POST', '/v1/payments/payouts', {
        sender_batch_header: {
            sender_batch_id: `allowance_${senderItemId}`,
            email_subject: 'You have a payout from Allowance',
            email_message: note,
        },
        items: [{
            recipient_type: 'EMAIL',
            amount: { value: (amountCents / 100).toFixed(2), currency: 'USD' },
            receiver,
            note,
            sender_item_id: senderItemId,
        }],
    });
    return { batchId: result.batch_header.payout_batch_id, batchStatus: result.batch_header.batch_status };
}

function getPayout(batchId) {
    return request('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
}

// What we show people as "PayPal's response": the API body without its HATEOAS links.
function forDisplay(body) {
    return JSON.parse(JSON.stringify(body, (key, value) => (key === 'links' ? undefined : value)));
}

module.exports = { isConfigured, sendPayout, getPayout, forDisplay, PayPalError };
