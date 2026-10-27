# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view <ID>`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run Maven verification commands to ensure the build and tests succeed:

1. Run `./mvnw test-compile` to verify that all code compiles without errors.
2. Run `./mvnw test` to execute the automated test suite and ensure all tests pass.

When executing `run_command` for `./mvnw` commands, specify `WaitMsBeforeAsync: 10000` so that execution completes synchronously before proceeding.

Ensure both `./mvnw test-compile` and `./mvnw test` succeed prior to committing changes. Never commit code if compilation or tests fail.

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
NEVER alter, commit to, or push to `main`, `homol`, or `developer`. Commits are ONLY permitted on `refractor/ai-main-implementation` or designated child branches.
