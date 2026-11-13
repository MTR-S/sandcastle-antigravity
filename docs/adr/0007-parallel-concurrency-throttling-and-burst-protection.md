# 7. Parallel Concurrency Throttling, Stagger Delay, and Burst Protection

Date: 2026-11-13

## Status

Accepted

## Context

During autonomous multi-agent orchestration runs using `sandcastle-antigravity` (`sc-agy`), Phase 2 (Execute + Review) previously invoked `Promise.allSettled(issues.map(...))` without concurrency constraints. When the planning phase selected multiple unblocked issues, multiple Docker sandbox containers launched simultaneously.

Each container executed the Google Antigravity CLI (`agy`) with `effort: "high"` by default, generating extensive thinking token streams and firing multiple parallel requests containing large git logs and project source files at the exact same millisecond. Concurrently, all containers shared the same Host OAuth Session payload, creating risk of race conditions on token refresh.

This burst pattern triggered automated abuse and anti-bot protection mechanisms on the Google Gemini API backend, resulting in a fatal account suspension with HTTP 403 `PERMISSION_DENIED`:
`"This service has been disabled in this account for violation of Terms of Service" (retryable: false)`.

## Decision

1. **Domain Vocabulary Expansion**:
   - Register canonical domain concepts in `CONTEXT.md`:
     - *Parallel Concurrency Cap*: Maximum number of issues running simultaneously in Phase 2 (default: 3).
     - *Stagger Delay*: Jittered startup delay (default: 8s ±2s) between launching parallel workers.
     - *Dynamic Issue Worker Pool*: Continuous queue-based worker pool allocating next issues as slots open.
     - *Rate Limit Cool-down Backoff*: Defensive backoff window (15–30s) on HTTP 429 (`RESOURCE_EXHAUSTED`).

2. **Parallel Concurrency Cap & Dynamic Worker Pool**:
   - Replace unconstrained `Promise.allSettled` with a bounded dynamic worker pool in Phase 2.
   - Set the default concurrency cap to **3 simultaneous issues**.
   - Provide CLI flags `--concurrency <N>` and `-c <N>`, with environment variable fallback `SANDCASTLE_CONCURRENCY`.
   - As any of the 3 active worker slots finishes, the next pending issue from the planned queue starts immediately.

3. **Stagger Delay with Jitter**:
   - Inject a staggered delay (default 8 seconds with ±25% random jitter) between launching parallel containers.
   - Provide CLI flag `--stagger-delay <seconds>` and environment variable `SANDCASTLE_STAGGER_DELAY`.
   - Prevents burst collision on git index expansion, context payload transfers, and API socket handshakes.

4. **Implementer Reasoning Effort Reduction**:
   - Set the Implementer agent's reasoning effort explicitly to `effort: "low"` in `main.mts`.
   - Preserve the Planner agent at `effort: "high"`, Reviewer at `effort: "medium"`, and retain `maxIterations: 100`.
   - Drastically cuts thinking token consumption during code implementation while preserving planner depth.

5. **Host OAuth Expiry Pre-flight Validation**:
   - Verify token expiration timestamp in `auth-preflight.ts` prior to sandbox launching.
   - Avoids simultaneous refresh token exchanges by multiple isolated container keyring daemons.

6. **Rate-Limit Interception and Cool-Down Backoff**:
   - Detect `RESOURCE_EXHAUSTED` (HTTP 429) signatures in agent streams/logs.
   - Pause worker pool queue advancement for a cool-down window (15–30s) with a clear console warning to prevent escalation to account suspensions.

7. **Pre-Run Banner Integration**:
   - Display `Parallel Concurrency: 3` and `Implementer Effort: low` in `banner.ts`.
   - Allow interactive modification in the Pre-Run Configuration Banner before starting the run.

8. **Atomic Merge Consolidation in Phase 3**:
   - Execute Phase 3 (Merger agent) only after all planned issues in the worker pool complete their Phase 2 pipelines.

## Considered Options

- **Option 1: Complete Serial Execution (Concurrency = 1)**:
  Rejected because serial execution eliminates multi-core and multi-issue parallelism, substantially increasing the overall wall-clock runtime of large multi-issue iterations.
- **Option 2: Fixed Batch Slices (e.g., rigid blocks of 3)**:
  Rejected because when one fast issue finishes, its slot remains idle waiting for the slowest issue in the batch to finish. The Dynamic Worker Pool eliminates idle slot time.
- **Option 3: Reducing Implementer `maxIterations` from 100 to 20**:
  Rejected per user requirement to preserve `maxIterations: 100` so complex multi-step refactoring tasks do not fail prematurely.

## Consequences

- Prevents burst-induced API account suspensions and rate-limit escalations.
- Retains high parallel throughput (up to 3 simultaneous issues).
- Greatly lowers API token overhead per implementer turn.
- CLI, Banner, and Orchestrator loop remain transparent, deterministic, and 100% unit-testable.
