# Termbook

Termbook is a notebook-style terminal interface.

## Quick Start

### Backend
```bash
cd backend
npm install
node server.js
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Testing

### E2E Verification
We have a comprehensive E2E verification test suite.
```bash
cd frontend
npx playwright test tests/e2e_verification.spec.js -c playwright.custom.config.js
```
