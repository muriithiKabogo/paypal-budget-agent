# PayPal Budget Agent

This project is an autonomous budget agent built for the PayPal AI Hackathon. It manages a fixed spending budget on behalf of a user, with a web UI to accept transaction requests and display the current budget status. The agent decides whether to approve or deny transactions based on the remaining budget and integrates with the PayPal API to create and verify orders for approved transactions.

## Features

-   **Autonomous Budget Management:** The agent automatically manages a fixed budget, approving or denying transactions based on the available funds.
-   **Web UI:** A simple web interface allows users to submit transaction requests and view the current budget status in real-time.
-   **PayPal Integration:** The agent integrates with the PayPal API to create and verify orders for approved transactions.
-   **Budget Reload:** The agent's budget can be reloaded at any time through the web UI.

## Getting Started

### Prerequisites

-   Node.js and npm
-   A PayPal developer account with API credentials (client ID and secret)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/paypal-budget-agent.git
    ```
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the root of the project and add your PayPal API credentials:
    ```
    PAYPAL_CLIENT_ID=YOUR_CLIENT_ID
    PAYPAL_CLIENT_SECRET=YOUR_CLIENT_SECRET
    ```

### Running the Application

1.  Start the server:
    ```bash
    node src/server.js
    ```
2.  Open your browser and navigate to `http://localhost:3000` to view the web UI.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
