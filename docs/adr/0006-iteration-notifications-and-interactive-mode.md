# 6. Iteration Notifications and Interactive Orchestration Mode

Date: 2026-11-12

## Status

Accepted

## Context

During autonomous multi-agent orchestration runs using `sandcastle-agy run` or `sc-agy run`, the orchestrator executes an outer loop of up to 10 *Pipeline Iterations*. In the default mode, each iteration (spanning planning, parallel containerized implementation, reviewer inspection, and merger consolidation) executes completely continuously.

Previously, operators had no auditory or desktop OS signaling when a long-running iteration completed. This required operators to constantly monitor the terminal window or risk that a new iteration would begin before they had an opportunity to inspect the integrated code on the Base Branch, execute local manual tests, or stop execution safely.

Furthermore, operators had no mechanism to run the orchestrator step-by-step with interactive checkpoints between cycles while preserving all merged progress and triggering orderly worktree and container cleanup.

## Decision

1. **Domain Vocabulary Expansion**:
   - Formally register canonical domain concepts in `CONTEXT.md`:
     - *Pipeline Iteration*: Outer loop cycle of the orchestrator (1..`MAX_ITERATIONS`).
     - *Execution Mode*: Operational mode (`automatic` vs `interactive`).
     - *Iteration Checkpoint*: Post-merge decision point in interactive mode allowing operators to inspect results and choose the next action.
     - *Iteration Notification*: Desktop and terminal signaling mechanism emitted upon completion of each iteration.

2. **Native Zero-Dependency Windows & Terminal Notifications (`notifications.ts`)**:
   - On Windows (`win32`), PowerShell is spawned in detached mode to execute `System.Windows.Forms.NotifyIcon`, `ShowBalloonTip`, and `[System.Media.SystemSounds]::Asterisk.Play()`. This eliminates binary npm dependencies (e.g. `node-notifier`) and circumvents WinRT UWP application ID constraints (`0x80073D54`).
   - In terminal, emits ASCII bell character `\x07` and logs an eye-catching summary line with bell icon and bullet marker (`🔔 [Iteration Notification] <title> • <message>`).
   - Implements zero-throw fault tolerance with warnings logged via `warnLogger`, ensuring platform or runner exceptions never crash or interrupt the orchestrator.

3. **CLI Arguments & Precedence Contract (`cli.ts`)**:
   - Recognizes `--interactive`, `-i`, and `--mode <automatic|interactive>`.
   - Strictly enforces that `--yes` / `-y` takes precedence over interactive mode, automatically defaulting to `automatic` mode and logging an informational warning to guarantee headless CI/CD runs never hang on input.

4. **Pre-Run Configuration Banner Integration (`banner.ts`)**:
   - Displays `Execution Mode: automatic (default)` or `Execution Mode: interactive`.
   - Offers an interactive edit option in the "Edit a Configuration" menu to toggle execution mode before starting.

5. **Decoupled Iteration Checkpoint Handler (`checkpoint.ts`)**:
   - Pure, testable checkpoint handler (`handleIterationCheckpoint`) accepting iteration context and injectable prompter/notifier seams.
   - When in interactive mode, prompts operator via `@clack/prompts` `select` with three actions:
     1. **Advance to next iteration (`X+1/10`)**: proceeds to next cycle in interactive mode.
     2. **Continue remaining iterations automatically**: dynamically switches `activeExecutionMode` to `"automatic"` in memory for all subsequent cycles.
     3. **Stop safely now**: cleanly breaks the loop with exit code 0, executing `cleanupTargetRepository` in `finally` and preserving all Base Branch commits.
   - When the loop finishes naturally (iteration limit reached or issue queue empty), checkpoint prompts are safely bypassed.

## Considered Options

- **Option 1: Binary npm notification libraries (`node-notifier`)**:
  Rejected because native binary dependencies add packaging complexity across platforms, risk security vulnerabilities, and fail on Windows due to modern UWP Application Model restrictions.
- **Option 2: Inline blocking stdin prompt embedded inside `main.mts`**:
  Rejected because inline prompts cannot be tested deterministically in CI, risk hanging headless pipelines, and violate hexagonal architecture separation of concerns.
- **Option 3: Decoupled native notification dispatcher and injectable checkpoint handler (chosen)**:
  Encapsulates OS and terminal dispatching behind coarse-grained seams (`NotificationRunner`, `PromptAdapter`), guarantees graceful fallbacks, and enables 100% test coverage with mock adapters and zero terminal hangs.

## Consequences

- **Hands-Free Situational Awareness**: Operators are alerted with visual and auditory OS cues when long-running cycles conclude.
- **Granular Operator Control**: Operators can review, verify, or halt runs after every cycle without fear of worktree corruption or dangling containers.
- **CI/CD Safety**: Automated pipelines using `--yes` run unhindered in automatic mode with zero prompt blocking.
- **Deterministic Testability**: Full suite of unit tests verifying all state transitions, choices, and cancellation handling.
