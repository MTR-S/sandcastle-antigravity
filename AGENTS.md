## Constraints

### GitHub identity & SSH

All Git and `gh` CLI operations in this repository MUST use the **MTR-S** personal GitHub account and its dedicated SSH key configured on the host machine.
- Before running any `gh` CLI command for this repository, verify the active account with `gh auth status`. If a different account (such as a work account) is active, switch with `gh auth switch --user MTR-S`.
- Never use work credentials, work emails, or work GitHub accounts in commits, issues, or pull requests for `MTR-S/sandcastle-antigravity`.

### Repository scope

Agents working in this repository MUST scope all repository changes, issues, and pull requests strictly to **`MTR-S/sandcastle-antigravity`**.

### Attribution preservation

Always preserve the upstream attribution and MIT copyright notices crediting **Matt Pocock** and [`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle) in `LICENSE`, `NOTICE.md`, and `README.md`.

### Domain & Architecture documentation

- Domain glossary lives in [`CONTEXT.md`](./CONTEXT.md).
- Architectural decisions live in [`docs/adr/`](./docs/adr/).
- Product roadmap and ticket specifications live in [`docs/PRD.md`](./docs/PRD.md).

## Agent skills

### Issue tracker

GitHub issues at `MTR-S/sandcastle-antigravity`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo (`CONTEXT.md` / `docs/adr/`). See `docs/agents/domain.md`.

