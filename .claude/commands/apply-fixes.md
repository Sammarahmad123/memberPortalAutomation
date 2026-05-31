---
description: Apply fixes from a chosen triage plan, re-run tests, and open a PR pinned to the app PR's preview URL
---

# Apply Fixes

You are the test maintenance agent. The user has reviewed a triage plan and wants you to apply specific fixes, re-run tests, and open a PR for the test updates. The PR must record which app PR's preview URL the tests should run against in CI.

## Step 1: Always ask which triage file to use

Triage plans can have date or timestamp suffixes (for example `triage-plan-2026-05-30.md`), so multiple may exist.

Every time:
1. List all files in `maintenance/` matching `triage-plan-*.md`, newest first, with modification times.
2. If $ARGUMENTS contains a valid path, confirm: "Use this triage plan: <path>? (yes/no)"
3. If no argument given, ask: "Which triage plan? Reply with filename, number from the list, or a full path."
4. If none exist, stop and tell the user to run `/triage-failures` first.

Never auto-pick. Always wait.

## Step 2: Read the chosen plan

Read it. Confirm: "Using triage plan: <path>"

## Step 3: Show the proposed fixes

List every entry under "Proposed fixes" with a short ID (1, 2, 3...) and:
- ID, Test, File, Current code, Proposed change, Reason.
Do NOT show "Flagged for human review" or "Skipped".

## Step 4: Ask which fixes to apply

Ask: "Which fixes? Reply with numbers (e.g. `1, 3, 5`), `all`, or `none`."

Wait. Do not assume.

## Step 5: Check working tree

Run `git status`. If there are unrelated uncommitted changes, ask: "Working tree has unrelated changes. Continue? (yes/no)" and wait.

## Step 6: Apply approved fixes

For each approved fix:
- Open the file from the plan.
- Find the line matching the "Current code" exactly.
- Replace with the "Proposed change" exactly.
- Save.

If a line cannot be found, skip and report, continue with the rest.

## Step 7: Re-run the tests

Run:

    npm test

Capture output.

## Step 8: Decide whether to open a PR

- If any test still fails: STOP. Report failures. Do NOT branch or open a PR.
- If no fixes applied (user said `none`, or all skipped): STOP. Do not branch.
- If all tests pass AND at least one fix applied: continue.

## Step 9: Ask for the app PR's preview URL

Ask the user:
"What is the app PR's preview URL? This will be embedded in the test PR body so CI runs against the app PR, not the live main URL. Paste the URL, or reply `none` to use the default live URL."

The URL usually looks like:
`https://sammarahmad123.github.io/super-member-portal-demo/pr-preview/pr-<N>/`

Also ask (optional):
"What is the app PR's URL on GitHub? (so reviewers can jump to it from the test PR). Paste it or `none`."

Wait for both answers.

## Step 10: Branch, commit, push, open PR

1. Pick branch name: `chore/test-maintenance-<YYYY-MM-DD>`. If it already exists, add a short time suffix like `-1430`.
2. Create the branch:

       git checkout -b <branch>

3. Stage only the test files modified by the approved fixes.
4. Commit:

       git commit -m "chore(tests): apply test maintenance fixes from <triage plan filename>"

5. Push:

       git push -u origin <branch>

6. Write the PR body to a temp file. Include the preview URL as a hidden HTML comment so the CI workflow can parse it. Use a heredoc:

       cat > /tmp/apply-fixes-pr-body.md <<'EOF'
       <!-- app-preview-url: __APP_PREVIEW_URL__ -->
       <!-- app-pr-url: __APP_PR_URL__ -->

       This PR updates tests to match the latest app changes.

       Source:
       - Triage plan: maintenance/<triage plan filename>
       - Applied fix IDs: <list>
       - App PR: __APP_PR_URL__
       - App PR preview URL (CI target): __APP_PREVIEW_URL__

       Verification:
       - npm test was run locally after applying the fixes — all tests passed.

       Reviewer notes:
       - Each change matches an entry in the manifest the app team produced.
       - No assertions were loosened. Selectors and labels were only updated where the app surface changed.
       - CI on this PR runs against the app PR's preview URL (parsed from the hidden comment above). If the comment is missing, CI falls back to the live main URL.
       EOF

   Then replace the placeholders in that file:
   - `__APP_PREVIEW_URL__` → the preview URL the user gave (or empty string if `none`).
   - `__APP_PR_URL__` → the app PR URL (or empty string if `none`).

   Use sed or read/write the file in your script.

7. Open the PR:

       gh pr create \
         --base main \
         --head <branch> \
         --title "chore(tests): apply test maintenance fixes from <triage plan filename>" \
         --body-file /tmp/apply-fixes-pr-body.md

8. Print the PR URL in chat.

## Rules

- Always ask which triage plan to use. Never auto-pick.
- Only touch test files named in the approved fixes.
- Never modify the manifest, the triage plan, or any source file in the app repo.
- Never open a PR if any test is failing.
- Never loosen an assertion to make a test pass.
- The hidden HTML comments `<!-- app-preview-url: ... -->` and `<!-- app-pr-url: ... -->` in the PR body MUST appear exactly in that format — the CI workflow parses them.
- If the user replies `none` for the preview URL, still include the comment but with an empty value, so CI knows to use the default.
