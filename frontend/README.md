# Expense Management Frontend

React 19 + Vite client for the Expense Management app.

## Requirements

- Node.js 18 or later
- The backend API running on http://localhost:5000

## Setup

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build into `dist/`
- `npm run lint` — run ESLint
- `npm run preview` — serve the production build locally

## Configuration

The API base URL is set in `src/services/api.js`. The JWT token is stored in
`localStorage` under `token` and attached as a `Bearer` header on every request.

See the [root README](../README.md) for full setup, including the backend.