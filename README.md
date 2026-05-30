# REST Super Member Portal — Automated Tests

Playwright test suite for the [super-member-portal-demo](../super-member-portal-demo) static site.

## Automated tests

Install dependencies and run the full test suite:

```bash
npm install && npx playwright install chromium && npm test
```

The webServer block in `playwright.config.js` automatically starts `http-server` serving `../super-member-portal-demo` on port 3000 before the tests run, so no manual server setup is needed.

### Additional run modes

```bash
npm run test:headed   # run with visible browser
npm run test:ui       # open Playwright UI mode
```

## Structure

```
tests/
  fixtures.js            # shared loggedInPage fixture
  login.spec.js
  dashboard.spec.js
  contribution.spec.js
  transactions.spec.js
  member-details.spec.js
```

## Site credentials (demo only)

- Email: `sarah.chen@restsuper.com.au`
- Password: `Demo2026!`
