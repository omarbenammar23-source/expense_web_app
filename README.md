# Expense Management App

Receipt-scanning expense tracker with shared groups and supervisor oversight.

- **`backend/`** — Express 5 + MySQL API. JWT auth, receipt OCR, expense and
  group management, fraud detection, Excel export.
- **`frontend/`** — React 19 + Vite client. Login/register, dashboard, group hub,
  receipt scanning, supervisor dashboard. English, French and Arabic UI.

## Requirements

- Node.js 18 or later
- MySQL 8 or later

## Getting started

The two packages run independently. Start the API first.

### 1. Database

Create the database, then apply the migrations in
`backend/migrations/` in filename order:

```bash
mysql -u root -p -e "CREATE DATABASE expense_management;"
mysql -u root -p expense_management < backend/migrations/2026-04-04-add-is-suspicious-to-expenses.sql
```

### 2. Backend

```bash
cd backend
npm install
```

Copy `.env.example` to `.env` and fill in your local MySQL credentials and a
long random `JWT_SECRET`.

The upload directory is not tracked in git, so create it once before starting
the server — multer does not create it and upload routes will fail without it:

```bash
mkdir uploads
```

Then start the API:

```bash
npm run dev
```

It listens on http://localhost:5000.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The client calls `http://localhost:5000/api` (see `frontend/src/services/api.js`).

## Receipt OCR

Scanning uses free local Tesseract OCR, English and French by default via
`OCR_LANGUAGES=eng+fra`. The first scan downloads language data into the working
directory; later scans reuse that cache.

Setting `GOOGLE_CLOUD_VISION_API_KEY` optionally enables public web receipt
matching. It is not required.

## Key routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/groups`
- `POST /api/ocr/scan`
- `POST /api/ocr/scan-and-save`

## Security

`.env`, receipt uploads, API keys, database passwords and JWT secrets are
excluded from this repository via `.gitignore`. `.env.example` is the public
configuration template. Do not commit real credentials.