---
description: Run tests, fetch the app change manifest, then triage failures using Playwright MCP
---

# Triage Failures

You are the test maintenance agent. Tests in this repo may be failing because the app team changed something. Your job: run the tests, get the app's change manifest, figure out which failures the manifest explains, propose fixes — but DO NOT apply them yet.

Arguments (optional): $ARGUMENTS
- If a path or URL to the manifest is given, use it directly.
- If a GitHub repo slug is given (like `Sammarahmad123/super-member-portal-demo`), fetch the manifest from that repo.
- If nothing is given, try the steps below in order.

## Step 0: Ask for the target URL

**Before doing anything else**, ask the user:

> "Which URL should I run the tests against?
> - Press Enter to use the default (`BASE_URL` from `playwright.config.js` — the main deployed site)
> - Or paste a PR preview URL (e.g. `https://sammarahmad123.github.io/super-member-portal-demo/pr-preview/pr-6/`)"

Wait for their answer. Record the URL they provide (or note "default" if they skip).

When running `npm test` in Step 2, if they gave a custom URL, prefix the command:

    BASE_URL="<their URL>" npm test

If they chose the default, run `npm test` as-is.

## Step 1: Find the manifest

Try these in order until you find the manifest:

1. If $ARGUMENTS is a local path that exists, use it.
2. Try a sibling folder: `../super-member-portal-demo/maintenance/app-change-manifest.md`. If it exists, use it.
3. If `gh` CLI is installed and the user has a configured app repo (ask them for the repo slug if you do not know it), fetch the manifest:

       gh api repos/<owner>/<repo>/contents/maintenance/app-change-manifest.md --jq .content | base64 -d > /tmp/app-change-manifest.md

   Then use `/tmp/app-change-manifest.md`.
4. If none of the above work, stop and ask the user where the manifest is.

Record the path or URL you ended up using. You will print it in the plan.

## Step 2: Read the manifest

Read it fully so you know what the app team changed.

## Step 3: Run the tests locally

Run:

    npm test

(Or `BASE_URL="<url>" npm test` if the user provided a custom URL in Step 0.)

Wait for the run to finish. Capture the output.

If `npm install` has not been run yet, run it first. If Playwright browsers are missing, run `npx playwright install chromium`.

## Step 4: Read the results

- The console output you just captured
- Anything in `test-results/`
- The Playwright HTML report under `playwright-report/` if present
- The failing test files themselves

## Step 5: Skip flakes

If a test passed on retry, skip it. Mark it in the plan as "skipped — retry-recovered."

## Step 6: Open the live app with Playwright MCP

For each failing test that is not a flake:
- Open the page the test was visiting (use the same URL from Step 0).
- Look for the element the test wanted.
- Compare what you see to the manifest.

## Step 7: Classify each failure

One of:
- **Explained by manifest** — manifest mentions a matching change. Safe to propose a test update.
- **Not in manifest but visible in app** — app shows a change the manifest does not list. Flag for human.
- **Not visible in app** — test fails but app looks fine. Possible flake, timing, or real bug. Flag for human.

## Step 8: Write the triage plan

Save to `maintenance/triage-plan-<today>.md` using this format:

# Triage Plan

**Date:** <today>
**Target URL:** <URL used for npm test — default or custom>
**Manifest source:** <path or URL used>
**Tests run:** <n>
**Tests failed:** <n>
**Safe proposed fixes:** <n>
**Flagged for human review:** <n>
**Skipped (flakes):** <n>

## Summary

One short paragraph.

## Proposed fixes (manifest backs them)

### Test: <name>
- File: <path>
- Line: <n>
- Current code: `<current line>`
- Proposed change: `<new line>`
- Reason: <which manifest entry justifies this>
- Verified in live app via MCP: yes/no

## Flagged for human review

### Test: <name>
- File: <path>
- Failure: <short description>
- Why flagged: <reason>
- Suggested next step: <what the human should check>

## Skipped

- <test name>: retry-recovered (likely flake)

## Step 9: Show summary in chat

5-8 lines:
- Manifest source used
- How many tests ran
- How many failed
- How many have safe proposed fixes
- How many need human review
- Then say: "Plan saved to `maintenance/triage-plan-<today>.md`. To apply fixes, tell me which ones."

## Rules

- Always ask for the target URL (Step 0) before running anything. Never assume the default is correct — the change may only be on a PR preview.
- Always run `npm test` (or `BASE_URL=... npm test`) first. Do not assume past results are still accurate.
- DO NOT edit any test file in this step. Only write the plan.
- Verify every proposed fix by opening the live app via Playwright MCP. If MCP is unavailable, say so and lower confidence.
- Never loosen assertions just to make a test pass. Only update an assertion if the manifest confirms the change.
- If a failure is NOT explained by the manifest, do not propose a fix. Flag it.
- Cite the manifest section for every proposed change.
