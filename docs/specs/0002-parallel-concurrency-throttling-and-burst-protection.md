# Spec: Controle de Concorrência Paralela, Stagger Delay e Proteção Contra Rajadas na Fase 2

**Status**: Ready for Agent  
**Triage Label**: `ready-for-agent`  
**Domain Context**: [`CONTEXT.md`](../../CONTEXT.md)  
**Architectural Decision Record**: `docs/adr/0007-parallel-concurrency-throttling-and-burst-protection.md`  

---

## Problem Statement

Durante o ciclo do *Phase Pipeline* do orquestrador `sandcastle-antigravity` (`sc-agy`), a Fase 2 (Execução + Revisão) dispara todas as branches de issues desbloqueadas em paralelo irrestrito através de `Promise.allSettled`. Quando o *Planner* seleciona múltiplas issues simultâneas, dezenas de requisições de grande volume de contexto (`git log`, arquivos de código, prompts extensos e ferramentas) são enviadas no mesmo milissegundo por múltiplos containers Docker para a API da Google.

Além disso, cada agente *Implementer* vinha executando com nível de esforço de raciocínio máximo (`effort: "high"`), gerando fluxos ininterruptos de milhares de *thinking tokens* por até 100 iterações. Essa rajada de tráfego simultâneo aciona as heurísticas automatizadas de detecção de abuso e anti-bot do Google Gemini, culminando em suspensão definitiva da conta por suposta violação de Termos de Serviço (`PERMISSION_DENIED 403: This service has been disabled in this account for violation of Terms of Service`, com `"retryable": false`), abortando a execução do pipeline de tarefas e impedindo novas execuções.

## Solution

Implementar um mecanismo robusto de contenção de tráfego, escalonamento e proteção de credenciais na Fase 2 do *Phase Pipeline*:
1. **Parallel Issue Concurrency Cap**: Estabelecer um teto determinístico de **3 issues simultâneas** como padrão na Fase 2, configurável via flag de linha de comando (`--concurrency <N>` / `-c <N>`) e variável de ambiente (`SANDCASTLE_CONCURRENCY`).
2. **Stagger Delay com Jitter**: Injetar um atraso escalonado de **8 segundos com variação aleatória de ±2s de jitter** entre a inicialização de cada worker paralelo subsequente, eliminando o pico de rajada no início do ciclo.
3. **Dynamic Issue Worker Pool**: Implementar uma fila de despacho contínuo onde, assim que um dos 3 slots de trabalho é liberado pelo término de uma issue, a próxima issue da fila assume a vaga imediatamente (respeitando o Stagger Delay), evitando tempo ocioso sem jamais exceder o teto de 3 tarefas ativas.
4. **Implementer Reasoning Effort**: Reduzir o nível de esforço de raciocínio do *Implementer* exclusivamente para `effort: "low"` em seu provedor, mantendo o *Planner* em `effort: "high"`, o *Reviewer* em `effort: "medium"` e preservando `maxIterations: 100`.
5. **Rate Limit Cool-down Backoff**: Interceptar respostas transitórias de exaustão de cota (`RESOURCE_EXHAUSTED` / HTTP 429) no provedor do agente e aplicar uma pausa temporizada preventiva (15 a 30s) na fila antes de despachar novas requisições.
6. **Host OAuth Pre-refresh**: Validar preventivamente o status e a expiração da sessão OAuth no host antes do disparo dos sandboxes, evitando disputas concorrentes de renovação do `refresh_token` entre múltiplos containers.
7. **Pre-Run Configuration Banner**: Exibir o limite de concorrência e o nível de esforço do implementador no painel interativo de pré-execução, permitindo ajuste interativo com 1 clique antes do início da execução.
8. **Consolidação Atômica na Fase 3**: Executar a etapa de merge único somente após a conclusão de todas as issues planejadas consumidas pelo pool de workers, integrando as branches concluídas de forma atômica na *Base Branch*.

## User Stories

1. As an operator running `sc-agy run`, I want Phase 2 to execute up to 3 parallel issues simultaneously by default, so that my work runs in parallel without triggering API abuse suspensions.
2. As an operator running `sc-agy run`, I want to customize the maximum concurrency via `--concurrency <N>` or `-c <N>`, so that I can dial the concurrency down to 1 or 2 on restricted networks or up on enterprise quotas.
3. As an operator configuring automated pipelines, I want to define `SANDCASTLE_CONCURRENCY` in my environment, so that headless runs inherit my preferred concurrency cap without editing shell scripts.
4. As an operator watching the terminal, I want each parallel issue to start with a Stagger Delay of 8 seconds (±2s jitter), so that containers do not collide and flood the API in the exact same millisecond.
5. As an operator, I want to configure the Stagger Delay duration via `--stagger-delay <seconds>` or `SANDCASTLE_STAGGER_DELAY`, so that I can calibrate the startup buffer to my network latency and API limits.
6. As an operator running a cycle where the planner selects 5 unblocked issues, I want the system to use a Dynamic Issue Worker Pool so that as soon as the first issue finishes, the 4th issue immediately takes the free slot without waiting for the other 2 to finish.
7. As an operator, I want all planned issues in an iteration to finish their Phase 2 execution before Phase 3 (Merge) starts, so that all candidate branches are consolidated into the Base Branch in a single, conflict-free merge step.
8. As an operator, I want the Implementer agent to run with `effort: "low"` by default, so that reasoning token volume is drastically reduced without diminishing code generation capability.
9. As an operator, I want the Planner agent to continue running with `effort: "high"`, so that issue dependency analysis and architectural decomposition remain thorough and deep.
10. As an operator, I want the Reviewer agent to continue running with `effort: "medium"`, so that pull request style code review and standard verification remain rigorous.
11. As an operator, I want the Implementer to retain `maxIterations: 100`, so that complex tasks requiring multi-step refactoring are not truncated prematurely.
12. As an operator inspecting the Pre-Run Configuration Banner, I want to see `Parallel Concurrency: 3` and `Implementer Effort: low` clearly listed in the summary, so that I have complete visibility of execution throttle settings before starting.
13. As an operator in the Pre-Run Configuration Banner edit menu, I want to interactively change the concurrency limit and implementer effort, so that I can adjust parameters on the fly without restarting the CLI.
14. As an operator whose account hits a temporary rate limit (`RESOURCE_EXHAUSTED` / HTTP 429), I want the orchestrator to log a cool-down notice and pause for 15 to 30 seconds before retrying or advancing the worker pool, so that transient rate limits do not escalate into permanent account bans.
15. As an operator using Docker sandboxes with Host OAuth Session Bridge, I want the host process to validate and refresh the OAuth token before launching sandboxes, so that multiple containers do not attempt concurrent refresh token exchanges against Google Identity endpoints.
16. As a test suite maintainer, I want the worker pool, concurrency limiter, stagger delays, and rate-limit backoff logic to be fully unit-testable using mock runners, mock delay timers, and mock sandbox results, so that all throttling behaviors run deterministically in milliseconds during CI.

## Implementation Decisions

1. **Dynamic Worker Pool Architecture**:
   Phase 2 execution is refactored from an unconstrained `Promise.allSettled` into a dedicated worker pool dispatcher function. The pool manages an active set of concurrent promises, capped at the resolved concurrency limit. When an active promise fulfills or rejects, the next issue from the planned queue is pulled, delayed by the calculated stagger interval, and launched in that vacant slot.

2. **Jittered Stagger Delay Formulation**:
   The stagger delay computes an effective wait time based on the base delay plus a deterministic pseudo-random jitter ratio (within ±25% of the base delay). The delay is executed via a dependency-injected sleep/timer function, allowing tests to inject an instantaneous timer while production runs use native `setTimeout`.

3. **Concurrency and Throttle Configuration Contract**:
   CLI arguments `--concurrency` (with alias `-c`) and `--stagger-delay` are added to the argument parser. Positive integer validation is enforced, with default values:
   - Default concurrency cap: `3`
   - Default stagger delay: `8` seconds
   - Precedence: CLI flags take precedence over environment variables (`SANDCASTLE_CONCURRENCY`, `SANDCASTLE_STAGGER_DELAY`), which take precedence over defaults.

4. **Phase-Specific Effort Mapping**:
   The implementer agent creation call explicitly specifies reasoning effort as `"low"`, while the planner explicitly sets `"high"` and the reviewer explicitly sets `"medium"`. The fallback priority honors role-specific environment variables if supplied by the operator.

5. **Host OAuth Expiry Pre-flight Validation**:
   The host pre-flight routine inspects the expiry timestamp in the retrieved credential. If the access token is expired or within 5 minutes of expiration, the host initiates a clean token refresh or warns the operator before container dispatch, preventing concurrent refresh token collision inside containerized keyring daemons.

6. **Rate-Limit Interception and Cool-Down Backoff**:
   The stream parser and agent execution error handlers detect `RESOURCE_EXHAUSTED` or HTTP 429 signatures in error messages or JSON error payloads. Upon detection, a structured warning is emitted and a cool-down backoff (default 20 seconds) pauses queue advancement.

7. **Pre-Run Banner Integration**:
   The pre-run configuration resolver and banner rendering are updated to include concurrency cap and implementer effort. The interactive edit menu includes an option to modify both settings before launching the run.

## Testing Decisions

- **Behavioral & Black-Box Testing**: Tests must assert external observable behavior (number of concurrently executing tasks, elapsed interval between starts, collected branch results, and state transitions) without coupling to internal private variables.
- **Mockable Timers and Task Runners**: The worker pool dispatcher must accept an optional `delayFn` (e.g., `async (ms) => void`) and `taskRunner` callback. In unit tests, `delayFn` records delays and resolves immediately, keeping the test suite fast and deterministic.
- **Modules to Test**:
  - Worker pool and concurrency controller (pool capacity enforcement, dynamic queue consumption, stagger intervals, error isolation).
  - CLI parser and validator (`--concurrency`, `-c`, `--stagger-delay`, environment variable fallbacks, validation of non-positive or non-numeric inputs).
  - Pre-run configuration banner (inspection summary formatting and interactive prompt updates).
  - Agent provider configuration (resolution of `effort: "low"` for implementer and model parsing).
  - Host OAuth pre-flight validation (token expiry detection).
- **Prior Art**:
  - `checkpoint.test.ts` (mock prompt adapters and dependency injection).
  - `cli.test.ts` (CLI argument parsing and validation suites).
  - `banner.test.ts` (mocking interactive select/confirm flows).
  - `notifications.test.ts` (mock stdio and runner dependencies).

## Out of Scope

- Dynamic auto-scaling of concurrency based on real-time network latency metrics.
- Distributed worker execution across multiple physical host machines.
- Bypassing or attempting to defeat Google API safety filters or acceptable use policies.
- Modifying upstream `@ai-hero/sandcastle` core library internals outside this repository's extension layer.

## Further Notes

- The outer loop `MAX_ITERATIONS` remains 10 by default.
- Phase 2 execution summary and Phase 3 merge summary formatting retain their current visual design with bullet indicators and branch commit summaries.
