# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --label "${SANDCASTLE_LABEL:-ready-for-agent}" --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

The list above has already been filtered to issues ready for work.

# TARGET REPOSITORY CONTEXT & DOMAIN DOCS

Before analyzing issues and constructing the execution plan, discover and read the Target Repository's own domain documentation located at the root of the workspace:
- `AGENTS.md`: Project constraints, identity guidelines, and agent instructions.
- `CONTEXT.md`: Domain architecture overview, glossary, and bounded contexts.
- `CODING_STANDARDS.md`: Code quality rules, testing standards, and design conventions.

Target configuration:
- Base Branch: `{{BASE_BRANCH}}`
- Protected Branches: {{PROTECTED_BRANCHES}}
- Verification Command: `{{VERIFY_COMMAND}}`

All planned feature branches must branch from and target `{{BASE_BRANCH}}`. Never plan direct commits or merges into protected branches ({{PROTECTED_BRANCHES}}).

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
