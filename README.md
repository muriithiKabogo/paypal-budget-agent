# PayPal Budget Agent

This project implements an autonomous agent that manages a predefined budget by interacting with the PayPal API. It runs as a web service that can approve or deny transactions based on its budget constraints.

## Features

- **Budget Enforcement:** The agent maintains a fixed budget and will not approve transactions that exceed the remaining balance.
- **PayPal Integration:** Creates real PayPal Sandbox orders for approved transactions.
- **Order Verification:** Includes a crucial verification step where every created order is re-fetched from the PayPal API to confirm its status before the agent's internal state is updated.
- **API Interface:** Exposes simple REST endpoints to check the agent's status and request new transactions.

## Prerequisites

- Node.js
- npm

## Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Conway-Research/automaton.git
    cd automaton
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create an environment file:**
    Create a file named `.env` in the root of the project and add your PayPal Sandbox API credentials:
    ```
    PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID
    PAYPAL_CLIENT_SECRET=YOUR_SANDBOX_CLIENT_SECRET
    ```

## Running the Agent

Start the server using the following command:

```bash
node src/server.js
```

The server will start on port 3000 and you should see a confirmation message in the console.

## API Endpoints

### 1. Get Agent Status

-   **URL:** `/status`
-   **Method:** `GET`
-   **Description:** Retrieves the current financial state of the agent.
-   **Example:**
    ```bash
    curl http://localhost:3000/status
    ```
-   **Success Response:**
    ```json
    {
        "budget": 100,
        "currentSpending": 0,
        "remainingBudget": 100
    }
    ```

### 2. Request a Transaction

-   **URL:** `/transaction`
-   **Method:** `POST`
-   **Description:** Submits a new transaction request for the agent to approve. If approved, a PayPal order is created and verified.
-   **Body:**
    ```json
    {
        "amount": 25.50
    }
    ```
-   **Example:**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{"amount": 25.50}' http://localhost:3000/transaction
    ```
-   **Success Response:**
    ```json
    {
        "success": true,
        "message": "Successfully processed and verified PayPal order YOUR_ORDER_ID with status CREATED.",
        "orderId": "YOUR_ORDER_ID",
        "verifiedStatus": "CREATED",
        "state": {
            "budget": 100,
            "currentSpending": 25.5,
            "remainingBudget": 74.5
        }
    }
    ```
-   **Failure Response (Exceeds Budget):**
    ```json
    {
        "success": false,
        "message": "DENIED: Transaction of $80.00 would exceed the budget.",
        "state": {
            "budget": 100,
            "currentSpending": 25.5,
            "remainingBudget": 74.5
        }
    }
    ```
