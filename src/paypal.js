
require('dotenv').config();
const payoutsNodeJssdk = require('@paypal/payouts-sdk');

// --- PayPal SDK Setup ---

/**
 * Sets up and returns the PayPal environment based on credentials.
 */
function environment() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("FATAL: Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env file.");
    }
    // Using SandboxEnvironment for testing
    return new payoutsNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

/**
 * Returns a PayPal HTTP client instance.
 */
function client() {
    return new payoutsNodeJssdk.core.PayPalHttpClient(environment());
}

// --- Payouts API Implementation ---

/**
 * Creates and sends a single payout to a recipient.
 * @param {number} amount - The amount to send.
 * @param {string} recipientEmail - The recipient's PayPal email address.
 * @param {string} currency - The currency code (e.g., 'USD').
 * @returns {Promise<{success: boolean, payoutId?: string, message: string}>} Result of the payout operation.
 */
async function createPayout(amount, recipientEmail, currency = 'USD') {
    const senderBatchId = `payout_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const requestBody = {
        sender_batch_header: {
            sender_batch_id: senderBatchId,
            email_subject: "You have a new payout!",
            email_message: "You have received a payout for providing a fun fact."
        },
        items: [
            {
                recipient_type: "EMAIL",
                amount: {
                    value: amount.toFixed(2),
                    currency: currency
                },
                receiver: recipientEmail,
                note: "Thanks for the fun fact!",
                sender_item_id: `item_${Date.now()}`
            }
        ]
    };
    const request = new payoutsNodeJssdk.payouts.PayoutsPostRequest();
    request.requestBody(requestBody);

    try {
        console.log(`Attempting to send a $${amount.toFixed(2)} payout to ${recipientEmail}...`);
        const response = await client().execute(request);
        const payoutBatchId = response.result.batch_header.payout_batch_id;
        console.log(`Successfully created payout batch with ID: ${payoutBatchId}`);
        return {
            success: true,
            payoutId: payoutBatchId,
            message: `Payout batch ${payoutBatchId} created successfully.`
        };
    } catch (err) {
        const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error("Failed to create PayPal payout:", errorMessage);
        return {
            success: false,
            message: `Failed to create payout. Details: ${errorMessage}`
        };
    }
}

/**
 * Verifies the status of a PayPal payout batch.
 * @param {string} payoutBatchId The ID of the payout batch to verify.
 * @returns {Promise<object|null>} The payout batch details if verification is successful, otherwise null.
 */
async function verifyPayout(payoutBatchId) {
    try {
        const request = new payoutsNodeJssdk.payouts.PayoutsGetRequest(payoutBatchId);
        console.log(`Verifying payout batch with ID: ${payoutBatchId}`);
        const response = await client().execute(request);
        console.log("Payout verification successful.");
        return response.result;
    } catch (err) {
        const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error("Failed to verify PayPal payout:", errorMessage);
        return null;
    }
}


module.exports = {
    createPayout,
    verifyPayout, // Export the new function
};
