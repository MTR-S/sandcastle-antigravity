import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { antigravity } from "./antigravity.ts";

describe("Sandcastle Prompts & Template Configuration", () => {
  const repoRoot = existsSync(".git") ? process.cwd() : resolve(process.cwd(), "..");
  const reviewPromptPath = resolve(repoRoot, ".sandcastle/review-prompt.md");
  const planPromptPath = resolve(repoRoot, ".sandcastle/plan-prompt.md");
  const mainMtsPath = resolve(repoRoot, ".sandcastle/main.mts");

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
        BASE_BRANCH: "refractor/ai-main-implementation",
      };

      const interpolated = content.replace(
        /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
        (_, key: string) => (args as Record<string, string>)[key] ?? `{{${key}}}`,
      );

      assert.match(interpolated, /git diff refractor\/ai-main-implementation\.\.\.sandcastle\/issue-41/);
      assert.match(interpolated, /git log refractor\/ai-main-implementation\.\.sandcastle\/issue-41 --oneline/);
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
    test("defaults baseBranch to refractor/ai-main-implementation and enforces protection against main, homol, developer", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        content,
        /baseBranch\s*=\s*process\.env\.BASE_BRANCH\s*\?\?\s*process\.env\.TARGET_BRANCH\s*\?\?\s*["']refractor\/ai-main-implementation["']/,
        "main.mts must default baseBranch to refractor/ai-main-implementation",
      );

      assert.doesNotMatch(
        content,
        /\?\?\s*["']homol["']/,
        "main.mts must not default baseBranch to homol",
      );

      assert.match(
        content,
        /PROTECTED_BRANCHES/,
        "main.mts must define PROTECTED_BRANCHES",
      );
      assert.match(
        content,
        /main.*homol.*developer/,
        "main.mts must include main, homol, developer in protected branches",
      );
    });

    test("passes BASE_BRANCH instead of reserved TARGET_BRANCH in reviewer promptArgs", () => {
      const content = readFileSync(mainMtsPath, "utf-8");

      assert.doesNotMatch(
        content,
        /TARGET_BRANCH:\s*(?:baseBranch|targetBranch)/,
        "main.mts must not pass TARGET_BRANCH in promptArgs to avoid PromptError collision",
      );

      assert.match(
        content,
        /BASE_BRANCH:\s*baseBranch/,
        "main.mts must pass BASE_BRANCH: baseBranch in reviewer promptArgs",
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

  describe("ADR-0002 and environment schemas (Issue #50)", () => {
    const adrPath = resolve(repoRoot, "docs/adr/0002-sandcastle-host-oauth-bridge.md");
    const envExamplePath = resolve(repoRoot, ".sandcastle/.env.example");
    const codingStandardsPath = resolve(repoRoot, ".sandcastle/CODING_STANDARDS.md");

    test("ADR-0002 document exists and follows domain modeling conventions", () => {
      assert.ok(existsSync(adrPath), "docs/adr/0002-sandcastle-host-oauth-bridge.md must exist");
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
      assert.ok(existsSync(envExamplePath), ".sandcastle/.env.example must exist");
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
        /refractor\/ai-main-implementation/,
        "CODING_STANDARDS.md must document refractor/ai-main-implementation",
      );
      assert.match(
        standardsContent,
        /main.*homol.*developer|strictly protected/i,
        "CODING_STANDARDS.md must document protected branches",
      );

      assert.match(
        envExampleContent,
        /BASE_BRANCH=refractor\/ai-main-implementation/,
        ".env.example must document BASE_BRANCH=refractor/ai-main-implementation",
      );
    });

    test("CODING_STANDARDS.md documents Host OAuth bridge requirement and removal of API keys", () => {
      assert.ok(existsSync(codingStandardsPath), ".sandcastle/CODING_STANDARDS.md must exist");
      const content = readFileSync(codingStandardsPath, "utf-8");

      assert.match(content, /Host OAuth/i, "CODING_STANDARDS.md must document Host OAuth bridge requirement");
      assert.match(content, /(?:API key|GEMINI_API_KEY)/i, "CODING_STANDARDS.md must document removal / prohibition of API keys");
      assert.match(content, /PLANNER_MODEL|IMPLEMENTER_MODEL|REVIEWER_MODEL|MERGER_MODEL|AGENT_MODEL/i, "CODING_STANDARDS.md must document role-based model configurations");
      assert.match(content, /gemini-3.8-flash-high/, "CODING_STANDARDS.md must document gemini-3.8-flash-high fallback");
      assert.doesNotMatch(content, /gemini-3.6-flash-high/, "CODING_STANDARDS.md must not reference deprecated gemini-3.6-flash-high");
    });
  });
});

