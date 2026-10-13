document.addEventListener('DOMContentLoaded', () => {
    const totalBudgetEl = document.getElementById('total-budget');
    const spentBudgetEl = document.getElementById('spent-budget');
    const remainingBudgetEl = document.getElementById('remaining-budget');
    const transactionForm = document.getElementById('transaction-form');
    const transactionAmountEl = document.getElementById('transaction-amount');
    const transactionLogEl = document.getElementById('transaction-log');

    async function fetchStatus() {
        try {
            const response = await fetch('/status');
            const data = await response.json();
            totalBudgetEl.textContent = data.budget.toFixed(2);
            spentBudgetEl.textContent = data.currentSpending.toFixed(2);
            remainingBudgetEl.textContent = data.remainingBudget.toFixed(2);
        } catch (error) {
            console.error('Error fetching status:', error);
        }
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
            fetchStatus();
            transactionAmountEl.value = '';
        } catch (error) {
            console.error('Error submitting transaction:', error);
            logTransaction({ success: false, message: 'An unknown error occurred.' });
        }
    }

    function logTransaction(result) {
        const logItem = document.createElement('li');
        if (result.success) {
            logItem.className = 'success';
            logItem.textContent = `APPROVED: ${result.message}`;
        } else {
            logItem.className = 'error';
            logItem.textContent = `DENIED: ${result.message}`;
        }
        transactionLogEl.prepend(logItem);
    }

    transactionForm.addEventListener('submit', handleTransactionSubmit);

    // Initial status fetch and then poll every 5 seconds
    fetchStatus();
    setInterval(fetchStatus, 5000);
});