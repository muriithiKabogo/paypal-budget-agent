// public/app.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
    const budgetRing = document.getElementById('budget-ring');
    const budgetRemainingEl = document.getElementById('budget-remaining');
    const budgetOfTotalEl = document.getElementById('budget-of-total');
    const payoutAmountEl = document.getElementById('payout-amount');
    const latestDecisionContentEl = document.getElementById('latest-decision-content');
    const activityLogListEl = document.getElementById('activity-log-list');
    const transactionForm = document.getElementById('transaction-form');
    const transactionStatusEl = document.getElementById('transaction-status');
    const budgetForm = document.getElementById('budget-form');
    const budgetStatusEl = document.getElementById('budget-status');

    // --- State ---
    let lastKnownPayout = null;

    // --- Functions ---
    const fetchStatus = async () => {
        try {
            const response = await fetch('/status');
            const data = await response.json();
            updateBudget(data);
            updateAgentFlow(data.transactionHistory);
        } catch (error) {
            console.error('Error fetching status:', error);
        }
    };

    const fetchActivity = async () => {
        try {
            const response = await fetch('/activity');
            const data = await response.json();
            updateActivity(data);
        } catch (error) {
            console.error('Error fetching activity:', error);
        }
    };

    const updateBudget = (data) => {
        // Bug 1 Fix: Use `currentSpending` instead of `totalSpent`
        const { budget, currentSpending } = data;
        const remaining = budget - currentSpending;
        const percentage = budget > 0 ? (remaining / budget) * 100 : 0;
        const angle = (percentage / 100) * 360;

        budgetRemainingEl.textContent = `$${remaining.toFixed(2)}`;
        budgetOfTotalEl.textContent = `of $${budget.toFixed(2)}`;
        budgetRing.style.background = `conic-gradient(var(--accent-blue) ${angle}deg, var(--border-color) 0deg)`;
    };
    
    const updateAgentFlow = (history) => {
        // Bug 2 Fix: Check for `payoutId` which indicates an approved transaction
        // and use `payoutId` instead of `payout_batch_id`
        const lastApproved = [...history].reverse().find(t => t.payoutId);
        if (lastApproved && lastApproved.payoutId !== lastKnownPayout) {
            payoutAmountEl.textContent = `$${lastApproved.amount.toFixed(2)} Payout`;
            lastKnownPayout = lastApproved.payoutId;
        }
    };

    const updateActivity = (logs) => {
        if (!logs || logs.length === 0) return;
        
        // Logs are already newest first from the server
        updateHeroCard(logs[0]);
        updateTimeline(logs);
    };

    const parseLogEntry = (logObject) => {
        // Bug 3 Fix: Operate on the log object directly, not a string
        try {
            const { timestamp, message } = logObject;
            
            const isApproved = message.includes('APPROVED');
            const isDenied = message.includes('DENIED');
            let status = 'neutral';
            if(isApproved) status = 'approved';
            if(isDenied) status = 'denied';

            // Extract details using regex on the message string
            const amountMatch = message.match(/\$(\d+\.?\d*)/);
            const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

            const reasoningMatch = message.match(/Reason: (.*?)$/);
            const reasoning = reasoningMatch ? reasoningMatch[1] : 'No reasoning provided.';
            
            const batchIdMatch = message.match(/Payout Batch ID: ([\w-]+)/);
            const batchId = batchIdMatch ? batchIdMatch[1] : null;

            return { timestamp, message, status, amount, reasoning, batchId };
        } catch (e) {
            console.error("Failed to parse log entry object:", logObject, e);
            return { timestamp: new Date().toISOString(), message: 'Error parsing log.', status: 'neutral' };
        }
    };

    const updateHeroCard = (latestLog) => {
        const entry = parseLogEntry(latestLog);
        if (!entry || entry.status === 'neutral') {
             latestDecisionContentEl.innerHTML = `<p>No recent decision to display.</p>`;
             return;
        };

        const icon = entry.status === 'approved' 
            ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`;

        latestDecisionContentEl.innerHTML = `
            <div class="hero-status">
                <div class="hero-status-icon ${entry.status}">
                    ${icon}
                </div>
                <span class="hero-status-text ${entry.status}">${entry.status.toUpperCase()}</span>
            </div>
            <blockquote id="decision-reasoning">${entry.reasoning}</blockquote>
            <div class="decision-details">
                <span class="detail-item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <strong>$${entry.amount ? entry.amount.toFixed(2) : 'N/A'}</strong>
                </span>
                ${entry.batchId ? `
                <span class="detail-item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    PayPal Batch ID: <strong id="decision-paypal-id">${entry.batchId}</strong>
                </span>` : ''}
                <span class="detail-item" id="decision-timestamp">${new Date(entry.timestamp).toLocaleString()}</span>
            </div>
        `;
    };

    const updateTimeline = (logs) => {
        activityLogListEl.innerHTML = logs.slice(0, 10).map(log => { // Show latest 10
            const entry = parseLogEntry(log);
            return `
                <li class="activity-item ${entry.status}">
                    <div class="activity-item-content">
                        <p>${entry.message}</p>
                        <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                </li>
            `;
        }).join('');
    };

    // --- Event Listeners ---
    transactionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // Bug 4 Fix: Use `description` instead of `item`
        const description = document.getElementById('item').value;
        const amount = document.getElementById('amount').value;
        transactionStatusEl.textContent = 'Submitting...';
        try {
            const response = await fetch('/transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Bug 4 Fix: Send `description` field
                body: JSON.stringify({ description, amount: parseFloat(amount) })
            });
            const result = await response.json();
            transactionStatusEl.textContent = `Server response: ${result.decision || result.message || result.reason}`;
            setTimeout(() => { fetchStatus(); fetchActivity(); }, 1000); // give server time to update logs
        } catch (error) {
            transactionStatusEl.textContent = 'Error submitting transaction.';
        }
    });

    budgetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newBudget = document.getElementById('new-budget').value;
        budgetStatusEl.textContent = 'Updating...';
        try {
            // Bug 4 Fix: Post to `/reload` endpoint with `newBudget` field
            const response = await fetch('/reload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newBudget: parseFloat(newBudget) })
            });
            const result = await response.json();
            budgetStatusEl.textContent = `Budget reloaded to $${result.state.budget.toFixed(2)}`;
            fetchStatus();
        } catch (error) {
            budgetStatusEl.textContent = 'Error reloading budget.';
        }
    });

    // --- Initial Load ---
    setInterval(() => {
        fetchStatus();
        fetchActivity();
    }, 5000);
    fetchStatus();
    fetchActivity();
});
