
const express = require('express');
const path = require('path');
const { handleTransactionRequest, getAgentState } = require('./agent'); // Renaming index to agent for clarity

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(express.json());

// Endpoint to handle a new transaction request
app.post('/transaction', async (req, res) => {
    const { amount } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'Invalid "amount" in request body. Must be a positive number.' });
    }

    const result = await handleTransactionRequest(amount);

    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(400).json(result);
    }
});

// Endpoint to get the current state of the agent (budget, spending)
app.get('/status', (req, res) => {
    const state = getAgentState();
    res.status(200).json(state);
});

app.listen(port, () => {
    console.log(`PayPal Budget Agent server listening at http://localhost:${port}`);
    console.log('Endpoints:');
    console.log('  GET /status         - Check the agent\'s current budget and spending.');
    console.log('  POST /transaction   - Request a new transaction. Body: { "amount": 10.50 }');
    console.log(`UI available at http://localhost:${port}`);
});
