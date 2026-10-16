
const express = require('express');
const path = require('path');
const { handleTransactionRequest, getAgentState, reloadBudget, updateCategories, getAgentActivityLog } = require('./agent');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

app.post('/transaction', async (req, res) => {
    const { amount, description } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'Invalid "amount" in request body.' });
    }
    if (typeof description !== 'string' || description.trim() === '') {
        return res.status(400).json({ error: 'A non-empty "description" is required.' });
    }

    const result = await handleTransactionRequest(amount, description);

    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(400).json(result);
    }
});

app.get('/status', (req, res) => {
    const state = getAgentState();
    res.status(200).json(state);
});

app.get('/activity', (req, res) => {
    const log = getAgentActivityLog();
    res.status(200).json(log);
});

app.post('/reload', (req, res) => {
    const { newBudget } = req.body;
    if (typeof newBudget !== 'number' || newBudget <= 0) {
        return res.status(400).json({ error: 'Invalid "newBudget" in request body.' });
    }
    const result = reloadBudget(newBudget);
    res.status(200).json(result);
});

app.get('/categories', (req, res) => {
    const state = getAgentState();
    res.status(200).json({ allowedCategories: state.allowedCategories });
});

app.put('/categories', (req, res) => {
    const { categories } = req.body;
    if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'Request body must be an object with a "categories" array.' });
    }
    const result = updateCategories(categories);
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(400).json(result);
    }
});

app.listen(port, () => {
    console.log(`PayPal Budget Agent server listening at http://localhost:${port}`);
    console.log(`UI available at http://localhost:${port}`);
});
