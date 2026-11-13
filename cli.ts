import { z } from "zod";
import {
  runRescue,
  type RescueOptions,
  type RescueResult,
  runDoctor,
  type DoctorOptions,
  type DoctorResult,
  type DoctorCheckResult,
  runBuildImage,
  type BuildImageOptions,
  type BuildImageResult,
  getBranchCommits,
  formatBranchCommitsSummary,
  formatPhase2ExecutionSummary,
  renderPhase2ExecutionSummary,
  getIntegratedCommits,
  formatIntegratedCommitsSummary,
  getBranchHeadRevision,
  formatPhase3MergeSummary,
  renderPhase3MergeSummary,
  DEFAULT_COMMIT_FALLBACK_MESSAGE,
  DEFAULT_INTEGRATED_EMPTY_MESSAGE,
  type GitCommitInfo,
  type GetBranchCommitsOptions,
  type FormatBranchCommitsOptions,
  type FormatPhase2ExecutionSummaryOptions,
  type RenderPhase2ExecutionSummaryOptions,
  type GetIntegratedCommitsOptions,
  type FormatIntegratedCommitsOptions,
  type GetBranchHeadRevisionOptions,
  type FormatPhase3MergeSummaryOptions,
  type RenderPhase3MergeSummaryOptions,
  type OperationsGitRunner,
} from "./operations.ts";
import {
  TERMINAL_BELL_CHAR,
  DEFAULT_NOTIFICATION_TITLE_PREFIX,
  escapePowerShellSingleQuotedString,
  formatIterationNotificationTitle,
  formatIterationNotificationMessage,
  formatIterationNotificationConsoleSummary,
  buildWindowsNotificationScript,
  buildWindowsNotificationCommand,
  sendIterationNotification,
  formatZeroUnblockedNotificationMessage,
  formatNoCommitsNotificationMessage,
  formatIterationLimitNotificationMessage,
  sendLoopTerminalNotification,
  sendPipelineIterationNotification,
  DEFAULT_ZERO_UNBLOCKED_NOTIFICATION_MESSAGE,
  DEFAULT_NO_COMMITS_NOTIFICATION_MESSAGE,
  DEFAULT_ITERATION_LIMIT_NOTIFICATION_SUFFIX,
  DEFAULT_ORCHESTRATION_COMPLETED_TITLE,
  defaultNotificationRunner,
  defaultTerminalBellWriter,
  type NotificationStdio,
  type FormatIterationNotificationTitleOptions,
  type FormatIterationNotificationMessageOptions,
  type IterationNotificationOptions,
  type LoopTerminalReason,
  type TerminalNotificationOptions,
  type PipelineIterationNotificationOptions,
  type WindowsNotificationCommand,
  type NotificationRunnerOptions,
  type NotificationCommandResult,
  type NotificationRunner,
  type IterationNotificationDependencies,
  type NotificationResult,
} from "./notifications.ts";
export {
  handleIterationCheckpoint,
  formatCheckpointPromptMessage,
  buildCheckpointOptions,
  CHECKPOINT_ACTION_ADVANCE,
  CHECKPOINT_ACTION_AUTOMATIC,
  CHECKPOINT_ACTION_STOP,
  DEFAULT_CHECKPOINT_MESSAGE,
  type CheckpointAction,
  type CheckpointContext,
  type CheckpointDependencies,
  type CheckpointResult,
} from "./checkpoint.ts";

export {
  calculateStaggerDelayMs,
  executePhase2WithWorkerPool,
  DEFAULT_JITTER_RATIO,
  DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS,
  type WorkerPoolIssue,
  type WorkerTaskOutcome,
  type WorkerTaskRunner,
  type WorkerPoolOptions,
  type WorkerPoolResult,
  type CalculateStaggerDelayOptions,
  type DelayFunction,
  type RandomGenerator,
} from "./worker-pool.ts";

export {
  runRescue,
  type RescueOptions,
  type RescueResult,
  runDoctor,
  type DoctorOptions,
  type DoctorResult,
  type DoctorCheckResult,
  runBuildImage,
  type BuildImageOptions,
  type BuildImageResult,
  getBranchCommits,
  formatBranchCommitsSummary,
  formatPhase2ExecutionSummary,
  renderPhase2ExecutionSummary,
  getIntegratedCommits,
  formatIntegratedCommitsSummary,
  getBranchHeadRevision,
  formatPhase3MergeSummary,
  renderPhase3MergeSummary,
  DEFAULT_COMMIT_FALLBACK_MESSAGE,
  DEFAULT_INTEGRATED_EMPTY_MESSAGE,
  type GitCommitInfo,
  type GetBranchCommitsOptions,
  type FormatBranchCommitsOptions,
  type FormatPhase2ExecutionSummaryOptions,
  type RenderPhase2ExecutionSummaryOptions,
  type GetIntegratedCommitsOptions,
  type FormatIntegratedCommitsOptions,
  type GetBranchHeadRevisionOptions,
  type FormatPhase3MergeSummaryOptions,
  type RenderPhase3MergeSummaryOptions,
  type OperationsGitRunner,
  TERMINAL_BELL_CHAR,
  DEFAULT_NOTIFICATION_TITLE_PREFIX,
  escapePowerShellSingleQuotedString,
  formatIterationNotificationTitle,
  formatIterationNotificationMessage,
  formatIterationNotificationConsoleSummary,
  buildWindowsNotificationScript,
  buildWindowsNotificationCommand,
  sendIterationNotification,
  formatZeroUnblockedNotificationMessage,
  formatNoCommitsNotificationMessage,
  formatIterationLimitNotificationMessage,
  sendLoopTerminalNotification,
  sendPipelineIterationNotification,
  DEFAULT_ZERO_UNBLOCKED_NOTIFICATION_MESSAGE,
  DEFAULT_NO_COMMITS_NOTIFICATION_MESSAGE,
  DEFAULT_ITERATION_LIMIT_NOTIFICATION_SUFFIX,
  DEFAULT_ORCHESTRATION_COMPLETED_TITLE,
  defaultNotificationRunner,
  defaultTerminalBellWriter,
  type NotificationStdio,
  type FormatIterationNotificationTitleOptions,
  type FormatIterationNotificationMessageOptions,
  type IterationNotificationOptions,
  type LoopTerminalReason,
  type TerminalNotificationOptions,
  type PipelineIterationNotificationOptions,
  type WindowsNotificationCommand,
  type NotificationRunnerOptions,
  type NotificationCommandResult,
  type NotificationRunner,
  type IterationNotificationDependencies,
  type NotificationResult,
};

export const ExecutionModeSchema = z.enum(["automatic", "interactive"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const DEFAULT_CLI_EXECUTION_MODE: ExecutionMode = "automatic";
export const CLI_INTERACTIVE_PRECEDENCE_WARNING =
  "--yes flag takes precedence over interactive mode. Running in automatic mode.";

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_STAGGER_DELAY = 8;

export type CliCommand =
  | "run"
  | "rescue"
  | "doctor"
  | "build-image"
  | "help"
  | "version"
  | "unknown";

export interface CliParsedArgs {
  readonly command: CliCommand;
  readonly repoPath?: string;
  readonly yes: boolean;
  readonly mode: ExecutionMode;
  readonly tag?: string;
  readonly buildArgs?: readonly string[];
  readonly concurrency?: number;
  readonly staggerDelay?: number;
  readonly unknownCommand?: string;
  readonly invalidArgError?: string;
  readonly warning?: string;
  readonly warnings?: readonly string[];
  readonly rawArgs: readonly string[];
}

export const CliParsedArgsSchema = z.object({
  command: z.enum(["run", "rescue", "doctor", "build-image", "help", "version", "unknown"]),
  repoPath: z.string().optional(),
  yes: z.boolean(),
  mode: ExecutionModeSchema.default(DEFAULT_CLI_EXECUTION_MODE),
  tag: z.string().optional(),
  buildArgs: z.array(z.string()).optional(),
  concurrency: z.number().int().positive().optional(),
  staggerDelay: z.number().int().positive().optional(),
  unknownCommand: z.string().optional(),
  invalidArgError: z.string().optional(),
  warning: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  rawArgs: z.array(z.string()),
});

export interface CliValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly warning?: string;
  readonly warnings?: readonly string[];
}

export function validateCliArgs(args: CliParsedArgs): CliValidationResult {
  const warnings = {
    warning: args.warning,
    warnings: args.warnings,
  };

  const schemaResult = CliParsedArgsSchema.safeParse(args);
  if (!schemaResult.success) {
    return {
      valid: false,
      error: `Invalid CLI arguments: ${schemaResult.error.message}`,
      ...warnings,
    };
  }
  if (args.invalidArgError) {
    return {
      valid: false,
      error: args.invalidArgError,
      ...warnings,
    };
  }
  if (args.command === "unknown") {
    return {
      valid: false,
      error: `Unknown subcommand: "${args.unknownCommand}".`,
      ...warnings,
    };
  }
  return {
    valid: true,
    ...warnings,
  };
}

export interface CliIo {
  readonly logger?: (msg: string) => void;
  readonly errorLogger?: (msg: string) => void;
  readonly runHandler?: (args: CliParsedArgs, io: CliIo) => Promise<number>;
  readonly rescueHandler?: (args: CliParsedArgs, io: CliIo) => Promise<number>;
  readonly doctorHandler?: (args: CliParsedArgs, io: CliIo) => Promise<number>;
  readonly buildImageHandler?: (args: CliParsedArgs, io: CliIo) => Promise<number>;
}

export const CLI_VERSION = "0.1.0";

type KnownCliCommand = "run" | "rescue" | "doctor" | "build-image" | "help";

const KNOWN_COMMANDS = new Set<string>([
  "run",
  "rescue",
  "doctor",
  "build-image",
  "help",
]);

const RUNTIME_BINARY_PATTERN = /^(?:node|tsx)(?:\.exe)?$/i;
const CLI_BINARY_OR_SCRIPT_PATTERN =
  /^(?:sandcastle-agy|sc-agy|(?:main|cli)\.(?:mts|ts|js|mjs))(?:\.(?:cmd|ps1|exe))?$/i;

function isKnownCommand(cmd: string): cmd is KnownCliCommand {
  return KNOWN_COMMANDS.has(cmd);
}

function extractBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? "";
}

function isRuntimeBinary(arg: string): boolean {
  return RUNTIME_BINARY_PATTERN.test(extractBasename(arg));
}

function isCliBinaryOrScript(arg: string): boolean {
  return CLI_BINARY_OR_SCRIPT_PATTERN.test(extractBasename(arg));
}

/**
 * Parses raw command-line arguments into a structured CliParsedArgs object.
 */
export function parseCliArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): CliParsedArgs {
  // Strip node / tsx runtime and binary alias / entrypoint script if present
  let args = [...argv];
  if (args.length > 0 && isRuntimeBinary(args[0])) {
    args.shift();
  }
  while (args.length > 0 && isCliBinaryOrScript(args[0])) {
    args.shift();
  }

  // Handle direct flags without subcommand (e.g. --help, -h, --version, -v)
  if (args.includes("--help") || args.includes("-h") || (args.length > 0 && args[0] === "help")) {
    return {
      command: "help",
      yes: false,
      mode: DEFAULT_CLI_EXECUTION_MODE,
      concurrency: DEFAULT_CONCURRENCY,
      staggerDelay: DEFAULT_STAGGER_DELAY,
      rawArgs: Object.freeze(argv),
    };
  }

  if (args.includes("--version") || args.includes("-v") || (args.length > 0 && args[0] === "version")) {
    return {
      command: "version",
      yes: false,
      mode: DEFAULT_CLI_EXECUTION_MODE,
      concurrency: DEFAULT_CONCURRENCY,
      staggerDelay: DEFAULT_STAGGER_DELAY,
      rawArgs: Object.freeze(argv),
    };
  }

  let explicitCommand: CliCommand | undefined;
  let unknownCommand: string | undefined;
  let repoPath: string | undefined;
  let yes = false;
  let interactiveRequested = false;
  let explicitMode: ExecutionMode | undefined;
  let tag: string | undefined;
  let buildArgs: string[] = [];
  let explicitConcurrency: number | undefined;
  let explicitStaggerDelay: number | undefined;
  let invalidArgError: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--repo" || arg === "-r") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        invalidArgError = `Option "${arg}" requires a path argument.`;
        i++;
      } else {
        repoPath = args[i + 1];
        i += 2;
      }
    } else if (arg === "--concurrency" || arg === "-c" || arg.startsWith("--concurrency=")) {
      let concVal: string | undefined;
      if (arg.startsWith("--concurrency=")) {
        concVal = arg.slice("--concurrency=".length);
        i++;
      } else if (i + 1 >= args.length || (args[i + 1].startsWith("-") && !/^-?\d+$/.test(args[i + 1]))) {
        invalidArgError = `Option "${arg}" requires a positive integer argument for concurrency.`;
        i++;
      } else {
        concVal = args[i + 1];
        i += 2;
      }

      if (concVal !== undefined) {
        const parsed = Number(concVal);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          invalidArgError = `Option "${arg}" requires a positive integer for concurrency. Received: "${concVal}".`;
        } else {
          explicitConcurrency = parsed;
        }
      }
    } else if (arg === "--stagger-delay" || arg.startsWith("--stagger-delay=")) {
      let delayVal: string | undefined;
      if (arg.startsWith("--stagger-delay=")) {
        delayVal = arg.slice("--stagger-delay=".length);
        i++;
      } else if (i + 1 >= args.length || (args[i + 1].startsWith("-") && !/^-?\d+$/.test(args[i + 1]))) {
        invalidArgError = `Option "${arg}" requires a positive integer argument (seconds) for stagger-delay.`;
        i++;
      } else {
        delayVal = args[i + 1];
        i += 2;
      }

      if (delayVal !== undefined) {
        const parsed = Number(delayVal);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          invalidArgError = `Option "${arg}" requires a positive integer (seconds) for stagger-delay. Received: "${delayVal}".`;
        } else {
          explicitStaggerDelay = parsed;
        }
      }
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
      i++;
    } else if (arg === "--interactive" || arg === "-i") {
      interactiveRequested = true;
      i++;
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      let modeVal: string | undefined;
      if (arg.startsWith("--mode=")) {
        modeVal = arg.slice("--mode=".length);
        i++;
      } else if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        invalidArgError = `Option "${arg}" requires a mode argument ("auto", "automatic", or "interactive").`;
        i++;
      } else {
        modeVal = args[i + 1];
        i += 2;
      }

      if (modeVal !== undefined) {
        const normalizedMode = modeVal.trim().toLowerCase();
        if (normalizedMode === "auto" || normalizedMode === "automatic") {
          explicitMode = "automatic";
        } else if (normalizedMode === "interactive") {
          explicitMode = "interactive";
          interactiveRequested = true;
        } else {
          invalidArgError = `Invalid mode "${modeVal}". Valid modes are "automatic" (or "auto") and "interactive".`;
        }
      }
    } else if (arg === "--tag" || arg === "-t") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        invalidArgError = `Option "${arg}" requires an image tag argument.`;
        i++;
      } else {
        tag = args[i + 1];
        i += 2;
      }
    } else if (arg === "--build-arg") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        invalidArgError = `Option "${arg}" requires a KEY=VALUE argument.`;
        i++;
      } else {
        buildArgs.push(args[i + 1]);
        i += 2;
      }
    } else if (!arg.startsWith("-")) {
      if (!explicitCommand && !unknownCommand) {
        if (isKnownCommand(arg)) {
          explicitCommand = arg;
        } else {
          unknownCommand = arg;
        }
      }
      i++;
    } else {
      i++;
    }
  }

  let command: CliCommand = "run";
  if (unknownCommand) {
    command = "unknown";
  } else if (explicitCommand) {
    command = explicitCommand;
  }

  let mode: ExecutionMode = DEFAULT_CLI_EXECUTION_MODE;
  let warning: string | undefined;
  let warnings: string[] | undefined;

  if (yes) {
    mode = DEFAULT_CLI_EXECUTION_MODE;
    if (interactiveRequested) {
      warning = CLI_INTERACTIVE_PRECEDENCE_WARNING;
      warnings = [warning];
    }
  } else if (explicitMode) {
    mode = explicitMode;
  } else if (interactiveRequested) {
    mode = "interactive";
  }

  // Resolve concurrency with precedence: CLI flag > env var > default (3)
  let concurrency = DEFAULT_CONCURRENCY;
  if (explicitConcurrency !== undefined) {
    concurrency = explicitConcurrency;
  } else if (env.SANDCASTLE_CONCURRENCY !== undefined && env.SANDCASTLE_CONCURRENCY.trim() !== "") {
    const envVal = Number(env.SANDCASTLE_CONCURRENCY.trim());
    if (Number.isInteger(envVal) && envVal > 0) {
      concurrency = envVal;
    } else if (!invalidArgError) {
      invalidArgError = `Environment variable SANDCASTLE_CONCURRENCY must be a positive integer. Received: "${env.SANDCASTLE_CONCURRENCY}".`;
    }
  }

  // Resolve stagger delay with precedence: CLI flag > env var > default (8)
  let staggerDelay = DEFAULT_STAGGER_DELAY;
  if (explicitStaggerDelay !== undefined) {
    staggerDelay = explicitStaggerDelay;
  } else if (env.SANDCASTLE_STAGGER_DELAY !== undefined && env.SANDCASTLE_STAGGER_DELAY.trim() !== "") {
    const envVal = Number(env.SANDCASTLE_STAGGER_DELAY.trim());
    if (Number.isInteger(envVal) && envVal > 0) {
      staggerDelay = envVal;
    } else if (!invalidArgError) {
      invalidArgError = `Environment variable SANDCASTLE_STAGGER_DELAY must be a positive integer (seconds). Received: "${env.SANDCASTLE_STAGGER_DELAY}".`;
    }
  }

  return {
    command,
    repoPath,
    yes,
    mode,
    tag,
    buildArgs: buildArgs.length > 0 ? Object.freeze(buildArgs) : undefined,
    concurrency,
    staggerDelay,
    unknownCommand,
    invalidArgError,
    warning,
    warnings: warnings ? Object.freeze(warnings) : undefined,
    rawArgs: Object.freeze(argv),
  };
}

export function formatCliHelp(): string {
  return [
    "sandcastle-agy - Standalone Multi-Agent Orchestrator for Google Antigravity CLI",
    "",
    "Usage:",
    "  sandcastle-agy | sc-agy <command> [options]",
    "",
    "Commands:",
    "  run          Run the 4-phase multi-agent orchestrator loop against a target repository",
    "  rescue       Kill dangling containers, prune Git worktrees, and copy logs to clipboard",
    "  doctor       Run diagnostic pre-flight checks (OAuth, Docker, Git, GH CLI, Tech Stack)",
    "  build-image  Build the sandcastle-agent Docker container image locally",
    "  help         Show this help message",
    "",
    "Options:",
    "  --repo, -r <path>       Target repository path (default: current directory)",
    "  --concurrency, -c <N>   Parallel issue concurrency cap in Phase 2 (default: 3)",
    "  --stagger-delay <sec>   Stagger delay between parallel worker starts in seconds (default: 8)",
    "  --yes, -y               Skip interactive confirmation banner (non-interactive mode)",
    "  --interactive, -i       Run orchestrator in interactive mode with post-iteration checkpoints",
    "  --mode <mode>           Execution mode: automatic (or auto) | interactive (default: automatic)",
    "  --tag, -t <tag>         Docker image tag for build-image (default: sandcastle-agent)",
    "  --help, -h              Show help message",
    "  --version, -v           Show version number",
  ].join("\n");
}

/**
 * Dispatches CLI execution to the appropriate handler.
 */
export async function dispatchCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const log = io.logger ?? console.log;
  const errorLog = io.errorLogger ?? console.error;
  const parsed = parseCliArgs(argv);

  const validation = validateCliArgs(parsed);
  if (!validation.valid) {
    errorLog(`[ERROR] ${validation.error}`);
    errorLog(formatCliHelp());
    return 1;
  }

  for (const warn of validation.warnings ?? []) {
    log(`[WARN] ${warn}`);
  }

  switch (parsed.command) {
    case "help":
      log(formatCliHelp());
      return 0;

    case "version":
      log(`sandcastle-agy v${CLI_VERSION}`);
      return 0;

    case "unknown":
      errorLog(`[ERROR] Unknown subcommand: "${parsed.unknownCommand}".`);
      errorLog(formatCliHelp());
      return 1;

    case "rescue":
      if (io.rescueHandler) {
        return await io.rescueHandler(parsed, io);
      }
      await runRescue({
        targetRepoPath: parsed.repoPath,
        logger: log,
        errorLogger: errorLog,
      });
      return 0;

    case "doctor":
      if (io.doctorHandler) {
        return await io.doctorHandler(parsed, io);
      }
      {
        const docResult = await runDoctor({
          targetRepoPath: parsed.repoPath,
          logger: log,
          errorLogger: errorLog,
        });
        return docResult.healthy ? 0 : 1;
      }

    case "build-image":
      if (io.buildImageHandler) {
        return await io.buildImageHandler(parsed, io);
      }
      {
        let buildArgsMap: Record<string, string> | undefined;
        if (parsed.buildArgs && parsed.buildArgs.length > 0) {
          buildArgsMap = {};
          for (const pair of parsed.buildArgs) {
            const eqIdx = pair.indexOf("=");
            if (eqIdx !== -1) {
              buildArgsMap[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
            }
          }
        }
        const buildResult = await runBuildImage({
          imageName: parsed.tag,
          buildArgs: buildArgsMap,
          logger: log,
          errorLogger: errorLog,
        });
        return buildResult.success ? 0 : 1;
      }

    case "run":
    default:
      if (io.runHandler) {
        return await io.runHandler(parsed, io);
      }
      return 0;
  }
}
