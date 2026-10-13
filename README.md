# PayPal Budget Agent

This autonomous agent manages a predefined budget using the PayPal Sandbox API. It demonstrates agentic commerce by enforcing spending limits and making real-time decisions on simulated transactions.

## Features

*   **Budget Enforcement:** Monitors spending and prevents transactions that would exceed a set budget.
*   **Autonomous Operation:** Runs as a background process, continuously monitoring for new transactions.
*   **PayPal Integration:** Connects to the PayPal Sandbox to authenticate and (soon) process real transactions.

## Setup & Running

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Configure Environment:**
    Create a `.env` file in the root directory with your PayPal Sandbox credentials:
    ```
    PAYPAL_CLIENT_ID=YOUR_CLIENT_ID
    PAYPAL_CLIENT_SECRET=YOUR_CLIENT_SECRET
    ```
3.  **Run the Agent:**
    ```bash
    node src/index.js
    ```
