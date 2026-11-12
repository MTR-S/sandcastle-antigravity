# Spec: Notificações de Término de Ciclo e Modo Interativo de Orquestração

**Status**: Ready for Agent  
**Triage Label**: `ready-for-agent`  
**Domain Context**: [`CONTEXT.md`](../../CONTEXT.md)  

---

## Problem Statement

Durante execuções do orquestrador `sandcastle-agy` / `sc-agy`, o operador dispara o comando `run` e o sistema executa o loop externo de até 10 *Pipeline Iterations* de forma totalmente contínua no modo padrão. Atualmente, o operador não recebe nenhum aviso sonoro ou visual do sistema operacional quando uma iteração demorada (que envolve planejamento, codificação em container e merges) é concluída. Isso obriga o operador a monitorar constantemente a janela do terminal ou arriscar que uma nova iteração seja disparada sem que ele tenha a oportunidade de avaliar o código consolidado na *Base Branch*, testar localmente ou interromper a execução com segurança.

## Solution

Introduzir suporte oficial a dois modos operacionais de condução do loop (**Execution Mode**):
1. **Modo Automático (`automatic`)** (padrão): O orquestrador executa as *Pipeline Iterations* consecutivamente até a 10ª iteração ou até que não existam mais issues unblocked. Ao término de cada iteração, emite uma **Iteration Notification** nativa no Windows (balão de notificação via PowerShell `System.Windows.Forms.NotifyIcon`, alerta sonoro do sistema e sinal de terminal) informando o progresso consolidado de forma não bloqueante.
2. **Modo Interativo (`interactive`)**: Configurado antes do início (via argumento de linha de comando ou pelo *Pre-Run Configuration Banner*). Ao término de cada iteração, o sistema emite a notificação nativa com sinal sonoro e aciona o **Iteration Checkpoint**, pausando o fluxo e perguntando ao operador se deseja:
   - Avançar para a próxima iteração (`X+1/10`);
   - Liberar a execução contínua de todas as iterações restantes em modo automático;
   - Encerrar o orquestrador graciosamente mantendo os commits integrados e executando a limpeza segura de worktrees e sandboxes.

Caso o comando seja acionado com `--yes` (para pipelines automatizados ou scripts headless), o orquestrador força o modo automático para garantir que a execução nunca fique suspensa aguardando entrada humana.

## User Stories

1. As an operator running `sc-agy run`, I want to be notified by the operating system when a long-running *Pipeline Iteration* finishes, so that I can step away from the terminal without missing the completion of the cycle.
2. As an operator using Windows, I want the completion notification to trigger a native system tray balloon notification and play a system alert sound, so that I notice the event even if the terminal window is minimized or behind other apps.
3. As an operator, I want each notification to state the completed iteration number and the number of branches integrated, so that I have immediate situational awareness of the orchestrator's progress.
4. As an operator running `sc-agy run`, I want to see the active *Execution Mode* displayed clearly in the *Pre-Run Configuration Banner*, so that I know before starting whether the loop will pause between iterations.
5. As an operator inspecting the *Pre-Run Configuration Banner*, I want an option inside the "Edit a Configuration" menu to toggle the *Execution Mode* between `automatic` and `interactive`, so that I can decide how the run will behave without restarting the command.
6. As an operator who prefers interactive control from the shell, I want to pass `--interactive` or `-i` to `sc-agy run`, so that the orchestrator starts directly in step-by-step mode.
7. As an operator, I want to explicitly specify `--mode automatic` or `--mode interactive` via CLI flags, so that I have a consistent flag syntax across automated scripts and interactive shells.
8. As an operator running in *Interactive Mode*, I want the orchestrator to pause at an *Iteration Checkpoint* after all branches of the current iteration are merged into the *Base Branch*, so that I have an active opportunity to review the repository state before any new cycle begins.
9. As an operator at an *Iteration Checkpoint*, I want to choose "Advance to next iteration", so that the orchestrator proceeds with iteration `X+1` and pauses again at its conclusion.
10. As an operator at an *Iteration Checkpoint*, I want to choose "Continue remaining iterations in automatic mode", so that the orchestrator runs the rest of the loop without pausing again while still notifying me at each cycle's completion.
11. As an operator at an *Iteration Checkpoint*, I want to choose "Stop safely now", so that the orchestrator exits cleanly with exit code 0, preserves all integrated work, and runs target repository worktree and container cleanup.
12. As a CI/CD pipeline or automated script author passing `--yes` or `-y`, I want the orchestrator to strictly enforce `automatic` mode regardless of any `--interactive` flag, so that headless automation never blocks indefinitely waiting for user input.
13. As an operator running a cycle where the planner finds zero unblocked issues, I want the orchestrator to dispatch a final notification and exit immediately, so that I am alerted without being prompted for a next iteration that has no work.
14. As an operator running a cycle where agents make no commits, I want the orchestrator to dispatch a completion notification and exit cleanly without showing a redundant checkpoint prompt.
15. As a test suite maintainer, I want all notification and checkpoint interactions to be testable with mock runners and mock prompt adapters, so that the entire behavior can be verified deterministically in CI without popping OS dialogs or hanging on STDIN.

## Implementation Decisions

1. **Canonical Domain Model Alignment**:
   All modules, types, and documentation use the domain terms defined in `CONTEXT.md`:
   - *Pipeline Iteration* for outer loop cycles (1..`MAX_ITERATIONS`).
   - *Execution Mode* (`automatic` vs `interactive`).
   - *Iteration Checkpoint* for the interactive post-merge gate.
   - *Iteration Notification* for the completion signaling mechanism.

2. **Zero-Dependency Native Windows Notification**:
   Windows notifications are executed via PowerShell using `System.Windows.Forms.NotifyIcon`, `[System.Drawing.SystemIcons]::Information`, `ShowBalloonTip`, and `[System.Media.SystemSounds]::Asterisk.Play()`, coupled with the terminal alert character (`\x07`) and console logging. This avoids adding binary npm dependencies (e.g. `node-notifier`) and circumvents WinRT UWP package ID restrictions (`0x80073D54`).

3. **CLI Arguments & Precedence Contract**:
   The CLI parser recognizes `--interactive`, `-i`, and `--mode <automatic|interactive>`.
   When `--yes` (or `-y`) is present alongside an interactive request, the parser/validator sets the effective mode to `automatic` and logs a non-fatal warning (`--yes flag takes precedence over interactive mode. Running in automatic mode.`).

4. **Pre-Run Configuration Banner Integration**:
   `PreRunConfig` in the banner module is extended to include `mode: "automatic" | "interactive"`. The inspection summary displays `Execution Mode: automatic (default)` or `Execution Mode: interactive`. The edit menu adds a dedicated `Execution Mode` prompt using `@clack/prompts` `select`.

5. **Decoupled Iteration Checkpoint Handler**:
   The checkpoint logic in the outer loop is encapsulated into a pure, testable function (`handleIterationCheckpoint`) accepting the iteration summary, a notification dispatcher, and a prompt adapter. When the operator selects "automatic for remaining", the state machine switches the current run's `mode` to `automatic` in memory for all subsequent iterations.

## Testing Decisions

- **Focus on External Behavior**: Tests will verify CLI flag parsing, banner configuration editing, prompt option dispatching, and notification command generation. Internal PowerShell execution details will be stubbed via runner interfaces.
- **Modules to Test**:
  - CLI parser and validation suite (flag parsing, `--yes` precedence).
  - Banner suite (display format and interactive editing of execution mode).
  - Notification module (PowerShell argument formatting, sound dispatching, and terminal bell emission).
  - Checkpoint handler (state transitions: next iteration, switch to automatic, graceful abort).
- **Prior Art**:
  - `banner.test.ts` (mocking `PromptAdapter` methods).
  - `cli.test.ts` (mocking `CliIo` and verifying arg parsing).
  - `operations.test.ts` (mocking Git runner commands via injected function).

## Out of Scope

- Remote webhook notifications (Slack, Discord, Telegram, or email).
- Notifications inside Docker sandbox containers during Phase 2 agent iterations.
- Interactive prompts interrupting agents during an ongoing Phase 2 implementation.
- Native macOS / Linux notification daemons (fallback to terminal bell and console output on non-Windows platforms for this phase).

## Further Notes

- The default `MAX_ITERATIONS` remains 10.
- All exit paths from the checkpoint trigger the standard `finally` block in `main.mts` ensuring `cleanupTargetRepository` runs and zero orphaned worktrees or dangling containers remain.
