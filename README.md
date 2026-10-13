# PayPal Budget Agent

A simple web service that acts as a budget-conscious agent for PayPal transactions. It uses the Gemini API to categorize transactions and make approval decisions based on a configurable budget and allowed spending categories.

## Features

*   **Budget Management:** Set a total budget and track spending. The agent will deny any transaction that exceeds the remaining budget.
*   **Transaction Categorization:** Uses the Gemini API to intelligently categorize transactions based on their description.
*   **Allowed Spending Categories:** Define a list of allowed spending categories. The agent will deny any transaction that does not fall into one of these categories.
*   **Web UI:** A simple web interface to view the current budget, spending, remaining budget, allowed categories, and transaction history.
*   **REST API:** A simple REST API to manage the agent's state.

## API

### GET /

Returns the HTML for the web UI.

### GET /state

Returns the current state of the agent as a JSON object.

### POST /transaction

Processes a new transaction. The request body should be a JSON object with the following properties:

*   `amount`: The transaction amount (number).
*   `description`: The transaction description (string).

The response will be a JSON object indicating whether the transaction was approved or denied, along with the reason.

### GET /categories

Returns the current list of allowed spending categories as a JSON object.

### PUT /categories

Updates the list of allowed spending categories. The request body should be a JSON object with a single property, `categories`, which is an array of strings.

## Quick Start

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    ```
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file with your PayPal API credentials and Gemini API key:
    ```
    PAYPAL_CLIENT_ID=your-paypal-client-id
    PAYPAL_CLIENT_SECRET=your-paypal-client-secret
    GEMINI_API_KEY=your-gemini-api-key
    ```
4.  Start the server:
    ```bash
    node src/server.js
    ```
5.  Open your browser and navigate to `http://localhost:3000`.
