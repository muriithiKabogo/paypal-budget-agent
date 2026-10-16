
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createPayout } = require('./paypal');

// --- Agent State Management ---
const STATE_FILE = path.join(__dirname, 'agent_state.json');

// State variables are declared with 'let' to allow them to be re-initialized from the saved state file.
let budgetUsd;
let currentSpending;
let transactionHistory;
let agentActivityLog; // Activity log will be in-memory only and not persisted.
let allowedCategories;

// Default initial state
const initialState = {
    budgetUsd: 100.00,
    currentSpending: 0.00,
    transactionHistory: [],
    agentActivityLog: [],
    allowedCategories: ['groceries', 'utilities', 'transport', 'business_expenses', 'data_services', 'digital_goods']
};

function saveState() {
    try {
        const stateToSave = {
            budgetUsd,
            currentSpending,
            transactionHistory,
            allowedCategories
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving agent state:", error);
    }
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const savedState = JSON.parse(data);
            budgetUsd = savedState.budgetUsd !== undefined ? savedState.budgetUsd : initialState.budgetUsd;
            currentSpending = savedState.currentSpending !== undefined ? savedState.currentSpending : initialState.currentSpending;
            transactionHistory = savedState.transactionHistory || initialState.transactionHistory;
            allowedCategories = savedState.allowedCategories || initialState.allowedCategories;
            agentActivityLog = []; // Reset activity log on each start
            console.log('Agent state successfully loaded from file.');
        } else {
            // If no file exists, initialize with default state
            budgetUsd = initialState.budgetUsd;
            currentSpending = initialState.currentSpending;
            transactionHistory = initialState.transactionHistory;
            agentActivityLog = initialState.agentActivityLog;
            allowedCategories = initialState.allowedCategories;
            saveState(); // Create the file for the first time
            console.log('No state file found. Initialized with default state.');
        }
    } catch (error) {
        console.error('Error loading agent state, initializing with defaults:', error);
        // Initialize with defaults in case of a corrupted file
        Object.assign(this, initialState);
    }
}


// --- Agent Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// DO NOT CHANGE THIS MODEL NAME OR THE v1beta PATH. gemini-pro, gemini-1.5-flash,
// gemini-1.5-flash-latest, gemini-1.5-pro-latest, gemini-1.0-pro-latest (all on v1beta or v1)
// are all deprecated and 404 on this API key. gemini-3.1-pro-preview on v1beta is the one
// confirmed working by direct curl testing against the live API, repeatedly. If you think
// you need to change this, verify the exact new URL with a real curl request first - do not
// guess, and do not "fix" this line again without that verification.
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}`;
const VENDOR_URL = 'http://localhost:4000/fact';
const VENDOR_RECIPIENT_EMAIL = 'sb-92u6j30533513@business.example.com';


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

async function handleTransactionRequest(amount, description) {
    console.log(`\n--- Manual Decision Request: $${amount.toFixed(2)} for "${description}" ---`);
    const state = getAgentState();
    if (state.currentSpending + amount > state.budget) {
        const reason = `DENIED: Transaction of $${amount.toFixed(2)} would exceed the budget.`;
        return { success: false, reason, state };
    }
    const modelDecision = await getGeminiDecision(amount, description, state);
    console.log(`Model Decision: ${modelDecision.decision}. Reason: ${modelDecision.reason}`);
    return { success: modelDecision.decision === 'APPROVE', reason: modelDecision.reason, state };
}

async function autonomousPurchase() {
    const log = (message) => {
        const timestamp = new Date().toISOString();
        const fullMessage = `[Autonomous Agent] ${timestamp}: ${message}`;
        console.log(fullMessage);
        // Prepend to activity log so newest is first
        agentActivityLog.unshift({ timestamp, message: fullMessage });
        // Keep the log from growing indefinitely in memory
        if (agentActivityLog.length > 100) {
            agentActivityLog.pop();
        }
    };
    log("Waking up to see if I need a new fun fact.");
    try {
        const priceRequest = await axios.get(VENDOR_URL, { validateStatus: status => status === 402 });
        const { price } = priceRequest.data;
        const description = "Purchase a fun fact from the vendor agent.";
        log(`Vendor requires a payment of $${price}. Considering the purchase...`);
        const state = getAgentState();
        const modelDecision = await getGeminiDecision(price, description, state);
        log(`Model Decision: ${modelDecision.decision}. Category: ${modelDecision.category}. Reason: ${modelDecision.reason}`);
        if (modelDecision.decision !== 'APPROVE') {
            log(`Purchase DENIED. Going back to sleep.`);
            return;
        }
        log(`Purchase APPROVED. Attempting to send payout...`);
        const payoutResult = await createPayout(price, VENDOR_RECIPIENT_EMAIL);
        if (!payoutResult.success) {
            log(`Payout FAILED. Reason: ${payoutResult.message}`);
            return;
        }
        log(`Payout successful! Payout Batch ID: ${payoutResult.payoutId}. Fetching the fact...`);
        currentSpending += price;
        transactionHistory.push({ 
            amount: price, 
            description, 
            date: new Date().toISOString(), 
            status: 'approved',
            reason: modelDecision.reason,
            category: modelDecision.category, 
            payoutId: payoutResult.payoutId 
        });
        saveState(); // Save state after a successful purchase
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

function getAgentState() {
    return {
        budget: budgetUsd,
        currentSpending: currentSpending,
        remainingBudget: budgetUsd - currentSpending,
        allowedCategories: allowedCategories,
        transactionHistory: transactionHistory,
    };
}
function getAgentActivityLog() { 
    return agentActivityLog; 
}

function reloadBudget(newBudget) {
    if (typeof newBudget === 'number' && newBudget > 0) {
        budgetUsd = newBudget;
        currentSpending = 0;
        transactionHistory = []; // Clear history on reload
        agentActivityLog = []; // Clear activity log as well
        saveState(); // Save state after reloading budget
        return { success: true, message: `Budget reloaded. New budget: $${newBudget.toFixed(2)}`, state: getAgentState() };
    }
    return { success: false, message: 'Invalid budget amount.', state: getAgentState() };
}

function updateCategories(newCategories) {
    if (Array.isArray(newCategories) && newCategories.every(c => typeof c === 'string')) {
        allowedCategories = newCategories.map(c => c.toLowerCase().trim());
        saveState(); // Save state after updating categories
        return { success: true, message: 'Allowed categories updated.', state: getAgentState() };
    }
    return { success: false, message: 'Invalid categories format. Please provide an array of strings.', state: getAgentState() };
}

// --- Initialization ---
loadState(); // Load the state when the module is first required
setInterval(autonomousPurchase, 30000);

module.exports = {
    handleTransactionRequest,
    getAgentState,
    getAgentActivityLog,
    reloadBudget,
    updateCategories,
};
