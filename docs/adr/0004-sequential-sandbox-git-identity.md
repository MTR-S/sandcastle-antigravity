# 4. Sequential Sandbox Git Identity Configuration and .gitconfig.lock Race Elimination

Date: 2026-11-04

## Status

Accepted

## Context

When Sandcastle provisions a containerized sandbox via `docker run -d`, the container executes `/usr/local/bin/entrypoint.sh` as PID 1 in the background to initialize D-Bus, unlock GNOME Keyring, and store Google Antigravity OAuth tokens. Simultaneously, the Sandcastle host orchestrator enters the `Setting up sandbox` phase and issues `git config --global --add safe.directory "/home/agent/workspace"` (and optionally `git config --global user.name` / `user.email`) via `docker exec`.

Previously, `entrypoint.sh` also performed uncoordinated `git config --global user.name "$GIT_USER_NAME"` and `git config --global user.email "$GIT_USER_EMAIL"` during container boot. Because Git manages configuration updates with exclusive lockfiles (`/home/agent/.gitconfig.lock`) created via `O_CREAT | O_EXCL` without backoff or retry logic, concurrent execution caused immediate collisions:
```text
error: could not lock config file /home/agent/.gitconfig: File exists
```
This aborted sandbox setup with exit code 255 and, because `set -e` was enabled in `entrypoint.sh`, risked crashing container PID 1 prematurely.

## Decision

1. **Eliminate concurrent mutations in container entrypoint**:
   - In `entrypoint.sh`, remove uncoordinated `git config --global` mutations during container boot.
   - Clean up any orphaned lockfile defensively upon container start (`rm -f "$HOME/.gitconfig.lock"`).
   - Export standard Git author and committer environment variables (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`) from `$GIT_USER_NAME` and `$GIT_USER_EMAIL`.
2. **Sequential onSandboxReady lifecycle hooks**:
   - Introduce `getSandboxHooks()` in `docker-config.ts` to construct deterministic `onSandboxReady` lifecycle hooks.
   - Configure `git config --global user.name` and `git config --global user.email` sequentially inside the container via `sandbox.onSandboxReady` in `main.mts` during Phase 1 (Plan), Phase 2 (Execute + Review), and Phase 3 (Merge).
   - Standard author and committer environment variables injected by `getSandboxEnv()` guarantee dynamic identity precedence across all commits in target repository worktrees.

## Considered Options

- **Option 1: Shell lock wait loop in entrypoint.sh**: Adding a polling loop in `entrypoint.sh` with `flock` or checking `.gitconfig.lock`. Rejected because Git lock acquisition from multiple processes without central locking coordinators is prone to deadlocks and does not prevent `docker exec` commands from failing when the lock is held.
- **Option 2: Pure environment variable relying without .gitconfig**: Omitting global config entirely and solely using `GIT_AUTHOR_*` and `GIT_COMMITTER_*`. Partially viable, but tools or subcommands querying `git config user.name` or `git config user.email` inside the container would return empty or fallback values.
- **Option 3: Sequential onSandboxReady lifecycle hooks + author environment variables (chosen)**: Decouples container daemon startup from Git configuration. Sandcastle executes setup commands sequentially; hooks execute after setup completes, eliminating concurrency and guaranteeing 100% stable execution.

## Consequences

- Container sandbox initialization completes reliably without exit code 255 lockfile collisions.
- Container PID 1 stays running cleanly under `set -e`.
- Commits generated inside container worktrees consistently preserve dynamic authorship identity without leaking host repository credentials.
- Unit and smoke test suites validate resilience across all phases.
