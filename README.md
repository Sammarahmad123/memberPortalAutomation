# REST Super Member Portal — Automated Tests

Playwright E2E test suite for [REST Super Member Portal](https://sammarahmad123.github.io/super-member-portal-demo/).

## Running the tests

Against the deployed GitHub Pages site (default):

    npm install
    npx playwright install chromium
    npm test

Against a local copy of the site for development:

    BASE_URL=http://localhost:3000/ npm test

The trailing slash on BASE_URL matters for relative path resolution.

## Continuous Integration

A GitHub Actions workflow (.github/workflows/test.yml) runs the
full suite on every push to main, every pull request, and on
manual dispatch. The Playwright HTML report is uploaded as an
artifact on every run; traces are uploaded only on failure.

## Structure

```
tests/
  fixtures.js   # shared loggedInPage fixture
  e2e.spec.js   # 5 end-to-end tests
```

## Site credentials (demo only)

- Email: `sarah.chen@restsuper.com.au`
- Password: `Demo2026!`
