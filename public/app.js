document.addEventListener('DOMContentLoaded', () => {
    const totalBudgetEl = document.getElementById('total-budget');
    const spentBudgetEl = document.getElementById('spent-budget');
    const remainingBudgetEl = document.getElementById('remaining-budget');
    const transactionForm = document.getElementById('transaction-form');
    const transactionAmountEl = document.getElementById('transaction-amount');
    const reloadForm = document.getElementById('reload-form');
    const reloadAmountEl = document.getElementById('reload-amount');
    const transactionLogEl = document.getElementById('transaction-log');

    async function fetchStatus() {
        try {
            const response = await fetch('/status');
            const data = await response.json();
            updateStatusUI(data);
        } catch (error) {
            console.error('Error fetching status:', error);
        }
    }

    function updateStatusUI(state) {
        totalBudgetEl.textContent = state.budget.toFixed(2);
        spentBudgetEl.textContent = state.currentSpending.toFixed(2);
        remainingBudgetEl.textContent = state.remainingBudget.toFixed(2);
    }

    async function handleTransactionSubmit(event) {
        event.preventDefault();
        const amount = parseFloat(transactionAmountEl.value);
        if (isNaN(amount) || amount <= 0) {
            alert('Please enter a valid amount.');
            return;
        }

        try {
            const response = await fetch('/transaction', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ amount }),
            });
            const result = await response.json();
            logTransaction(result);
            if (result.state) {
                updateStatusUI(result.state);
            }
            transactionAmountEl.value = '';
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
            logTransaction(result);
            if (result.state) {
                updateStatusUI(result.state);
            }
            reloadAmountEl.value = '';
        } catch (error) {
            console.error('Error reloading budget:', error);
            logTransaction({ success: false, message: 'An unknown error occurred during reload.' });
        }
    }

    function logTransaction(result) {
        const logItem = document.createElement('li');
        if (result.success) {
            logItem.className = 'success';
            logItem.textContent = `INFO: ${result.message}`;
        } else {
            logItem.className = 'error';
            logItem.textContent = `ERROR: ${result.message || result.error}`;
        }
        transactionLogEl.prepend(logItem);
    }

    transactionForm.addEventListener('submit', handleTransactionSubmit);
    reloadForm.addEventListener('submit', handleReloadSubmit);

    // Initial status fetch
    fetchStatus();
});