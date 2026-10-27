# Sandcastle Antigravity (`sandcastle-agy`)

> **Standalone Multi-Agent Orchestrator for Google Antigravity CLI (`agy`), built on top of [`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle).**

---

## Credits & Upstream Acknowledgments

This project is an independent community adaptation and extension built on top of **[`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle)**, created by **[Matt Pocock](https://github.com/mattpocock)** under the [MIT License](./LICENSE).

All credit for the core sandbox orchestration engine, git worktree lifecycle management, the *Parallel Planner with Review* four-phase workflow template (`Plan → Implement → Review → Merge`), and the *Shared Development* philosophy belongs to **Matt Pocock**:
- **Upstream Repository**: [github.com/mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)
- **NPM Package**: [`@ai-hero/sandcastle`](https://www.npmjs.com/package/@ai-hero/sandcastle)
- **Reference Videos by Matt Pocock**:
  - [How I'm Building Software with AI](https://www.youtube.com/watch?v=M6mYodf0dJM)
  - [Building Software with AI / Sandcastle Deep Dive](https://www.youtube.com/watch?v=-QFHIoCo-Ko&t=4169s)

### What This Adaptation (`MTR-S/sandcastle-antigravity`) Adds

1. **Google Antigravity CLI (`agy`) Agent Provider ([`antigravity.ts`](./antigravity.ts))**: Native implementation of the Sandcastle `AgentProvider` contract for `agy --output-format stream-json`, supporting role-scoped model routing (`PLANNER_MODEL`, `IMPLEMENTER_MODEL`, `REVIEWER_MODEL`, `MERGER_MODEL`) and reasoning effort levels (`low`, `medium`, `high`).
2. **Host OAuth Session Bridge ([`auth-preflight.ts`](./auth-preflight.ts) & [`entrypoint.sh`](./entrypoint.sh))**: Bridges your authenticated Google Antigravity OAuth session from the Windows Credential Manager (`gemini:antigravity`) strictly in memory into a headless Linux D-Bus + GNOME Keyring Secret Service inside the Docker sandbox—eliminating static API keys (`GEMINI_API_KEY`).
3. **Standalone Multi-Repository CLI (`sandcastle-agy`)**: Designed to run externally against any local Java or Node/TypeScript repository with an interactive pre-run configuration summary, dynamic Git/GitHub identity injection, and built-in container/worktree rescue utilities.

See [`NOTICE.md`](./NOTICE.md) and [`LICENSE`](./LICENSE) for full attribution details.

---

## Architecture & Domain Documentation

- **[`CONTEXT.md`](./CONTEXT.md)**: Canonical domain glossary (*Target Repository*, *Host OAuth Session Bridge*, *Phase Pipeline*, *Base Branch*, *Protected Branches*, *Verification Command*, *Pre-Run Configuration Banner*).
- **[`docs/adr/0001-host-oauth-session-bridge.md`](./docs/adr/0001-host-oauth-session-bridge.md)**: Architectural Decision Record for Cross-OS Keyring Bridging & Phase-Scoped Models.
- **[`docs/adr/0002-standalone-multi-repo-cli.md`](./docs/adr/0002-standalone-multi-repo-cli.md)**: Architectural Decision Record for the Standalone Multi-Repo CLI & Interactive Pre-Run Inspection.
- **[`docs/PRD.md`](./docs/PRD.md)**: Product Requirements Document & Ticket Breakdown for the standalone CLI transition.

---

## Quick Verification (Seed Repository)

```bash
npm install
npm run typecheck
npm run test:unit
```

## License

[MIT](./LICENSE) — Copyright (c) 2026 Matt Pocock & Copyright (c) 2026 MTR-S.
