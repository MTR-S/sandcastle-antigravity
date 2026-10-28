import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { TargetRepoConfig } from "./target-config.ts";
import {
  resolvePreRunConfig,
  formatPreRunSummary,
  runPreRunConfigurationBanner,
  type PreRunConfig,
  type PromptAdapter,
} from "./banner.ts";

function createMockPromptAdapter(
  overrides: Partial<PromptAdapter> = {},
): PromptAdapter {
  return {
    intro: () => {},
    outro: () => {},
    note: () => {},
    select: async () => "confirm",
    text: async () => "",
    cancel: () => {},
    isCancel: () => false,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    ...overrides,
  };
}

describe("Interactive Pre-Run Configuration Banner & Defaults Editor (Issue #9)", () => {
  const dummyTargetConfig: TargetRepoConfig = {
    targetRepoPath: "/projects/sample-app",
    baseBranch: "feature/initial",
    protectedBranches: ["main", "master", "homol", "developer"],
    gitIdentity: {
      name: "Matheus Almeida",
      email: "matheusalmeidass14@gmail.com",
    },
    githubAuth: {
      account: "MTR-S",
      token: "gho_test123",
      source: "gh:cli",
    },
    techStack: "maven",
    verifyCommand: "./mvnw test-compile && ./mvnw test",
    cacheMounts: [],
  };

  describe("Seam 1: Configuration Resolution & Formatted Inspection Summary", () => {
    test("resolves initial pre-run config from target config and environment defaults", () => {
      const config = resolvePreRunConfig(dummyTargetConfig, {
        SANDCASTLE_LABEL: "custom-label",
        PLANNER_MODEL: "gemini-4-ultra",
        AGENT_MODEL: "gemini-3.8-flash-high",
      });

      assert.equal(config.targetRepoPath, "/projects/sample-app");
      assert.equal(config.baseBranch, "feature/initial");
      assert.deepEqual(config.protectedBranches, [
        "main",
        "master",
        "homol",
        "developer",
      ]);
      assert.deepEqual(config.gitIdentity, {
        name: "Matheus Almeida",
        email: "matheusalmeidass14@gmail.com",
      });
      assert.deepEqual(config.githubAuth, {
        account: "MTR-S",
        token: "gho_test123",
        source: "gh:cli",
      });
      assert.equal(config.verifyCommand, "./mvnw test-compile && ./mvnw test");
      assert.equal(config.issueLabel, "custom-label");
      assert.equal(config.models.planner, "gemini-4-ultra");
      assert.equal(config.models.implementer, "gemini-3.8-flash-high");
      assert.equal(config.models.reviewer, "gemini-3.8-flash-high");
      assert.equal(config.models.merger, "gemini-3.8-flash-high");
    });

    test("falls back to standard defaults when environment variables are omitted", () => {
      const config = resolvePreRunConfig(dummyTargetConfig, {});

      assert.equal(config.issueLabel, "ready-for-agent");
      assert.equal(config.models.planner, "gemini-3.8-flash-high");
      assert.equal(config.models.implementer, "gemini-3.8-flash-high");
      assert.equal(config.models.reviewer, "gemini-3.8-flash-high");
      assert.equal(config.models.merger, "gemini-3.8-flash-high");
    });

    test("formats inspection summary containing all 8 parameters", () => {
      const config: PreRunConfig = {
        targetRepoPath: "/projects/sample-app",
        baseBranch: "developer",
        protectedBranches: ["main", "master", "homol"],
        gitIdentity: {
          name: "MTR-S",
          email: "mtr-s@github.com",
        },
        githubAuth: {
          account: "MTR-S",
          token: "gho_secret",
          source: "gh:cli",
        },
        verifyCommand: "npm test",
        issueLabel: "ready-for-agent",
        models: {
          planner: "gemini-4-pro",
          implementer: "gemini-3.8-flash-high",
          reviewer: "gemini-3.8-flash-high",
          merger: "gemini-4-pro",
        },
      };

      const summary = formatPreRunSummary(config);

      assert.match(summary, /Target Repository Path.*\/projects\/sample-app/i);
      assert.match(summary, /Active Base Branch.*developer/i);
      assert.match(summary, /Protected Branches.*main,\s*master,\s*homol/i);
      assert.match(summary, /Git Author Identity.*MTR-S\s*<mtr-s@github\.com>/i);
      assert.match(summary, /GitHub User\/Token.*MTR-S.*\[gh:cli\]/i);
      assert.match(summary, /Verification Command.*npm test/i);
      assert.match(summary, /Issue Label.*ready-for-agent/i);
      assert.match(
        summary,
        /Models assigned per phase[\s\S]*Planner:\s*gemini-4-pro[\s\S]*Implementer:\s*gemini-3.8-flash-high[\s\S]*Reviewer:\s*gemini-3.8-flash-high[\s\S]*Merger:\s*gemini-4-pro/i,
      );
    });

    test("formats summary gracefully when git identity or github auth is unset", () => {
      const config: PreRunConfig = {
        targetRepoPath: "/projects/empty",
        baseBranch: "main",
        protectedBranches: ["main"],
        gitIdentity: {},
        githubAuth: {
          source: "none",
        },
        verifyCommand: "",
        issueLabel: "ready-for-agent",
        models: {
          planner: "gemini-3.8-flash-high",
          implementer: "gemini-3.8-flash-high",
          reviewer: "gemini-3.8-flash-high",
          merger: "gemini-3.8-flash-high",
        },
      };

      const summary = formatPreRunSummary(config);

      assert.match(summary, /Git Author Identity.*\(not configured\)/i);
      assert.match(summary, /GitHub User\/Token.*\(not authenticated\)/i);
      assert.match(summary, /Verification Command.*\(none\)/i);
    });
  });

  describe("Seam 2: Non-Interactive Mode (--yes / -y) Bypass", () => {
    test("bypasses prompts, prints summary to logger, and immediately returns start", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      const logs: string[] = [];
      let promptCalled = false;

      const promptAdapter = createMockPromptAdapter({
        intro: () => {
          promptCalled = true;
        },
        outro: () => {
          promptCalled = true;
        },
        note: () => {
          promptCalled = true;
        },
        select: async () => {
          promptCalled = true;
          return "confirm";
        },
      });

      const result = await runPreRunConfigurationBanner({
        config,
        nonInteractive: true,
        logger: (msg) => logs.push(msg),
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.deepEqual(result.config, config);
      assert.equal(promptCalled, false, "Prompts must not be invoked when nonInteractive is true");

      const joinedLogs = logs.join("\n");
      assert.match(joinedLogs, /Target Repository Path.*\/projects\/sample-app/i);
      assert.match(joinedLogs, /Active Base Branch.*feature\/initial/i);
      assert.match(joinedLogs, /Verification Command.*\.\/mvnw test-compile/i);
    });

    test("recognizes --yes in argv when options.nonInteractive is not explicitly set", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      const logs: string[] = [];
      let promptCalled = false;

      const promptAdapter = createMockPromptAdapter({
        intro: () => {
          promptCalled = true;
        },
      });

      const result = await runPreRunConfigurationBanner({
        config,
        argv: ["node", "main.mts", "--yes"],
        logger: (msg) => logs.push(msg),
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.equal(promptCalled, false);
      assert.ok(logs.length > 0);
    });

    test("recognizes -y in argv as non-interactive flag", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      const logs: string[] = [];

      const result = await runPreRunConfigurationBanner({
        config,
        argv: ["node", "main.mts", "-y"],
        logger: (msg) => logs.push(msg),
      });

      assert.equal(result.action, "start");
      assert.ok(logs.some((l) => l.includes("Active Base Branch")));
    });
  });

  describe("Seam 3: Interactive Menu Navigation & Cancellation", () => {
    test("selecting 'Confirm and Start' displays intro, summary note, outro, and returns start", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      const events: string[] = [];

      const promptAdapter = createMockPromptAdapter({
        intro: (title) => events.push(`intro:${title}`),
        outro: (msg) => events.push(`outro:${msg}`),
        note: (body, title) => events.push(`note:${title}:${body.includes("Active Base Branch")}`),
        select: async (opts) => {
          events.push(`select:${opts.message}`);
          return "confirm";
        },
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.deepEqual(result.config, config);
      assert.ok(events.some((e) => e.startsWith("intro:")));
      assert.ok(events.some((e) => e.startsWith("note:") && e.endsWith("true")));
      assert.ok(events.some((e) => e.startsWith("select:")));
      assert.ok(events.some((e) => e.startsWith("outro:")));
    });

    test("selecting 'Cancel' displays cancel message, triggers onCancel, and returns cancel", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      const events: string[] = [];
      let cancelCallbackInvoked = false;

      const promptAdapter = createMockPromptAdapter({
        select: async () => "cancel",
        cancel: (msg) => events.push(`cancel:${msg}`),
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
        onCancel: () => {
          cancelCallbackInvoked = true;
        },
      });

      assert.equal(result.action, "cancel");
      assert.equal(cancelCallbackInvoked, true);
      assert.ok(events.some((e) => e.startsWith("cancel:")));
    });

    test("handles prompt cancellation (Ctrl+C / isCancel) gracefully at main menu", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      const events: string[] = [];
      let cancelCallbackInvoked = false;

      const CANCEL_SYM = Symbol("cancel");

      const promptAdapter = createMockPromptAdapter({
        select: async () => CANCEL_SYM,
        cancel: (msg) => events.push(`cancel:${msg}`),
        isCancel: (val) => val === CANCEL_SYM,
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
        onCancel: () => {
          cancelCallbackInvoked = true;
        },
      });

      assert.equal(result.action, "cancel");
      assert.equal(cancelCallbackInvoked, true);
      assert.ok(events.some((e) => e.startsWith("cancel:")));
    });

    test("handles prompt cancellation (Ctrl+C / isCancel) inside edit sub-menu", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      let cancelCallbackInvoked = false;

      const CANCEL_SYM = Symbol("cancel");
      const selectCalls = ["edit", CANCEL_SYM];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? CANCEL_SYM,
        isCancel: (val) => val === CANCEL_SYM,
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
        onCancel: () => {
          cancelCallbackInvoked = true;
        },
      });

      assert.equal(result.action, "cancel");
      assert.equal(cancelCallbackInvoked, true);
    });

    test("handles prompt cancellation (Ctrl+C / isCancel) during text input", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);
      let cancelCallbackInvoked = false;

      const CANCEL_SYM = Symbol("cancel");
      const selectCalls = ["edit", "baseBranch"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => CANCEL_SYM,
        isCancel: (val) => val === CANCEL_SYM,
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
        onCancel: () => {
          cancelCallbackInvoked = true;
        },
      });

      assert.equal(result.action, "cancel");
      assert.equal(cancelCallbackInvoked, true);
    });
  });

  describe("Seam 4: Interactive Defaults Editor Sub-Menu", () => {
    test("allows overriding Base Branch and immediately reflects the update in returned config", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = ["edit", "baseBranch", "confirm"];
      const textCalls = ["feature/override-branch"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => textCalls.shift() ?? "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.equal(result.config.baseBranch, "feature/override-branch");
      assert.equal(result.config.verifyCommand, dummyTargetConfig.verifyCommand);
    });

    test("allows overriding Protected Branches (comma-separated list)", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = ["edit", "protectedBranches", "confirm"];
      const textCalls = ["main, staging, release"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => textCalls.shift() ?? "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.deepEqual(result.config.protectedBranches, [
        "main",
        "staging",
        "release",
      ]);
    });

    test("allows overriding Git Identity (Name and Email)", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = ["edit", "gitIdentity", "confirm"];
      const textCalls = ["Alice Dev", "alice@example.com"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => textCalls.shift() ?? "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.deepEqual(result.config.gitIdentity, {
        name: "Alice Dev",
        email: "alice@example.com",
      });
    });

    test("allows overriding Verification Command", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = ["edit", "verifyCommand", "confirm"];
      const textCalls = ["pnpm test:ci"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => textCalls.shift() ?? "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.equal(result.config.verifyCommand, "pnpm test:ci");
    });

    test("allows overriding Issue Label filter", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = ["edit", "issueLabel", "confirm"];
      const textCalls = ["priority-1-agent"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => textCalls.shift() ?? "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.equal(result.config.issueLabel, "priority-1-agent");
    });

    test("allows overriding Phase Models individually", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = [
        "edit",
        "models",
        "planner",
        "confirm",
      ];
      const textCalls = ["gemini-4-ultra"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => textCalls.shift() ?? "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.equal(result.config.models.planner, "gemini-4-ultra");
      assert.equal(result.config.models.implementer, "gemini-3.8-flash-high");
    });

    test("sub-menu back option returns to main menu without changes", async () => {
      const config = resolvePreRunConfig(dummyTargetConfig);

      const selectCalls = ["edit", "back", "confirm"];

      const promptAdapter = createMockPromptAdapter({
        select: async () => selectCalls.shift() ?? "confirm",
        text: async () => "",
      });

      const result = await runPreRunConfigurationBanner({
        config,
        promptAdapter,
      });

      assert.equal(result.action, "start");
      assert.deepEqual(result.config, config);
    });
  });

  describe("Seam 5: Orchestrator Gate Integration (main.mts)", () => {
    test("main.mts imports resolvePreRunConfig and runPreRunConfigurationBanner from ./banner.ts", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /import\s+\{[^}]*resolvePreRunConfig[^}]*\}\s+from\s+["']\.\/banner\.ts["']/,
        "main.mts must import resolvePreRunConfig from ./banner.ts",
      );

      assert.match(
        content,
        /import\s+\{[^}]*runPreRunConfigurationBanner[^}]*\}\s+from\s+["']\.\/banner\.ts["']/,
        "main.mts must import runPreRunConfigurationBanner from ./banner.ts",
      );
    });

    test("main.mts executes the banner before creating sandboxes or starting the loop", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /const\s+bannerResult\s*=\s*await\s+runPreRunConfigurationBanner\(/,
        "main.mts must await runPreRunConfigurationBanner before sandbox creation",
      );

      assert.match(
        content,
        /if\s*\(\s*bannerResult\.action\s*===\s*["']cancel["']\s*\)\s*\{[\s\S]*process\.exit\(0\)/,
        "main.mts must exit cleanly with status 0 when banner action is cancel",
      );

      const bannerIndex = content.indexOf("runPreRunConfigurationBanner");
      const sandboxIndex = content.indexOf("sandcastle.run");
      assert.ok(
        bannerIndex !== -1 && sandboxIndex !== -1 && bannerIndex < sandboxIndex,
        "runPreRunConfigurationBanner must be executed strictly before sandcastle.run",
      );
    });
  });
});
