/**
 * Native Iteration Notification Dispatcher for Sandcastle Antigravity.
 *
 * Dispatches completion notifications at the boundary of each Pipeline Iteration:
 * - On Windows: Triggers a native system tray balloon notification with an
 *   information icon (System.Windows.Forms.NotifyIcon) and plays the default
 *   system alert sound (SystemSounds.Asterisk) via detached PowerShell execution.
 * - In Terminal: Emits the terminal alert character (\x07) and logs a formatted,
 *   eye-catching summary line to the console logger.
 *
 * Implements safe, zero-throw fallbacks so that headless environments or
 * platform/runner errors log warnings without aborting or interrupting the
 * orchestrator loop.
 */

import { spawn } from "node:child_process";

export const TERMINAL_BELL_CHAR = "\x07";
export const DEFAULT_NOTIFICATION_TITLE_PREFIX = "Sandcastle Antigravity";

/**
 * Options for dispatching an iteration notification.
 */
export interface IterationNotificationOptions {
  /** The current 1-based pipeline iteration index (e.g. 1). */
  readonly iteration: number;
  /** Total maximum pipeline iterations configured (e.g. 10). */
  readonly totalIterations: number;
  /** Number of branches integrated into Base Branch in this iteration. */
  readonly integratedBranchesCount: number;
  /** Optional custom title override for the notification. */
  readonly title?: string;
  /** Optional custom body message override for the notification. */
  readonly message?: string;

  /** Platform override for testing or cross-platform simulation. */
  readonly platform?: string;
  /** Runner override for executing external notification commands. */
  readonly runner?: NotificationRunner;
  /** Logger override for informational summary output. */
  readonly logger?: (message: string) => void;
  /** Logger override for non-fatal warning messages. */
  readonly warnLogger?: (message: string) => void;
  /** Terminal writer override for emitting the terminal bell character. */
  readonly terminalBellWriter?: (bell: string) => void;
}

/**
 * Options passed to the notification runner when spawning detached processes.
 */
export interface NotificationRunnerOptions {
  readonly detached?: boolean;
  readonly windowsHide?: boolean;
  readonly stdio?: "ignore" | "inherit" | "pipe" | unknown;
}

/**
 * Result returned by a notification command runner.
 */
export interface NotificationCommandResult {
  readonly status?: number | null;
  readonly pid?: number;
  readonly error?: Error;
}

/**
 * Runner seam for external command execution.
 */
export type NotificationRunner = (
  command: string,
  args: readonly string[],
  options?: NotificationRunnerOptions,
) => NotificationCommandResult | void;

/**
 * Injected dependencies for sendIterationNotification.
 */
export interface IterationNotificationDependencies {
  /** Platform override (defaults to process.platform). */
  readonly platform?: string;
  /** Runner override for PowerShell execution. */
  readonly runner?: NotificationRunner;
  /** Logger override for standard output. */
  readonly logger?: (message: string) => void;
  /** Logger override for warnings. */
  readonly warnLogger?: (message: string) => void;
  /** Writer override for terminal bell. */
  readonly terminalBellWriter?: (bell: string) => void;
}

/**
 * Result returned by sendIterationNotification describing the outcome.
 */
export interface NotificationResult {
  /** Whether the notification dispatched without uncaught errors. */
  readonly success: boolean;
  /** Operating system platform detected or specified. */
  readonly platform: string;
  /** Whether the Windows native notification was executed. */
  readonly windowsDispatched: boolean;
  /** Whether the system alert sound was triggered. */
  readonly soundPlayed: boolean;
  /** Whether the system tray balloon tip was sent. */
  readonly balloonSent: boolean;
  /** Whether the terminal bell was emitted. */
  readonly bellEmitted: boolean;
  /** Whether the summary log was output. */
  readonly logEmitted: boolean;
  /** Final title used in the notification. */
  readonly title: string;
  /** Final body message used in the notification. */
  readonly message: string;
  /** Command executed (if on Windows platform). */
  readonly command?: string;
  /** Arguments passed to command (if on Windows platform). */
  readonly args?: readonly string[];
  /** Warning message logged in case of partial or caught failure. */
  readonly warning?: string;
}

/**
 * Escapes characters in a string for safe embedding into PowerShell single-quoted literals.
 * In PowerShell single-quoted strings, only single quotes need escaping (doubled as '').
 */
export function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Resolves the notification title, defaulting to "Iteração X/Y concluída".
 */
export function formatIterationNotificationTitle(options: {
  iteration: number;
  totalIterations: number;
  title?: string;
}): string {
  if (options.title) {
    return options.title;
  }
  return `Iteração ${options.iteration}/${options.totalIterations} concluída`;
}

/**
 * Resolves the notification body message based on the count of integrated branches.
 */
export function formatIterationNotificationMessage(options: {
  integratedBranchesCount: number;
  message?: string;
}): string {
  if (options.message) {
    return options.message;
  }
  if (options.integratedBranchesCount === 0) {
    return "Nenhuma branch integrada (ciclo finalizado).";
  }
  if (options.integratedBranchesCount === 1) {
    return "1 branch integrada à Base Branch com sucesso.";
  }
  return `${options.integratedBranchesCount} branches integradas à Base Branch com sucesso.`;
}

/**
 * Formats an eye-catching terminal summary line containing alert icon and unicode bullet.
 */
export function formatIterationNotificationConsoleSummary(
  title: string,
  message: string,
): string {
  return `🔔 [Iteration Notification] ${title} • ${message}`;
}

/**
 * Builds the PowerShell script that loads Windows Forms and Drawing assemblies,
 * plays the system Asterisk alert sound, configures the system tray NotifyIcon,
 * and calls ShowBalloonTip.
 */
export function buildWindowsNotificationScript(title: string, message: string): string {
  const escapedTitle = escapePowerShellSingleQuotedString(title);
  const escapedMessage = escapePowerShellSingleQuotedString(message);

  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "[System.Media.SystemSounds]::Asterisk.Play()",
    "$notify = New-Object System.Windows.Forms.NotifyIcon",
    "$notify.Icon = [System.Drawing.SystemIcons]::Information",
    `$notify.BalloonTipTitle = '${escapedTitle}'`,
    `$notify.BalloonTipText = '${escapedMessage}'`,
    "$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info",
    "$notify.Visible = $true",
    "$notify.ShowBalloonTip(10000)",
    "Start-Sleep -Milliseconds 1500",
    "$notify.Dispose()",
  ].join("\n");
}

/**
 * Builds the command and argument array for powershell.exe invocation.
 */
export function buildWindowsNotificationCommand(
  title: string,
  message: string,
): { command: string; args: string[] } {
  const script = buildWindowsNotificationScript(title, message);
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
  };
}

/**
 * Default production command runner using detached child_process.spawn.
 */
export const defaultNotificationRunner: NotificationRunner = (command, args, options) => {
  try {
    const child = spawn(command, [...args], {
      detached: options?.detached ?? true,
      windowsHide: options?.windowsHide ?? true,
      stdio: (options?.stdio as "ignore" | "inherit" | "pipe") ?? "ignore",
    });
    child.unref();
    return { pid: child.pid, status: 0 };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { status: 1, error };
  }
};

/**
 * Default production terminal bell writer.
 */
export const defaultTerminalBellWriter = (bell: string): void => {
  process.stdout.write(bell);
};

/**
 * Dispatches an iteration completion notification across native OS and terminal channels.
 *
 * @param options Notification details including cycle indices and branch count.
 * @param dependencies Optional injected seams for platform, runner, loggers, and bell writer.
 * @returns Result object detailing channel outcomes and diagnostics.
 */
export function sendIterationNotification(
  options: IterationNotificationOptions,
  dependencies?: IterationNotificationDependencies,
): NotificationResult {
  const platform = dependencies?.platform ?? options.platform ?? process.platform;
  const runner = dependencies?.runner ?? options.runner ?? defaultNotificationRunner;
  const logger = dependencies?.logger ?? options.logger ?? console.log;
  const warnLogger = dependencies?.warnLogger ?? options.warnLogger ?? console.warn;
  const terminalBellWriter =
    dependencies?.terminalBellWriter ?? options.terminalBellWriter ?? defaultTerminalBellWriter;

  const title = formatIterationNotificationTitle(options);
  const message = formatIterationNotificationMessage(options);

  let bellEmitted = false;
  let logEmitted = false;
  let windowsDispatched = false;
  let soundPlayed = false;
  let balloonSent = false;
  let dispatchedCommand: string | undefined;
  let dispatchedArgs: readonly string[] | undefined;
  let failureWarning: string | undefined;

  // 1. Emit terminal alert character (\x07)
  try {
    terminalBellWriter(TERMINAL_BELL_CHAR);
    bellEmitted = true;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const bellWarn = `[notifications] Warning: Failed to emit terminal bell: ${errorMsg}`;
    warnLogger(bellWarn);
  }

  // 2. Output eye-catching summary line to console logger
  try {
    const summaryLine = formatIterationNotificationConsoleSummary(title, message);
    logger(summaryLine);
    logEmitted = true;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const logWarn = `[notifications] Warning: Failed to write notification summary to log: ${errorMsg}`;
    warnLogger(logWarn);
  }

  // 3. Dispatch native Windows notification if platform is win32
  if (platform === "win32") {
    try {
      const cmdInfo = buildWindowsNotificationCommand(title, message);
      dispatchedCommand = cmdInfo.command;
      dispatchedArgs = cmdInfo.args;

      const runResult = runner(cmdInfo.command, cmdInfo.args, {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      });

      if (runResult && runResult.error) {
        throw runResult.error;
      }
      if (
        runResult &&
        runResult.status !== undefined &&
        runResult.status !== null &&
        runResult.status !== 0
      ) {
        throw new Error(`PowerShell process exited with non-zero code ${runResult.status}`);
      }

      windowsDispatched = true;
      soundPlayed = true;
      balloonSent = true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failureWarning = `[notifications] Warning: Failed to dispatch native Windows notification: ${errorMsg}`;
      warnLogger(failureWarning);
    }
  }

  return {
    success: failureWarning === undefined,
    platform,
    windowsDispatched,
    soundPlayed,
    balloonSent,
    bellEmitted,
    logEmitted,
    title,
    message,
    command: dispatchedCommand,
    args: dispatchedArgs,
    warning: failureWarning,
  };
}
