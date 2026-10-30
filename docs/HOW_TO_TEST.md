# How to Test Sandcastle Antigravity on Any Local Project
# Guia de Teste: Sandcastle Antigravity em Qualquer Projeto Local

> **Language / Idioma**: [English](#english-guide) | [Português](#guia-em-português)

---

<a id="english-guide"></a>
## English Guide: End-to-End Walkthrough

This guide provides a comprehensive step-by-step walkthrough to test **`sandcastle-antigravity` (`sandcastle-agy`)** independently against any local Git repository on your machine (Java Maven/Gradle or Node/TypeScript). It ensures total isolation (*Zero-Footprint*) with no orchestrator files copied into the target project.

### 1. Host Environment Prerequisites

Ensure the following tools and services are running and authenticated on your host workstation:

1. **Docker Desktop / Docker Engine**: Running locally with Linux container support (WSL2 on Windows).
2. **Google Antigravity CLI (`agy`)**: Installed and authenticated on host via `agy login` (session stored in Windows Credential Manager as `gemini:antigravity`).
3. **GitHub CLI (`gh`)**: Installed and authenticated (`gh auth status` verifying active account, e.g. `MTR-S`).
4. **Git**: Git 2.40+ installed and available in your terminal PATH.
5. **Node.js**: v22.0.0 or higher (for native TypeScript/ESM execution).

---

### 2. Orchestrator Setup

#### Step 2.1: Build the Container Image

The container image is built once locally and reused across all your target projects:

```bash
cd C:\Users\MatheusAlmeida\projects\sandcastle-antigravity
npm run build-image
```

Verify that the image is built and available:
```bash
docker images sandcastle-agent
# Output: sandcastle-agent latest
```

#### Step 2.2: Link the CLI Binary Globally

Inside the `sandcastle-antigravity` root directory, link the binary to your global PATH:

```bash
npm link
```

Verify that `sandcastle-agy` is accessible from any terminal window:
```bash
sandcastle-agy --version
# Output: sandcastle-agy v0.1.0

sandcastle-agy --help
```

> [!NOTE]
> **Direct invocation without `npm link`:** You can also run the CLI without linking globally:
> ```bash
> node C:\Users\MatheusAlmeida\projects\sandcastle-antigravity\main.mts <command>
> ```

---

### 3. Target Project Requirements

Before testing against a target repository, ensure it meets the following criteria:

1. **Active Git Repository**:
   - Must be a local git repo (`git init` or cloned) with at least an initial commit on the base branch (e.g., `main` or `develop`).
2. **Autodetectable Tech Stack**:
   - **Node / TypeScript**: Must have `package.json` with a test script (e.g. `"test": "vitest run"` or `"test": "npm test"`).
   - **Java Maven**: Must have `pom.xml` (and preferably the wrapper `./mvnw`).
   - **Java Gradle**: Must have `build.gradle` or `build.gradle.kts` (and preferably `./gradlew`).
3. **Open GitHub Issue with Matching Label**:
   - The remote GitHub repository must have an open issue with the label **`ready-for-agent`** (or your custom label).
   - The issue should specify what needs to be implemented or fixed (e.g., *"Add currency format utility"* or *"Fix unit tests"*).
4. **(Optional) Context Documents**:
   - If the target project contains `AGENTS.md`, `CONTEXT.md`, or `CODING_STANDARDS.md`, autonomous agents will automatically read them to follow domain conventions.

---

### 4. Diagnostic Pre-Flight Check (`doctor`)

Before initiating autonomous agents, validate that the target repository and host environment are ready:

```bash
# Option A: Specifying target path via --repo
sandcastle-agy doctor --repo "C:\path\to\target-repo"

# Option B: Running from inside target project directory
cd "C:\path\to\target-repo"
sandcastle-agy doctor
```

What `doctor` verifies:
- [x] **Host OAuth Session**: Valid `gemini:antigravity` token in Windows Credential Manager.
- [x] **Docker Daemon**: Active and responsive Docker engine.
- [x] **Git & Target Repository**: Target repository accessibility and Git health.
- [x] **GitHub CLI**: Active GitHub authentication status.
- [x] **Stack Toolchain**: Autodetected stack (Node `npm test`, Maven `./mvnw test`, or Gradle `./gradlew test`).

---

### 5. Running Autonomous Multi-Agent Loop (`run`)

Launch the 4-phase orchestration loop against your target project:

```bash
sandcastle-agy run --repo "C:\path\to\target-repo"
```

#### Pre-Run Configuration Banner (Interactive Gate)

Before provisioning any containers or worktrees, an interactive banner displays all autodetected parameters:

```text
┌  Sandcastle Antigravity Pre-Run Configuration Gate
│
◇  Target Repository Path : C:\path\to\target-repo
◇  Active Base Branch     : main
◇  Protected Branches     : main, master, homol, developer, staging, production
◇  Git Author Identity    : Developer Name <dev@example.com>
◇  GitHub User/Token      : MTR-S (token: configured [gh:cli])
◇  Verification Command   : npm test
◇  Issue Label filter     : ready-for-agent
◇  Models assigned per phase:
│  • Planner: gemini-3.8-flash-high
│  • Implementer: gemini-3.8-flash-high
│  • Reviewer: gemini-3.8-flash-high
│  • Merger: gemini-3.8-flash-high
│
?  Select an action:
│  ● 1. [Confirm and Start] - Proceed immediately with above defaults
│  ○ 2. [Change a configuration now] - Edit an option before starting
│  ○ 3. [Cancel] - Abort execution cleanly
```

- **`1. [Confirm and Start]`**: Proceeds immediately with the orchestration loop.
- **`2. [Change a configuration now]`**: Allows editing any parameter on the fly (base branch, protected branches, issue label, verification command, AI models, Git author).
- **`3. [Cancel]`**: Safely aborts execution without modifying anything.

> [!TIP]
> **Non-interactive mode (CI/CD):** Use the `--yes` (or `-y`) flag to bypass the banner:
> ```bash
> sandcastle-agy run --repo "C:\path\to\target-repo" --yes
> ```

---

### 6. Four-Phase Lifecycle & Zero-Footprint Guarantee

1. **Phase 1 (Plan)**: Analyzes open issues with `ready-for-agent`, builds dependency graph, and prepares branch plan.
2. **Phase 2 (Implement)**: Creates an isolated Git worktree, runs the implementer agent inside Docker with host dependency caches (`~/.m2` or `~/.npm`), and validates changes using the verification command.
3. **Phase 3 (Review)**: An independent reviewer agent audits the code changes.
4. **Phase 4 (Merge)**: Merges completed branches back into the base branch.

**Zero-Footprint**: The target repository is never polluted with orchestrator files; execution logs are archived in `sandcastle-antigravity/.sandcastle/logs/`.

---

### 7. Recovery Utility (`rescue`)

If execution is interrupted (`Ctrl+C`) or encounters an unexpected failure:

```bash
sandcastle-agy rescue --repo "C:\path\to\target-repo"
```

What `rescue` does automatically:
1. Kills dangling `sandcastle-agent` Docker containers.
2. Prunes Git worktrees (`git worktree prune`) to unlock branches.
3. Extracts the last 40 lines of the latest execution log and copies them directly to the system clipboard.

---
---

<a id="guia-em-português"></a>
## Guia em Português: Passo a Passo Completo

Este guia detalha o passo a passo completo para testar o **`sandcastle-antigravity` (`sandcastle-agy`)** de forma independente contra qualquer repositório Git existente na sua máquina (Java Maven/Gradle ou Node/TypeScript), garantindo isolamento total (*Zero-Footprint*) e sem necessidade de copiar código do orquestrador para o projeto alvo.

---

### 1. Pré-Requisitos do Ambiente

Antes de testar, confirme que os serviços e ferramentas abaixo estão ativos no host:

1. **Docker Desktop**: Em execução localmente com suporte a contêineres Linux (WSL2).
2. **Google Antigravity CLI (`agy`)**: Autenticado no host via `agy login` (sessão persistida no Windows Credential Manager como `gemini:antigravity`).
3. **GitHub CLI (`gh`)**: Instalado e autenticado (`gh auth status` confirmando a conta ativa, ex.: `MTR-S`).
4. **Git**: Git 2.40+ instalado e acessível no PATH do terminal.
5. **Node.js**: v22.0.0 ou superior (para suporte nativo a ESM e TypeScript).

---

### 2. Preparação do Orquestrador

#### Passo 2.1: Compilar a Imagem Docker (se ainda não compilada)

A imagem Docker é única e reutilizável para todos os seus projetos:

```powershell
cd C:\Users\MatheusAlmeida\projects\sandcastle-antigravity
npm run build-image
```

Para verificar se a imagem está presente:
```powershell
docker images sandcastle-agent
# Deve listar a imagem 'sandcastle-agent:latest'
```

#### Passo 2.2: Disponibilizar o binário `sandcastle-agy` globalmente

No diretório do `sandcastle-antigravity`, vincule o comando no sistema usando `npm link`:

```powershell
cd C:\Users\MatheusAlmeida\projects\sandcastle-antigravity
npm link
```

Teste se o executável ficou acessível globalmente:
```powershell
sandcastle-agy --version
# Saída esperada: sandcastle-agy v0.1.0

sandcastle-agy --help
```

> [!NOTE]
> **Execução sem `npm link`:** caso não queira registrar o comando globalmente, você pode executar o orquestrador chamando o script diretamente:
> ```powershell
> node C:\Users\MatheusAlmeida\projects\sandcastle-antigravity\main.mts <comando>
> ```

---

### 3. Preparando o Projeto Alvo

O Sandcastle Antigravity opera contra repositórios locais existentes. Certifique-se de que o projeto alvo satisfaz:

1. **Repositório Git Ativo**:
   - O projeto deve ser um repositório Git (`git init` ou clonado do GitHub).
   - Deve possuir pelo menos um commit inicial na branch base (ex.: `main` ou `develop`).
2. **Stack e Comando de Verificação Autodetectáveis**:
   - **Node / TypeScript**: deve conter `package.json` com script de teste (ex.: `"test": "vitest run"` ou `"test": "jest"`).
   - **Java Maven**: deve conter `pom.xml` (e de preferência o wrapper `./mvnw`).
   - **Java Gradle**: deve conter `build.gradle` ou `build.gradle.kts` (e de preferência o wrapper `./gradlew`).
3. **GitHub Issue Aberta com a Label Configurada**:
   - O repositório remoto no GitHub precisa ter uma issue aberta com a label **`ready-for-agent`** (ou outra label customizada).
   - Descreva na issue o que deve ser feito (ex.: *"Criar função utilitária de formatação de moeda"* ou *"Adicionar teste unitário para o serviço X"*).
4. **(Opcional) Documentação de Contexto**:
   - Se o projeto possuir `AGENTS.md`, `CONTEXT.md` ou `CODING_STANDARDS.md`, os agentes irão ler automaticamente esses arquivos para respeitar a arquitetura e padrões do projeto.

---

### 4. Diagnóstico de Pré-Voo (`doctor`)

Antes de disparar a execução, valide se todos os pré-requisitos estão saudáveis para o projeto alvo:

```powershell
# Opção A: Passando o caminho via flag --repo
sandcastle-agy doctor --repo "C:\caminho\para\seu-projeto"

# Opção B: Executando dentro da pasta do projeto
cd "C:\caminho\para\seu-projeto"
sandcastle-agy doctor
```

#### O que o `doctor` valida:
- [x] **Host OAuth Session**: Credencial `gemini:antigravity` no Windows Credential Manager.
- [x] **Docker Daemon**: Conexão com o Docker Engine.
- [x] **Git & Target Repository**: Validade do repositório local informado.
- [x] **GitHub CLI**: Sessão ativa e conectividade com a API do GitHub.
- [x] **Stack Toolchain**: Autodetecção de Node (`npm test`) ou Java Maven/Gradle (`./mvnw test` / `./gradlew test`).

---

### 5. Executando o Loop Autônomo (`run`)

Para iniciar o ciclo de agentes contra o projeto alvo:

```powershell
sandcastle-agy run --repo "C:\caminho\para\seu-projeto"
```

#### Painel Interativo de Pré-Execução (Banner Gate)

Antes de iniciar qualquer container ou criar branches, o terminal exibirá o resumo de parâmetros detectados:

```text
┌  Sandcastle Antigravity Pre-Run Configuration Gate
│
◇  Target Repository Path : C:\caminho\para\seu-projeto
◇  Active Base Branch     : main
◇  Protected Branches     : main, master, homol, developer, staging, production
◇  Git Author Identity    : Seu Nome <seu-email@dominio.com>
◇  GitHub User/Token      : MTR-S (token: configured [gh:cli])
◇  Verification Command   : npm test
◇  Issue Label filter     : ready-for-agent
◇  Models assigned per phase:
│  • Planner: gemini-3.8-flash-high
│  • Implementer: gemini-3.8-flash-high
│  • Reviewer: gemini-3.8-flash-high
│  • Merger: gemini-3.8-flash-high
│
?  Select an action:
│  ● 1. [Confirm and Start] - Proceed immediately with above defaults
│  ○ 2. [Change a configuration now] - Edit an option before starting
│  ○ 3. [Cancel] - Abort execution cleanly
```

- **`1. [Confirm and Start]`**: Inicia imediatamente o ciclo multi-agente.
- **`2. [Change a configuration now]`**: Permite alterar interativamente no terminal qualquer parâmetro (branch base, branches protegidas, label de issue, comando de teste, modelos de IA ou autor Git).
- **`3. [Cancel]`**: Aborta a execução de forma limpa sem alterar nada.

> [!TIP]
> **Modo não-interativo (CI/CD ou scripts):** passe a flag `--yes` (ou `-y`) para pular o banner e iniciar com os defaults autodetectados:
> ```powershell
> sandcastle-agy run --repo "C:\caminho\para\seu-projeto" --yes
> ```

---

### 6. O Ciclo das 4 Fases e Zero-Footprint

1. **Phase 1 (Plan)**: Lê as issues com a label `ready-for-agent` via GitHub CLI, monta a árvore de dependências e gera o plano com branches dedicadas.
2. **Phase 2 (Implement)**: Cria um *git worktree* isolado e roda o agente implementador dentro do container com caches montados (`~/.m2` ou `~/.npm`). O agente executa o comando de verificação para garantir que o código compila e passa nos testes.
3. **Phase 3 (Review)**: O agente revisor audita o código gerado na mesma branch.
4. **Phase 4 (Merge)**: O agente de merge mescla as alterações na branch base do projeto alvo.

**Garantia Zero-Footprint**: O repositório alvo nunca é poluído com arquivos do orquestrador; os logs são preservados em `sandcastle-antigravity/.sandcastle/logs/`.

---

### 7. Resgate em Caso de Falha ou Interrupção (`rescue`)

Se você interromper a execução com `Ctrl+C` ou ocorrer uma falha inesperada:

```powershell
sandcastle-agy rescue --repo "C:\caminho\para\seu-projeto"
```

#### O que o utilitário `rescue` faz automaticamente:
1. **Derruba containers Docker órfãos** associados ao `sandcastle-agent`.
2. **Poda worktrees do Git** (`git worktree prune`) no repositório alvo para destravar as branches.
3. **Copia os logs para o Clipboard**: Localiza o último arquivo `.log` gerado, extrai as últimas 40 linhas e copia para a Área de Transferência do sistema.
