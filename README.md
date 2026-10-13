# PayPal Budget Agent

This agent manages a predefined budget and approves or denies transactions based on the remaining funds. It's designed to be a simple, autonomous agent that can be used as a starting point for more complex financial agents.

This project was created as a submission for an AI hackathon.

## Features

-   **Budget Management:** The agent has a fixed budget and keeps track of its spending.
-   **Transaction Handling:** It can approve or deny transactions based on the available budget.
-   **PayPal Integration (Simulated):** The agent simulates creating and verifying PayPal orders.
-   **Web UI:** A simple web interface to view the agent's status and submit transactions.

## Quick Start

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd paypal-budget-agent
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the agent:**
    ```bash
    node src/server.js
    ```

4.  **Open the Web UI:**
    Open your web browser and navigate to `http://localhost:3000`.

## Web UI

The web UI provides a simple interface to interact with the agent.

-   **Current Status:** Displays the total budget, the amount spent, and the remaining balance. The status polls the server every 5 seconds to provide live updates.
-   **New Transaction:** A form to submit a new transaction. Enter an amount and click "Submit".
-   **Transaction Log:** A running list of all transaction requests and their outcomes (approved or denied).

## API Endpoints

You can also interact with the agent directly via its API:

### `GET /status`

Returns the current state of the agent's budget.

**Example Response:**

```json
{
  "budget": 100,
  "currentSpending": 25.5,
  "remainingBudget": 74.5
}
```

### `POST /transaction`

Submits a new transaction request.

**Request Body:**

```json
{
  "amount": 10.50
}
```

**Success Response (Approved):**

```json
{
  "success": true,
  "message": "Transaction approved. Verified PayPal Order ID: 2XF36472Y1125264L"
}
```

**Error Response (Denied):**

```json
{
  "success": false,
  "message": "Transaction denied. Amount exceeds remaining budget."
}
```
