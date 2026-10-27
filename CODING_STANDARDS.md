# Coding Standards

This document establishes the architectural, security, and code quality standards enforced across the repository.
The reviewer agent loads this file during code review to ensure all implementations comply with these standards.

## Branch Protection and AI Commit Restrictions

- **Strictly Protected Branches (`main`, `homol`, `developer`)**:
  - AI agents must NEVER alter, commit to, push to, or merge directly into `main`, `homol`, or `developer`.
  - If a user explicitly requests modifying, committing to, or pushing to `main`, `homol`, or `developer`, the AI MUST pause, ask for confirmation, and explicitly remind the user of this protection rule before performing any action.
- **Permitted Commit Branches**:
  - AI commits and modifications are strictly restricted to `refractor/ai-main-implementation` and child branches created off `refractor/ai-main-implementation`.
  - All work branches must use `refractor/ai-main-implementation` as their base branch.

## Authentication and Security Boundaries

- **Host OAuth Bridge Requirement**: All agent and containerized workflows must exclusively use the Host OAuth Session Bridge. The orchestrator bridges credentials from the host Windows Credential Manager (`gemini:antigravity`) into the container's D-Bus Secret Service daemon.
- **Prohibition of API Keys**: Static API keys (including `GEMINI_API_KEY`) are deprecated and strictly prohibited. Never introduce, forward, hardcode, or check in API keys or secret tokens.
- **In-Memory Credential Transport**: Credential payloads must only exist in ephemeral process memory. Do not persist unencrypted tokens, authorization codes, or OAuth sessions to disk in repository workspaces, git worktrees, or shared container volumes.
- **Fail-Fast Pre-flight**: Authentication validation must execute prior to provisioning git branches, worktrees, or sandboxes. Missing or invalid credentials must abort execution with exit code 1 and record structured diagnostics to `.sandcastle/logs/auth-failure.log` without dirtying git working trees.
- **Environment Scrubbing**: Containers injecting ephemeral transport variables (`SANDCASTLE_OAUTH_PAYLOAD`) must scrub/unset them immediately after loading into the secret store, preventing leakage in child processes or environment listings.

## Model Configuration Standards

- **Role-Based Phase Scoping**: Sandcastle execution phases must utilize their designated scoped model configuration variables:
  - `PLANNER_MODEL`: Reasoning-focused model for issue dependency analysis and plan formulation (high effort, mode `plan`).
  - `IMPLEMENTER_MODEL`: Code-generation model optimized for test-driven development and fast feedback loops (high effort, mode `accept-edits`).
  - `REVIEWER_MODEL`: Focused diff inspection and standards compliance checking (medium effort, mode `accept-edits`).
  - `MERGER_MODEL`: Integration and merge conflict resolution (high effort, mode `accept-edits`).
- **Global Fallback**: All role-specific model variables must gracefully fall back to `AGENT_MODEL` (defaulting to `gemini-3.8-flash-high`) when omitted.

## Architecture and Seam Design

- **Hexagonal Architecture with Deep Modules (ADR-0001)**:
  - Domain models speak domain language only and remain free of framework annotations (Spring, JPA, persistence annotations).
  - External integrations and multi-source routing (RAID, QLIK, SEEC) must be encapsulated entirely behind coarse-grained adapter seams. Use cases interact strictly with domain ports.
- **Host OAuth Session Bridge and Scoped Models (ADR-0002)**:
  - Container and orchestrator changes must comply with the cross-OS keyring bridging and in-memory credential forwarding design.
- **Separation of Concerns**: Keep modules focused on a single responsibility. Prefer deep interfaces with small surface areas that hide implementation complexity.

## Testing Standards

- **Test-Driven Development (TDD)**: All new features, bug fixes, and configuration schemas must be covered by tests written before or alongside implementation.
- **Boundary Verification**: Tests must exercise behavior across real boundaries (CLI command generation, token validation, stream parsing, error logging) rather than asserting trivial internal state.
- **Deterministic and Isolated**: Unit tests must execute quickly and reliably without depending on external network services or running Docker engines. Container-dependent integration tests belong in dedicated smoke tests.
- **Zero Git Dirtying**: Tests and pre-flight routines must cleanly revert or avoid altering git repository status.

## Code Style and Maintainability

- **TypeScript / Node.js**:
  - Prefer immutable types (`readonly`, `as const`) where applicable.
  - Avoid unsafe type assertions or `any`; use Zod or standard schemas at system boundaries.
  - Use camelCase for variables and functions; PascalCase for classes, interfaces, and types; SCREAMING_SNAKE_CASE for constants.
- **Java / Spring Boot**:
  - Follow standard Java conventions.
  - Keep domain entities clean and free of persistence or web DTO leaks.
