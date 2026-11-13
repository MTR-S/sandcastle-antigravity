import { DEFAULT_CONCURRENCY, DEFAULT_STAGGER_DELAY } from "./cli.ts";
import {
  detectRateLimitError,
  formatRateLimitWarning,
  type RateLimitDiagnosis,
} from "./antigravity.ts";

export const DEFAULT_JITTER_RATIO = 0.25;
export const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 20;

export interface WorkerPoolIssue {
  readonly id: string;
  readonly title: string;
  readonly branch: string;
}

export type WorkerTaskOutcome<T = unknown> =
  | {
      readonly issue: WorkerPoolIssue;
      readonly status: "fulfilled";
      readonly value: T;
      readonly durationMs?: number;
    }
  | {
      readonly issue: WorkerPoolIssue;
      readonly status: "rejected";
      readonly reason: unknown;
      readonly durationMs?: number;
    };

export type WorkerTaskRunner<T = unknown> = (
  issue: WorkerPoolIssue,
  context: { readonly index: number },
) => Promise<T>;

export type DelayFunction = (ms: number) => Promise<void>;
export type RandomGenerator = () => number;
export type TimeProvider = () => number;

export interface CalculateStaggerDelayOptions {
  readonly baseSeconds?: number;
  readonly jitterRatio?: number;
  readonly randomFn?: RandomGenerator;
}

/**
 * Calculates a jittered stagger delay in milliseconds.
 *
 * Formula: baseMs * (1 + (random() * 2 - 1) * jitterRatio)
 * Clamps to 0 if baseSeconds <= 0.
 */
export function calculateStaggerDelayMs(options?: CalculateStaggerDelayOptions): number {
  const baseSeconds = options?.baseSeconds ?? DEFAULT_STAGGER_DELAY;
  if (baseSeconds <= 0) {
    return 0;
  }
  const jitterRatio = options?.jitterRatio !== undefined ? Math.max(0, options.jitterRatio) : DEFAULT_JITTER_RATIO;
  const randomFn = options?.randomFn ?? Math.random;

  const rawRandom = randomFn();
  const clampedRandom = Math.max(0, Math.min(1, rawRandom));
  // Maps [0, 1] to [-1, 1]
  const jitterOffset = (clampedRandom * 2 - 1) * jitterRatio;
  const effectiveMultiplier = Math.max(0, 1 + jitterOffset);

  return Math.round(baseSeconds * 1000 * effectiveMultiplier);
}

export interface WorkerPoolLogger {
  readonly log?: (msg: string) => void;
  readonly warn?: (msg: string) => void;
  readonly error?: (msg: string) => void;
}

export interface WorkerPoolOptions<T = unknown> {
  readonly issues: readonly WorkerPoolIssue[];
  readonly taskRunner: WorkerTaskRunner<T>;
  readonly concurrency?: number;
  readonly staggerDelay?: number;
  readonly jitterRatio?: number;
  readonly coolDownDelay?: number;
  readonly delayFn?: DelayFunction;
  readonly randomFn?: RandomGenerator;
  readonly nowFn?: TimeProvider;
  readonly onWorkerStart?: (issue: WorkerPoolIssue, activeCount: number) => void;
  readonly onWorkerComplete?: (outcome: WorkerTaskOutcome<T>, activeCount: number) => void;
  readonly onRateLimitCoolDown?: (diagnosis: RateLimitDiagnosis, coolDownMs: number) => void;
  readonly logger?: WorkerPoolLogger;
}

export interface WorkerPoolResult<T = unknown> {
  readonly outcomes: readonly WorkerTaskOutcome<T>[];
  readonly completed: readonly WorkerPoolIssue[];
  readonly failed: readonly WorkerPoolIssue[];
  readonly totalDurationMs: number;
}

const defaultDelayFn: DelayFunction = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function executePhase2WithWorkerPool<T = unknown>(
  options: WorkerPoolOptions<T>,
): Promise<WorkerPoolResult<T>> {
  const issues = options.issues ?? [];
  if (issues.length === 0) {
    return {
      outcomes: [],
      completed: [],
      failed: [],
      totalDurationMs: 0,
    };
  }

  const nowFn = options.nowFn ?? Date.now;
  const overallStartTime = nowFn();

  const effectiveConcurrency =
    options.concurrency !== undefined && options.concurrency > 0
      ? options.concurrency
      : DEFAULT_CONCURRENCY;

  const staggerDelaySeconds =
    options.staggerDelay !== undefined && options.staggerDelay >= 0
      ? options.staggerDelay
      : DEFAULT_STAGGER_DELAY;

  const coolDownSeconds =
    options.coolDownDelay !== undefined && options.coolDownDelay >= 0
      ? options.coolDownDelay
      : DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS;

  const delayFn = options.delayFn ?? defaultDelayFn;
  const randomFn = options.randomFn ?? Math.random;
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;

  const outcomes: WorkerTaskOutcome<T>[] = new Array(issues.length);
  const completedIssues: WorkerPoolIssue[] = [];
  const failedIssues: WorkerPoolIssue[] = [];

  const activePromises = new Set<Promise<void>>();
  let coolDownUntil = 0;
  let lastLaunchTime = -1;

  function triggerRateLimit(diag: RateLimitDiagnosis) {
    const coolDownMs = coolDownSeconds * 1000;
    coolDownUntil = Math.max(coolDownUntil, nowFn() + coolDownMs);

    const warningMessage = formatRateLimitWarning(diag, coolDownSeconds);
    if (options.logger?.warn) {
      options.logger.warn(warningMessage);
    } else {
      console.warn(warningMessage);
    }

    if (options.onRateLimitCoolDown) {
      options.onRateLimitCoolDown(diag, coolDownMs);
    }
  }

  function settleWorker(
    index: number,
    outcome: WorkerTaskOutcome<T>,
    activeRemaining: number,
  ) {
    outcomes[index] = outcome;
    if (outcome.status === "fulfilled") {
      completedIssues.push(outcome.issue);
    } else {
      failedIssues.push(outcome.issue);
    }

    if (options.onWorkerComplete) {
      options.onWorkerComplete(outcome, activeRemaining);
    }
  }

  for (let index = 0; index < issues.length; index++) {
    const issue = issues[index]!;

    // Wait until an active slot becomes free
    while (activePromises.size >= effectiveConcurrency) {
      await Promise.race(Array.from(activePromises));
    }

    // Check if defensive rate-limit cool-down is in effect
    const currentTime = nowFn();
    if (coolDownUntil > currentTime) {
      const waitMs = coolDownUntil - currentTime;
      // Reset coolDownUntil once acknowledged
      coolDownUntil = 0;
      await delayFn(waitMs);
    }

    // Apply Stagger Delay between worker launches relative to last launch time
    if (lastLaunchTime >= 0 && staggerDelaySeconds > 0) {
      const targetStaggerMs = calculateStaggerDelayMs({
        baseSeconds: staggerDelaySeconds,
        jitterRatio,
        randomFn,
      });
      const elapsedSinceLastLaunch = nowFn() - lastLaunchTime;
      const remainingStaggerMs = targetStaggerMs - elapsedSinceLastLaunch;
      if (remainingStaggerMs > 0) {
        await delayFn(remainingStaggerMs);
      }
    }

    lastLaunchTime = nowFn();

    let resolveWorkerPromise: () => void;
    const workerPromise = new Promise<void>((resolve) => {
      resolveWorkerPromise = resolve;
    });
    activePromises.add(workerPromise);

    if (options.onWorkerStart) {
      options.onWorkerStart(issue, activePromises.size);
    }

    // Execute worker in the background
    (async () => {
      const startTime = nowFn();
      try {
        const result = await options.taskRunner(issue, { index });
        const finishTime = nowFn();

        const rateLimitFromValue = detectRateLimitError(result);
        if (rateLimitFromValue) {
          triggerRateLimit(rateLimitFromValue);
        }

        settleWorker(
          index,
          {
            issue,
            status: "fulfilled",
            value: result,
            durationMs: finishTime - startTime,
          },
          activePromises.size - 1,
        );
      } catch (reason) {
        const finishTime = nowFn();

        const rateLimitFromReason = detectRateLimitError(reason);
        if (rateLimitFromReason) {
          triggerRateLimit(rateLimitFromReason);
        }

        settleWorker(
          index,
          {
            issue,
            status: "rejected",
            reason,
            durationMs: finishTime - startTime,
          },
          activePromises.size - 1,
        );
      } finally {
        activePromises.delete(workerPromise);
        resolveWorkerPromise!();
      }
    })();
  }

  // Wait for all remaining active workers to finish
  if (activePromises.size > 0) {
    await Promise.all(Array.from(activePromises));
  }

  const totalDurationMs = nowFn() - overallStartTime;

  return {
    outcomes,
    completed: completedIssues,
    failed: failedIssues,
    totalDurationMs,
  };
}
