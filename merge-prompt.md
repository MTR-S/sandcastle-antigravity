# TASK

Merge the following branches into base branch `{{BASE_BRANCH}}`:

{{BRANCHES}}

IMPORTANT: Never merge into protected branches: {{PROTECTED_BRANCHES}}. Merges are strictly permitted only into `{{BASE_BRANCH}}` or one of its child branches.

Before resolving conflicts, discover and read the Target Repository's domain documentation located at the root of the workspace:
- `AGENTS.md`: Review repository constraints and instructions.
- `CONTEXT.md`: Align conflict resolutions with domain models and glossary terms.
- `CODING_STANDARDS.md`: Adhere to coding standards and test conventions.

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `{{VERIFY_COMMAND}}` to verify everything works (specify `WaitMsBeforeAsync: 60000` in `run_command`)
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
