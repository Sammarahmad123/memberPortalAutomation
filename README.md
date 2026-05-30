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

## AI Maintenance Agent

Phase 3A+ is analysis/reporting only. On failed Playwright runs it collects
structured evidence, asks Gemini for a locked-schema diagnosis, and writes:

- `maintenance/manifests/latest-change-manifest.json`
- `maintenance/reports/latest-maintenance-report.md`

Local zero-cost smoke test:

    npm run ai:maintenance:dry-run

GitHub Actions behaviour:

- Green runs skip Gemini and write a no-failures manifest/report.
- Failed runs capture Playwright JSON/output, failure targets, trace summary,
  scoped code context, optional live UI evidence, and Gemini analysis artifacts.
- PR runs never deploy GitHub Pages.
- `repository_dispatch` and `workflow_dispatch` still deploy only the
  Playwright report to this automation repo's GitHub Pages.

Maintenance artifact evidence files:

- `playwright-report.json` — structured Playwright JSON report.
- `playwright-output.txt` — human-readable Playwright output fallback.
- `failure-targets.json` — failed/flaky test targets extracted from JSON.
- `trace-summary.json` — parsed trace zip metadata when traces are present.
- `code-context-summary.json` — scoped automation files related to failures.
- `live-ui/page-summary.json` and `live-ui/html/*.html` — fallback live UI observations.
- `app-diff.txt` — optional application diff supplied by an upstream workflow.

## Site credentials (demo only)

- Email: `sarah.chen@restsuper.com.au`
- Password: `Demo2026!`
