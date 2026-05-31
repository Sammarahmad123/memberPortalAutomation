---
description: Apply fixes from a chosen triage plan, re-run tests, and open a PR if green
---

# Apply Fixes

You are the test maintenance agent. The user has reviewed a triage plan and wants you to apply specific fixes, re-run the tests, and open a PR for the test updates.

## Step 1: Always ask which triage file to use

Triage plans can have date or timestamp suffixes (for example `triage-plan-2026-05-30.md`, `triage-plan-2026-05-31-10-59.md`), so multiple may exist.

Do this every time, even if only one file exists:

1. List all files in `maintenance/` matching `triage-plan-*.md`.
2. For each file, show:
   - The filename
   - The modification time (most recent first)
3. If $ARGUMENTS already contains a valid file path, confirm: "Use this triage plan: <path>? (yes/no)"
4. If no argument given, ask: "Which triage plan do you want me to apply? Reply with the filename, the number from the list, or a full path."
5. If no triage plan files exist, stop and tell the user to run `/triage-failures` first.

Never auto-pick. Always wait for the user's choice.

## Step 2: Read the chosen plan

Read the file. Confirm in chat: "Using triage plan: <path>"

## Step 3: Show me the proposed fixes

List every entry under "Proposed fixes" with a short ID (1, 2, 3...) and:
- ID: <number>
- Test: <test title>
- File: <path>
- Current: <current code>
- Proposed: <new code>
- Reason: <manifest entry that justifies it>

Do NOT show the "Flagged for human review" or "Skipped" sections.

## Step 4: Ask which fixes to apply

Ask: "Which fixes do you want me to apply? Reply with numbers (e.g. `1, 3, 5`), `all`, or `none`."

Wait. Do not assume.

## Step 5: Confirm clean working tree before changing anything

Run `git status` first. If there are uncommitted changes that are NOT test files in the approved fix list, stop and ask the user:
"Your working tree has unrelated uncommitted changes. Stash them or commit them before I continue. Continue anyway? (yes/no)"

Only proceed if the user says yes.

## Step 6: Apply only the approved fixes

For each approved fix:
- Open the file from the plan.
- Find the line that matches the "Current code" exactly.
- Replace it with the "Proposed change" exactly.
- Save.

If the line cannot be found exactly, skip that fix, tell the user, and continue with the rest.

## Step 7: Re-run the tests

Run:

    npm test

Capture the output.

## Step 8: Decide whether to continue to PR

- If any tests still fail, STOP. Report the failures (see Step 9) but DO NOT create a branch and DO NOT open a PR. Tell the user: "Tests still failing. Not opening a PR. Review failures below and decide next step."
- If all tests pass AND at least one fix was applied, continue to Step 10.
- If no fixes were applied (user said `none`, or every fix was skipped), STOP. Do not branch, commit, or PR.

## Step 9: Report the result

In chat:
- Which triage plan you used
- Which fixes were applied
- Which fixes were skipped and why
- How many tests passed
- How many tests still fail
- For each remaining failure, show the test name and a one-line error

## Step 10: Create a branch, commit, push, open a PR

Only reach this step if all tests pass and at least one fix was applied.

1. Pick a branch name in this format: `chore/test-maintenance-<YYYY-MM-DD>`. If a branch with that name already exists locally or on origin, add a short timestamp suffix to make it unique (e.g. `chore/test-maintenance-2026-05-31-1430`).
2. Create the branch from the current HEAD:

       git checkout -b <branch>

3. Stage only the test files that were modified by the approved fixes:

       git add <each modified file>

4. Commit with this message:

       chore(tests): apply test maintenance fixes from <triage plan filename>

5. Push:

       git push -u origin <branch>

6. Build the PR body. Write it to a temp file using a heredoc so there are no quoting traps:

       cat > /tmp/apply-fixes-pr-body.md <<'EOF'
       This PR updates tests to match the latest app changes.

       Source:
       - Triage plan: maintenance/<triage plan filename>
       - Applied fix IDs: <list>

       Verification:
       - npm test was run after applying the fixes
       - All tests pass locally on this branch

       Reviewer notes:
       - Each change matches an entry in the manifest the app team produced
       - No assertions were loosened. Selectors and labels were only updated where the app surface changed
       EOF

7. Open the PR using gh:

       gh pr create \
         --base main \
         --head <branch> \
         --title "chore(tests): apply test maintenance fixes from <triage plan filename>" \
         --body-file /tmp/apply-fixes-pr-body.md

8. Print the PR URL in chat.

## Rules

- Always ask which triage plan to use. Never auto-pick.
- Only touch test files named in the approved fixes.
- Do NOT modify the manifest, the triage plan, or any source file in the app repo.
- Do NOT open a PR if any test is failing after the fixes.
- Never loosen an assertion just to make a test pass.
- If the user replies "none" at step 4, stop and do not change anything.
- The branch name pattern is `chore/test-maintenance-<YYYY-MM-DD>`. Test repo maintenance is "chore", not "feat" or "fix".
