/**
 * Iteration Checkpoint & Interactive Post-Merge Control for Sandcastle Antigravity.
 *
 * Implements the interactive post-merge gate inside the orchestrator loop.
 * When mode === "interactive", halts at an interactive checkpoint prompt using
 * @clack/prompts (select) presenting the operator with three distinct actions:
 * 1. Advance to next iteration (X+1/10): proceeds to the next iteration in interactive mode.
 * 2. Continue remaining iterations automatically: dynamically switches the running loop's
 *    mode to automatic in memory and continues without further checkpoints.
 * 3. Stop safely now: cleanly aborts the loop, preserving all committed and merged
 *    progress on the Base Branch, and triggering the target repository cleanup routines.
 *
 * In automatic mode or when the loop reaches natural completion (queue empty or iteration limit),
 * prompt display is safely bypassed.
 */

import {
  type PromptAdapter,
  type PromptOption,
  type ExecutionMode,
  defaultPromptAdapter,
} from "./banner.ts";
import {
  sendPipelineIterationNotification,
  type PipelineIterationNotificationOptions,
  type IterationNotificationDependencies,
  type NotificationResult,
} from "./notifications.ts";

export type CheckpointAction = "advance" | "automatic" | "stop";

export const CHECKPOINT_ACTION_ADVANCE: CheckpointAction = "advance";
export const CHECKPOINT_ACTION_AUTOMATIC: CheckpointAction = "automatic";
export const CHECKPOINT_ACTION_STOP: CheckpointAction = "stop";

export const DEFAULT_CHECKPOINT_MESSAGE = "Iteration Checkpoint: Choose an action to proceed";

/**
 * Formats the interactive checkpoint select prompt title message.
 *
 * @param iteration Completed 1-based iteration number.
 * @param totalIterations Total maximum iterations configured for the run.
 * @returns Formatted prompt message string.
 */
export function formatCheckpointPromptMessage(iteration: number, totalIterations: number): string {
  return `Iteration Checkpoint: Iteration ${iteration}/${totalIterations} completed. Choose next action:`;
}

/**
 * Builds the array of choices presented to the operator at an Iteration Checkpoint.
 *
 * @param iteration Completed 1-based iteration number.
 * @param totalIterations Total maximum iterations configured for the run.
 * @returns Array of PromptOption items with labels and hints.
 */
export function buildCheckpointOptions(iteration: number, totalIterations: number): readonly PromptOption[] {
  return [
    {
      value: CHECKPOINT_ACTION_ADVANCE,
      label: `Advance to next iteration (${iteration + 1}/${totalIterations})`,
      hint: `Proceed to iteration ${iteration + 1} and pause again at next checkpoint`,
    },
    {
      value: CHECKPOINT_ACTION_AUTOMATIC,
      label: "Continue remaining iterations automatically",
      hint: "Switch to automatic mode and run all remaining cycles without pausing",
    },
    {
      value: CHECKPOINT_ACTION_STOP,
      label: "Stop safely now",
      hint: "Exit cleanly with code 0, preserving all merged commits on base branch",
    },
  ];
}

/**
 * Iteration context parameters passed to handleIterationCheckpoint.
 */
export interface CheckpointContext {
  /** The 1-based index of the iteration that just finished (1..totalIterations). */
  readonly iteration: number;
  /** Total maximum iterations configured in the orchestrator run (e.g. 10). */
  readonly totalIterations: number;
  /** Current effective execution mode of the orchestrator. */
  readonly mode: ExecutionMode;
  /** Number of candidate branches merged into Base Branch this iteration. */
  readonly integratedBranchesCount?: number;
  /** Whether to dispatch a pipeline completion notification when not using a custom notifier. */
  readonly dispatchNotification?: boolean;
}

/**
 * Injectable seams and dependencies for handleIterationCheckpoint.
 */
export interface CheckpointDependencies {
  /** Custom prompt adapter for interactive input (defaults to defaultPromptAdapter). */
  readonly promptAdapter?: PromptAdapter;
  /** Custom notification dispatcher seam. */
  readonly notifier?: (options: PipelineIterationNotificationOptions) => NotificationResult | void;
  /** Dependencies passed down to notification runner when dispatchNotification is true. */
  readonly notificationDependencies?: IterationNotificationDependencies;
  /** Logger override for informational checkpoint events. */
  readonly logger?: (message: string) => void;
}

/**
 * Result returned by handleIterationCheckpoint indicating action taken and next mode.
 */
export interface CheckpointResult {
  /** Action selected by operator or resolved automatically. */
  readonly action: CheckpointAction;
  /** Next effective execution mode to persist in memory for subsequent cycles. */
  readonly nextMode: ExecutionMode;
  /** Whether the orchestrator loop should proceed to the next iteration. */
  readonly shouldContinue: boolean;
  /** Result of notification dispatch if dispatched. */
  readonly notificationResult?: NotificationResult;
}

/**
 * Handles the post-merge Iteration Checkpoint at the boundary of each Pipeline Iteration.
 *
 * @param options Checkpoint context parameters.
 * @param dependencies Optional injected seams for prompts, notifications, and logging.
 * @returns CheckpointResult describing decision and state transitions.
 */
export async function handleIterationCheckpoint(
  options: CheckpointContext,
  dependencies?: CheckpointDependencies,
): Promise<CheckpointResult> {
  const { iteration, totalIterations, mode, integratedBranchesCount = 0 } = options;
  const logger = dependencies?.logger ?? console.log;

  let notificationResult: NotificationResult | undefined;

  // 1. Dispatch iteration notification if notifier or dispatchNotification is enabled
  if (dependencies?.notifier) {
    const res = dependencies.notifier({
      iteration,
      totalIterations,
      integratedBranchesCount,
    });
    if (res) {
      notificationResult = res;
    }
  } else if (options.dispatchNotification) {
    notificationResult = sendPipelineIterationNotification(
      {
        iteration,
        totalIterations,
        integratedBranchesCount,
      },
      dependencies?.notificationDependencies,
    );
  }

  // 2. Natural terminal boundary: if iteration reaches limit, do not display redundant prompt
  if (iteration >= totalIterations) {
    return {
      action: CHECKPOINT_ACTION_STOP,
      nextMode: mode,
      shouldContinue: false,
      notificationResult,
    };
  }

  // 3. Automatic mode: bypass checkpoint prompt and continue seamlessly
  if (mode === "automatic") {
    return {
      action: CHECKPOINT_ACTION_ADVANCE,
      nextMode: "automatic",
      shouldContinue: true,
      notificationResult,
    };
  }

  // 4. Interactive mode: halt and prompt operator
  const promptAdapter = dependencies?.promptAdapter ?? defaultPromptAdapter;
  const promptMessage = formatCheckpointPromptMessage(iteration, totalIterations);
  const promptOptions = buildCheckpointOptions(iteration, totalIterations);

  const choice = await promptAdapter.select({
    message: promptMessage,
    options: promptOptions,
  });

  // Handle cancellation (Ctrl+C, Esc, etc.)
  if (promptAdapter.isCancel(choice)) {
    promptAdapter.cancel("Orchestration stopped at iteration checkpoint.");
    logger("[checkpoint] Checkpoint cancelled. Stopping orchestration cleanly.");
    return {
      action: CHECKPOINT_ACTION_STOP,
      nextMode: "interactive",
      shouldContinue: false,
      notificationResult,
    };
  }

  switch (choice) {
    case CHECKPOINT_ACTION_ADVANCE:
      logger(`[checkpoint] Advancing to iteration ${iteration + 1}/${totalIterations} in interactive mode.`);
      return {
        action: CHECKPOINT_ACTION_ADVANCE,
        nextMode: "interactive",
        shouldContinue: true,
        notificationResult,
      };

    case CHECKPOINT_ACTION_AUTOMATIC:
      logger(`[checkpoint] Switching execution mode to automatic. Remaining iterations will run continuously.`);
      promptAdapter.log?.info("Switching execution mode to automatic for all remaining iterations.");
      return {
        action: CHECKPOINT_ACTION_AUTOMATIC,
        nextMode: "automatic",
        shouldContinue: true,
        notificationResult,
      };

    case CHECKPOINT_ACTION_STOP:
      logger(`[checkpoint] Stopping orchestration cleanly at iteration ${iteration}/${totalIterations}.`);
      promptAdapter.log?.info("Stopping orchestration safely at checkpoint. Preserving all merged commits.");
      return {
        action: CHECKPOINT_ACTION_STOP,
        nextMode: "interactive",
        shouldContinue: false,
        notificationResult,
      };

    default:
      return {
        action: CHECKPOINT_ACTION_STOP,
        nextMode: "interactive",
        shouldContinue: false,
        notificationResult,
      };
  }
}
