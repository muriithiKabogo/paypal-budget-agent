
require('dotenv').config();
const { createOrder } = require('./paypal');

// --- Agent Configuration & State ---
const BUDGET_USD = 100.00; // The agent's total budget
let currentSpending = 0.00; // The agent's current total spending

/**
 * The core decision-making logic of the agent.
 * Decides whether to approve a transaction and create a PayPal order.
 * @param {number} requestedAmount - The amount of the proposed transaction.
 * @returns {Promise<object>} A result object indicating success or failure.
 */
async function handleTransactionRequest(requestedAmount) {
    console.log(`\n--- New Transaction Request: $${requestedAmount.toFixed(2)} ---`);
    const currentState = getAgentState();
    console.log(`Current Spending: $${currentState.currentSpending.toFixed(2)} / Budget: $${currentState.budget.toFixed(2)}`);

    if (currentSpending + requestedAmount > BUDGET_USD) {
        const message = `DENIED: Transaction of $${requestedAmount.toFixed(2)} would exceed the budget.`;
        console.error(message);
        return { success: false, message, state: getAgentState() };
    }

    console.log(`APPROVED: Transaction is within budget.`);
    
    const order = await createOrder(requestedAmount);

    if (order) {
        currentSpending += requestedAmount;
        const message = `Successfully processed transaction and created PayPal order ${order.id}.`;
        console.log(`${message} New spending total: $${currentSpending.toFixed(2)}`);
        return { success: true, message, orderId: order.id, state: getAgentState() };
    } else {
        const message = "Failed to process transaction: Could not create PayPal order.";
        console.error(message);
        return { success: false, message, state: getAgentState() };
    }
}

/**
 * Returns the current state of the agent's finances.
 * @returns {object} The agent's current budget and spending.
 */
function getAgentState() {
    return {
        budget: BUDGET_USD,
        currentSpending: currentSpending,
        remainingBudget: BUDGET_USD - currentSpending,
    };
}

module.exports = {
    handleTransactionRequest,
    getAgentState,
};
