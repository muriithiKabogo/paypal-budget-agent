document.addEventListener('DOMContentLoaded', () => {
    const totalBudgetEl = document.getElementById('total-budget');
    const spentBudgetEl = document.getElementById('spent-budget');
    const remainingBudgetEl = document.getElementById('remaining-budget');
    const transactionForm = document.getElementById('transaction-form');
    const transactionAmountEl = document.getElementById('transaction-amount');
    const transactionDescriptionEl = document.getElementById('transaction-description');
    const reloadForm = document.getElementById('reload-form');
    const reloadAmountEl = document.getElementById('reload-amount');
    const transactionLogEl = document.getElementById('transaction-log');
    const activityLogEl = document.getElementById('activity-log');
    const transactionHistoryEl = document.getElementById('transaction-history');

    async function fetchStatus() {
        try {
            const response = await fetch('/status');
            const data = await response.json();
            updateStatusUI(data);
            updateTransactionHistoryUI(data.transactionHistory);
        } catch (error) {
            console.error('Error fetching status:', error);
        }
    }

    async function fetchActivityLog() {
        try {
            const response = await fetch('/activity');
            const data = await response.json();
            updateActivityLogUI(data);
        } catch (error) {
            console.error('Error fetching activity log:', error);
        }
    }

    function updateStatusUI(state) {
        totalBudgetEl.textContent = `$${state.budget.toFixed(2)}`;
        spentBudgetEl.textContent = `$${state.currentSpending.toFixed(2)}`;
        remainingBudgetEl.textContent = `$${state.remainingBudget.toFixed(2)}`;
    }

    function updateActivityLogUI(log) {
        activityLogEl.innerHTML = ''; // Clear the list
        log.forEach(entry => {
            const logItem = document.createElement('li');
            const timestamp = new Date(entry.timestamp).toLocaleTimeString();
            logItem.innerHTML = `<strong>[${timestamp}]</strong> ${entry.message}`;
            activityLogEl.appendChild(logItem);
        });
    }

    function updateTransactionHistoryUI(history) {
        transactionHistoryEl.innerHTML = ''; // Clear the list
        history.slice().reverse().forEach(tx => {
            const listItem = document.createElement('li');
            const date = new Date(tx.date).toLocaleString();
            listItem.innerHTML = `
                <strong>${tx.description}</strong> - $${tx.amount.toFixed(2)}
                <br>
                <small>${date} - Category: ${tx.category || 'N/A'}</small>
            `;
            transactionHistoryEl.appendChild(listItem);
        });
    }

    async function handleTransactionSubmit(event) {
        event.preventDefault();
        const amount = parseFloat(transactionAmountEl.value);
        const description = transactionDescriptionEl.value;

        if (isNaN(amount) || amount <= 0) {
            alert('Please enter a valid amount.');
            return;
        }
        if (!description) {
            alert('Please enter a description for the transaction.');
            return;
        }

        try {
            const response = await fetch('/transaction', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ amount, description }),
            });
            const result = await response.json();
            logTransaction(result, amount, description);
            if (result.state) {
                updateStatusUI(result.state);
            }
            transactionAmountEl.value = '';
            transactionDescriptionEl.value = '';
        } catch (error) {
            console.error('Error submitting transaction:', error);
            logTransaction({ success: false, message: 'An unknown error occurred.' });
        }
    }

    async function handleReloadSubmit(event) {
        event.preventDefault();
        const newBudget = parseFloat(reloadAmountEl.value);
        if (isNaN(newBudget) || newBudget <= 0) {
            alert('Please enter a valid new budget amount.');
            return;
        }

        try {
            const response = await fetch('/reload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ newBudget }),
            });
            const result = await response.json();
            logTransaction(result); // Reload doesn't need amount/desc
            if (result.state) {
                updateStatusUI(result.state);
                // After a budget reload, the history is cleared, so update the UI
                updateTransactionHistoryUI(result.state.transactionHistory);
            }
            reloadAmountEl.value = '';
        } catch (error) {
            console.error('Error reloading budget:', error);
            logTransaction({ success: false, message: 'An unknown error occurred during reload.' });
        }
    }

    function logTransaction(result, amount, description) {
        const logItem = document.createElement('li');
        let prefix = '';
        let message = result.message || result.error;

        if (result.success) {
            logItem.className = 'success';
            prefix = `APPROVED ($${amount.toFixed(2)} for "${description}")`;
        } else {
            logItem.className = 'error';
            prefix = `DENIED ($${amount.toFixed(2)} for "${description}")`;
        }
        
        // Use the model's reasoning if available
        if (result.reason) {
            message = result.reason;
        }

        logItem.innerHTML = `<strong>${prefix}:</strong> ${message}`;
        transactionLogEl.prepend(logItem);
    }

    transactionForm.addEventListener('submit', handleTransactionSubmit);
    reloadForm.addEventListener('submit', handleReloadSubmit);

    // Initial status and log fetch
    fetchStatus();
    fetchActivityLog();

    // Set up polling for real-time updates
    setInterval(fetchStatus, 5000);
    setInterval(fetchActivityLog, 5000); // Refresh activity log every 5 seconds
});
