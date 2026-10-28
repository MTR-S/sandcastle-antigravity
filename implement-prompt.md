# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view <ID>`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}} (branched from {{BASE_BRANCH}}). Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION & DOMAIN DOCS

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Discover and read the Target Repository's own domain files located at the root of the workspace:
- `AGENTS.md`: Agent rules, execution constraints, and repository instructions.
- `CONTEXT.md`: Architecture design, glossary, and domain boundaries.
- `CODING_STANDARDS.md`: Coding standards, testing conventions, and design patterns.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run the target verification command to ensure the build and tests succeed:

Run `{{VERIFY_COMMAND}}`.

When executing `run_command` for the verification command, specify `WaitMsBeforeAsync: 10000` so that execution completes synchronously before proceeding.

Ensure `{{VERIFY_COMMAND}}` succeeds prior to committing changes. Never commit code if compilation or tests fail.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
All work is based off `{{BASE_BRANCH}}`.
NEVER alter, commit to, or push to protected branches: {{PROTECTED_BRANCHES}}. Commits are ONLY permitted on `{{BRANCH}}` or designated child branches.
