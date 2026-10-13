
require('dotenv').config();
const axios = require('axios');
const { createOrder, verifyOrder } = require('./paypal');

// --- Agent Configuration & State ---
let budgetUsd = 100.00;
let currentSpending = 0.00;
const transactionHistory = []; // To give the model context

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;


/**
 * Calls the Gemini API to get a reasoned decision on a transaction.
 * @param {number} amount - The transaction amount.
 * @param {string} description - The transaction description.
 * @param {object} state - The current agent state.
 * @returns {Promise<{decision: 'APPROVE'|'DENY', reason: string}>}
 */
async function getGeminiDecision(amount, description, state) {
    if (!GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY not found. Approving transaction based on budget only.");
        return { decision: 'APPROVE', reason: 'Automatic approval due to missing Gemini API key.' };
    }

    const historySummary = transactionHistory.slice(-5).map(t => `$${t.amount.toFixed(2)} for "${t.description}"`).join('; ') || 'None';

    const prompt = `
        You are a meticulous budget agent. Your task is to approve or deny transactions based on a user's request.
        Your decision should be based on the transaction's description, amount, and the user's current budget status.
        Deny transactions that look suspicious, are for non-essential items when the budget is low, or are poorly described.

        Current Budget Status:
        - Total Budget: $${state.budget.toFixed(2)}
        - Current Spending: $${state.currentSpending.toFixed(2)}
        - Remaining Budget: $${state.remainingBudget.toFixed(2)}

        Recent Transactions: ${historySummary}

        Transaction to evaluate:
        - Amount: $${amount.toFixed(2)}
        - Description: "${description}"

        Your response MUST be in JSON format with two keys: "decision" (either "APPROVE" or "DENY") and "reason" (a concise, one-sentence explanation for your decision).
    `;

    try {
        const response = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                response_mime_type: "application/json",
            }
        });

        const content = response.data.candidates[0].content.parts[0].text;
        return JSON.parse(content);
    } catch (error) {
        console.error("Error calling Gemini API:", error.response ? error.response.data : error.message);
        return { decision: 'DENY', reason: 'Failed to get a decision from the model due to an internal error.' };
    }
}

async function handleTransactionRequest(amount, description) {
    console.log(`\n--- New Transaction Request: $${amount.toFixed(2)} for "${description}" ---`);
    const state = getAgentState();

    // 1. Hard budget check (non-negotiable)
    if (state.currentSpending + amount > state.budget) {
        const reason = `DENIED: Transaction of $${amount.toFixed(2)} would exceed the budget.`;
        console.error(reason);
        return { success: false, reason, state };
    }

    // 2. AI-driven decision making
    const modelDecision = await getGeminiDecision(amount, description, state);
    console.log(`Model Decision: ${modelDecision.decision}. Reason: ${modelDecision.reason}`);

    if (modelDecision.decision !== 'APPROVE') {
        return { success: false, reason: modelDecision.reason, state };
    }

    // 3. Proceed with PayPal order if approved
    const createdOrder = await createOrder(amount);
    if (!createdOrder) {
        const reason = "Failed to process transaction: Could not create PayPal order.";
        return { success: false, reason, state };
    }
    
    // In a real scenario, we'd wait for capture, but for this hackathon, we assume immediate capture on creation.
    currentSpending += amount;
    transactionHistory.push({ amount, description, date: new Date() });
    
    const message = `Successfully processed PayPal order ${createdOrder.id}.`;
    return { success: true, message, orderId: createdOrder.id, reason: modelDecision.reason, state: getAgentState() };
}

function getAgentState() {
    return {
        budget: budgetUsd,
        currentSpending: currentSpending,
        remainingBudget: budgetUsd - currentSpending,
    };
}

function reloadBudget(newBudget) {
    if (typeof newBudget === 'number' && newBudget > 0) {
        budgetUsd = newBudget;
        currentSpending = 0;
        transactionHistory.length = 0; // Clear history on reload
        return { success: true, message: `Budget reloaded. New budget: $${newBudget.toFixed(2)}`, state: getAgentState() };
    }
    return { success: false, message: 'Invalid budget amount.', state: getAgentState() };
}

module.exports = {
    handleTransactionRequest,
    getAgentState,
    reloadBudget,
};
