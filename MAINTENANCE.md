# Test Maintenance Process

How we keep the Playwright tests in this repo in sync with the app at `Sammarahmad123/super-member-portal-demo`. Human-driven, agent-assisted, evidence-based.

## Goal

When app developers change user-facing things — testids, page names, button labels, dropdown options, status text — the tests in this repo will break. This process helps a human fix them quickly and safely, with a clear paper trail and without ever silently masking a regression.

## Setup

### App repo: `super-member-portal-demo`

- Static site served by GitHub Pages from a dedicated `gh-pages` branch:
  - Root path → production site (latest `main`).
  - `pr-preview/pr-N/` → a fresh preview per open PR.
- Workflows under `.github/workflows/`:
  - `deploy-main.yml` — push to `main` → deploy to `gh-pages` root.
  - `deploy-pr-preview.yml` — PR open / sync / close → deploy preview, comment URL on PR, dispatch test repo workflow with the preview URL.
- Slash command (lives only in this repo): `.claude/commands/describe-changes.md` → `/describe-changes`.

### Test repo: `memberPortalAutomation` (this repo)

- Playwright tests.
- `.mcp.json` configures the official Playwright MCP server so Claude Code can drive a real browser against the app.
- One CI workflow that runs `npm test`. The BASE_URL it uses depends on the event:
  - Push to `main` → live production URL (default in `playwright.config.js`).
  - `repository_dispatch` from the app repo → preview URL from the dispatch payload.
  - Test repo PR → URL read from a hidden HTML comment in the PR body (see below).
- Slash commands (live only in this repo):
  - `.claude/commands/triage-failures.md` → `/triage-failures`
  - `.claude/commands/apply-fixes.md` → `/apply-fixes`

## The flow

1. **App developer opens a PR** in the app repo with a user-facing change.
2. **Preview deploys.** `deploy-pr-preview.yml` publishes the PR's site under `gh-pages/pr-preview/pr-N/` and comments the URL on the PR.
3. **Tests run against the preview.** The app workflow dispatches this repo's test workflow with the preview URL as payload. Some tests fail.
4. **App developer runs `/describe-changes`** in the app repo. It reads the PR's diff and writes `maintenance/app-change-manifest.md` — a short structured file listing only the things tests care about (renamed testids, renamed pages, renamed labels, removed/new elements, behaviour changes). The developer commits and pushes the manifest to the PR branch.
5. **Tester opens this repo and runs `/triage-failures`.** It:
   - Asks where the manifest is (sibling folder by default, falls back to `gh` fetch from GitHub).
   - Runs `npm test` locally so the failures are fresh.
   - Uses the **Playwright MCP server** to open the live preview and verify each suspected change. If MCP is not available, it falls back to a direct HTML fetch of the preview URL and marks confidence accordingly — every proposed fix in the plan ends with `Verified in live app via MCP: yes/no`.
   - Classifies each failure: explained by manifest, not in manifest but visible in app, or not visible in app at all.
   - Writes `maintenance/triage-plan-<date>.md` with proposed fixes and items flagged for human review.
6. **Tester reads the plan and picks which fixes to approve.**
7. **Tester runs `/apply-fixes`.** It:
   - Asks which triage plan to use (always asks, even if only one exists, because filenames are timestamped).
   - Asks which fixes to apply.
   - Applies only the approved edits.
   - Re-runs `npm test`. If anything still fails, **stops** — no branch, no PR.
   - If green: asks for the app PR's preview URL, creates a `chore/test-maintenance-<date>` branch, commits, pushes, and opens a PR via `gh`. The PR body contains a hidden HTML comment `<!-- app-preview-url: ... -->` so the test repo CI can target the right URL.
8. **Test PR CI runs.** The CI workflow parses the hidden comment from the PR body and uses that URL as `BASE_URL`. Tests run against the app PR's preview — green.
   > Note: this only works for PRs opened by `/apply-fixes` (or any PR whose body contains the hidden comment). PRs opened manually without that comment will silently fall back to the live `main` URL, which usually means the tests will fail until the app PR merges.
9. **Reviewer reads both PRs together.** Manifest, triage plan, and code diff give the full chain of evidence. Reviewer approves both.
10. **Merge both.** App PR merges to `main` → production deploys. Test PR merges to `main` → next run uses the live URL → also green.

## The three slash commands

| Command | Lives in | What it does |
| --- | --- | --- |
| `/describe-changes` | App repo `.claude/commands/describe-changes.md` | Reads git diff, writes `maintenance/app-change-manifest.md` listing only test-relevant changes |
| `/triage-failures` | Test repo `.claude/commands/triage-failures.md` | Runs the tests, compares failures to the manifest, verifies via Playwright MCP, writes `maintenance/triage-plan-<date>.md` |
| `/apply-fixes` | Test repo `.claude/commands/apply-fixes.md` | Applies approved fixes, re-runs tests, opens a PR with the app preview URL embedded in a hidden comment |

## Safety rules (built into the prompts)

The single most important rule:

> **Never loosen an assertion to make a test pass.**
>
> A test assertion is only updated when the manifest explicitly backs the change (e.g. the manifest declares a rename from "Pending" to "Processing"). This is the line that separates legitimate maintenance from silently covering up a regression.

The other rules support that one:

- Every step is human-triggered. No silent runs.
- Each command asks for confirmation (which manifest, which fixes, which preview URL).
- Failures not explained by the manifest are flagged for human review — never auto-fixed.
- `/apply-fixes` will not open a PR if any test is still failing.
- Test maintenance PRs are labelled `chore(tests):` — never `feat` or `fix`.
- All evidence (manifest, triage plan) is committed alongside the changes so the trail is auditable forever.

## Why this design

- **Honest about uncertainty.** When evidence is thin, the agent says "insufficient evidence" and stops. A human is one step away.
- **Evidence-driven, not log-driven.** Manifest + live app via MCP + a fresh local test run. No reasoning from stale CI artefacts.
- **Auditable.** Manifest and triage plan are committed markdown files. Every fix in the test PR cites a manifest entry.
- **Project-generic.** The three slash commands are framework-agnostic in structure. To reuse on another project: copy the commands, set up the same preview deployment pattern, wire the test repo CI to read the hidden URL comment. Done.

## Extending later

Possible next moves, in rough order of value:

1. **Couple the two PRs explicitly.** Comment on the app PR linking the test PR, and use a required check (or Mergify) so neither can merge alone.
2. **`/verify` slash command.** After both PRs merge, run a one-shot check against the live `main` URL to confirm everything is in sync.
3. **Cycle metrics.** Log how long each maintenance cycle takes (from app PR open to both PRs merged) to track value over time.
4. **Live-probing escalation.** When evidence is insufficient, let the agent actively explore the preview via Playwright MCP (try alternative selectors, look for buttons with the same label, etc.) instead of just flagging for human review. Higher signal, higher cost per run.

None of these are required. The core three-command loop is sufficient for the common case.
