
require('dotenv').config();
const { createOrder, verifyOrder } = require('./paypal');

// --- Agent Configuration & State ---
const BUDGET_USD = 100.00; // The agent's total budget
let currentSpending = 0.00; // The agent's current total spending

/**
 * The core decision-making logic of the agent.
 * Decides whether to approve a transaction, creates a PayPal order, and verifies it.
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
    
    // 1. Create the order
    const createdOrder = await createOrder(requestedAmount);
    if (!createdOrder) {
        const message = "Failed to process transaction: Could not create PayPal order.";
        console.error(message);
        return { success: false, message, state: getAgentState() };
    }

    // 2. Verify the order with a separate API call
    const verifiedOrder = await verifyOrder(createdOrder.id);
    if (!verifiedOrder) {
        const message = `CRITICAL: Order ${createdOrder.id} was created but FAILED verification. Rolling back.`;
        console.error(message);
        // NOTE: In a real system, we might add this to a retry queue or alert a human.
        return { success: false, message, orderId: createdOrder.id, state: getAgentState() };
    }

    // 3. Only update state after successful creation AND verification
    currentSpending += requestedAmount;
    const message = `Successfully processed and verified PayPal order ${verifiedOrder.id} with status ${verifiedOrder.status}.`;
    console.log(`${message} New spending total: $${currentSpending.toFixed(2)}`);
    
    return { 
        success: true, 
        message, 
        orderId: verifiedOrder.id, 
        verifiedStatus: verifiedOrder.status,
        state: getAgentState() 
    };
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
