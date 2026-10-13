
require('dotenv').config();
const axios = require('axios');
const { createOrder, verifyOrder } = require('./paypal');

// --- Agent Configuration & State ---
let budgetUsd = 100.00;
let currentSpending = 0.00;
const transactionHistory = [];
let allowedCategories = ['groceries', 'utilities', 'transport', 'business_expenses']; // Default categories

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Calls the Gemini API to get a reasoned decision on a transaction.
 * @param {number} amount - The transaction amount.
 * @param {string} description - The transaction description.
 * @param {object} state - The current agent state.
 * @returns {Promise<{decision: 'APPROVE'|'DENY', reason: string, category: string}>}
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

async function handleTransactionRequest(amount, description) {
    console.log(`\n--- New Transaction Request: $${amount.toFixed(2)} for "${description}" ---`);
    const state = getAgentState();

    if (state.currentSpending + amount > state.budget) {
        const reason = `DENIED: Transaction of $${amount.toFixed(2)} would exceed the budget.`;
        console.error(reason);
        return { success: false, reason, state, category: 'N/A' };
    }

    const modelDecision = await getGeminiDecision(amount, description, state);
    console.log(`Model Decision: ${modelDecision.decision}. Category: ${modelDecision.category}. Reason: ${modelDecision.reason}`);

    if (modelDecision.decision !== 'APPROVE') {
        return { success: false, reason: modelDecision.reason, state, category: modelDecision.category };
    }

    const createdOrder = await createOrder(amount);
    if (!createdOrder) {
        const reason = "Failed to process transaction: Could not create PayPal order.";
        return { success: false, reason, state, category: modelDecision.category };
    }

    currentSpending += amount;
    transactionHistory.push({ amount, description, date: new Date(), category: modelDecision.category });

    const message = `Successfully processed PayPal order ${createdOrder.id}.`;
    return { success: true, message, orderId: createdOrder.id, reason: modelDecision.reason, state: getAgentState(), category: modelDecision.category };
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

module.exports = {
    handleTransactionRequest,
    getAgentState,
    reloadBudget,
    updateCategories,
};
