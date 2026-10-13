
require('dotenv').config();
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

/**
 * Sets up and returns the PayPal environment based on credentials.
 */
function environment() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("FATAL: Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env file.");
    }

    return new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

/**
 * Returns a PayPal HTTP client instance.
 */
function client() {
    return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

/**
 * Creates a new order in the PayPal Sandbox.
 * @param {number} amount - The amount for the order.
 * @param {string} currency - The currency code (e.g., 'USD').
 * @returns {Promise<object|null>} The created order object or null on failure.
 */
async function createOrder(amount, currency = 'USD') {
    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: {
                currency_code: currency,
                value: amount.toFixed(2)
            }
        }]
    });

    try {
        console.log(`Attempting to create a real PayPal order for $${amount.toFixed(2)}...`);
        const order = await client().execute(request);
        console.log(`Successfully created order with ID: ${order.result.id}`);
        return order.result;
    } catch (err) {
        console.error("Failed to create PayPal order:", err.message);
        return null;
    }
}

/**
 * Verifies an order by fetching its details from the PayPal API.
 * @param {string} orderId - The ID of the order to verify.
 * @returns {Promise<object|null>} The order details or null on failure.
 */
async function verifyOrder(orderId) {
    const request = new checkoutNodeJssdk.orders.OrdersGetRequest(orderId);

    try {
        console.log(`Verifying order with ID: ${orderId}...`);
        const order = await client().execute(request);
        console.log(`Successfully verified order. Status: ${order.result.status}`);
        return order.result;
    } catch (err) {
        console.error(`Failed to verify PayPal order ${orderId}:`, err.message);
        return null;
    }
}

module.exports = {
    createOrder,
    verifyOrder,
};
