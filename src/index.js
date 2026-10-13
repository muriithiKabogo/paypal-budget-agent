
require('dotenv').config();
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

// --- Configuration ---
const BUDGET_USD = 100.00;
let currentSpending = 0.00;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

// --- PayPal API Section ---
function environment() {
    let clientId = process.env.PAYPAL_CLIENT_ID;
    let clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("FATAL: Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env file.");
    }
    return new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

function client() {
    return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

async function getAccessToken() {
    console.log("Attempting to get access token...");
    try {
        const request = new checkoutNodeJssdk.core.AccessTokenRequest(environment());
        const response = await client().execute(request);
        console.log("Successfully got access token!");
        return response.result.access_token;
    } catch (error) {
        console.error(`Failed to get access token: ${error.message}`);
        return null;
    }
}

// TODO: Implement actual transaction fetching
async function fetchLatestTransactions(accessToken) {
    console.log("Fetching latest transactions (simulation)...");
    // In a real implementation, this function would make an API call to PayPal's
    // v1/reporting/transactions endpoint to get recent transactions.
    // For now, we'll simulate a new transaction occasionally.
    const shouldSimulateTransaction = Math.random() < 0.2; // 20% chance of new transaction
    if (shouldSimulateTransaction) {
        const newTransactionAmount = parseFloat((Math.random() * 20 + 5).toFixed(2)); // $5-$25
        console.log(`Simulated new transaction of $${newTransactionAmount}`);
        return [{ amount: newTransactionAmount }];
    }
    return [];
}


// --- Budget Management Logic ---
function processTransactions(transactions) {
    if (transactions.length === 0) {
        console.log("No new transactions to process.");
        return;
    }
    transactions.forEach(tx => {
        console.log(`Processing transaction of $${tx.amount.toFixed(2)}`);
        if (currentSpending + tx.amount > BUDGET_USD) {
            console.error(`Transaction of $${tx.amount.toFixed(2)} would exceed budget. ALERT!`);
            // TODO: Implement an alert mechanism (e.g., send an email, webhook)
        } else {
            currentSpending += tx.amount;
            console.log(`Transaction recorded. New spending total: $${currentSpending.toFixed(2)} / $${BUDGET_USD.toFixed(2)}`);
        }
    });
}


// --- Main Execution Loop ---
async function main() {
    console.log('PayPal Budget Agent starting...');
    
    // The main loop that runs indefinitely
    setInterval(async () => {
        console.log(`\n--- Running budget check at ${new Date().toISOString()} ---`);
        const accessToken = await getAccessToken();
        if (accessToken) {
            const transactions = await fetchLatestTransactions(accessToken);
            processTransactions(transactions);
        } else {
            console.error("Could not obtain access token. Skipping this check.");
        }
    }, CHECK_INTERVAL_MS);

    // Initial run
    console.log('--- Performing initial budget check ---');
    const accessToken = await getAccessToken();
    if (accessToken) {
        const transactions = await fetchLatestTransactions(accessToken);
        processTransactions(transactions);
    } else {
        console.error("Could not obtain access token for initial run.");
    }
}

main();
