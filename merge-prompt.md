# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

IMPORTANT: Never merge into `main`, `homol`, or `developer`. Merges are strictly permitted only into `refractor/ai-main-implementation` or one of its child branches.

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `./mvnw test-compile` and `./mvnw test` to verify everything works (specify `WaitMsBeforeAsync: 60000` in `run_command`)
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
