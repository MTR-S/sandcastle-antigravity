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
 * Supported stdio configurations for notification command execution.
 */
export type NotificationStdio = "ignore" | "inherit" | "pipe";

/**
 * Options passed to the notification runner when spawning detached processes.
 */
export interface NotificationRunnerOptions {
  readonly detached?: boolean;
  readonly windowsHide?: boolean;
  readonly stdio?: NotificationStdio;
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
 * Options for formatting the notification title.
 */
export interface FormatIterationNotificationTitleOptions {
  /** The current 1-based pipeline iteration index (e.g. 1). */
  readonly iteration: number;
  /** Total maximum pipeline iterations configured (e.g. 10). */
  readonly totalIterations: number;
  /** Optional custom title override for the notification. */
  readonly title?: string;
}

/**
 * Options for formatting the notification message.
 */
export interface FormatIterationNotificationMessageOptions {
  /** Number of branches integrated into Base Branch in this iteration. */
  readonly integratedBranchesCount: number;
  /** Optional custom body message override for the notification. */
  readonly message?: string;
}

/**
 * Options for dispatching an iteration notification.
 */
export interface IterationNotificationOptions
  extends IterationNotificationDependencies,
    FormatIterationNotificationTitleOptions,
    FormatIterationNotificationMessageOptions {}

/**
 * Windows notification command and argument specification.
 */
export interface WindowsNotificationCommand {
  readonly command: string;
  readonly args: string[];
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
 * Helper to safely extract error message from unknown thrown value.
 */
function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Helper to safely normalize an unknown caught value to an Error instance.
 */
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
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
export function formatIterationNotificationTitle(
  options: FormatIterationNotificationTitleOptions,
): string {
  if (options.title) {
    return options.title;
  }
  return `Iteração ${options.iteration}/${options.totalIterations} concluída`;
}

/**
 * Resolves the notification body message based on the count of integrated branches.
 */
export function formatIterationNotificationMessage(
  options: FormatIterationNotificationMessageOptions,
): string {
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
): WindowsNotificationCommand {
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
 * Internal helper to dispatch the native Windows notification via PowerShell.
 */
function dispatchWindowsNotification(
  title: string,
  message: string,
  runner: NotificationRunner,
): {
  success: boolean;
  command: string;
  args: readonly string[];
  warning?: string;
} {
  const cmdInfo = buildWindowsNotificationCommand(title, message);
  try {
    const runResult = runner(cmdInfo.command, cmdInfo.args, {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });

    if (runResult?.error) {
      throw runResult.error;
    }
    if (runResult?.status !== undefined && runResult.status !== null && runResult.status !== 0) {
      throw new Error(`PowerShell process exited with non-zero code ${runResult.status}`);
    }

    return {
      success: true,
      command: cmdInfo.command,
      args: cmdInfo.args,
    };
  } catch (err: unknown) {
    return {
      success: false,
      command: cmdInfo.command,
      args: cmdInfo.args,
      warning: `[notifications] Warning: Failed to dispatch native Windows notification: ${toErrorMessage(err)}`,
    };
  }
}

/**
 * Default production command runner using detached child_process.spawn.
 */
export const defaultNotificationRunner: NotificationRunner = (command, args, options) => {
  try {
    const child = spawn(command, [...args], {
      detached: options?.detached ?? true,
      windowsHide: options?.windowsHide ?? true,
      stdio: options?.stdio ?? "ignore",
    });
    child.unref();
    return { pid: child.pid, status: 0 };
  } catch (err: unknown) {
    return { status: 1, error: toError(err) };
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
    warnLogger(`[notifications] Warning: Failed to emit terminal bell: ${toErrorMessage(err)}`);
  }

  // 2. Output eye-catching summary line to console logger
  try {
    const summaryLine = formatIterationNotificationConsoleSummary(title, message);
    logger(summaryLine);
    logEmitted = true;
  } catch (err: unknown) {
    warnLogger(`[notifications] Warning: Failed to write notification summary to log: ${toErrorMessage(err)}`);
  }

  // 3. Dispatch native Windows notification if platform is win32
  if (platform === "win32") {
    const dispatch = dispatchWindowsNotification(title, message, runner);
    dispatchedCommand = dispatch.command;
    dispatchedArgs = dispatch.args;
    if (dispatch.success) {
      windowsDispatched = true;
      soundPlayed = true;
      balloonSent = true;
    } else {
      failureWarning = dispatch.warning;
      if (failureWarning) {
        warnLogger(failureWarning);
      }
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
