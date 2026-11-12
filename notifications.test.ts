import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
  defaultNotificationRunner,
  defaultTerminalBellWriter,
  type IterationNotificationOptions,
  type IterationNotificationDependencies,
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
      let warnCount = 0;
      const warnLogger = () => {
        warnCount++;
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
      assert.equal(warnCount, 1);

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
      assert.equal(warnCount, 2);

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
      assert.equal(warnCount, 3);
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
