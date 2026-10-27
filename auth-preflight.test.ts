import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  extractWindowsCredential,
  validateOAuthPayload,
  formatOAuthPayloadForContainer,
  runAuthPreflight,
  type AuthPreflightOptions,
  type CommandRunner,
} from "./auth-preflight.ts";

describe("Host OAuth Pre-flight Validation & Fail-Fast Logging", () => {
  const testLogDir = resolve(process.cwd(), ".sandcastle/logs");
  const testLogPath = join(testLogDir, "auth-failure.log");

  const validTokenObj = {
    token: {
      access_token: "test-access-token-xyz",
      token_type: "Bearer",
      refresh_token: "test-refresh-token-123",
      expiry: "2026-09-18T18:00:00.000Z",
    },
    auth_method: "consumer",
    id_token: "test-id-token",
  };

  const validJsonString = JSON.stringify(validTokenObj);

  describe("extractWindowsCredential", () => {
    test("extracts credential when runner returns valid UTF-8 payload", () => {
      const mockRunner: CommandRunner = () => ({
        status: 0,
        stdout: validJsonString,
        stderr: "",
      });

      const cred = extractWindowsCredential("gemini:antigravity", {
        runner: mockRunner,
      });
      assert.equal(cred, validJsonString);
    });

    test("returns null when runner exits with non-zero status (not found)", () => {
      const mockRunner: CommandRunner = () => ({
        status: 2,
        stdout: "",
        stderr: "Element not found.",
      });

      const cred = extractWindowsCredential("non-existent-target", {
        runner: mockRunner,
      });
      assert.equal(cred, null);
    });

    test("returns null when runner throws an exception", () => {
      const mockRunner: CommandRunner = () => {
        throw new Error("Spawn error");
      };

      const cred = extractWindowsCredential("gemini:antigravity", {
        runner: mockRunner,
      });
      assert.equal(cred, null);
    });

    test("returns null on non-Windows platform without custom runner", () => {
      const cred = extractWindowsCredential("gemini:antigravity", {
        platform: "linux",
      });
      assert.equal(cred, null);
    });
  });

  describe("validateOAuthPayload", () => {
    test("validates nested token structure with access_token, refresh_token, and expiry", () => {
      const result = validateOAuthPayload(validJsonString);
      assert.equal(result.valid, true);
      if (result.valid) {
        assert.equal(result.token.access_token, "test-access-token-xyz");
        assert.equal(result.token.refresh_token, "test-refresh-token-123");
        assert.equal(result.token.expiry, "2026-09-18T18:00:00.000Z");
        assert.equal(result.payload, validJsonString);
      }
    });

    test("validates flat token structure containing root access_token, refresh_token, and expiry", () => {
      const flatObj = {
        access_token: "flat-access-token",
        refresh_token: "flat-refresh-token",
        expiry: "2026-10-01T00:00:00.000Z",
      };
      const result = validateOAuthPayload(JSON.stringify(flatObj));
      assert.equal(result.valid, true);
      if (result.valid) {
        assert.equal(result.token.access_token, "flat-access-token");
        assert.equal(result.token.refresh_token, "flat-refresh-token");
      }
    });

    test("fails when input is null, undefined or empty", () => {
      assert.equal(validateOAuthPayload("").valid, false);
      assert.equal(validateOAuthPayload(null).valid, false);
      assert.equal(validateOAuthPayload(undefined).valid, false);
    });

    test("fails when input is malformed JSON", () => {
      const result = validateOAuthPayload("{ broken-json ");
      assert.equal(result.valid, false);
      if (!result.valid) {
        assert.match(result.error, /JSON/i);
      }
    });

    test("fails when access_token is missing or empty", () => {
      const noAccess = {
        token: {
          refresh_token: "ref-123",
          expiry: "2026-09-18T18:00:00Z",
        },
      };
      const result = validateOAuthPayload(JSON.stringify(noAccess));
      assert.equal(result.valid, false);
      if (!result.valid) {
        assert.match(result.error, /access_token/i);
      }
    });

    test("fails when refresh_token is missing or empty", () => {
      const noRefresh = {
        token: {
          access_token: "acc-123",
          expiry: "2026-09-18T18:00:00Z",
        },
      };
      const result = validateOAuthPayload(JSON.stringify(noRefresh));
      assert.equal(result.valid, false);
      if (!result.valid) {
        assert.match(result.error, /refresh_token/i);
      }
    });

    test("fails when expiry is missing or invalid date", () => {
      const invalidExpiry = {
        token: {
          access_token: "acc-123",
          refresh_token: "ref-123",
          expiry: "not-a-valid-date",
        },
      };
      const result = validateOAuthPayload(JSON.stringify(invalidExpiry));
      assert.equal(result.valid, false);
      if (!result.valid) {
        assert.match(result.error, /expiry/i);
      }
    });
  });

  describe("runAuthPreflight", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      if (existsSync(testLogPath)) {
        rmSync(testLogPath, { force: true });
      }
    });

    afterEach(() => {
      process.env = originalEnv;
      if (existsSync(testLogPath)) {
        rmSync(testLogPath, { force: true });
      }
    });

    test("returns payload and parsed token on successful extraction without exiting", () => {
      let exitCalled = false;
      let exitCode: number | undefined;

      const result = runAuthPreflight({
        credentialReader: () => validJsonString,
        logPath: testLogPath,
        exitFn: (code) => {
          exitCalled = true;
          exitCode = code;
          throw new Error(`Exit ${code}`);
        },
      });

      assert.equal(exitCalled, false);
      assert.equal(result.payload, validJsonString);
      assert.equal(result.token.access_token, "test-access-token-xyz");
      assert.equal(existsSync(testLogPath), false);
    });

    test("fails fast when credential is not found: logs to file, prints agy remediation, and exits 1", () => {
      let exitCode: number | undefined;
      const errorsLogged: string[] = [];

      assert.throws(
        () => {
          runAuthPreflight({
            credentialReader: () => null,
            logPath: testLogPath,
            consoleError: (msg) => errorsLogged.push(msg),
            exitFn: (code) => {
              exitCode = code;
              throw new Error(`Process exited with code ${code}`);
            },
          });
        },
        /Process exited with code 1/,
      );

      assert.equal(exitCode, 1);

      // Verify remediation message printed to console
      const combinedConsoleOutput = errorsLogged.join("\n");
      assert.match(combinedConsoleOutput, /gemini:antigravity/);
      assert.match(combinedConsoleOutput, /agy login/);

      // Verify structured diagnostic entry appended to log file
      assert.equal(existsSync(testLogPath), true);
      const logContent = readFileSync(testLogPath, "utf-8");
      assert.match(logContent, /\[ERROR\]/);
      assert.match(logContent, /gemini:antigravity/);
      assert.match(logContent, /not found/i);
    });

    test("formats OAuth payload for container injection", () => {
      const formatted = formatOAuthPayloadForContainer(validJsonString);
      const parsed = JSON.parse(formatted);
      assert.equal(parsed.token.access_token, "test-access-token-xyz");
      assert.equal(parsed.token.refresh_token, "test-refresh-token-123");
    });

    test("fails fast when credential has invalid schema: logs failure, prints remediation, and exits 1", () => {
      let exitCode: number | undefined;
      const errorsLogged: string[] = [];

      assert.throws(
        () => {
          runAuthPreflight({
            credentialReader: () => JSON.stringify({ broken: "payload" }),
            logPath: testLogPath,
            consoleError: (msg) => errorsLogged.push(msg),
            exitFn: (code) => {
              exitCode = code;
              throw new Error(`Process exited with code ${code}`);
            },
          });
        },
        /Process exited with code 1/,
      );

      assert.equal(exitCode, 1);

      // Verify log file contents
      assert.equal(existsSync(testLogPath), true);
      const logContent = readFileSync(testLogPath, "utf-8");
      assert.match(logContent, /\[ERROR\]/);
      assert.match(logContent, /access_token/i);
    });

    test("ensures zero git dirtying on authentication failure", () => {
      // Execute failure pre-flight check
      try {
        runAuthPreflight({
          credentialReader: () => null,
          logPath: testLogPath,
          consoleError: () => {},
          exitFn: () => {
            throw new Error("Abort");
          },
        });
      } catch {
        // Expected abort
      }

      // Check git status to verify zero dirtying
      const gitStatus = execSync("git status --porcelain", {
        encoding: "utf-8",
      }).trim();

      // Only untracked new test files should appear if anything, never runtime artifacts
      const lines = gitStatus.split("\n").filter((l) => l.trim().length > 0);
      const dirtyLogs = lines.filter((l) => l.includes("auth-failure.log") || l.includes(".sandcastle/logs"));
      assert.equal(dirtyLogs.length, 0, "auth-failure.log must be gitignored and not dirty the working tree");
    });
  });

  describe("Native Windows integration (conditional)", () => {
    test("extracts real gemini:antigravity credential on host Windows if available", (t) => {
      if (process.platform !== "win32") {
        t.skip("Test only runs on native Windows host");
        return;
      }

      const cred = extractWindowsCredential("gemini:antigravity");
      if (!cred) {
        t.skip("No gemini:antigravity credential found on current Windows user account");
        return;
      }

      const validation = validateOAuthPayload(cred);
      assert.equal(validation.valid, true);
      if (validation.valid) {
        assert.ok(validation.token.access_token.length > 0);
        assert.ok(validation.token.refresh_token.length > 0);
      }
    });
  });
});
