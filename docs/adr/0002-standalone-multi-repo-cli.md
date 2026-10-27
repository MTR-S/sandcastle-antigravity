# Standalone Multi-Repository CLI with Interactive Default Inspection

Sandcastle Antigravity is architected as a standalone CLI application (`sandcastle-agy`) that operates externally against any local Target Repository (`--repo <path>` or `process.cwd()`) with zero code footprint required inside the target project. Before provisioning any container or Git worktree, the CLI autodetects the target repository's Git identity (`user.name`/`user.email`), active GitHub account (`gh`), stack-specific Verification Command (Java Maven/Gradle or Node/TypeScript), cache mounts (`~/.m2`, `~/.npm`), and Base/Protected branches, presenting them in an interactive Pre-Run Configuration Banner (`@clack/prompts`) where the operator can confirm or override any setting on the fly.

## Considered Options

1. **Per-Repository `.sandcastle/` Copy or Git Submodule**: Rejected because duplicating orchestrator code, prompts, and scripts across multiple repositories creates maintenance drift and pollutes target repository commit histories.
2. **Silent Zero-Config Execution Without Confirmation**: Rejected because running autonomous multi-agent loops across personal (`MTR-S`) and work repositories carries high risk if the wrong GitHub account, Git identity, or Base Branch is silently assumed.
3. **External CLI (`sandcastle-agy`) + Dynamic Container Identity + Interactive Pre-Run Banner (chosen)**: Centralizes the orchestrator, prompts, rescue utilities (`sandcastle-agy rescue`), and diagnostics (`sandcastle-agy doctor`) in a single standalone installation, injects Git identity dynamically into the container at runtime via `entrypoint.sh`, and provides an explicit interactive confirmation/override gate prior to execution (with `--yes` available for unattended runs).
