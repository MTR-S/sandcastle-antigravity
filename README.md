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
3. **Standalone Multi-Repository CLI (`sandcastle-agy`)**: Designed to run externally against any local Java or Node/TypeScript target repository with an interactive pre-run configuration summary, dynamic Git/GitHub identity injection, zero-footprint target repository guarantees, and built-in container/worktree rescue utilities.

See [`NOTICE.md`](./NOTICE.md) and [`LICENSE`](./LICENSE) for full attribution details.

---

## Architecture & Domain Documentation

- **[`CONTEXT.md`](./CONTEXT.md)**: Canonical domain glossary (*Target Repository*, *Host OAuth Session Bridge*, *Phase Pipeline*, *Base Branch*, *Protected Branches*, *Verification Command*, *Pre-Run Configuration Banner*).
- **[`docs/adr/0001-host-oauth-session-bridge.md`](./docs/adr/0001-host-oauth-session-bridge.md)**: Architectural Decision Record for Cross-OS Keyring Bridging & Phase-Scoped Models.
- **[`docs/adr/0002-standalone-multi-repo-cli.md`](./docs/adr/0002-standalone-multi-repo-cli.md)**: Architectural Decision Record for the Standalone Multi-Repo CLI & Interactive Pre-Run Inspection.
- **[`docs/PRD.md`](./docs/PRD.md)**: Product Requirements Document & Ticket Breakdown for the standalone CLI transition.
- **[`docs/HOW_TO_TEST.md`](./docs/HOW_TO_TEST.md)**: Step-by-Step Testing & Onboarding Guide (Full walkthrough from scratch for testing on any local project).

---

## 🚀 Quick Start: Using `sandcastle-agy` from Scratch

Want to test `sandcastle-agy` on your local projects right away?

> [!TIP]
> 📖 **[Read the Complete Step-by-Step Testing Guide (`docs/HOW_TO_TEST.md`)](./docs/HOW_TO_TEST.md)**  
> *(Guia didático passo a passo completo disponível em Português e Inglês com exemplos para Node/TS e Java Maven/Gradle).*

### At a Glance (3 Simple Steps):

1. **Install & Link Globally** (run once inside `sandcastle-antigravity`):
   ```bash
   npm install
   npm run build-image
   npm link
   ```

2. **Diagnose Your Target Project (`doctor`)**:
   Verify that your host environment and target repository meet all prerequisites:
   ```bash
   sandcastle-agy doctor --repo /path/to/target-project
   ```

3. **Launch the Autonomous Multi-Agent Loop (`run`)**:
   Run against any local Git repository with an open issue labeled `ready-for-agent`:
   ```bash
   sandcastle-agy run --repo /path/to/target-project
   ```
   An interactive **Pre-Run Configuration Banner** will confirm or allow you to customize all parameters (Git identity, Base branch, test command, AI models) before launching Docker containers.

---

## Installation & Distribution Guide

### Prerequisites

- **Node.js**: v22.0.0 or higher
- **Docker**: Docker Desktop or Docker Engine running locally
- **Google Antigravity CLI**: `agy` installed and authenticated on host (`agy login`)
- **GitHub CLI**: `gh` installed and authenticated (`gh auth login` / `gh auth status`)
- **Git**: Git 2.40+ installed on host machine

### Global Setup via `npm link`

You can install `sandcastle-agy` globally on your developer workstation using `npm link`:

```bash
# 1. Clone the repository using MTR-S GitHub SSH credentials
git clone git@github.com:MTR-S/sandcastle-antigravity.git
cd sandcastle-antigravity

# 2. Install dependencies
npm install

# 3. Build the container image locally
npm run build-image

# 4. Link binary globally
npm link
```

Verify that the global binary is available in your PATH:

```bash
sandcastle-agy --version
# Output: sandcastle-agy v0.1.0

sandcastle-agy --help
```

Alternatively, you can install globally from the project folder:

```bash
npm install -g .
```

---

## CLI Commands Reference

`sandcastle-agy` provides four primary operational subcommands:

```
Usage:
  sandcastle-agy <command> [options]

Commands:
  run          Run the 4-phase multi-agent orchestrator loop against a target repository
  rescue       Kill dangling containers, prune Git worktrees, and copy logs to clipboard
  doctor       Run diagnostic pre-flight checks (OAuth, Docker, Git, GH CLI, Tech Stack)
  build-image  Build the sandcastle-agent Docker container image locally
  help         Show this help message

Options:
  --repo, -r <path>  Target repository path (default: current directory)
  --yes, -y          Skip interactive confirmation banner (non-interactive mode)
  --tag, -t <tag>    Docker image tag for build-image (default: sandcastle-agent)
  --help, -h         Show help message
  --version, -v      Show version number
```

### 1. `sandcastle-agy run [--repo <path>] [--yes]`

Runs the four-phase autonomous orchestration loop (`Plan → Implement → Review → Merge`) against any external Target Repository.

```bash
# Run against the current directory
sandcastle-agy run

# Run against an external Java or Node repository
sandcastle-agy run --repo /path/to/target-repo

# Run non-interactively in CI/CD or automation
sandcastle-agy run --repo /path/to/target-repo --yes
```

#### Pre-Run Configuration Banner & Defaults Editor

When invoked without `--yes`, `sandcastle-agy run` presents an interactive terminal dashboard displaying all autodetected parameters:

```text
┌  Sandcastle Antigravity Pre-Run Configuration Gate
│
◇  Target Repository Path : /path/to/target-repo
◇  Active Base Branch     : develop
◇  Protected Branches     : main, master, homol, developer, staging, production
◇  Git Author Identity    : Developer Name <dev@example.com>
◇  GitHub User/Token      : MTR-S (token: configured [gh:cli])
◇  Verification Command   : ./mvnw test-compile && ./mvnw test
◇  Issue Label filter     : ready-for-agent
◇  Models assigned per phase:
│  • Planner: gemini-3.8-flash-high
│  • Implementer: gemini-3.8-flash-high
│  • Reviewer: gemini-3.8-flash-high
│  • Merger: gemini-3.8-flash-high
│
?  Select an action:
│  ● 1. [Confirm and Start] - Proceed immediately with above defaults
│  ○ 2. [Change a configuration now] - Edit an option before starting
│  ○ 3. [Cancel] - Abort execution cleanly
```

- **[Confirm and Start]**: Starts the multi-agent loop immediately.
- **[Change a configuration now]**: Allows interactive editing of base branch, protected branches, GitHub account/token, Git author identity, verification command, issue label filter, or role-scoped models.
- **[Cancel]**: Aborts without modifying any repository state.

#### Zero-Footprint Target Repository Guarantee

Target repositories remain completely clean:
- **No Orchestrator Artifacts**: Orchestrator prompt files (`plan-prompt.md`, `implement-prompt.md`, `review-prompt.md`, `merge-prompt.md`) are resolved directly from the orchestrator package root and are never copied into the target repository.
- **Automatic Post-Run Cleanup**: Temporary `.sandcastle` folders and worktrees created by the engine are cleaned up upon completion or interruption.
- **Log Preservation**: All execution logs generated during the run are automatically archived to the orchestrator package's `.sandcastle/logs/` directory for debugging and inspection.

---

### 2. `sandcastle-agy rescue [--repo <path>]`

Fast-recovery utility when an agent loop is interrupted or fails:

```bash
sandcastle-agy rescue --repo /path/to/target-repo
```

What `rescue` does automatically:
1. **Terminates Dangling Containers**: Finds and kills any orphan `sandcastle-agent` Docker containers.
2. **Prunes Worktrees**: Runs `git worktree prune` and forcefully cleans leftover `.sandcastle/worktrees` to unlock branches.
3. **Log Diagnostics to Clipboard**: Identifies the latest `.log` file, extracts its last 40 lines, and copies them directly to the system clipboard for immediate pasting into chat or issue trackers.

---

### 3. `sandcastle-agy doctor [--repo <path>]`

Validates all developer environment prerequisites before running:

```bash
sandcastle-agy doctor --repo /path/to/target-repo
```

Checks:
- **Host OAuth Session**: Validates `gemini:antigravity` credentials in Windows Credential Manager.
- **Docker Daemon**: Confirms Docker service connectivity.
- **Git & Repository Validity**: Verifies Git binary and target repository health.
- **GitHub CLI Authentication**: Checks active GitHub authentication status.
- **Target Tech Stack Toolchain**: Autodetects Java (Maven/Gradle) or Node/TypeScript and verifies build tool existence.

---

### 4. `sandcastle-agy build-image [--tag <image-name>] [--build-arg KEY=VALUE]`

Compiles the container image locally:

```bash
sandcastle-agy build-image

# Custom tag or build argument
sandcastle-agy build-image --tag my-sandcastle-agent:latest
```

---

## Multi-Account GitHub Workflow

When working on `MTR-S/sandcastle-antigravity` or multi-repo setups with different GitHub accounts:

### Account Verification & Switching

Always ensure the `MTR-S` personal account is active for this repository:

```bash
# Check current active GitHub account
gh auth status

# Switch to MTR-S personal account if another account is active
gh auth switch --user MTR-S
```

### Environment Overrides

You can explicitly configure credentials via environment variables without changing host defaults:

```bash
# GitHub Token override
export GH_TOKEN="ghp_yourPersonalGitHubToken"
export GH_USER="MTR-S"

# Dynamic Git Authorship override
export GIT_USER_NAME="Matheus de Sousa Almeida"
export GIT_USER_EMAIL="matheusalmeidass14@gmail.com"
```

The orchestrator dynamically forwards these values into the container sandbox.

---

## Verification & Test Suite

Run the full automated test suite:

```bash
# Typecheck
npm run typecheck

# Unit tests
npm run test:unit

# Multi-repository verification smoke tests
npm run test:smoke

# Full test suite
npm test
```

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Matt Pocock & Copyright (c) 2026 MTR-S.
