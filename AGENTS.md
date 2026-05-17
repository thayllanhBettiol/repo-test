# Git Dashboard - Agent Context

This document provides context and instructions for AI agents interacting with this repository.

## Project Overview
Git Dashboard is a lightweight, local web-based application designed to manage, visualize, and interact with Git repositories. It provides a UI to view branches, logs, graphs, and perform quick actions like checking out branches, rebasing, amending commits, and pushing.

## Tech Stack
- **Backend:** Node.js, Express
- **Git Interaction:** `simple-git` package and native `child_process` (for some raw git commands)
- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6+), with no build step.

## Running the Project
- **Install dependencies:** `npm install`
- **Run server:** `npm start` (or `npm run dev` for watch mode)
- **Access UI:** Open `http://localhost:3434` in a browser.

## Architecture

### Backend (`server.js`)
- An Express server that acts as a REST-like API for Git operations.
- **Endpoints:**
  - `GET /api/status`, `GET /api/log`, `GET /api/graph`, `GET /api/diff`
  - `POST /api/checkout`, `POST /api/rebase`, `POST /api/rebase-abort`, `POST /api/rebase-continue`, `POST /api/amend`, `POST /api/push`, `POST /api/fetch`
- Requires an absolute path to a local repository to be passed to these endpoints (usually as `?repo=<path>` or in the JSON body).

### Frontend (`public/`)
- **`index.html`:** The structure of the application.
- **`style.css`:** Styling for the dashboard.
- **`app.js`:** The core frontend logic. It manages state, fetches data from the backend API, updates the DOM, and handles user interactions.
- The frontend uses `fetch` to communicate with the backend.

## AI Agent Directives
1. **Frontend Modifications:** The frontend does not use a bundler or a framework (like React or Vue). All DOM manipulation is done directly in `app.js`. Ensure you maintain this vanilla approach.
2. **Backend Modifications:** The backend uses `simple-git` for most commands. If a command is too complex or not well-supported by `simple-git`, the project falls back to `execFile` (e.g., for the git graph generation and rebase commands).
3. **Security:** This application is intended to be run locally and executes arbitrary git commands based on user input. It relies on the local user environment and does not have robust authentication or path sanitization.
4. **Styling:** Keep styling scoped to the existing classes in `style.css`. Avoid inline styles unless absolutely necessary for dynamic layout calculations.
