
const express = require('express');
const cors = require('cors');
// Correctly import verifyPayout from the updated paypal.js
const { verifyPayout } = require('./paypal.js');

const app = express();
const port = 4000;

const funFacts = [
    "A single cloud can weigh more than 1 million pounds.",
    "A human will eat on average 70 assorted insects and 10 spiders while sleeping.",
    "A bolt of lightning is six times hotter than the sun.",
    "A crocodile can't stick its tongue out.",
    "A shrimp's heart is in its head.",
    "It is physically impossible for pigs to look up into the sky.",
];

app.use(cors());
app.use(express.json());

app.get('/fact', async (req, res) => {
    // Use 'paymentId' to match what the agent sends in the autonomousPurchase function
    const { paymentId } = req.query;

    if (!paymentId) {
        return res.status(402).json({
            error: "Payment Required",
            price: 0.25,
            currency: "USD",
            // Update the requiredProof to reflect the change
            requiredProof: "paypal_payout_id",
        });
    }

    // Call the new verification function for Payouts
    const payoutDetails = await verifyPayout(paymentId);
    
    // *** MODIFIED FOR PRODUCTION ***
    // Log the full details to understand the structure and status
    // console.log("Full Payout Details from PayPal:", JSON.stringify(payoutDetails, null, 2));

    const status = payoutDetails && payoutDetails.batch_header ? payoutDetails.batch_header.batch_status : null;

    // A Payout is considered valid for this purpose if it's either just been created ('PENDING')
    // or has been fully processed ('SUCCESS'). This accounts for the small delay in PayPal's system.
    if (status === 'SUCCESS' || status === 'PENDING') {
        const fact = funFacts[Math.floor(Math.random() * funFacts.length)];
        return res.status(200).json({
            fact: fact,
            payoutId: paymentId,
        });
    } else {
        return res.status(403).json({
            error: "Invalid Payment",
            message: `The provided PayPal Payout ID has a status of '${status}' and could not be accepted.`,
        });
    }
});

app.listen(port, () => {
    console.log(`Vendor server listening at http://localhost:${port}`);
});
