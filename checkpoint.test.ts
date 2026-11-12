import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHECKPOINT_ACTION_ADVANCE,
  CHECKPOINT_ACTION_AUTOMATIC,
  CHECKPOINT_ACTION_STOP,
  DEFAULT_CHECKPOINT_MESSAGE,
  formatCheckpointPromptMessage,
  buildCheckpointOptions,
  handleIterationCheckpoint,
  type CheckpointAction,
  type CheckpointContext,
  type CheckpointDependencies,
  type CheckpointResult,
} from "./checkpoint.ts";
import type { PromptAdapter, PromptOption } from "./banner.ts";
import type { PipelineIterationNotificationOptions, NotificationResult } from "./notifications.ts";

function createMockPromptAdapter(options?: {
  selectResult?: string | symbol;
  isCancelResult?: boolean;
}): {
  adapter: PromptAdapter;
  selectCalls: Array<{ message: string; options: readonly PromptOption[]; initialValue?: string }>;
  cancelCalls: string[];
  infoLogs: string[];
} {
  const selectCalls: Array<{ message: string; options: readonly PromptOption[]; initialValue?: string }> = [];
  const cancelCalls: string[] = [];
  const infoLogs: string[] = [];

  const cancelSymbol = Symbol("clack:cancel");
  const selectResult = options?.selectResult ?? CHECKPOINT_ACTION_ADVANCE;

  const adapter: PromptAdapter = {
    intro: () => {},
    outro: () => {},
    note: () => {},
    select: async (opts) => {
      selectCalls.push(opts);
      return selectResult;
    },
    text: async () => "",
    cancel: (msg) => {
      cancelCalls.push(msg);
    },
    isCancel: (val) => {
      if (options?.isCancelResult !== undefined) {
        return options.isCancelResult;
      }
      return val === cancelSymbol;
    },
    log: {
      info: (msg) => {
        infoLogs.push(msg);
      },
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  };

  return { adapter, selectCalls, cancelCalls, infoLogs };
}

describe("Iteration Checkpoint & Interactive Post-Merge Control (Issue #33 / Spec #29)", () => {
  describe("Seam 1: Constants, Message Formatting & Option Builder", () => {
    test("exports canonical checkpoint action constants", () => {
      assert.equal(CHECKPOINT_ACTION_ADVANCE, "advance");
      assert.equal(CHECKPOINT_ACTION_AUTOMATIC, "automatic");
      assert.equal(CHECKPOINT_ACTION_STOP, "stop");
    });

    test("exports DEFAULT_CHECKPOINT_MESSAGE string", () => {
      assert.ok(typeof DEFAULT_CHECKPOINT_MESSAGE === "string");
      assert.ok(DEFAULT_CHECKPOINT_MESSAGE.length > 0);
      assert.match(DEFAULT_CHECKPOINT_MESSAGE, /checkpoint/i);
    });

    test("formatCheckpointPromptMessage includes iteration cycle indices", () => {
      const msg = formatCheckpointPromptMessage(1, 10);
      assert.match(msg, /Iteration Checkpoint/i);
      assert.match(msg, /1\/10/);
    });

    test("buildCheckpointOptions creates 3 distinct options with Advance, Automatic, and Stop actions", () => {
      const options = buildCheckpointOptions(1, 10);
      assert.equal(options.length, 3);

      const [advanceOpt, autoOpt, stopOpt] = options;
      assert.equal(advanceOpt.value, CHECKPOINT_ACTION_ADVANCE);
      assert.match(advanceOpt.label ?? "", /advance/i);
      assert.match(advanceOpt.label ?? "", /2\/10/);
      assert.ok(advanceOpt.hint && advanceOpt.hint.length > 0);

      assert.equal(autoOpt.value, CHECKPOINT_ACTION_AUTOMATIC);
      assert.match(autoOpt.label ?? "", /automatic/i);
      assert.ok(autoOpt.hint && autoOpt.hint.length > 0);

      assert.equal(stopOpt.value, CHECKPOINT_ACTION_STOP);
      assert.match(stopOpt.label ?? "", /stop/i);
      assert.ok(stopOpt.hint && stopOpt.hint.length > 0);
    });
  });

  describe("Seam 2: Checkpoint State Transitions & Decision Handler", () => {
    test("in automatic mode, bypasses prompt completely and continues loop", async () => {
      const mock = createMockPromptAdapter();
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 1,
          totalIterations: 10,
          mode: "automatic",
          integratedBranchesCount: 2,
        },
        {
          promptAdapter: mock.adapter,
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "advance");
      assert.equal(result.nextMode, "automatic");
      assert.equal(result.shouldContinue, true);
      assert.equal(mock.selectCalls.length, 0, "Should not invoke select prompt in automatic mode");
    });

    test("in interactive mode, displays prompt and advances to next iteration when Advance is chosen", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_ADVANCE });
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 2,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 1,
        },
        {
          promptAdapter: mock.adapter,
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "advance");
      assert.equal(result.nextMode, "interactive");
      assert.equal(result.shouldContinue, true);
      assert.equal(mock.selectCalls.length, 1);
      assert.match(mock.selectCalls[0].message, /2\/10/);
      assert.ok(logs.some((l) => l.includes("Advancing to iteration 3/10")));
    });

    test("in interactive mode, dynamically switches mode to automatic when user selects Continue remaining automatically", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_AUTOMATIC });
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 3,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 2,
        },
        {
          promptAdapter: mock.adapter,
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "automatic");
      assert.equal(result.nextMode, "automatic", "nextMode must transition to automatic in memory");
      assert.equal(result.shouldContinue, true);
      assert.equal(mock.selectCalls.length, 1);
      assert.ok(logs.some((l) => l.includes("Switching execution mode to automatic")));
      assert.ok(mock.infoLogs.some((l) => l.includes("automatic")));
    });

    test("in interactive mode, aborts cleanly when user selects Stop safely now", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_STOP });
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 4,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 1,
        },
        {
          promptAdapter: mock.adapter,
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "stop");
      assert.equal(result.shouldContinue, false);
      assert.equal(mock.selectCalls.length, 1);
      assert.ok(logs.some((l) => l.includes("Stopping orchestration cleanly")));
      assert.ok(mock.infoLogs.some((l) => l.includes("Stopping orchestration")));
    });

    test("in interactive mode, handles prompt cancellation (Ctrl+C / Esc) cleanly by stopping loop", async () => {
      const cancelSymbol = Symbol("clack:cancel");
      const mock = createMockPromptAdapter({
        selectResult: cancelSymbol,
        isCancelResult: true,
      });
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 2,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 1,
        },
        {
          promptAdapter: mock.adapter,
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "stop");
      assert.equal(result.shouldContinue, false);
      assert.equal(mock.cancelCalls.length, 1);
      assert.match(mock.cancelCalls[0], /checkpoint/i);
    });

    test("when maximum iteration limit is reached (iteration >= totalIterations), bypasses prompt cleanly", async () => {
      const mock = createMockPromptAdapter();

      const result = await handleIterationCheckpoint(
        {
          iteration: 10,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 1,
        },
        {
          promptAdapter: mock.adapter,
        },
      );

      assert.equal(result.action, "stop");
      assert.equal(result.shouldContinue, false);
      assert.equal(mock.selectCalls.length, 0, "No redundant prompt should be displayed at iteration limit");
    });

    test("invokes injectable notifier dependency when provided", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_ADVANCE });
      const notifierCalls: PipelineIterationNotificationOptions[] = [];

      const fakeResult: NotificationResult = {
        success: true,
        platform: "linux",
        windowsDispatched: false,
        soundPlayed: false,
        balloonSent: false,
        bellEmitted: true,
        logEmitted: true,
        title: "Test",
        message: "Test message",
      };

      const result = await handleIterationCheckpoint(
        {
          iteration: 2,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 3,
        },
        {
          promptAdapter: mock.adapter,
          notifier: (opts) => {
            notifierCalls.push(opts);
            return fakeResult;
          },
        },
      );

      assert.equal(notifierCalls.length, 1);
      assert.equal(notifierCalls[0].iteration, 2);
      assert.equal(notifierCalls[0].totalIterations, 10);
      assert.equal(notifierCalls[0].integratedBranchesCount, 3);
      assert.equal(result.notificationResult, fakeResult);
    });

    test("dispatches default notification when dispatchNotification is explicitly true without custom notifier", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_ADVANCE });
      let bellEmitted = false;

      const result = await handleIterationCheckpoint(
        {
          iteration: 1,
          totalIterations: 10,
          mode: "automatic",
          integratedBranchesCount: 1,
          dispatchNotification: true,
        },
        {
          promptAdapter: mock.adapter,
          notificationDependencies: {
            platform: "linux",
            terminalBellWriter: () => {
              bellEmitted = true;
            },
            logger: () => {},
          },
        },
      );

      assert.equal(result.shouldContinue, true);
      assert.ok(result.notificationResult);
      assert.equal(bellEmitted, true);
    });

    test("handles throwing notifier gracefully without crashing checkpoint", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_ADVANCE });
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 1,
          totalIterations: 10,
          mode: "interactive",
          integratedBranchesCount: 1,
        },
        {
          promptAdapter: mock.adapter,
          notifier: () => {
            throw new Error("Simulated notification service failure");
          },
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "advance");
      assert.equal(result.shouldContinue, true);
      assert.equal(result.notificationResult, undefined);
      assert.ok(logs.some((l) => l.includes("Failed to dispatch iteration notification")));
    });

    test("respects custom promptMessage override in CheckpointContext", async () => {
      const mock = createMockPromptAdapter({ selectResult: CHECKPOINT_ACTION_ADVANCE });
      const customMessage = "Custom checkpoint message for cycle 2";

      const result = await handleIterationCheckpoint(
        {
          iteration: 2,
          totalIterations: 10,
          mode: "interactive",
          promptMessage: customMessage,
        },
        {
          promptAdapter: mock.adapter,
        },
      );

      assert.equal(result.action, "advance");
      assert.equal(mock.selectCalls.length, 1);
      assert.equal(mock.selectCalls[0].message, customMessage);
    });

    test("handles unrecognized action from prompt adapter by stopping safely and logging", async () => {
      const mock = createMockPromptAdapter({ selectResult: "unknown_action" });
      const logs: string[] = [];

      const result = await handleIterationCheckpoint(
        {
          iteration: 2,
          totalIterations: 10,
          mode: "interactive",
        },
        {
          promptAdapter: mock.adapter,
          logger: (msg) => logs.push(msg),
        },
      );

      assert.equal(result.action, "stop");
      assert.equal(result.shouldContinue, false);
      assert.ok(logs.some((l) => l.includes("Unrecognized checkpoint action")));
    });
  });

  describe("Seam 3: Orchestrator main.mts & cli.ts Re-export Verification", () => {
    const mainMtsPath = resolve(process.cwd(), "main.mts");
    const mainContent = readFileSync(mainMtsPath, "utf-8");
    const cliTsPath = resolve(process.cwd(), "cli.ts");
    const cliContent = readFileSync(cliTsPath, "utf-8");

    test("cli.ts re-exports handleIterationCheckpoint and checkpoint constants and types", () => {
      assert.match(
        cliContent,
        /export\s+{[^}]*\bhandleIterationCheckpoint\b[^}]*}\s+from\s+["']\.\/checkpoint(?:\.ts)?["']/,
        "cli.ts must re-export handleIterationCheckpoint",
      );
      assert.match(
        cliContent,
        /CHECKPOINT_ACTION_ADVANCE/,
        "cli.ts must re-export CHECKPOINT_ACTION_ADVANCE",
      );
      assert.match(
        cliContent,
        /CHECKPOINT_ACTION_AUTOMATIC/,
        "cli.ts must re-export CHECKPOINT_ACTION_AUTOMATIC",
      );
      assert.match(
        cliContent,
        /CHECKPOINT_ACTION_STOP/,
        "cli.ts must re-export CHECKPOINT_ACTION_STOP",
      );
    });

    test("main.mts imports handleIterationCheckpoint from ./checkpoint.ts (or ./cli.ts)", () => {
      assert.match(
        mainContent,
        /import\s+{[^}]*\bhandleIterationCheckpoint\b[^}]*}\s+from\s+["']\.\/(?:checkpoint|cli)(?:\.ts)?["']/,
        "main.mts must import handleIterationCheckpoint",
      );
    });

    test("main.mts initializes activeExecutionMode from activeConfig.mode", () => {
      assert.match(
        mainContent,
        /(?:let|var)\s+activeExecutionMode[\s\S]*?activeConfig\.mode/,
        "main.mts must track mutable activeExecutionMode initialized from activeConfig.mode",
      );
    });

    test("main.mts invokes handleIterationCheckpoint at the boundary of each iteration", () => {
      assert.match(
        mainContent,
        /handleIterationCheckpoint\s*\(\s*{[\s\S]*?iteration[\s\S]*?totalIterations[\s\S]*?mode/,
        "main.mts must call handleIterationCheckpoint passing iteration, totalIterations, and mode",
      );
    });

    test("main.mts dynamically updates activeExecutionMode with nextMode and breaks on !shouldContinue", () => {
      assert.match(
        mainContent,
        /activeExecutionMode\s*=\s*(?:checkpoint|checkpointResult)\.nextMode/,
        "main.mts must update activeExecutionMode from checkpoint.nextMode",
      );
      assert.match(
        mainContent,
        /if\s*\(\s*!(?:checkpoint|checkpointResult)\.shouldContinue\s*\)\s*{\s*break;\s*}/,
        "main.mts must break the loop when checkpoint.shouldContinue is false",
      );
    });
  });
});
