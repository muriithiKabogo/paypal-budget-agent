
require('dotenv').config();
const axios = require('axios');
const { createPayout } = require('./paypal'); // Updated import

// --- Agent Configuration & State ---
let budgetUsd = 100.00;
let currentSpending = 0.00;
const transactionHistory = [];
const agentActivityLog = [];
let allowedCategories = ['groceries', 'utilities', 'transport', 'business_expenses', 'data_services', 'digital_goods'];

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}`;
const VENDOR_URL = 'http://localhost:4000/fact';
// Per instructions, use a sandbox recipient email for the vendor agent
const VENDOR_RECIPIENT_EMAIL = 'sb-92u6j30533513@business.example.com';


/**
 * Calls the Gemini API to get a reasoned decision on a transaction.
 * (No changes needed in this function)
 */
async function getGeminiDecision(amount, description, state) {
    if (!GEMINI_API_KEY) {
        return { decision: 'APPROVE', reason: 'Automatic approval due to missing Gemini API key.', category: 'unknown' };
    }
    const historySummary = transactionHistory.slice(-5).map(t => `$${t.amount.toFixed(2)} for "${t.description}"`).join('; ') || 'None';
    const categoriesString = state.allowedCategories.join(', ');
    const prompt = `
        You are a meticulous budget agent. Your task is to approve or deny transactions.
        Your decision process has two steps:
        1. Categorize the transaction based on its description. The possible categories are: ${categoriesString}, or "other".
        2. Decide to APPROVE or DENY the transaction.
        Rules for decision:
        - First, check if the transaction's category is in the list of allowed categories. If it is NOT, you MUST DENY it.
        - If the category IS allowed, then you should also consider the budget, remaining funds, and transaction description.
        - Deny transactions that look suspicious, are for non-essential items when the budget is low, or are poorly described, even if the category is allowed.
        Current Budget Status:
        - Total Budget: $${state.budget.toFixed(2)}
        - Current Spending: $${state.currentSpending.toFixed(2)}
        - Remaining Budget: $${state.remainingBudget.toFixed(2)}
        - Allowed Categories: [${categoriesString}]
        Recent Transactions: ${historySummary}
        Transaction to evaluate:
        - Amount: $${amount.toFixed(2)}
        - Description: "${description}"
        Your response MUST be in JSON format with three keys: "decision" (either "APPROVE" or "DENY"), "reason" (a concise explanation), and "category" (the determined category).
    `;
    try {
        const response = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
        });
        const content = response.data.candidates[0].content.parts[0].text;
        return JSON.parse(content);
    } catch (error) {
        console.error("Error calling Gemini API:", error.response ? error.response.data : error.message);
        return { decision: 'DENY', reason: 'Failed to get a decision from the model due to an internal error.', category: 'error' };
    }
}

/**
 * A simplified handler for manual transactions, which now only makes a decision
 * and does NOT process a payment.
 */
async function handleTransactionRequest(amount, description) {
    console.log(`\n--- Manual Decision Request: $${amount.toFixed(2)} for "${description}" ---`);
    const state = getAgentState();
    if (state.currentSpending + amount > state.budget) {
        const reason = `DENIED: Transaction of $${amount.toFixed(2)} would exceed the budget.`;
        return { success: false, reason, state };
    }
    const modelDecision = await getGeminiDecision(amount, description, state);
    console.log(`Model Decision: ${modelDecision.decision}. Reason: ${modelDecision.reason}`);
    // This function no longer creates an order. It just returns the decision.
    return { success: modelDecision.decision === 'APPROVE', reason: modelDecision.reason, state };
}

// --- Autonomous Agent Logic ---

async function autonomousPurchase() {
    const log = (message) => {
        const timestamp = new Date().toISOString();
        console.log(`[Autonomous Agent] ${timestamp}: ${message}`);
        agentActivityLog.unshift({ timestamp, message });
    };

    log("Waking up to see if I need a new fun fact.");

    try {
        // 1. Get the price from the vendor
        const priceRequest = await axios.get(VENDOR_URL, { validateStatus: status => status === 402 });
        const { price } = priceRequest.data;
        const description = "Purchase a fun fact from the vendor agent.";
        log(`Vendor requires a payment of $${price}. Considering the purchase...`);
        const state = getAgentState();

        // 2. Make a decision using Gemini
        const modelDecision = await getGeminiDecision(price, description, state);
        log(`Model Decision: ${modelDecision.decision}. Category: ${modelDecision.category}. Reason: ${modelDecision.reason}`);

        if (modelDecision.decision !== 'APPROVE') {
            log(`Purchase DENIED. Going back to sleep.`);
            return;
        }

        // 3. Create and send the Payout
        log(`Purchase APPROVED. Attempting to send payout...`);
        const payoutResult = await createPayout(price, VENDOR_RECIPIENT_EMAIL);

        if (!payoutResult.success) {
            log(`Payout FAILED. Reason: ${payoutResult.message}`);
            return;
        }
        
        log(`Payout successful! Payout Batch ID: ${payoutResult.payoutId}. Fetching the fact...`);
        
        // 4. Update local state and fetch the fact
        currentSpending += price;
        transactionHistory.push({ amount: price, description, date: new Date().toISOString(), category: modelDecision.category, payoutId: payoutResult.payoutId });

        // 5. Complete the purchase by sending the Payout ID to the vendor
        // Assuming the vendor API accepts `paymentId` as the query param for the Payout ID
        const purchaseRequest = await axios.get(`${VENDOR_URL}?paymentId=${payoutResult.payoutId}`);
        const { fact } = purchaseRequest.data;
        log(`Successfully purchased fact: "${fact}"`);

    } catch (error) {
        if (error.response && error.response.status === 402) {
            // This is the expected initial state, handled above.
        } else {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            log(`An unexpected error occurred: ${errorMessage}`);
        }
    }
}


// --- Utility Functions ---
function getAgentState() {
    return {
        budget: budgetUsd,
        currentSpending: currentSpending,
        remainingBudget: budgetUsd - currentSpending,
        allowedCategories: allowedCategories,
        transactionHistory: transactionHistory,
    };
}
function getAgentActivityLog() { return agentActivityLog; }
function reloadBudget(newBudget) {
    if (typeof newBudget === 'number' && newBudget > 0) {
        budgetUsd = newBudget;
        currentSpending = 0;
        transactionHistory.length = 0;
        return { success: true, message: `Budget reloaded. New budget: $${newBudget.toFixed(2)}`, state: getAgentState() };
    }
    return { success: false, message: 'Invalid budget amount.', state: getAgentState() };
}
function updateCategories(newCategories) {
    if (Array.isArray(newCategories) && newCategories.every(c => typeof c === 'string')) {
        allowedCategories = newCategories.map(c => c.toLowerCase().trim());
        return { success: true, message: 'Allowed categories updated.', state: getAgentState() };
    }
    return { success: false, message: 'Invalid categories format. Please provide an array of strings.', state: getAgentState() };
}

// --- Start Autonomous Loop ---
setInterval(autonomousPurchase, 30000); // Run every 30 seconds

module.exports = {
    handleTransactionRequest,
    getAgentState,
    getAgentActivityLog,
    reloadBudget,
    updateCategories,
};
