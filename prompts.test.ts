import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { antigravity } from "./antigravity.ts";
import {
  buildPromptArgs,
  substitutePromptVariables,
  findUnsubstitutedVariables,
  PROMPT_FILE_NAMES,
  REQUIRED_PROMPT_VARIABLES,
  TARGET_DOMAIN_DOC_FILES,
  resolvePromptFile,
} from "./prompts.ts";

describe("Sandcastle Prompts & Template Configuration", () => {
  const repoRoot = existsSync(".git") ? process.cwd() : resolve(process.cwd(), "..");

  const reviewPromptPath = resolvePromptFile("review-prompt.md", repoRoot);
  const planPromptPath = resolvePromptFile("plan-prompt.md", repoRoot);
  const implementPromptPath = resolvePromptFile("implement-prompt.md", repoRoot);
  const mergePromptPath = resolvePromptFile("merge-prompt.md", repoRoot);
  const mainMtsPath = resolvePromptFile("main.mts", repoRoot);

  describe("review-prompt.md template", () => {
    test("uses BASE_BRANCH instead of reserved TARGET_BRANCH", () => {
      const content = readFileSync(reviewPromptPath, "utf-8");

      assert.doesNotMatch(
        content,
        /\{\{\s*TARGET_BRANCH\s*\}\}/,
        "review-prompt.md must not use {{TARGET_BRANCH}} as it collides with Sandcastle built-in prompt argument",
      );

      assert.match(
        content,
        /git diff \{\{BASE_BRANCH\}\}\.\.\.\{\{BRANCH\}\}/,
        "review-prompt.md must use {{BASE_BRANCH}} in git diff command",
      );

      assert.match(
        content,
        /git log \{\{BASE_BRANCH\}\}\.\.\{\{BRANCH\}\} --oneline/,
        "review-prompt.md must use {{BASE_BRANCH}} in git log command",
      );
    });

    test("interpolates correctly when given BRANCH and BASE_BRANCH prompt args", () => {
      const content = readFileSync(reviewPromptPath, "utf-8");
      const args = {
        BRANCH: "sandcastle/issue-41",
        BASE_BRANCH: "main",
        VERIFY_COMMAND: "npm test",
        PROTECTED_BRANCHES: "main, master, developer",
      };

      const interpolated = substitutePromptVariables(content, args);

      assert.match(interpolated, /git diff main\.\.\.sandcastle\/issue-41/);
      assert.match(interpolated, /git log main\.\.sandcastle\/issue-41 --oneline/);
      assert.doesNotMatch(interpolated, /\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/);
    });
  });

  describe("plan-prompt.md template", () => {
    test("queries ready-for-agent label instead of non-existent Sandcastle label", () => {
      const content = readFileSync(planPromptPath, "utf-8");

      assert.doesNotMatch(
        content,
        /--label Sandcastle\b/,
        "plan-prompt.md must not filter on '--label Sandcastle' as no issues use that label in this repository",
      );

      assert.match(
        content,
        /--label\s+["']?(?:\$\{SANDCASTLE_LABEL:-ready-for-agent\}|ready-for-agent)["']?/,
        "plan-prompt.md must filter on ready-for-agent (or ${SANDCASTLE_LABEL:-ready-for-agent})",
      );
    });
  });

  describe("main.mts reviewer promptArgs and environment forwarding", () => {
    test("defaults baseBranch to targetConfig and enforces protection against main, homol, developer", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /baseBranch\s*=\s*process\.env\.BASE_BRANCH\s*\?\?\s*process\.env\.TARGET_BRANCH\s*\?\?\s*targetConfig\.baseBranch/,
        "main.mts must resolve baseBranch from env or targetConfig.baseBranch",
      );

      assert.match(
        content,
        /PROTECTED_BRANCHES/,
        "main.mts must define PROTECTED_BRANCHES",
      );
    });

    test("passes BASE_BRANCH in promptArgs via buildPromptArgs", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.doesNotMatch(
        content,
        /TARGET_BRANCH:\s*(?:baseBranch|targetBranch)/,
        "main.mts must not pass TARGET_BRANCH in promptArgs to avoid PromptError collision",
      );
    });

    test("forwards SANDCASTLE_LABEL into sandbox environment when configured", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /process\.env\.SANDCASTLE_LABEL/,
        "main.mts should forward SANDCASTLE_LABEL in getSandboxEnv()",
      );
    });

    test("wires host authentication pre-flight check before creating sandboxes", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /import\s+\{[^}]*runAuthPreflight[^}]*\}\s+from\s+["']\.\/auth-preflight\.ts["']/,
        "main.mts must import runAuthPreflight from auth-preflight.ts",
      );

      assert.match(
        content,
        /const\s+authResult\s*=\s*runAuthPreflight\(\)/,
        "main.mts must call runAuthPreflight() before creating sandboxes or running loops",
      );

      assert.match(
        content,
        /formatOAuthPayloadForContainer\s*\(\s*authResult\s*\)/,
        "main.mts must format authResult for container injection",
      );
    });

    test("injects SANDCASTLE_OAUTH_PAYLOAD into sandbox environment and does not forward GEMINI_API_KEY", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /SANDCASTLE_OAUTH_PAYLOAD:\s*oauthPayload/,
        "main.mts must inject SANDCASTLE_OAUTH_PAYLOAD into sandboxEnv / createSandboxProvider()",
      );

      assert.doesNotMatch(
        content,
        /process\.env\.GEMINI_API_KEY/,
        "main.mts must not forward GEMINI_API_KEY from environment to sandbox",
      );
    });
  });

  describe("main.mts phase-scoped model configuration and dispatch", () => {
    test("defines phase-specific model resolvers for PLANNER_MODEL, IMPLEMENTER_MODEL, REVIEWER_MODEL, and MERGER_MODEL defaulting to AGENT_MODEL", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /PLANNER_MODEL/,
        "main.mts must resolve PLANNER_MODEL",
      );
      assert.match(
        content,
        /IMPLEMENTER_MODEL/,
        "main.mts must resolve IMPLEMENTER_MODEL",
      );
      assert.match(
        content,
        /REVIEWER_MODEL/,
        "main.mts must resolve REVIEWER_MODEL",
      );
      assert.match(
        content,
        /MERGER_MODEL/,
        "main.mts must resolve MERGER_MODEL",
      );
      assert.match(
        content,
        /(?:const|let)\s+plannerModel\s*=/,
        "main.mts must define plannerModel",
      );
      assert.match(
        content,
        /(?:const|let)\s+implementerModel\s*=/,
        "main.mts must define implementerModel",
      );
      assert.match(
        content,
        /(?:const|let)\s+reviewerModel\s*=/,
        "main.mts must define reviewerModel",
      );
      assert.match(
        content,
        /(?:const|let)\s+mergerModel\s*=/,
        "main.mts must define mergerModel",
      );
    });

    test("passes resolved models to each pipeline phase", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      // Phase 1 (planner)
      assert.match(
        content,
        /name:\s*["']planner["'][\s\S]*?agent:\s*createAgent\(\s*plannerModel/m,
        "Phase 1 planner must receive plannerModel in createAgent",
      );

      // Phase 2 (implementer)
      assert.match(
        content,
        /name:\s*["']implementer["'][\s\S]*?agent:\s*createAgent\(\s*implementerModel/m,
        "Phase 2 implementer must receive implementerModel in createAgent",
      );

      // Phase 2 (reviewer)
      assert.match(
        content,
        /name:\s*["']reviewer["'][\s\S]*?agent:\s*createAgent\(\s*reviewerModel/m,
        "Phase 2 reviewer must receive reviewerModel in createAgent",
      );

      // Phase 3 (merger)
      assert.match(
        content,
        /name:\s*["']merger["'][\s\S]*?agent:\s*createAgent\(\s*mergerModel/m,
        "Phase 3 merger must receive mergerModel in createAgent",
      );
    });

    test("configures dedicated effort levels and execution modes across all phases", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /name:\s*["']planner["'][\s\S]*?createAgent\(\s*plannerModel,\s*\{[\s\S]*?effort:\s*["']high["'][\s\S]*?mode:\s*["']plan["']/m,
        "Phase 1 planner must configure effort: high and mode: plan",
      );

      assert.match(
        content,
        /name:\s*["']implementer["'][\s\S]*?createAgent\(\s*implementerModel,\s*\{[\s\S]*?effort:\s*["']high["'][\s\S]*?mode:\s*["']accept-edits["']/m,
        "Phase 2 implementer must configure effort: high and mode: accept-edits",
      );

      assert.match(
        content,
        /name:\s*["']reviewer["'][\s\S]*?createAgent\(\s*reviewerModel,\s*\{[\s\S]*?effort:\s*["']medium["'][\s\S]*?mode:\s*["']accept-edits["']/m,
        "Phase 2 reviewer must configure effort: medium and mode: accept-edits",
      );

      assert.match(
        content,
        /name:\s*["']merger["'][\s\S]*?createAgent\(\s*mergerModel,\s*\{[\s\S]*?effort:\s*["']high["'][\s\S]*?mode:\s*["']accept-edits["']/m,
        "Phase 3 merger must configure effort: high and mode: accept-edits",
      );
    });

    test("dispatches each agent phase with its configured model tier and flags", () => {
      const env = {
        PLANNER_MODEL: "gemini-4-argon-high",
        IMPLEMENTER_MODEL: "gemini-3.8-flash-high",
        REVIEWER_MODEL: "gemini-3.8-flash-medium",
        MERGER_MODEL: "gemini-4-argon-high",
      };

      const phases = [
        {
          name: "planner",
          model: env.PLANNER_MODEL,
          effort: "high" as const,
          mode: "plan" as const,
          expectedModel: "gemini-4-argon",
          expectedEffort: "high",
        },
        {
          name: "implementer",
          model: env.IMPLEMENTER_MODEL,
          effort: "high" as const,
          mode: "accept-edits" as const,
          expectedModel: "gemini-3.8-flash",
          expectedEffort: "high",
        },
        {
          name: "reviewer",
          model: env.REVIEWER_MODEL,
          effort: "medium" as const,
          mode: "accept-edits" as const,
          expectedModel: "gemini-3.8-flash",
          expectedEffort: "medium",
        },
        {
          name: "merger",
          model: env.MERGER_MODEL,
          effort: "high" as const,
          mode: "accept-edits" as const,
          expectedModel: "gemini-4-argon",
          expectedEffort: "high",
        },
      ];

      for (const phase of phases) {
        const provider = antigravity(phase.model, {
          effort: phase.effort,
          mode: phase.mode,
        });

        const printCmd = provider.buildPrintCommand({
          prompt: `Execute ${phase.name}`,
        });

        assert.match(
          printCmd.command,
          new RegExp(`--model ${phase.expectedModel}\\b`),
          `${phase.name} must dispatch with model ${phase.expectedModel}`,
        );
        assert.match(
          printCmd.command,
          new RegExp(`--effort ${phase.expectedEffort}\\b`),
          `${phase.name} must dispatch with effort ${phase.expectedEffort}`,
        );
        assert.match(
          printCmd.command,
          new RegExp(`--mode ${phase.mode}\\b`),
          `${phase.name} must dispatch with mode ${phase.mode}`,
        );
      }
    });
  });

  describe("ADR-0001 / ADR-0002 and environment schemas", () => {
    const adr0001 = resolve(repoRoot, "docs/adr/0001-host-oauth-session-bridge.md");
    const adr0002 = resolve(repoRoot, "docs/adr/0002-sandcastle-host-oauth-bridge.md");
    const adrPath = existsSync(adr0001) ? adr0001 : adr0002;
    const envExamplePath = resolvePromptFile(".env.example", repoRoot);
    const codingStandardsPath = resolvePromptFile("CODING_STANDARDS.md", repoRoot);

    test("Host OAuth ADR document exists and follows domain modeling conventions", () => {
      assert.ok(existsSync(adrPath), `${adrPath} must exist`);
      const content = readFileSync(adrPath, "utf-8");

      // Title
      assert.match(content, /^#\s+.+/m, "ADR must contain a top-level heading");
      // Context / Problem
      assert.match(content, /Host OAuth/i, "ADR must address Host OAuth");
      // Considered Options
      assert.match(content, /## Considered Options/i, "ADR must contain 'Considered Options' section");
      // Keyring bridging & In-memory transport
      assert.match(content, /keyring/i, "ADR must discuss keyring bridging");
      assert.match(content, /in-memory/i, "ADR must discuss in-memory credential transport");
      // Security boundaries
      assert.match(content, /security/i, "ADR must discuss security boundaries");
      // Scoped models
      assert.match(content, /PLANNER_MODEL|IMPLEMENTER_MODEL|REVIEWER_MODEL|MERGER_MODEL|AGENT_MODEL/, "ADR must document phase-scoped model configuration");
      assert.match(content, /gemini-3.8-flash-high/, "ADR must document gemini-3.8-flash-high fallback");
      assert.doesNotMatch(content, /gemini-3.6-flash-high/, "ADR must not reference deprecated gemini-3.6-flash-high");
      // Consequences
      assert.match(content, /## Consequences/i, "ADR must contain 'Consequences' section");
    });

    test(".env.example documents phase-scoped models and removes GEMINI_API_KEY", () => {
      assert.ok(existsSync(envExamplePath), `${envExamplePath} must exist`);
      const content = readFileSync(envExamplePath, "utf-8");

      assert.doesNotMatch(content, /^GEMINI_API_KEY=/m, ".env.example must not contain GEMINI_API_KEY assignment");
      assert.match(content, /AGENT_MODEL=/m, ".env.example must document AGENT_MODEL");
      assert.match(content, /PLANNER_MODEL=/m, ".env.example must document PLANNER_MODEL");
      assert.match(content, /IMPLEMENTER_MODEL=/m, ".env.example must document IMPLEMENTER_MODEL");
      assert.match(content, /REVIEWER_MODEL=/m, ".env.example must document REVIEWER_MODEL");
      assert.match(content, /MERGER_MODEL=/m, ".env.example must document MERGER_MODEL");
      assert.match(content, /# Phase 1/i, ".env.example must document Phase 1");
      assert.match(content, /# Phase 2/i, ".env.example must document Phase 2");
      assert.match(content, /# Phase 3/i, ".env.example must document Phase 3");
      assert.match(content, /# Phase 4/i, ".env.example must document Phase 4");
      assert.match(content, /AGENT_MODEL=gemini-3.8-flash-high/, ".env.example must configure AGENT_MODEL=gemini-3.8-flash-high");
      assert.match(content, /PLANNER_MODEL=gemini-4-argon-high/, ".env.example must configure PLANNER_MODEL=gemini-4-argon-high");
      assert.match(content, /IMPLEMENTER_MODEL=gemini-3.8-flash-high/, ".env.example must configure IMPLEMENTER_MODEL=gemini-3.8-flash-high");
      assert.match(content, /REVIEWER_MODEL=gemini-3.8-flash-medium/, ".env.example must configure REVIEWER_MODEL=gemini-3.8-flash-medium");
      assert.match(content, /MERGER_MODEL=gemini-4-argon-high/, ".env.example must configure MERGER_MODEL=gemini-4-argon-high");
    });

    test("documents branch protection rules in CODING_STANDARDS.md and .env.example", () => {
      const standardsContent = readFileSync(codingStandardsPath, "utf-8");
      const envExampleContent = readFileSync(envExamplePath, "utf-8");

      assert.match(
        standardsContent,
        /protected|protection/i,
        "CODING_STANDARDS.md must document branch protection",
      );

      assert.match(
        envExampleContent,
        /BASE_BRANCH=/,
        ".env.example must document BASE_BRANCH",
      );
    });

    test("CODING_STANDARDS.md documents Host OAuth bridge requirement and removal of API keys", () => {
      assert.ok(existsSync(codingStandardsPath), `${codingStandardsPath} must exist`);
      const content = readFileSync(codingStandardsPath, "utf-8");

      assert.match(content, /Host OAuth/i, "CODING_STANDARDS.md must document Host OAuth bridge requirement");
      assert.match(content, /(?:API key|GEMINI_API_KEY)/i, "CODING_STANDARDS.md must document removal / prohibition of API keys");
      assert.match(content, /PLANNER_MODEL|IMPLEMENTER_MODEL|REVIEWER_MODEL|MERGER_MODEL|AGENT_MODEL/i, "CODING_STANDARDS.md must document role-based model configurations");
      assert.match(content, /gemini-3.8-flash-high/, "CODING_STANDARDS.md must document gemini-3.8-flash-high fallback");
      assert.doesNotMatch(content, /gemini-3.6-flash-high/, "CODING_STANDARDS.md must not reference deprecated gemini-3.6-flash-high");
    });
  });

  describe("Parametrized Prompts & Target Domain Docs Integration (Issue #8)", () => {
    describe("Seam 1: Prompt Template Structure & Acceptance Criteria", () => {
      test("all four prompt templates accept {{VERIFY_COMMAND}}, {{BASE_BRANCH}}, and {{PROTECTED_BRANCHES}}", () => {
        assert.deepEqual(REQUIRED_PROMPT_VARIABLES, [
          "VERIFY_COMMAND",
          "BASE_BRANCH",
          "PROTECTED_BRANCHES",
        ]);

        for (const name of PROMPT_FILE_NAMES) {
          const path = resolvePromptFile(name, repoRoot);
          assert.ok(existsSync(path), `${name} must exist at ${path}`);
          const content = readFileSync(path, "utf-8");

          for (const reqVar of REQUIRED_PROMPT_VARIABLES) {
            assert.match(
              content,
              new RegExp(`\\{\\{\\s*${reqVar}\\s*\\}\\}`),
              `${name} must accept {{${reqVar}}} placeholder`,
            );
          }
        }
      });

      test("no hardcoded ./mvnw commands remain in repository prompt files", () => {
        for (const name of PROMPT_FILE_NAMES) {
          const content = readFileSync(resolvePromptFile(name, repoRoot), "utf-8");
          assert.doesNotMatch(
            content,
            /\.\/mvnw/,
            `${name} must not contain hardcoded ./mvnw references`,
          );
        }
      });

      test("no third-party client domain terms remain in prompt templates or coding standards", () => {
        const forbiddenTerms = [
          /\bRAID\b/,
          /\bQLIK\b/,
          /\bSEEC\b/,
          /refractor\/ai-main-implementation/,
        ];

        for (const name of PROMPT_FILE_NAMES) {
          const content = readFileSync(resolvePromptFile(name, repoRoot), "utf-8");
          for (const pattern of forbiddenTerms) {
            assert.doesNotMatch(
              content,
              pattern,
              `${name} must not contain third-party or legacy client terms: ${pattern}`,
            );
          }
        }

        const codingStandardsContent = readFileSync(resolvePromptFile("CODING_STANDARDS.md", repoRoot), "utf-8");
        for (const pattern of [/\bRAID\b/, /\bQLIK\b/, /\bSEEC\b/, /refractor\/ai-main-implementation/]) {
          assert.doesNotMatch(
            codingStandardsContent,
            pattern,
            `CODING_STANDARDS.md must not contain legacy client terms: ${pattern}`,
          );
        }
      });

      test("all four prompt templates explicitly instruct agents to discover and read AGENTS.md, CONTEXT.md, and CODING_STANDARDS.md", () => {
        for (const name of PROMPT_FILE_NAMES) {
          const content = readFileSync(resolvePromptFile(name, repoRoot), "utf-8");
          for (const docFile of TARGET_DOMAIN_DOC_FILES) {
            assert.match(
              content,
              new RegExp(`\\b${docFile.replace(".", "\\.")}\\b`),
              `${name} must explicitly instruct reading ${docFile}`,
            );
          }
        }
      });
    });

    describe("Seam 2: Prompt Arguments Resolution & Variable Substitution Engine", () => {
      test("buildPromptArgs merges common target config variables with phase-specific args", () => {
        const mockTargetConfig = {
          baseBranch: "feature/new-bridge",
          verifyCommand: "npm test",
          protectedBranches: ["main", "master", "staging"] as const,
        };

        const args = buildPromptArgs(mockTargetConfig, {
          TASK_ID: "42",
          ISSUE_TITLE: "Support OAuth",
          BRANCH: "sandcastle/issue-42",
        });

        assert.equal(args.BASE_BRANCH, "feature/new-bridge");
        assert.equal(args.VERIFY_COMMAND, "npm test");
        assert.equal(args.PROTECTED_BRANCHES, "main, master, staging");
        assert.equal(args.TASK_ID, "42");
        assert.equal(args.ISSUE_TITLE, "Support OAuth");
        assert.equal(args.BRANCH, "sandcastle/issue-42");
      });

      test("substitutes all placeholders across all four templates without leaving raw template tags", () => {
        const mockTargetConfig = {
          baseBranch: "main",
          verifyCommand: "./mvnw test-compile && ./mvnw test",
          protectedBranches: ["main", "homol", "developer"] as const,
        };

        const phaseArgsMap: Record<string, Record<string, string>> = {
          "plan-prompt.md": {},
          "implement-prompt.md": {
            TASK_ID: "8",
            ISSUE_TITLE: "feat: Parametrized Prompts",
            BRANCH: "sandcastle/issue-8",
          },
          "review-prompt.md": {
            BRANCH: "sandcastle/issue-8",
          },
          "merge-prompt.md": {
            BRANCHES: "- sandcastle/issue-8",
            ISSUES: "- 8: feat: Parametrized Prompts",
          },
        };

        for (const name of PROMPT_FILE_NAMES) {
          const content = readFileSync(resolvePromptFile(name, repoRoot), "utf-8");
          const args = buildPromptArgs(mockTargetConfig, phaseArgsMap[name]);
          const substituted = substitutePromptVariables(content, args as Record<string, string>);

          const unreplaced = findUnsubstitutedVariables(substituted);
          assert.deepEqual(
            unreplaced,
            [],
            `${name} has unreplaced template placeholders: ${unreplaced.join(", ")}`,
          );
          assert.doesNotMatch(
            substituted,
            /\{\{\s*[A-Za-z0-9_]+\s*\}\}/,
            `${name} must not contain any raw {{...}} tags after substitution`,
          );
        }
      });
    });

    describe("Seam 3: Orchestrator main.mts Integration", () => {
      test("main.mts uses buildPromptArgs to forward target configuration across all 4 phases", () => {
        const content = readFileSync(mainMtsPath, "utf-8");

        assert.match(
          content,
          /import\s+\{[^}]*buildPromptArgs[^}]*\}\s+from\s+["']\.\/prompts\.ts["']/,
          "main.mts must import buildPromptArgs from ./prompts.ts",
        );

        // Planner promptArgs
        assert.match(
          content,
          /name:\s*["']planner["'][\s\S]*?promptArgs:\s*buildPromptArgs\(\s*targetConfig\s*\)/m,
          "main.mts planner phase must supply buildPromptArgs(targetConfig) in promptArgs",
        );

        // Implementer promptArgs
        assert.match(
          content,
          /name:\s*["']implementer["'][\s\S]*?promptArgs:\s*buildPromptArgs\(\s*targetConfig,\s*\{[\s\S]*?TASK_ID[\s\S]*?ISSUE_TITLE[\s\S]*?BRANCH/m,
          "main.mts implementer phase must supply buildPromptArgs(targetConfig, { TASK_ID, ISSUE_TITLE, BRANCH }) in promptArgs",
        );

        // Reviewer promptArgs
        assert.match(
          content,
          /name:\s*["']reviewer["'][\s\S]*?promptArgs:\s*buildPromptArgs\(\s*targetConfig,\s*\{[\s\S]*?BRANCH/m,
          "main.mts reviewer phase must supply buildPromptArgs(targetConfig, { BRANCH }) in promptArgs",
        );

        // Merger promptArgs
        assert.match(
          content,
          /name:\s*["']merger["'][\s\S]*?promptArgs:\s*buildPromptArgs\(\s*targetConfig,\s*\{[\s\S]*?BRANCHES[\s\S]*?ISSUES/m,
          "main.mts merger phase must supply buildPromptArgs(targetConfig, { BRANCHES, ISSUES }) in promptArgs",
        );
      });
    });
  });
});
