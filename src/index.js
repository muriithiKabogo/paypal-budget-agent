
require('dotenv').config();
const { createOrder } = require('./paypal');

// --- Agent Configuration & State ---
const BUDGET_USD = 100.00; // The agent's total budget
let currentSpending = 0.00; // The agent's current total spending

/**
 * The core decision-making logic of the agent.
 * Decides whether to approve a transaction and create a PayPal order.
 * @param {number} requestedAmount - The amount of the proposed transaction.
 */
async function handleTransactionRequest(requestedAmount) {
    console.log(`\n--- New Transaction Request: $${requestedAmount.toFixed(2)} ---`);
    console.log(`Current Spending: $${currentSpending.toFixed(2)} / Budget: $${BUDGET_USD.toFixed(2)}`);

    if (currentSpending + requestedAmount > BUDGET_USD) {
        console.error(`DENIED: Transaction of $${requestedAmount.toFixed(2)} would exceed the budget.`);
        return;
    }

    console.log(`APPROVED: Transaction is within budget.`);
    
    // If approved, proceed to create a real order in the PayPal Sandbox
    const order = await createOrder(requestedAmount);

    if (order) {
        // If the order is created successfully, update the agent's internal state
        currentSpending += requestedAmount;
        console.log(`Successfully processed transaction. New spending total: $${currentSpending.toFixed(2)}`);
    } else {
        console.error("Failed to process transaction due to an error creating the PayPal order.");
    }
}

/**
 * Main execution function to simulate incoming payment requests.
 */
async function main() {
    console.log('PayPal Budget Agent Initializing...');
    console.log(`Budget set to: $${BUDGET_USD.toFixed(2)}`);
    console.log('------------------------------------');

    // --- Simulation of incoming payment requests ---
    // In a real-world scenario, these requests might come from a message queue,
    // a web server, or another event-driven source.

    await handleTransactionRequest(45.50);
    await handleTransactionRequest(30.00);
    await handleTransactionRequest(50.00); // This request should be denied

    console.log('\n------------------------------------');
    console.log('Agent simulation finished.');
    console.log(`Final Spending: $${currentSpending.toFixed(2)}`);
}

main();
