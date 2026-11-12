import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TERMINAL_BELL_CHAR,
  DEFAULT_NOTIFICATION_TITLE_PREFIX,
  DEFAULT_ZERO_UNBLOCKED_NOTIFICATION_MESSAGE,
  DEFAULT_NO_COMMITS_NOTIFICATION_MESSAGE,
  DEFAULT_ITERATION_LIMIT_NOTIFICATION_SUFFIX,
  DEFAULT_ORCHESTRATION_COMPLETED_TITLE,
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
  defaultNotificationRunner,
  defaultTerminalBellWriter,
  type IterationNotificationOptions,
  type IterationNotificationDependencies,
  type FormatIterationNotificationTitleOptions,
  type FormatIterationNotificationMessageOptions,
  type TerminalNotificationOptions,
  type PipelineIterationNotificationOptions,
  type WindowsNotificationCommand,
  type NotificationStdio,
  type NotificationRunner,
  type NotificationResult,
} from "./notifications.ts";

describe("Native Iteration Notification Dispatcher (Issue #30)", () => {
  describe("Constants & Utilities", () => {
    test("exports TERMINAL_BELL_CHAR as ASCII 7", () => {
      assert.equal(TERMINAL_BELL_CHAR, "\x07");
      assert.equal(TERMINAL_BELL_CHAR.charCodeAt(0), 7);
    });

    test("exports DEFAULT_NOTIFICATION_TITLE_PREFIX", () => {
      assert.ok(typeof DEFAULT_NOTIFICATION_TITLE_PREFIX === "string");
      assert.ok(DEFAULT_NOTIFICATION_TITLE_PREFIX.length > 0);
    });

    test("escapePowerShellSingleQuotedString escapes single quotes to doubled single quotes", () => {
      assert.equal(escapePowerShellSingleQuotedString("normal text"), "normal text");
      assert.equal(escapePowerShellSingleQuotedString("it's a test"), "it''s a test");
      assert.equal(escapePowerShellSingleQuotedString("''multiple''quotes''"), "''''multiple''''quotes''''");
      assert.equal(escapePowerShellSingleQuotedString(""), "");
    });

    test("escapePowerShellSingleQuotedString preserves dollar signs and backticks safely", () => {
      const input = "Branch $foo `command` \"quoted\"";
      assert.equal(escapePowerShellSingleQuotedString(input), input);
    });
  });

  describe("Formatting Helpers", () => {
    test("formatIterationNotificationTitle uses custom title when provided", () => {
      const title = formatIterationNotificationTitle({
        iteration: 2,
        totalIterations: 10,
        title: "Custom Title Here",
      });
      assert.equal(title, "Custom Title Here");
    });

    test("formatIterationNotificationTitle generates default title with cycle count", () => {
      const title = formatIterationNotificationTitle({
        iteration: 3,
        totalIterations: 10,
      });
      assert.equal(title, "Iteração 3/10 concluída");
    });

    test("formatIterationNotificationMessage uses custom message when provided", () => {
      const message = formatIterationNotificationMessage({
        integratedBranchesCount: 2,
        message: "Custom message payload",
      });
      assert.equal(message, "Custom message payload");
    });

    test("formatIterationNotificationMessage handles singular branch count", () => {
      const message = formatIterationNotificationMessage({
        integratedBranchesCount: 1,
      });
      assert.equal(message, "1 branch integrada à Base Branch com sucesso.");
    });

    test("formatIterationNotificationMessage handles multiple branches count", () => {
      const message = formatIterationNotificationMessage({
        integratedBranchesCount: 3,
      });
      assert.equal(message, "3 branches integradas à Base Branch com sucesso.");
    });

    test("formatIterationNotificationMessage handles zero branches count", () => {
      const message = formatIterationNotificationMessage({
        integratedBranchesCount: 0,
      });
      assert.equal(message, "Nenhuma branch integrada (ciclo finalizado).");
    });

    test("formatIterationNotificationConsoleSummary formats eye-catching log line with bell symbol and bullet", () => {
      const summary = formatIterationNotificationConsoleSummary(
        "Iteração 1/10 concluída",
        "2 branches integradas à Base Branch com sucesso.",
      );
      assert.match(summary, /🔔/);
      assert.match(summary, /Iteration Notification/);
      assert.match(summary, /•/);
      assert.ok(summary.includes("Iteração 1/10 concluída"));
      assert.ok(summary.includes("2 branches integradas à Base Branch com sucesso."));
    });
  });

  describe("Windows PowerShell Notification Script & Command Generation", () => {
    test("buildWindowsNotificationScript generates valid PowerShell script with NotifyIcon and Asterisk sound", () => {
      const script = buildWindowsNotificationScript("Title 1", "Message 1");
      assert.match(script, /Add-Type\s+-AssemblyName\s+System\.Windows\.Forms/);
      assert.match(script, /Add-Type\s+-AssemblyName\s+System\.Drawing/);
      assert.match(script, /\[System\.Media\.SystemSounds\]::Asterisk\.Play\(\)/);
      assert.match(script, /New-Object\s+System\.Windows\.Forms\.NotifyIcon/);
      assert.match(script, /\[System\.Drawing\.SystemIcons\]::Information/);
      assert.match(script, /BalloonTipTitle\s*=\s*'Title 1'/);
      assert.match(script, /BalloonTipText\s*=\s*'Message 1'/);
      assert.match(script, /\[System\.Windows\.Forms\.ToolTipIcon\]::Info/);
      assert.match(script, /ShowBalloonTip\(10000\)/);
      assert.match(script, /Dispose\(\)/);
    });

    test("buildWindowsNotificationScript properly escapes quotes in title and message", () => {
      const script = buildWindowsNotificationScript("Developer's Title", "Operator's branch 'feature-1'");
      assert.match(script, /BalloonTipTitle\s*=\s*'Developer''s Title'/);
      assert.match(script, /BalloonTipText\s*=\s*'Operator''s branch ''feature-1'''/);
    });

    test("buildWindowsNotificationCommand builds powershell.exe command and standard non-interactive arguments", () => {
      const cmdInfo = buildWindowsNotificationCommand("Title", "Message");
      assert.equal(cmdInfo.command, "powershell.exe");
      assert.deepEqual(cmdInfo.args.slice(0, 5), [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
      ]);
      const scriptArg = cmdInfo.args[5];
      assert.ok(scriptArg.includes("System.Windows.Forms.NotifyIcon"));
      assert.ok(scriptArg.includes("SystemSounds"));
      assert.ok(scriptArg.includes("ShowBalloonTip"));
    });
  });

  describe("sendIterationNotification Dispatcher", () => {
    test("dispatches on Windows platform triggering PowerShell runner with detached options", () => {
      let executedCommand = "";
      let executedArgs: readonly string[] = [];
      let runnerOptions: unknown = null;
      let loggedMessage = "";
      let bellOutput = "";

      const mockRunner: NotificationRunner = (cmd, args, opts) => {
        executedCommand = cmd;
        executedArgs = args;
        runnerOptions = opts;
        return { status: 0, pid: 1234 };
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 2,
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: (b) => {
            bellOutput = b;
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.platform, "win32");
      assert.equal(result.windowsDispatched, true);
      assert.equal(result.soundPlayed, true);
      assert.equal(result.balloonSent, true);
      assert.equal(result.bellEmitted, true);
      assert.equal(result.logEmitted, true);
      assert.equal(result.title, "Iteração 1/10 concluída");
      assert.equal(result.message, "2 branches integradas à Base Branch com sucesso.");

      assert.equal(executedCommand, "powershell.exe");
      assert.ok(executedArgs.length > 0);
      assert.ok(executedArgs.includes("-Command"));
      const scriptContent = executedArgs[executedArgs.indexOf("-Command") + 1];
      assert.ok(scriptContent);
      assert.ok(scriptContent.includes("System.Windows.Forms.NotifyIcon"));
      assert.ok(scriptContent.includes("SystemSounds"));
      assert.ok(scriptContent.includes("ShowBalloonTip"));
      assert.ok(scriptContent.includes("Iteração 1/10 concluída"));
      assert.ok(scriptContent.includes("2 branches integradas à Base Branch com sucesso."));

      assert.deepEqual(runnerOptions, {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      });

      assert.equal(bellOutput, "\x07");
      assert.ok(loggedMessage.length > 0);
      assert.ok(loggedMessage.includes("Iteração 1/10 concluída"));
    });

    test("dispatches on non-Windows platform without executing PowerShell runner but emitting bell and summary log", () => {
      let runnerCalled = false;
      let loggedMessage = "";
      let bellOutput = "";

      const mockRunner: NotificationRunner = () => {
        runnerCalled = true;
        return { status: 0 };
      };

      const result = sendIterationNotification(
        {
          iteration: 4,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "linux",
          runner: mockRunner,
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: (b) => {
            bellOutput = b;
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.platform, "linux");
      assert.equal(result.windowsDispatched, false);
      assert.equal(result.soundPlayed, false);
      assert.equal(result.balloonSent, false);
      assert.equal(result.bellEmitted, true);
      assert.equal(result.logEmitted, true);
      assert.equal(runnerCalled, false);
      assert.equal(bellOutput, "\x07");
      assert.ok(loggedMessage.length > 0);
      assert.ok(loggedMessage.includes("Iteração 4/10 concluída"));
      assert.ok(loggedMessage.includes("1 branch integrada à Base Branch com sucesso."));
    });

    test("supports custom title and message overrides", () => {
      let scriptContent = "";
      let loggedMessage = "";

      const mockRunner: NotificationRunner = (_cmd, args) => {
        scriptContent = args[args.indexOf("-Command") + 1] ?? "";
        return { status: 0 };
      };

      const result = sendIterationNotification(
        {
          iteration: 5,
          totalIterations: 10,
          integratedBranchesCount: 0,
          title: "Custom Pipeline Finished",
          message: "All issues successfully processed with 0 unblocked remaining.",
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: () => {},
        },
      );

      assert.equal(result.title, "Custom Pipeline Finished");
      assert.equal(result.message, "All issues successfully processed with 0 unblocked remaining.");
      assert.ok(scriptContent.includes("Custom Pipeline Finished"));
      assert.ok(scriptContent.includes("All issues successfully processed with 0 unblocked remaining."));
      assert.ok(loggedMessage.includes("Custom Pipeline Finished"));
      assert.ok(loggedMessage.includes("All issues successfully processed with 0 unblocked remaining."));
    });

    test("safe fallback: PowerShell runner failure logs a warning without throwing or aborting", () => {
      let loggedWarning = "";
      let loggedMessage = "";
      let bellOutput = "";

      const throwingRunner: NotificationRunner = () => {
        throw new Error("Simulated PowerShell launch failure (e.g. Win32 error 2)");
      };

      const result = sendIterationNotification(
        {
          iteration: 2,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "win32",
          runner: throwingRunner,
          warnLogger: (w) => {
            loggedWarning = w;
          },
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: (b) => {
            bellOutput = b;
          },
        },
      );

      assert.equal(result.success, false);
      assert.equal(result.windowsDispatched, false);
      assert.equal(result.bellEmitted, true);
      assert.equal(result.logEmitted, true);
      assert.equal(bellOutput, "\x07");
      assert.ok(loggedMessage.length > 0);
      assert.ok(loggedWarning.length > 0);
      assert.match(loggedWarning, /Simulated PowerShell launch failure/);
    });

    test("safe fallback: PowerShell runner non-zero exit status logs warning without throwing", () => {
      let loggedWarning = "";

      const failingRunner: NotificationRunner = () => {
        return { status: 1 };
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "win32",
          runner: failingRunner,
          warnLogger: (w) => {
            loggedWarning = w;
          },
          terminalBellWriter: () => {},
          logger: () => {},
        },
      );

      assert.equal(result.success, false);
      assert.equal(result.windowsDispatched, false);
      assert.ok(loggedWarning.length > 0);
      assert.match(loggedWarning, /non-zero code 1/);
    });

    test("safe fallback: terminal bell writer failure does not throw or abort", () => {
      let loggedWarning = "";

      const throwingBellWriter = () => {
        throw new Error("stdout closed");
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "linux",
          terminalBellWriter: throwingBellWriter,
          warnLogger: (w) => {
            loggedWarning = w;
          },
          logger: () => {},
        },
      );

      assert.equal(result.bellEmitted, false);
      assert.ok(loggedWarning.length > 0);
      assert.match(loggedWarning, /terminal bell/i);
    });

    test("safe fallback: logger failure does not throw or abort", () => {
      let loggedWarning = "";

      const throwingLogger = () => {
        throw new Error("console.log failure");
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "linux",
          logger: throwingLogger,
          warnLogger: (w) => {
            loggedWarning = w;
          },
          terminalBellWriter: () => {},
        },
      );

      assert.equal(result.logEmitted, false);
      assert.ok(loggedWarning.length > 0);
      assert.match(loggedWarning, /log/i);
    });

    test("safe fallback: runner returning error object logs warning without throwing", () => {
      let loggedWarning = "";
      const errorRunner: NotificationRunner = () => {
        return { error: new Error("Runner reported failure") };
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "win32",
          runner: errorRunner,
          warnLogger: (w) => {
            loggedWarning = w;
          },
          terminalBellWriter: () => {},
          logger: () => {},
        },
      );

      assert.equal(result.success, false);
      assert.equal(result.windowsDispatched, false);
      assert.ok(loggedWarning.length > 0);
      assert.match(loggedWarning, /Runner reported failure/);
    });

    test("safe fallback: handles non-Error thrown objects across runner, logger, and bell writer", () => {
      const warnings: string[] = [];
      const warnLogger = (msg: string) => {
        warnings.push(msg);
      };

      // 1. Non-error thrown from bell writer
      sendIterationNotification(
        { iteration: 1, totalIterations: 10, integratedBranchesCount: 1 },
        {
          platform: "linux",
          terminalBellWriter: () => {
            throw "bell raw string error";
          },
          logger: () => {},
          warnLogger,
        },
      );
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /bell raw string error/);

      // 2. Non-error thrown from logger
      sendIterationNotification(
        { iteration: 1, totalIterations: 10, integratedBranchesCount: 1 },
        {
          platform: "linux",
          terminalBellWriter: () => {},
          logger: () => {
            throw "logger raw string error";
          },
          warnLogger,
        },
      );
      assert.equal(warnings.length, 2);
      assert.match(warnings[1], /logger raw string error/);

      // 3. Non-error thrown from runner
      sendIterationNotification(
        { iteration: 1, totalIterations: 10, integratedBranchesCount: 1 },
        {
          platform: "win32",
          terminalBellWriter: () => {},
          logger: () => {},
          runner: () => {
            throw "runner raw string error";
          },
          warnLogger,
        },
      );
      assert.equal(warnings.length, 3);
      assert.match(warnings[2], /runner raw string error/);
    });

    test("accepts runner returning status null without throwing", () => {
      let runnerCalled = false;
      const nullStatusRunner: NotificationRunner = () => {
        runnerCalled = true;
        return { status: null };
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "win32",
          runner: nullStatusRunner,
          terminalBellWriter: () => {},
          logger: () => {},
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.windowsDispatched, true);
      assert.equal(runnerCalled, true);
    });

    test("accepts runner returning void without throwing", () => {
      let runnerCalled = false;
      const voidRunner: NotificationRunner = () => {
        runnerCalled = true;
      };

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "win32",
          runner: voidRunner,
          terminalBellWriter: () => {},
          logger: () => {},
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.windowsDispatched, true);
      assert.equal(runnerCalled, true);
    });

    test("defaultNotificationRunner respects custom options for detached, windowsHide, and stdio", () => {
      const runResult = defaultNotificationRunner(process.execPath, ["-v"], {
        detached: false,
        windowsHide: false,
        stdio: "pipe",
      });
      assert.ok(runResult);
      assert.equal(runResult.status, 0);
    });

    test("accepts dependencies inside options parameter directly for convenience", () => {
      let runnerCalled = false;
      const result = sendIterationNotification({
        iteration: 1,
        totalIterations: 10,
        integratedBranchesCount: 1,
        platform: "win32",
        runner: () => {
          runnerCalled = true;
          return { status: 0 };
        },
        terminalBellWriter: () => {},
        logger: () => {},
      });

      assert.equal(result.success, true);
      assert.equal(runnerCalled, true);
    });

    test("defaultTerminalBellWriter writes bell to stdout", () => {
      const originalStdoutWrite = process.stdout.write;
      let captured = "";
      try {
        process.stdout.write = ((chunk: unknown) => {
          captured += String(chunk);
          return true;
        }) as typeof process.stdout.write;

        defaultTerminalBellWriter(TERMINAL_BELL_CHAR);
        assert.equal(captured, "\x07");
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
    });

    test("defaultNotificationRunner executes detached process and returns success status", () => {
      const runResult = defaultNotificationRunner(process.execPath, ["-v"]);
      assert.ok(runResult);
      assert.equal(runResult.status, 0);
      assert.ok(typeof runResult.pid === "number");
    });

    test("defaultNotificationRunner catches invocation errors and returns status 1 with error", () => {
      // Pass null/invalid command type to force child_process.spawn to throw synchronously
      const runResult = defaultNotificationRunner(null as unknown as string, []);
      assert.ok(runResult);
      assert.equal(runResult.status, 1);
      assert.ok(runResult.error);
    });

    test("defaultNotificationRunner handles non-Error exception gracefully", () => {
      // To test String(err) fallback in defaultNotificationRunner catch block:
      // We can verify defaultNotificationRunner with invalid arguments
      const runResult = defaultNotificationRunner(12345 as unknown as string, []);
      assert.ok(runResult);
      assert.equal(runResult.status, 1);
      assert.ok(runResult.error);
    });

    test("sendIterationNotification works with default parameters", () => {
      const originalStdoutWrite = process.stdout.write;
      const originalConsoleLog = console.log;
      let logCalled = false;
      let bellCalled = false;

      try {
        process.stdout.write = ((chunk: unknown) => {
          if (String(chunk) === "\x07") {
            bellCalled = true;
          }
          return true;
        }) as typeof process.stdout.write;

        console.log = (msg: unknown) => {
          if (typeof msg === "string" && msg.includes("Iteration Notification")) {
            logCalled = true;
          }
        };

        const result = sendIterationNotification({
          iteration: 1,
          totalIterations: 5,
          integratedBranchesCount: 2,
        });

        assert.equal(result.success, true);
        assert.equal(bellCalled, true);
        assert.equal(logCalled, true);
      } finally {
        process.stdout.write = originalStdoutWrite;
        console.log = originalConsoleLog;
      }
    });
  });
});

describe("Orchestrator Loop Notification Integration in Automatic Mode (Issue #32)", () => {
  describe("Seam 1: Notification Formatting & Dispatching at Iteration Boundaries", () => {
    test("formats iteration boundary notification payload reporting cycle count and merged branches", () => {
      let loggedMessage = "";
      let bellSent = false;

      const result = sendIterationNotification(
        {
          iteration: 1,
          totalIterations: 10,
          integratedBranchesCount: 3,
        },
        {
          platform: "linux",
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: () => {
            bellSent = true;
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.title, "Iteração 1/10 concluída");
      assert.equal(result.message, "3 branches integradas à Base Branch com sucesso.");
      assert.equal(bellSent, true);
      assert.ok(loggedMessage.includes("Iteração 1/10 concluída"));
      assert.ok(loggedMessage.includes("3 branches integradas à Base Branch com sucesso."));
    });

    test("dispatches on Windows at iteration boundary with mock runner verifying script and balloon payload", () => {
      let executedCommand = "";
      let executedArgs: readonly string[] = [];

      const mockRunner: NotificationRunner = (cmd, args) => {
        executedCommand = cmd;
        executedArgs = args;
        return { status: 0 };
      };

      const result = sendIterationNotification(
        {
          iteration: 2,
          totalIterations: 10,
          integratedBranchesCount: 1,
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: () => {},
          terminalBellWriter: () => {},
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.windowsDispatched, true);
      assert.equal(result.soundPlayed, true);
      assert.equal(result.balloonSent, true);
      assert.equal(executedCommand, "powershell.exe");

      const script = executedArgs[executedArgs.indexOf("-Command") + 1] ?? "";
      assert.ok(script.includes("BalloonTipTitle = 'Iteração 2/10 concluída'"));
      assert.ok(script.includes("BalloonTipText = '1 branch integrada à Base Branch com sucesso.'"));
      assert.ok(script.includes("[System.Media.SystemSounds]::Asterisk.Play()"));
    });

    test("formats and dispatches final notification when iteration limit is reached", () => {
      let executedArgs: readonly string[] = [];
      const mockRunner: NotificationRunner = (_cmd, args) => {
        executedArgs = args;
        return { status: 0 };
      };

      const result = sendPipelineIterationNotification(
        {
          iteration: 10,
          totalIterations: 10,
          integratedBranchesCount: 2,
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: () => {},
          terminalBellWriter: () => {},
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.title, "Iteração 10/10 concluída (limite atingido)");
      assert.ok(result.message.includes("2 branches integradas"));
      assert.ok(result.message.includes("Limite máximo de iterações atingido."));

      const script = executedArgs[executedArgs.indexOf("-Command") + 1] ?? "";
      assert.ok(script.includes("BalloonTipTitle = 'Iteração 10/10 concluída (limite atingido)'"));
      assert.ok(script.includes("Limite máximo de iterações atingido."));
    });

    test("formatIterationLimitNotificationMessage formats plural and singular branch count with limit warning", () => {
      const singular = formatIterationLimitNotificationMessage(1);
      assert.equal(singular, "1 branch integrada à Base Branch com sucesso. Limite máximo de iterações atingido.");

      const plural = formatIterationLimitNotificationMessage(4);
      assert.equal(plural, "4 branches integradas à Base Branch com sucesso. Limite máximo de iterações atingido.");

      const zero = formatIterationLimitNotificationMessage(0);
      assert.equal(zero, "Nenhuma branch integrada (ciclo finalizado). Limite máximo de iterações atingido.");
    });

    test("dispatches regular iteration notification via sendPipelineIterationNotification before reaching limit", () => {
      let loggedMessage = "";
      let bellSent = false;

      const result = sendPipelineIterationNotification(
        {
          iteration: 3,
          totalIterations: 10,
          integratedBranchesCount: 2,
        },
        {
          platform: "linux",
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: () => {
            bellSent = true;
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.title, "Iteração 3/10 concluída");
      assert.equal(result.message, "2 branches integradas à Base Branch com sucesso.");
      assert.equal(bellSent, true);
      assert.ok(loggedMessage.includes("Iteração 3/10 concluída"));
      assert.ok(!result.message.includes(DEFAULT_ITERATION_LIMIT_NOTIFICATION_SUFFIX));
    });

    test("exports canonical notification message constants matching formatting helpers", () => {
      assert.equal(
        DEFAULT_ZERO_UNBLOCKED_NOTIFICATION_MESSAGE,
        formatZeroUnblockedNotificationMessage(),
      );
      assert.equal(
        DEFAULT_NO_COMMITS_NOTIFICATION_MESSAGE,
        formatNoCommitsNotificationMessage(),
      );
      assert.equal(DEFAULT_ORCHESTRATION_COMPLETED_TITLE, "Orquestração concluída");
      assert.equal(DEFAULT_ITERATION_LIMIT_NOTIFICATION_SUFFIX, "Limite máximo de iterações atingido.");
    });
  });

  describe("Seam 2: Notification Dispatching at Loop Terminal States", () => {
    test("dispatches final notification when sendLoopTerminalNotification is called with iteration_limit_reached", () => {
      const mockRunner: NotificationRunner = () => ({ status: 0 });

      const resultWithCount = sendLoopTerminalNotification(
        {
          iteration: 10,
          totalIterations: 10,
          reason: "iteration_limit_reached",
          integratedBranchesCount: 5,
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: () => {},
          terminalBellWriter: () => {},
        },
      );

      assert.equal(resultWithCount.success, true);
      assert.equal(resultWithCount.title, "Iteração 10/10 concluída (limite atingido)");
      assert.equal(
        resultWithCount.message,
        "5 branches integradas à Base Branch com sucesso. Limite máximo de iterações atingido.",
      );

      const resultWithoutCount = sendLoopTerminalNotification(
        {
          iteration: 10,
          totalIterations: 10,
          reason: "iteration_limit_reached",
        },
        {
          platform: "linux",
          logger: () => {},
          terminalBellWriter: () => {},
        },
      );

      assert.equal(resultWithoutCount.success, true);
      assert.equal(
        resultWithoutCount.message,
        "Nenhuma branch integrada (ciclo finalizado). Limite máximo de iterações atingido.",
      );
    });
    test("dispatches final completion notification when planner finds zero unblocked issues", () => {
      let loggedMessage = "";
      let bellEmitted = false;
      let runnerInvoked = false;

      const mockRunner: NotificationRunner = () => {
        runnerInvoked = true;
        return { status: 0 };
      };

      const result = sendLoopTerminalNotification(
        {
          iteration: 3,
          totalIterations: 10,
          reason: "zero_unblocked_issues",
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: () => {
            bellEmitted = true;
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.title, "Orquestração concluída");
      assert.equal(result.message, formatZeroUnblockedNotificationMessage());
      assert.ok(result.message.includes("Nenhuma issue pendente"));
      assert.equal(runnerInvoked, true);
      assert.equal(bellEmitted, true);
      assert.ok(loggedMessage.includes("Orquestração concluída"));
    });

    test("dispatches informative notification when iteration yields zero commits without throwing", () => {
      let loggedMessage = "";
      let bellEmitted = false;
      let runnerInvoked = false;

      const mockRunner: NotificationRunner = () => {
        runnerInvoked = true;
        return { status: 0 };
      };

      const result = sendLoopTerminalNotification(
        {
          iteration: 1,
          totalIterations: 10,
          reason: "no_commits_produced",
        },
        {
          platform: "win32",
          runner: mockRunner,
          logger: (msg) => {
            loggedMessage = msg;
          },
          terminalBellWriter: () => {
            bellEmitted = true;
          },
        },
      );

      assert.equal(result.success, true);
      assert.equal(result.title, "Iteração 1/10 concluída");
      assert.equal(result.message, formatNoCommitsNotificationMessage());
      assert.ok(result.message.includes("Nenhum commit produzido"));
      assert.equal(runnerInvoked, true);
      assert.equal(bellEmitted, true);
      assert.ok(loggedMessage.includes("Iteração 1/10 concluída"));
      assert.ok(loggedMessage.includes("Nenhum commit produzido"));
    });

    test("handles runner failure at terminal states safely with zero throw", () => {
      let loggedWarning = "";
      const failingRunner: NotificationRunner = () => {
        throw new Error("Failed to spawn notification process");
      };

      const result = sendLoopTerminalNotification(
        {
          iteration: 2,
          totalIterations: 10,
          reason: "zero_unblocked_issues",
        },
        {
          platform: "win32",
          runner: failingRunner,
          warnLogger: (warn) => {
            loggedWarning = warn;
          },
          logger: () => {},
          terminalBellWriter: () => {},
        },
      );

      assert.equal(result.success, false);
      assert.ok(result.warning?.includes("Failed to spawn notification process"));
      assert.ok(loggedWarning.includes("Warning: Failed to dispatch native Windows notification"));
    });
  });

  describe("Seam 3: Orchestrator main.mts Integration & Wiring Verification", () => {
    const mainMtsPath = resolve(process.cwd(), "main.mts");
    const mainContent = readFileSync(mainMtsPath, "utf-8");

    test("main.mts imports sendIterationNotification from ./notifications.ts", () => {
      assert.match(
        mainContent,
        /import\s+{[^}]*\bsendIterationNotification\b[^}]*}\s+from\s+["']\.\/notifications(?:\.ts)?["']/,
        "main.mts must import sendIterationNotification from ./notifications.ts",
      );
    });

    test("main.mts invokes sendIterationNotification at the end of each Pipeline Iteration", () => {
      assert.match(
        mainContent,
        /sendIterationNotification\s*\(\s*{[\s\S]*?iteration[\s\S]*?totalIterations[\s\S]*?integratedBranchesCount/,
        "main.mts must invoke sendIterationNotification with iteration, totalIterations, and integratedBranchesCount",
      );
    });

    test("main.mts dispatches notification and cleanly terminates when zero unblocked issues found", () => {
      assert.match(
        mainContent,
        /if\s*\(\s*issues\.length\s*===\s*0\s*\)\s*{[\s\S]*?sendIterationNotification[\s\S]*?break;/,
        "main.mts must notify and break when issues.length === 0",
      );
    });

    test("main.mts dispatches informative notification and cleanly terminates when zero commits produced", () => {
      assert.match(
        mainContent,
        /if\s*\(\s*completedBranches\.length\s*===\s*0\s*\)\s*{[\s\S]*?sendIterationNotification[\s\S]*?break;/,
        "main.mts must notify and break (instead of continuing) when completedBranches.length === 0",
      );
    });

    test("main.mts handles iteration limit reached notification when iteration reaches MAX_ITERATIONS", () => {
      assert.match(
        mainContent,
        /MAX_ITERATIONS[\s\S]*?(?:iteration\s*===\s*MAX_ITERATIONS|iteration\s*>=\s*MAX_ITERATIONS|sendPipelineIterationNotification)/,
        "main.mts must handle final completion notification when iteration reaches MAX_ITERATIONS",
      );
    });
  });
});
