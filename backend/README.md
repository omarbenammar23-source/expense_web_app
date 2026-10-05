# Expense Management Backend

Express and MySQL API for the Expense Management application.

## Requirements

- Node.js 18 or later
- MySQL 8 or later

## Setup

1. Install dependencies:

   ~~~bash
   npm install
   ~~~

2. Copy .env.example to .env and provide your local MySQL credentials.

3. Create the expense_management database and required application tables.

4. Start the API:

   ~~~bash
   npm run dev
   ~~~

The server listens on http://localhost:5000 by default.

## Receipt OCR

Receipt scanning uses free local Tesseract OCR. It supports English and French by default through OCR_LANGUAGES=eng+fra. The first scan may download language data; subsequent scans use the local cache.

## Key Routes

- POST /api/auth/register
- POST /api/auth/login
- GET /api/groups
- POST /api/ocr/scan
- POST /api/ocr/scan-and-save

## Security

Never commit .env, receipt uploads, API keys, database passwords, or JWT secrets. Use .env.example as the public configuration template.
