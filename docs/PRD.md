# PRD: Isolamento do Sandcastle Antigravity como CLI Multi-Repositório (`sandcastle-agy`)

## 1. Visão Geral

Transformar a adaptação do `@ai-hero/sandcastle` com suporte ao Google Antigravity CLI (`agy`) e Host OAuth Session Bridge em uma **aplicação CLI standalone (`sandcastle-antigravity` / `sandcastle-agy`)**, capaz de orquestrar ciclos de *Plan → Implement → Review → Merge* contra qualquer repositório Git local (Java ou Node/TypeScript) sem exigir que o código do orquestrador viva dentro do repositório alvo.

## 2. Objetivos Principais

1. **Zero-Footprint nos Repositórios Alvos**: Executar de forma externa apontando para qualquer `Target Repository` (`--repo <caminho>` ou diretório atual).
2. **Suporte Multi-Conta e Identidade Git Dinâmica**: Remover identidades fixas da imagem Docker e herdar dinamicamente `user.name`, `user.email` e a conta/token do GitHub (`MTR-S` pessoal vs. outras contas) em tempo de execução.
3. **Autodetecção Java & Node/TS + Prompts Parametrizados**: Detectar automaticamente o comando de build/teste (`./mvnw test-compile && ./mvnw test`, `./gradlew test`, `npm test`), montar caches do host (`~/.m2`, `~/.npm`) e parametrizar os prompts para respeitar o `AGENTS.md` / `CONTEXT.md` / `CODING_STANDARDS.md` do repositório alvo.
4. **Painel Interativo de Confirmação e Edição de Defaults (`@clack/prompts`)**: Exibir claramente todas as opções padrões selecionadas (branch base, branches protegidas, conta do GitHub, identidade Git, comando de verificação, label das issues e modelos por fase) antes de iniciar, permitindo confirmar com 1 tecla ou editar qualquer opção ali mesmo no terminal.
5. **CLI Unificada (`run`, `rescue`, `doctor`, `build-image`)**: Incorporar o utilitário de resgate (`rescue-sandcastle.ps1`) e diagnóstico de pré-voo diretamente como subcomandos nativos da CLI.

---

## 3. Decomposição em Tickets (Backlog de Implementação)

### Ticket #1: Desacoplamento do Container e Identidade Git Dinâmica
- **Escopo**:
  - Remover `git config --global user.name` e `user.email` hardcoded do `Dockerfile`.
  - Atualizar `entrypoint.sh` para configurar `git config --global user.name "$GIT_USER_NAME"` e `git config --global user.email "$GIT_USER_EMAIL"` dinamicamente quando fornecidos no ambiente do container.
  - Suportar montagem automática condicional de caches do host (`~/.m2` → `/home/agent/.m2` e `~/.npm` → `/home/agent/.npm`).
- **Critérios de Aceite**:
  - Imagem `sandcastle-agent` compila sem nenhuma referência a contas ou domínios corporativos.
  - Testes unitários/smoke validam a injeção de `GIT_USER_NAME` e `GIT_USER_EMAIL` no `entrypoint.sh`.

### Ticket #2: Motor de Autodetecção de Repositório Alvo e Prompts Parametrizados
- **Escopo**:
  - Criar módulo `target-config.ts` que recebe o `targetRepoPath` e resolve defaults:
    - `baseBranch` (branch ativa do `Target Repository`) e `protectedBranches` (default: `main, master, homol, developer`).
    - `gitUserName` e `gitUserEmail` (lidos via `git config` no `Target Repository` com fallback global).
    - `ghAccount` e `ghToken` (verificando `GH_TOKEN` ou `gh auth status` / `gh auth token`).
    - `verifyCommand` autodetectado por stack: Maven (`./mvnw test-compile && ./mvnw test`), Gradle (`./gradlew test`) ou Node (`npm test`).
  - Parametrizar `implement-prompt.md`, `review-prompt.md`, `merge-prompt.md` e `CODING_STANDARDS.md` para receber `{{VERIFY_COMMAND}}`, `{{BASE_BRANCH}}` e `{{PROTECTED_BRANCHES}}`, removendo referências específicas da API DIFAL (RAID, QLIK, SEEC) e instruindo os agentes a lerem os arquivos `AGENTS.md`, `CONTEXT.md` e `CODING_STANDARDS.md` do próprio `Target Repository`.
- **Critérios de Aceite**:
  - Nenhum prompt contém comandos `./mvnw` fixos ou termos de domínio de terceiros; tudo é resolvido via placeholders `{{VERIFY_COMMAND}}`, `{{BASE_BRANCH}}`, `{{PROTECTED_BRANCHES}}`.
  - Testes unitários em `prompts.test.ts` e `target-config.test.ts` cobrindo detecção de projetos Maven, Gradle e Node/TS.

### Ticket #3: CLI `sandcastle-agy` (`run`, `rescue`, `doctor`, `build-image`) e Painel Interativo de Defaults
- **Escopo**:
  - Criar ponto de entrada CLI (`cli.mts` exposto no `"bin": { "sandcastle-agy": "./cli.mts" }` do `package.json`) com 4 subcomandos:
    1. `sandcastle-agy run [--repo <path>] [--yes]`
    2. `sandcastle-agy rescue [--repo <path>]`
    3. `sandcastle-agy doctor [--repo <path>]`
    4. `sandcastle-agy build-image`
  - Implementar o **Pre-Run Configuration Banner** usando `@clack/prompts` no comando `run`:
    - Mostra todos os padrões detectados (Repositório Alvo, Conta GitHub, Identidade Git, Branch Base, Branches Protegidas, Comando de Verificação, Label das Issues e Modelos por Fase).
    - Permite escolher entre: **[1. Confirmar e Iniciar]**, **[2. Alterar uma configuração agora]** (menu interativo para editar qualquer campo antes de iniciar) ou **[3. Cancelar]**.
- **Critérios de Aceite**:
  - O usuário consegue visualizar e alterar interativamente a branch base, conta do GitHub, label ou comando de verificação antes do início do loop.
  - Flag `--yes` pula o prompt interativo exibindo apenas o resumo informativo no log.
  - Subcomando `rescue` executa em TypeScript/Node a limpeza de containers órfãos, poda de worktrees do repositório alvo e cópia das últimas 40 linhas de log para o Clipboard.

### Ticket #4: Documentação Final e Smoke Test Multi-Repositório
- **Escopo**:
  - Atualizar `README.md` com instruções de instalação global (`npm link`), uso dos subcomandos (`run`, `rescue`, `doctor`, `build-image`) e exemplos para projetos Java e Node/TS.
  - Garantir 100% da suíte `npm test` e `npm run typecheck` verde.
