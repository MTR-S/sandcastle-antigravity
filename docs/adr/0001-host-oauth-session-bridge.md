# Host OAuth Session Bridge and Phase-Scoped Models

Sandcastle Antigravity adopts a Host OAuth Session Bridge and phase-scoped model routing to authenticate containerized Google Antigravity CLI (`agy`) agents without static API keys. The host orchestrator securely queries the active Google Antigravity OAuth session from the Windows Credential Manager (`gemini:antigravity`), validates the token structure during pre-flight, and forwards it strictly in memory into the Docker sandbox runner where a container-local D-Bus Secret Service daemon emulates the native Linux keyring. Each execution phase (Plan, Implement, Review, Merge) is configured with dedicated model tiers (`PLANNER_MODEL`, `IMPLEMENTER_MODEL`, `REVIEWER_MODEL`, `MERGER_MODEL`) falling back to `AGENT_MODEL`.

## Considered Options

1. **Static API Key Forwarding (`GEMINI_API_KEY`)**: Rejected because it incurs separate per-token billing, fails to leverage existing Google AI Pro/Ultra subscription quotas, and introduces credential leakage risks in container logs or worktrees.
2. **Interactive OAuth Within Container**: Rejected because sandboxes run headless and in parallel; interactive browser flows inside ephemeral containers break unattended execution.
3. **Host OAuth Session Bridge with Container Secret Service Emulation (chosen)**: Extracts `gemini:antigravity` from Windows Credential Manager via Win32 `CredReadW` in memory, injects it via `SANDCASTLE_OAUTH_PAYLOAD`, populates a container-local unlocked GNOME Keyring over D-Bus via `secret-tool`, and immediately unsets the transport variable before launching agent workloads.

## Consequences

- **Zero API Key Footprint**: No static API keys (`GEMINI_API_KEY`) are stored on disk or passed to containers.
- **In-Memory Credential Transport**: Security boundaries are preserved by transient environment injection and immediate cleanup.
- **Granular Model Orchestration**: Each phase independently configures its optimal model tier (`PLANNER_MODEL=gemini-4-argon-high`, `IMPLEMENTER_MODEL=gemini-3.8-flash-high`, `REVIEWER_MODEL=gemini-3.8-flash-medium`, `MERGER_MODEL=gemini-4-argon-high`), with graceful fallback to `AGENT_MODEL` (`gemini-3.8-flash-high`).
- **Autonomous Headless Execution**: Headless Linux containers authenticate transparently without requiring interactive browser sessions.
