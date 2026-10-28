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
} from "./operations.ts";

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
};

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
  readonly tag?: string;
  readonly unknownCommand?: string;
  readonly invalidArgError?: string;
  readonly rawArgs: readonly string[];
}

export interface CliValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export function validateCliArgs(args: CliParsedArgs): CliValidationResult {
  if (args.invalidArgError) {
    return {
      valid: false,
      error: args.invalidArgError,
    };
  }
  if (args.command === "unknown") {
    return {
      valid: false,
      error: `Unknown subcommand: "${args.unknownCommand}".`,
    };
  }
  return { valid: true };
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

function isKnownCommand(cmd: string): cmd is KnownCliCommand {
  return KNOWN_COMMANDS.has(cmd);
}

/**
 * Parses raw command-line arguments into a structured CliParsedArgs object.
 */
export function parseCliArgs(argv: readonly string[]): CliParsedArgs {
  // Strip node and binary if present (e.g. process.argv is ["node", "sandcastle-agy", ...])
  let args = [...argv];
  if (args.length > 0 && (args[0].endsWith("node") || args[0].endsWith("node.exe"))) {
    args.shift();
  }
  if (
    args.length > 0 &&
    (args[0].endsWith("main.mts") ||
      args[0].endsWith("main.ts") ||
      args[0].endsWith("cli.mts") ||
      args[0].endsWith("cli.ts") ||
      args[0].endsWith("sandcastle-agy"))
  ) {
    args.shift();
  }

  // Handle direct flags without subcommand (e.g. --help, -h, --version, -v)
  if (args.includes("--help") || args.includes("-h") || (args.length > 0 && args[0] === "help")) {
    return {
      command: "help",
      yes: false,
      rawArgs: Object.freeze(argv),
    };
  }

  if (args.includes("--version") || args.includes("-v") || (args.length > 0 && args[0] === "version")) {
    return {
      command: "version",
      yes: false,
      rawArgs: Object.freeze(argv),
    };
  }

  let explicitCommand: CliCommand | undefined;
  let unknownCommand: string | undefined;
  let repoPath: string | undefined;
  let yes = false;
  let tag: string | undefined;
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
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
      i++;
    } else if (arg === "--tag" || arg === "-t") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        invalidArgError = `Option "${arg}" requires an image tag argument.`;
        i++;
      } else {
        tag = args[i + 1];
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

  const command: CliCommand = unknownCommand
    ? "unknown"
    : (explicitCommand ?? "run");

  return {
    command,
    repoPath,
    yes,
    tag,
    unknownCommand,
    invalidArgError,
    rawArgs: Object.freeze(argv),
  };
}

export function formatCliHelp(): string {
  return [
    "sandcastle-agy - Standalone Multi-Agent Orchestrator for Google Antigravity CLI",
    "",
    "Usage:",
    "  sandcastle-agy <command> [options]",
    "",
    "Commands:",
    "  run          Run the 4-phase multi-agent orchestrator loop against a target repository",
    "  rescue       Kill dangling containers, prune Git worktrees, and copy logs to clipboard",
    "  doctor       Run diagnostic pre-flight checks (OAuth, Docker, Git, GH CLI, Tech Stack)",
    "  build-image  Build the sandcastle-agent Docker container image locally",
    "  help         Show this help message",
    "",
    "Options:",
    "  --repo, -r <path>  Target repository path (default: current directory)",
    "  --yes, -y          Skip interactive confirmation banner (non-interactive mode)",
    "  --tag, -t <tag>    Docker image tag for build-image (default: sandcastle-agent)",
    "  --help, -h         Show help message",
    "  --version, -v      Show version number",
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
        const buildResult = await runBuildImage({
          imageName: parsed.tag,
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
