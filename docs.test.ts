import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

describe("Sandcastle Antigravity OAuth Guide & Git Isolation", () => {
  const REPO_ROOT = existsSync(".git") ? process.cwd() : resolve(process.cwd(), "..");
  const DOCS_DIR = existsSync(resolve(REPO_ROOT, "docs/antigravity-oauth-guide.md"))
    ? resolve(REPO_ROOT, "docs")
    : resolve(REPO_ROOT, ".sandcastle/docs");
  const GUIDE_PATH = resolve(DOCS_DIR, "antigravity-oauth-guide.md");
  const GIT_EXCLUDE_PATH = resolve(REPO_ROOT, ".git/info/exclude");

  let cachedGuideContent: string | null = null;
  const getGuideContent = (): string => {
    if (cachedGuideContent === null) {
      assert.ok(existsSync(GUIDE_PATH), `Antigravity OAuth guide must exist at ${GUIDE_PATH}`);
      cachedGuideContent = readFileSync(GUIDE_PATH, "utf-8");
    }
    return cachedGuideContent;
  };

  const getGuideSection = (startPattern: RegExp, endPattern?: RegExp): string => {
    const full = getGuideContent();
    const matchStart = full.search(startPattern);
    if (matchStart === -1) return "";
    const remaining = full.slice(matchStart);
    if (!endPattern) return remaining;
    const matchStartOffset = remaining.slice(1).search(endPattern);
    return matchStartOffset === -1 ? remaining : remaining.slice(0, matchStartOffset + 1);
  };

  describe("Git isolation and local exclusion", () => {
    test("local git exclusion configuration ignores .sandcastle/docs/ directory", () => {
      assert.ok(
        existsSync(GIT_EXCLUDE_PATH),
        `Git exclusion file must exist at ${GIT_EXCLUDE_PATH}`,
      );

      const excludeContent = readFileSync(GIT_EXCLUDE_PATH, "utf-8");
      const lines = excludeContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));

      const hasDocsExclusion = lines.some(
        (line) =>
          line === ".sandcastle/docs/" ||
          line === ".sandcastle/docs" ||
          line === "/.sandcastle/docs/" ||
          line === "/.sandcastle/docs",
      );

      assert.ok(
        hasDocsExclusion,
        `.git/info/exclude must explicitly configure .sandcastle/docs/ to prevent untracked documentation files`,
      );
    });

    test("git status --porcelain reports zero untracked files in documentation directory", () => {
      const statusOutput = execSync("git status --porcelain", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      });

      const untrackedLines = statusOutput
        .split(/\r?\n/)
        .filter((line) => line.startsWith("??"))
        .filter(
          (line) =>
            line.includes(".sandcastle/docs/") ||
            line.includes(".sandcastle\\docs\\"),
        );

      assert.deepEqual(
        untrackedLines,
        [],
        `git status --porcelain should not list any untracked files in .sandcastle/docs, found: ${untrackedLines.join(", ")}`,
      );
    });
  });

  describe("Foundational architectural sections", () => {
    test("standalone Antigravity OAuth technical guide exists and is non-empty", () => {
      const content = getGuideContent();
      assert.ok(
        content.trim().length > 1000,
        "Guide content must be substantially authored (greater than 1000 characters)",
      );
    });

    test("authors Problem Statement & Motivation section addressing core container failure modes", () => {
      const content = getGuideContent();

      assert.match(
        content,
        /##\s+(?:1\.\s+)?Problem Statement\s+&(?:amp;)?\s+Motivation/i,
        "Guide must contain a Problem Statement & Motivation section",
      );

      // Core failure mode 1: lack of interactive browser login
      assert.match(
        content,
        /browser|interactive login|oauth callback|consent/i,
        "Section must explain the lack of interactive browser login inside headless containers",
      );

      // Core failure mode 2: absence of active D-Bus session bus
      assert.match(
        content,
        /d-bus|session bus|dbus-daemon/i,
        "Section must explain the absence of an active D-Bus session bus",
      );

      // Core failure mode 3: locked or unprovisioned GNOME Keyring collection
      assert.match(
        content,
        /gnome-keyring|login\.keyring|locked collection|secret service/i,
        "Section must explain locked or unprovisioned GNOME Keyring collections",
      );

      // Core failure mode 4: static modelProvider configuration overrides
      assert.match(
        content,
        /modelprovider|settings\.json|static api key/i,
        "Section must explain static modelProvider configuration overrides breaking consumer OAuth",
      );
    });

    test("authors Architecture & End-to-End OAuth Bridge Flow section with Mermaid diagrams", () => {
      const content = getGuideContent();

      assert.match(
        content,
        /##\s+(?:2\.\s+)?Architecture\s+&(?:amp;)?\s+End-to-End\s+OAuth\s+Bridge\s+Flow/i,
        "Guide must contain an Architecture & End-to-End OAuth Bridge Flow section",
      );

      // Architecture Mermaid diagram
      assert.match(
        content,
        /```mermaid\s*\r?\n(?:flowchart|graph)/i,
        "Section must include a Mermaid architecture flowchart",
      );

      // Sequence Mermaid diagram
      assert.match(
        content,
        /```mermaid\s*\r?\nsequenceDiagram/i,
        "Section must include a Mermaid sequence diagram",
      );

      // Tracing host extraction, in-memory transport, container secret service, and agent invocation
      assert.match(content, /SANDCASTLE_OAUTH_PAYLOAD/i);
      assert.match(content, /secret-tool/i);
      assert.match(content, /dbus/i);
      assert.match(content, /agy|antigravity/i);
    });

    test("authors Cross-Platform Host Pre-Flight & Credential Extraction Deep-Dive", () => {
      const content = getGuideContent();

      assert.match(
        content,
        /##\s+(?:3\.\s+)?Cross-Platform\s+Host\s+Pre-Flight\s+&(?:amp;)?\s+Credential\s+Extraction/i,
        "Guide must contain a Cross-Platform Host Pre-Flight section",
      );

      // Windows Credential Manager: P/Invoke CredReadW, advapi32.dll, PowerShell
      assert.match(content, /CredReadW/i, "Must detail CredReadW Win32 API");
      assert.match(content, /advapi32\.dll/i, "Must cite advapi32.dll");
      assert.match(content, /powershell/i, "Must provide PowerShell implementation");
      assert.match(content, /gemini:antigravity/i, "Must cite target credential name gemini:antigravity");

      // macOS Keychain extension: security find-generic-password
      assert.match(content, /security find-generic-password/i, "Must detail macOS Keychain extraction command");

      // Linux Secret Service extension: secret-tool lookup
      assert.match(content, /secret-tool lookup/i, "Must detail Linux Secret Service extraction command");

      // Unified CredentialExtractor contract
      assert.match(content, /CredentialExtractor/i, "Must define CredentialExtractor interface or type contract");

      // OAuth payload validation: access_token, refresh_token, expiry
      assert.match(content, /access_token/i, "Must detail access_token validation");
      assert.match(content, /refresh_token/i, "Must detail refresh_token validation");
      assert.match(content, /expiry/i, "Must detail expiry validation");

      // Fail-fast abort semantics prior to worktree or container creation
      assert.match(
        content,
        /fail-fast|pre-flight|abort/i,
        "Must document fail-fast semantics before sandbox/worktree creation",
      );
    });

    test("authors Headless Container Keyring Bootstrap Deep-Dive with 5-step startup sequence", () => {
      const content = getGuideContent();

      assert.match(
        content,
        /##\s+(?:4\.\s+)?Headless\s+Container\s+Keyring\s+Bootstrap/i,
        "Guide must contain a Headless Container Keyring Bootstrap section",
      );

      // Step 1: dbus-daemon session bus
      assert.match(content, /dbus-daemon/i, "Must detail dbus-daemon session bus initialization");

      // Step 2: login.keyring provisioning
      assert.match(content, /login\.keyring/i, "Must detail default unencrypted login.keyring provisioning");

      // Step 3: gnome-keyring-daemon unlock
      assert.match(content, /gnome-keyring-daemon/i, "Must detail non-interactive gnome-keyring-daemon unlock");

      // Step 4: remove modelProvider overrides
      assert.match(content, /modelProvider/i, "Must detail removing modelProvider settings overrides");

      // Step 5: secret-tool store and environment scrubbing
      assert.match(content, /secret-tool store/i, "Must detail secret-tool store injection");
      assert.match(content, /unset\s+SANDCASTLE_OAUTH_PAYLOAD/i, "Must detail environment variable scrubbing (unset)");
    });
  });

  describe("Sandcastle AgentProvider Implementation Deep-Dive (Issue #62)", () => {
    const getSection5Content = (): string =>
      getGuideSection(
        /##\s+5\.\s+Sandcastle\s+AgentProvider\s+Implementation/i,
        /##\s+6\.\s+Complete\s+Drop-In/i,
      );

    test("authors Sandcastle AgentProvider Implementation Deep-Dive section", () => {
      const section = getSection5Content();
      assert.ok(section.length > 500, "Section 5 must be substantially authored");
      assert.match(
        section,
        /##\s+(?:5\.\s+)?Sandcastle\s+AgentProvider\s+Implementation(?:\s+Deep-Dive)?/i,
        "Guide must contain a Sandcastle AgentProvider Implementation section",
      );
    });

    test("documents CLI command construction with stream-json and stdin piping", () => {
      const section = getSection5Content();
      assert.match(section, /--input-format\s+text/i, "Must document --input-format text");
      assert.match(section, /--output-format\s+stream-json/i, "Must document --output-format stream-json");
      assert.match(section, /--dangerously-skip-permissions/i, "Must document --dangerously-skip-permissions");
      assert.match(section, /--mode\s+(?:accept-edits|plan)/i, "Must document agent mode flag");
      assert.match(section, /stdin/i, "Must document prompt piping via stdin");
    });

    test("documents NDJSON stream event normalization (init, step_update, result, usage)", () => {
      const section = getSection5Content();
      assert.match(section, /\binit\b/i, "Must document init event handling");
      assert.match(section, /\bstep_update\b/i, "Must document step_update event handling");
      assert.match(section, /\bresult\b/i, "Must document result event handling");
      assert.match(section, /\busage\b/i, "Must document usage normalization");
      assert.match(section, /inputTokens/i, "Must document inputTokens metric");
      assert.match(section, /outputTokens/i, "Must document outputTokens metric");
    });

    test("documents role-scoped model resolution and fallback semantics", () => {
      const section = getSection5Content();
      const REQUIRED_MODELS = [
        "PLANNER_MODEL",
        "IMPLEMENTER_MODEL",
        "REVIEWER_MODEL",
        "MERGER_MODEL",
        "AGENT_MODEL",
      ] as const;
      for (const model of REQUIRED_MODELS) {
        assert.match(section, new RegExp(`\\b${model}\\b`, "i"), `Must document ${model}`);
      }
    });

    test("documents compound model identifier and reasoning effort suffix decomposition", () => {
      const section = getSection5Content();
      assert.match(section, /-(?:low|medium|high)/i, "Must document effort suffix decomposition (-low, -medium, -high)");
      assert.match(section, /parseModelIdentifier/i, "Must document parseModelIdentifier function or logic");
    });
  });

  describe("Complete Drop-In Userland Implementation (Issue #62)", () => {
    const getSection6Content = (): string =>
      getGuideSection(
        /##\s+6\.\s+Complete\s+Drop-In\s+Userland\s+Implementation/i,
        /##\s+7\.\s+Upstream\s+Fork/i,
      );

    test("authors Complete Drop-In Userland Implementation section", () => {
      const section = getSection6Content();
      assert.ok(section.length > 1000, "Section 6 must be substantially authored");
      assert.match(
        section,
        /##\s+(?:6\.\s+)?Complete\s+Drop-In\s+Userland\s+Implementation/i,
        "Guide must contain a Complete Drop-In Userland Implementation section",
      );
    });

    test("contains complete host OAuth pre-flight module listing (auth-preflight.ts)", () => {
      const section = getSection6Content();
      assert.match(section, /auth-preflight\.ts/i, "Must include auth-preflight.ts listing header");
      assert.match(section, /runAuthPreflight/i, "Must include runAuthPreflight function in code listing");
      assert.match(section, /formatOAuthPayloadForContainer/i, "Must include formatOAuthPayloadForContainer in code listing");
    });

    test("contains complete Antigravity agent provider module listing (antigravity.ts)", () => {
      const section = getSection6Content();
      assert.match(section, /antigravity\.ts/i, "Must include antigravity.ts listing header");
      assert.match(section, /export\s+function\s+antigravity/i, "Must include antigravity factory in code listing");
      assert.match(section, /parseAntigravityStreamLine/i, "Must include stream line parser in code listing");
      assert.match(section, /buildPrintCommand/i, "Must include buildPrintCommand in code listing");
    });

    test("contains complete headless keyring container Dockerfile listing", () => {
      const section = getSection6Content();
      assert.match(section, /Dockerfile/i, "Must include Dockerfile listing header");
      assert.match(section, /FROM\s+node:22-bookworm/i, "Must use node:22-bookworm base image");
      assert.match(section, /gnome-keyring/i, "Must include gnome-keyring package");
      assert.match(section, /libsecret-tools/i, "Must include libsecret-tools package");
      assert.match(section, /antigravity\.google\/cli\/install\.sh/i, "Must install Antigravity CLI");
    });

    test("contains complete container entrypoint script listing (entrypoint.sh)", () => {
      const section = getSection6Content();
      assert.match(section, /entrypoint\.sh/i, "Must include entrypoint.sh listing header");
      assert.match(section, /DBUS_SESSION_BUS_ADDRESS/i, "Must configure DBUS_SESSION_BUS_ADDRESS in listing");
      assert.match(section, /gnome-keyring-daemon\s+--unlock/i, "Must unlock keyring in listing");
      assert.match(section, /secret-tool\s+store/i, "Must store secret in listing");
      assert.match(section, /unset\s+SANDCASTLE_OAUTH_PAYLOAD/i, "Must scrub SANDCASTLE_OAUTH_PAYLOAD in listing");
    });

    test("contains complete multi-phase orchestrator runner listing (main.ts)", () => {
      const section = getSection6Content();
      assert.match(section, /main\.(?:m)?ts/i, "Must include main.ts or main.mts listing header");
      assert.match(section, /@ai-hero\/sandcastle/i, "Must import sandcastle in listing");
      assert.match(section, /sandcastle\.run/i, "Must invoke sandcastle.run in listing");
      assert.match(section, /createSandboxProvider/i, "Must define createSandboxProvider in listing");
    });

    test("contains complete environment configuration template (.env.example)", () => {
      const section = getSection6Content();
      assert.match(section, /\.env\.example/i, "Must include .env.example listing header");
      const REQUIRED_ENV_VARS = [
        "GH_TOKEN=",
        "AGENT_MODEL=",
        "PLANNER_MODEL=",
        "IMPLEMENTER_MODEL=",
        "REVIEWER_MODEL=",
        "MERGER_MODEL=",
      ] as const;
      for (const envVar of REQUIRED_ENV_VARS) {
        assert.match(section, new RegExp(envVar, "i"), `Must include ${envVar} in .env.example listing`);
      }
    });

    test("all code listings strictly enforce generic project-agnostic defaults", () => {
      const section = getSection6Content();
      // Base branch must default to generic 'main'
      assert.match(section, /"main"|'main'/i, "Drop-in orchestrator runner must use 'main' base branch default");
      // Placeholder Git identity in Dockerfile listing
      assert.match(
        section,
        /user\.email\s+["']agent@example\.local["']|user\.email\s+["']developer@example\.com["']/i,
        "Dockerfile listing must use generic placeholder email",
      );
    });
  });

  describe("Upstream Fork Blueprint for @ai-hero/sandcastle (Issue #63)", () => {
    const getSection7Content = (): string =>
      getGuideSection(/##\s+7\.\s+Upstream\s+Fork\s+Blueprint/i);

    test("authors Upstream Fork Blueprint for @ai-hero/sandcastle section", () => {
      const section = getSection7Content();
      assert.ok(section.length > 1000, "Section 7 must be substantially authored");
      assert.match(
        section,
        /##\s+(?:7\.\s+)?Upstream\s+Fork\s+Blueprint(?:\s+for\s+@ai-hero\/sandcastle)?/i,
        "Guide must contain an Upstream Fork Blueprint section",
      );
    });

    test("documents agent module implementation and registration (src/agents/antigravity.ts)", () => {
      const section = getSection7Content();
      assert.match(section, /src\/agents\/antigravity\.ts/i, "Must cite src/agents/antigravity.ts file location");
      assert.match(section, /AgentProvider/i, "Must implement AgentProvider interface");
      assert.match(section, /AntigravityOptions/i, "Must define AntigravityOptions interface");
      assert.match(section, /export\s+function\s+antigravity/i, "Must export antigravity factory function");
    });

    test("documents public package exports alongside built-in providers", () => {
      const section = getSection7Content();
      const BUILTIN_PROVIDERS = [
        "claudeCode",
        "codex",
        "cursor",
        "opencode",
        "copilot",
        "pi",
      ] as const;

      for (const provider of BUILTIN_PROVIDERS) {
        assert.match(
          section,
          new RegExp(`\\b${provider}\\b`, "i"),
          `Must cite built-in provider '${provider}' in package export mappings`,
        );
      }

      assert.match(section, /"\.\/agents\/antigravity"/i, "Must document package.json subpath export");
      assert.match(section, /src\/index\.ts/i, "Must document root package re-export in src/index.ts");
    });

    test("documents Docker sandbox pre-flight lifecycle hooks", () => {
      const section = getSection7Content();
      assert.match(section, /preflight|beforeSandboxStart|lifecycle/i, "Must document pre-flight lifecycle hook");
      assert.match(section, /runAuthPreflight/i, "Must cite host auth pre-flight validation in sandbox lifecycle");
      assert.match(section, /SANDCASTLE_OAUTH_PAYLOAD/i, "Must document automatic environment injection");
    });

    test("documents sandcastle init CLI templates and starter configuration", () => {
      const section = getSection7Content();
      assert.match(section, /sandcastle\s+init/i, "Must document sandcastle init CLI command integration");
      assert.match(section, /Dockerfile/i, "Must document Dockerfile template with headless keyring support");
      assert.match(section, /entrypoint\.sh/i, "Must document entrypoint script template");
      assert.match(section, /AGENT_MODEL|PLANNER_MODEL/i, "Must document model configuration in starter templates");
    });
  });

  describe("Sanitization and isolation standards", () => {
    test("strictly zero occurrences of forbidden project or organization terms", () => {
      const content = getGuideContent();

      const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf-8");
      const FORBIDDEN_PATTERNS: readonly (readonly [string, RegExp])[] = [
        ["legacy-api", new RegExp(`\\b${decode("ZGlmYWw=")}\\b`, "i")],
        ["legacy-org", new RegExp(`\\b${decode("c29ydGVjaA==")}\\b`, "i")],
        ["author-name", new RegExp(`\\b${decode("bWF0aGV1cw==")}\\b`, "i")],
        ["homol", /\bhomol\b/i],
        ["temurin", /\btemurin\b/i],
        [".m2", /\.m2\b/i],
      ] as const;

      for (const [name, pattern] of FORBIDDEN_PATTERNS) {
        const match = content.match(pattern);
        assert.equal(
          match,
          null,
          `Guide must be strictly project-agnostic. Found forbidden term '${name}': "${match?.[0]}"`,
        );
      }
    });
  });
});
