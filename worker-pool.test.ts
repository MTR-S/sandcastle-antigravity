import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateStaggerDelayMs,
  executePhase2WithWorkerPool,
  type WorkerPoolIssue,
  type WorkerTaskOutcome,
  type WorkerPoolOptions,
  type WorkerPoolResult,
} from "./worker-pool.ts";
import { DEFAULT_CONCURRENCY, DEFAULT_STAGGER_DELAY } from "./cli.ts";

describe("Phase 2 Dynamic Worker Pool with Stagger Delay (Issue #38)", () => {
  describe("Seam 1: Stagger Delay & Jitter Calculation", () => {
    test("calculates nominal delay when random is at median 0.5", () => {
      const delay = calculateStaggerDelayMs({
        baseSeconds: 8,
        jitterRatio: 0.25,
        randomFn: () => 0.5,
      });
      assert.equal(delay, 8000);
    });

    test("calculates minimum delay (-25%) when random is 0.0", () => {
      const delay = calculateStaggerDelayMs({
        baseSeconds: 8,
        jitterRatio: 0.25,
        randomFn: () => 0.0,
      });
      assert.equal(delay, 6000);
    });

    test("calculates maximum delay (+25%) when random is 1.0", () => {
      const delay = calculateStaggerDelayMs({
        baseSeconds: 8,
        jitterRatio: 0.25,
        randomFn: () => 1.0,
      });
      assert.equal(delay, 10000);
    });

    test("returns 0 ms when baseSeconds is 0 or negative", () => {
      assert.equal(calculateStaggerDelayMs({ baseSeconds: 0 }), 0);
      assert.equal(calculateStaggerDelayMs({ baseSeconds: -5 }), 0);
    });

    test("uses default values when optional parameters are omitted", () => {
      // Default baseSeconds is DEFAULT_STAGGER_DELAY (8s)
      const delay = calculateStaggerDelayMs({ randomFn: () => 0.5 });
      assert.equal(delay, 8000);
    });

    test("applies zero jitter when jitterRatio is 0", () => {
      const min = calculateStaggerDelayMs({ baseSeconds: 8, jitterRatio: 0, randomFn: () => 0.0 });
      const max = calculateStaggerDelayMs({ baseSeconds: 8, jitterRatio: 0, randomFn: () => 1.0 });
      assert.equal(min, 8000);
      assert.equal(max, 8000);
    });
  });

  describe("Seam 2: Parallel Concurrency Cap & Dynamic Worker Slot Reallocation", () => {
    test("handles empty issue list cleanly and immediately", async () => {
      let runnerCalled = false;
      const result = await executePhase2WithWorkerPool({
        issues: [],
        taskRunner: async () => {
          runnerCalled = true;
          return { commits: [] };
        },
      });

      assert.equal(runnerCalled, false);
      assert.deepEqual(result.outcomes, []);
      assert.deepEqual(result.completed, []);
      assert.deepEqual(result.failed, []);
    });

    test("enforces concurrency cap so active tasks never exceed configured limit", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
        { id: "ISSUE-3", title: "Task 3", branch: "b3" },
        { id: "ISSUE-4", title: "Task 4", branch: "b4" },
        { id: "ISSUE-5", title: "Task 5", branch: "b5" },
      ];

      let currentActive = 0;
      let maxActiveObserved = 0;
      const concurrencyCap = 2;

      const result = await executePhase2WithWorkerPool({
        issues,
        concurrency: concurrencyCap,
        staggerDelay: 0,
        delayFn: async () => {},
        taskRunner: async (issue) => {
          currentActive++;
          if (currentActive > maxActiveObserved) {
            maxActiveObserved = currentActive;
          }
          // Micro-tick yield
          await new Promise((resolve) => setImmediate(resolve));
          currentActive--;
          return { branch: issue.branch, commits: [`feat: ${issue.id}`] };
        },
      });

      assert.equal(maxActiveObserved, concurrencyCap);
      assert.equal(result.outcomes.length, 5);
      assert.equal(result.completed.length, 5);
      assert.equal(result.failed.length, 0);
    });

    test("dynamically allocates freed slot to next issue without waiting for rigid batches", async () => {
      // 4 issues:
      // Issue 1 finishes very quickly (fast).
      // Issue 2 finishes slowly.
      // Issue 3 is queued.
      // Under dynamic pool with concurrency 2: Issue 3 MUST start as soon as Issue 1 finishes,
      // before Issue 2 finishes!
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-FAST", title: "Fast task", branch: "b-fast" },
        { id: "ISSUE-SLOW", title: "Slow task", branch: "b-slow" },
        { id: "ISSUE-QUEUED", title: "Queued task", branch: "b-queued" },
      ];

      const startTimes = new Map<string, number>();
      const finishTimes = new Map<string, number>();
      let virtualTime = 0;

      // Mock resolvers
      let resolveFast: () => void = () => {};
      let resolveSlow: () => void = () => {};
      let resolveQueued: () => void = () => {};

      const fastPromise = new Promise<void>((r) => { resolveFast = r; });
      const slowPromise = new Promise<void>((r) => { resolveSlow = r; });
      const queuedPromise = new Promise<void>((r) => { resolveQueued = r; });

      const poolPromise = executePhase2WithWorkerPool({
        issues,
        concurrency: 2,
        staggerDelay: 0,
        delayFn: async () => {},
        taskRunner: async (issue) => {
          startTimes.set(issue.id, virtualTime);
          if (issue.id === "ISSUE-FAST") {
            await fastPromise;
          } else if (issue.id === "ISSUE-SLOW") {
            await slowPromise;
          } else if (issue.id === "ISSUE-QUEUED") {
            await queuedPromise;
          }
          finishTimes.set(issue.id, virtualTime);
          return { commits: [issue.id] };
        },
      });

      // Let pool initialize active slots
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(startTimes.has("ISSUE-FAST"), true);
      assert.equal(startTimes.has("ISSUE-SLOW"), true);
      assert.equal(startTimes.has("ISSUE-QUEUED"), false, "Queued issue must not start while slots are full");

      // Now resolve FAST issue at virtualTime = 10
      virtualTime = 10;
      resolveFast();
      await new Promise((resolve) => setImmediate(resolve));

      // Issue 3 (QUEUED) should now have started, while Issue 2 (SLOW) is still pending!
      assert.equal(startTimes.has("ISSUE-QUEUED"), true, "Queued issue must start as soon as fast slot is freed");
      assert.equal(finishTimes.has("ISSUE-SLOW"), false, "Slow issue should still be running");

      // Now finish QUEUED and SLOW
      virtualTime = 20;
      resolveQueued();
      await new Promise((resolve) => setImmediate(resolve));

      virtualTime = 30;
      resolveSlow();

      const result = await poolPromise;
      assert.equal(result.completed.length, 3);
      assert.equal(result.failed.length, 0);
    });
  });

  describe("Seam 3: Stagger Delay Injection & Jitter Dispersion", () => {
    test("first worker starts immediately without delay; subsequent workers receive stagger delay", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
        { id: "ISSUE-3", title: "Task 3", branch: "b3" },
      ];

      const recordedDelays: number[] = [];
      const startLog: string[] = [];
      let virtualTime = 1000;

      await executePhase2WithWorkerPool({
        issues,
        concurrency: 3,
        staggerDelay: 8,
        randomFn: () => 0.5, // 0 jitter = exactly 8000ms
        nowFn: () => virtualTime,
        delayFn: async (ms) => {
          recordedDelays.push(ms);
          virtualTime += ms;
        },
        taskRunner: async (issue) => {
          startLog.push(issue.id);
          return { branch: issue.branch };
        },
      });

      // 3 issues started: 1st had 0 delay, 2nd had 8000ms, 3rd had 8000ms
      assert.deepEqual(recordedDelays, [8000, 8000]);
      assert.deepEqual(startLog, ["ISSUE-1", "ISSUE-2", "ISSUE-3"]);
    });

    test("applies random jitter to successive stagger intervals", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
        { id: "ISSUE-3", title: "Task 3", branch: "b3" },
      ];

      const recordedDelays: number[] = [];
      const randomValues = [0.0, 1.0]; // will produce 6000ms (-25%) and 10000ms (+25%)
      let randomIndex = 0;
      let virtualTime = 1000;

      await executePhase2WithWorkerPool({
        issues,
        concurrency: 3,
        staggerDelay: 8,
        jitterRatio: 0.25,
        randomFn: () => randomValues[randomIndex++] ?? 0.5,
        nowFn: () => virtualTime,
        delayFn: async (ms) => {
          recordedDelays.push(ms);
          virtualTime += ms;
        },
        taskRunner: async (issue) => ({ branch: issue.branch }),
      });

      assert.deepEqual(recordedDelays, [6000, 10000]);
    });

    test("skips stagger delay when staggerDelay is 0", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
      ];

      const recordedDelays: number[] = [];

      await executePhase2WithWorkerPool({
        issues,
        concurrency: 3,
        staggerDelay: 0,
        delayFn: async (ms) => {
          recordedDelays.push(ms);
        },
        taskRunner: async (issue) => ({ branch: issue.branch }),
      });

      assert.deepEqual(recordedDelays, []);
    });

    test("allocates freed slot immediately without additional delay if stagger interval already elapsed", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
      ];

      const recordedDelays: number[] = [];
      let virtualClock = 1000;

      await executePhase2WithWorkerPool({
        issues,
        concurrency: 1, // serial: Task 1 runs, then Task 2 takes the slot
        staggerDelay: 8, // 8000ms
        randomFn: () => 0.5,
        nowFn: () => virtualClock,
        delayFn: async (ms) => {
          recordedDelays.push(ms);
          virtualClock += ms;
        },
        taskRunner: async (issue) => {
          if (issue.id === "ISSUE-1") {
            // Task 1 runs for 15,000ms (more than 8000ms stagger target)
            virtualClock += 15000;
          }
          return { branch: issue.branch };
        },
      });

      // Task 1 started at 1000.
      // Task 1 finished at 16000.
      // Elapsed since last launch is 15000ms >= 8000ms stagger.
      // Therefore, remaining stagger delay for Task 2 is 0, so delayFn is never called!
      assert.deepEqual(recordedDelays, []);
    });
  });

  describe("Seam 4: Individual Failure Isolation & Outcome Recording", () => {
    test("isolates rejection in one task so other tasks complete unimpeded", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-OK-1", title: "Good 1", branch: "b1" },
        { id: "ISSUE-FAIL", title: "Failing task", branch: "b-fail" },
        { id: "ISSUE-OK-2", title: "Good 2", branch: "b2" },
      ];

      const result = await executePhase2WithWorkerPool({
        issues,
        concurrency: 2,
        staggerDelay: 0,
        delayFn: async () => {},
        taskRunner: async (issue) => {
          if (issue.id === "ISSUE-FAIL") {
            throw new Error("Docker daemon terminated abruptly");
          }
          return { commits: [`commit-${issue.id}`] };
        },
      });

      assert.equal(result.outcomes.length, 3);
      assert.equal(result.completed.length, 2);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0]?.id, "ISSUE-FAIL");

      // Verify outcomes mapping preserves original order
      assert.equal(result.outcomes[0]?.status, "fulfilled");
      assert.equal(result.outcomes[0]?.issue.id, "ISSUE-OK-1");

      assert.equal(result.outcomes[1]?.status, "rejected");
      assert.equal(result.outcomes[1]?.issue.id, "ISSUE-FAIL");
      assert.match(String(result.outcomes[1]?.reason), /Docker daemon terminated abruptly/);

      assert.equal(result.outcomes[2]?.status, "fulfilled");
      assert.equal(result.outcomes[2]?.issue.id, "ISSUE-OK-2");
    });
  });

  describe("Seam 5: Rate Limit Interception & Defensive Cool-down Backoff", () => {
    test("triggers cool-down pause when a task rejects with RESOURCE_EXHAUSTED / 429", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
      ];

      const recordedDelays: number[] = [];
      const warnings: string[] = [];
      let rateLimitDiagnosisReported: any = null;

      const result = await executePhase2WithWorkerPool({
        issues,
        concurrency: 1, // serial to clearly verify cooldown before next task
        staggerDelay: 0,
        coolDownDelay: 15, // 15 seconds
        delayFn: async (ms) => {
          recordedDelays.push(ms);
        },
        logger: {
          warn: (msg) => warnings.push(msg),
        },
        onRateLimitCoolDown: (diag) => {
          rateLimitDiagnosisReported = diag;
        },
        taskRunner: async (issue) => {
          if (issue.id === "ISSUE-1") {
            const err = new Error("RPC failed: 429 RESOURCE_EXHAUSTED: Quota exceeded for GenerateContent requests per minute");
            throw err;
          }
          return { commits: ["feat: recovered"] };
        },
      });

      // Verify cool-down was triggered and intercepted
      assert.ok(rateLimitDiagnosisReported);
      assert.equal(rateLimitDiagnosisReported.status, "RESOURCE_EXHAUSTED");
      assert.equal(rateLimitDiagnosisReported.code, 429);

      // Warning message formatted
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /SANDCASTLE RATE LIMIT/);
      assert.match(warnings[0]!, /RESOURCE_EXHAUSTED/);
      assert.match(warnings[0]!, /15s/);

      // Delay function called with the ~15s cool-down (allow slight precision tolerance)
      assert.ok(recordedDelays.length >= 1);
      const coolDownDelays = recordedDelays.filter((d) => d >= 14000 && d <= 16000);
      assert.ok(coolDownDelays.length >= 1, `Expected cool-down delay around 15000ms, got: ${recordedDelays.join(", ")}`);

      // Both tasks accounted for
      assert.equal(result.failed.length, 1);
      assert.equal(result.completed.length, 1);
      assert.equal(result.completed[0]?.id, "ISSUE-2");
    });

    test("triggers cool-down pause when a task fulfills but return value reports rate limit", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
      ];

      const recordedDelays: number[] = [];
      const warnings: string[] = [];

      const result = await executePhase2WithWorkerPool({
        issues,
        concurrency: 1,
        staggerDelay: 0,
        coolDownDelay: 20,
        delayFn: async (ms) => {
          recordedDelays.push(ms);
        },
        logger: {
          warn: (msg) => warnings.push(msg),
        },
        taskRunner: async (issue) => {
          if (issue.id === "ISSUE-1") {
            return {
              commits: [],
              status: "RESOURCE_EXHAUSTED",
              code: 429,
              message: "Rate limit reached during execution",
            };
          }
          return { commits: ["success"] };
        },
      });

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /SANDCASTLE RATE LIMIT/);
      assert.ok(recordedDelays.some((d) => d >= 19000 && d <= 21000));
      assert.equal(result.completed.length, 2);
    });
  });

  describe("Seam 6: Worker Lifecycle Callbacks (onWorkerStart & onWorkerComplete)", () => {
    test("invokes start and complete callbacks with accurate active worker counts", async () => {
      const issues: WorkerPoolIssue[] = [
        { id: "ISSUE-1", title: "Task 1", branch: "b1" },
        { id: "ISSUE-2", title: "Task 2", branch: "b2" },
      ];

      const startEvents: { issueId: string; activeCount: number }[] = [];
      const completeEvents: { issueId: string; status: string; activeCount: number }[] = [];

      await executePhase2WithWorkerPool({
        issues,
        concurrency: 2,
        staggerDelay: 0,
        delayFn: async () => {},
        onWorkerStart: (issue, activeCount) => {
          startEvents.push({ issueId: issue.id, activeCount });
        },
        onWorkerComplete: (outcome, activeCount) => {
          completeEvents.push({
            issueId: outcome.issue.id,
            status: outcome.status,
            activeCount,
          });
        },
        taskRunner: async (issue) => {
          await new Promise((r) => setImmediate(r));
          return { branch: issue.branch };
        },
      });

      assert.equal(startEvents.length, 2);
      assert.equal(startEvents[0]?.issueId, "ISSUE-1");
      assert.equal(startEvents[1]?.issueId, "ISSUE-2");

      assert.equal(completeEvents.length, 2);
      assert.equal(completeEvents[0]?.status, "fulfilled");
      assert.equal(completeEvents[1]?.status, "fulfilled");
    });
  });

  describe("Seam 7: Orchestrator main.mts Integration (Issue #39)", () => {
    test("main.mts imports executePhase2WithWorkerPool from worker-pool.ts", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /import\s+\{[^}]*executePhase2WithWorkerPool[^}]*\}\s+from\s+["']\.\/(?:worker-pool|cli)(?:\.ts)?["']/,
        "main.mts must import executePhase2WithWorkerPool",
      );
    });

    test("main.mts invokes executePhase2WithWorkerPool with configured concurrency and staggerDelay in Phase 2", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /executePhase2WithWorkerPool<sandcastle\.SandboxRunResult>\(\{[\s\S]*?issues[\s\S]*?concurrency:\s*activeConfig\.concurrency[\s\S]*?staggerDelay:\s*parsedCli\.staggerDelay[\s\S]*?taskRunner:/m,
        "main.mts must dispatch Phase 2 through executePhase2WithWorkerPool with activeConfig.concurrency and parsedCli.staggerDelay",
      );
    });

    test("main.mts configures Implementer agent with effort: 'low' and maxIterations: 100", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /name:\s*["']implementer["'][\s\S]*?maxIterations:\s*100[\s\S]*?createAgent\(\s*implementerModel,\s*\{[\s\S]*?effort:\s*["']low["'][\s\S]*?mode:\s*["']accept-edits["']/m,
        "Implementer in main.mts must run with maxIterations: 100 and effort: 'low'",
      );
    });

    test("main.mts retains atomic Phase 3 Merge step after worker pool execution", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      const poolIndex = content.lastIndexOf("executePhase2WithWorkerPool");
      const phase2SummaryIndex = content.lastIndexOf("formatPhase2ExecutionSummary");
      const mergerIndex = content.lastIndexOf('name: "merger"');
      const phase3SummaryIndex = content.lastIndexOf("formatPhase3MergeSummary");

      assert.ok(poolIndex !== -1, "executePhase2WithWorkerPool must be present in main.mts");
      assert.ok(phase2SummaryIndex > poolIndex, "Phase 2 execution summary must occur after worker pool");
      assert.ok(mergerIndex > phase2SummaryIndex, "Phase 3 merger must occur strictly after Phase 2 execution summary");
      assert.ok(phase3SummaryIndex > mergerIndex, "Phase 3 merge summary must occur after merger");
    });
  });
});
