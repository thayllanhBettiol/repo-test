# Git Graph Visualization

A simple, self-contained Node.js web application for visualizing Git repositories with a focus on the commit graph, local branches, and remotes.

## Features

-   **Graph View**: Visualizes the commit history using `git log --graph` with color-coded branches.
-   **Branch Management**:
    -   Lists all local and remote branches.
    -   Checkout branches (local only).
    -   Rebase local branches onto others (or onto remote branches).
    -   Fetch updates from remotes.
-   **Commit Interaction**:
    -   Amend the last commit (with or without a new message).
    -   Push local branches with `--force-with-lease` safety.

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install express simple-git
    ```

2.  **Run the Server**:
    ```bash
    node server.js
    ```
    The server listens on port **3434**.

## Usage

### Accessing the Interface

Open your browser and navigate to `http://localhost:3434`.

### Repository Path

The application needs to know which directory to inspect.

-   It automatically detects the directory where you ran `node server.js` (this directory is served as `/`).
-   **To inspect another repository**:
    -   Append the path to the URL: `http://localhost:3434/<path>`.
    -   Example: `http://localhost:3434/home/user/my-project`.
    -   **Note**: For security, ensure the served paths are intended and safe.

### Core Actions

-   **Switching Branches**: Select a branch from the "Local Branches" list and click **Switch**. The page will reload showing the new branch state.
-   **Rebasing**:
    1.  Select the branch you want to move (e.g., `feature-a`) from the dropdown.
    2.  Select the target branch (e.g., `master`) to rebase onto.
    3.  Click **Rebase**. Use **Abort** or **Continue** if conflicts arise.
-   **Pushing**:
    1.  Select the branch you want to push.
    2.  Ensure the "Remote" and "Force with Lease" options are set as desired.
    3.  Click **Push**.

## Technical Details

-   **Server**: Node.js with Express.
-   **Git Client**: `simple-git` library for safe Git operations.
-   **File Serving**: Static files (HTML, CSS, JS) are served from the `public` directory.
-   **API Structure**: All operations go through RESTful endpoints (e.g., `/api/checkout`, `/api/rebase`).