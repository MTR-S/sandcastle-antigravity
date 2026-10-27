# Upstream Attribution & Notice

**Sandcastle Antigravity (`sandcastle-antigravity`)** is a community adaptation and standalone extension built on top of [`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle), created by **[Matt Pocock](https://github.com/mattpocock)**.

## Upstream Work by Matt Pocock (`@ai-hero/sandcastle`)

- **Core Sandbox & Worktree Engine**: Provided via the official `@ai-hero/sandcastle` npm package (MIT License).
- **Four-Phase Orchestration Template (*Parallel Planner with Review*)**: The structure of `main.mts`, `plan-prompt.md`, `implement-prompt.md`, `review-prompt.md`, `merge-prompt.md`, and the UID/GID alignment pattern in `Dockerfile` are adapted from the templates distributed with `@ai-hero/sandcastle`.
- **Shared Development Methodology**: Inspired by Matt Pocock's engineering workflows:
  - [How I'm Building Software with AI](https://www.youtube.com/watch?v=M6mYodf0dJM)
  - [Building Software with AI / Sandcastle Deep Dive](https://www.youtube.com/watch?v=-QFHIoCo-Ko&t=4169s)

## Extensions & Adaptations by MTR-S

- **Google Antigravity CLI `AgentProvider` (`antigravity.ts`)**: Custom stream-json parser, command builder, and role-scoped model resolver for Google's `agy` CLI.
- **Cross-OS Host OAuth Session Bridge (`auth-preflight.ts`, `entrypoint.sh`, `Dockerfile`)**: In-memory extraction of `gemini:antigravity` OAuth credentials from Windows Credential Manager (`Advapi32.dll` `CredReadW`) bridged into a headless Linux D-Bus + GNOME Keyring Secret Service inside Docker containers without static API keys.
- **Standalone Multi-Repository Orchestration & Rescue Tooling**: Zero-footprint execution against external target repositories, interactive default inspection/override, and automated container/worktree rescue utilities.
