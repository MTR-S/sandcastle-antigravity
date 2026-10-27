/**
 * Host OAuth Pre-flight Validation and Extraction Utility for Sandcastle.
 *
 * Queries the Windows Credential Manager for the Antigravity CLI generic
 * credential (`gemini:antigravity`), validates the contained OAuth token structure,
 * and logs structured diagnostic entries with actionable remediation instructions
 * if authentication is missing or corrupt.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_CREDENTIAL_TARGET = "gemini:antigravity";
export const DEFAULT_LOG_PATH = resolve(process.cwd(), ".sandcastle/logs/auth-failure.log");

export interface OAuthTokenData {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expiry: string;
  readonly token_type?: string;
}

export interface AntigravityOAuthPayload {
  readonly token: OAuthTokenData;
  readonly auth_method?: string;
  readonly id_token?: string;
  readonly [key: string]: unknown;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

export interface ExtractCredentialOptions {
  readonly runner?: CommandRunner;
  readonly platform?: string;
}

export type ValidationResult =
  | {
      readonly valid: true;
      readonly payload: string;
      readonly token: OAuthTokenData;
      readonly parsed: AntigravityOAuthPayload;
    }
  | {
      readonly valid: false;
      readonly error: string;
    };

export interface AuthPreflightOptions {
  readonly target?: string;
  readonly logPath?: string;
  readonly consoleError?: (message: string) => void;
  readonly exitFn?: (code: number) => never | void;
  readonly credentialReader?: (target: string) => string | null;
  readonly runner?: CommandRunner;
  readonly platform?: string;
}

export interface AuthPreflightSuccess {
  readonly payload: string;
  readonly token: OAuthTokenData;
  readonly parsed: AntigravityOAuthPayload;
}

const DEFAULT_RUNNER: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

/**
 * Builds the C# P/Invoke script executed inside PowerShell to query
 * CredReadW from Advapi32.dll for a generic credential.
 */
function buildCredReadScript(target: string): string {
  const escapedTarget = target.replace(/'/g, "''");
  return `
$code = @"
using System;
using System.Runtime.InteropServices;
public class WinCredReader {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredReadW(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr credentialPtr);
    public static string Read(string target) {
        IntPtr credPtr;
        if (!CredReadW(target, 1, 0, out credPtr)) {
            return null;
        }
        try {
            var cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize > 0 && cred.CredentialBlob != IntPtr.Zero) {
                byte[] bytes = new byte[cred.CredentialBlobSize];
                Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
                return System.Text.Encoding.UTF8.GetString(bytes);
            }
            return "";
        } finally {
            CredFree(credPtr);
        }
    }
}
"@
Add-Type -TypeDefinition $code
$val = [WinCredReader]::Read('${escapedTarget}')
if ($val) { [Console]::Out.Write($val) } else { exit 2 }
`;
}

/**
 * Extracts a generic credential from the Windows Credential Manager using native Win32 APIs.
 *
 * @param target Generic credential target name (default: "gemini:antigravity")
 * @param options Runner and platform overrides for testing and cross-platform safety
 * @returns Decoded UTF-8 credential string or null if not found
 */
export function extractWindowsCredential(
  target: string = DEFAULT_CREDENTIAL_TARGET,
  options?: ExtractCredentialOptions,
): string | null {
  const platform = options?.platform ?? process.platform;
  if (platform !== "win32" && !options?.runner) {
    return null;
  }

  const runner = options?.runner ?? DEFAULT_RUNNER;
  const script = buildCredReadScript(target);
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");

  try {
    const res = runner("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ]);

    if (res.status === 0 && res.stdout && res.stdout.trim().length > 0) {
      return res.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates a non-empty string field in a credential object.
 */
function extractNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): { value?: string; error?: string } {
  const val = record[key];
  if (typeof val !== "string" || val.trim().length === 0) {
    return { error: `Missing or empty '${key}' in OAuth credential payload.` };
  }
  return { value: val.trim() };
}

/**
 * Validates that a raw credential string represents a valid OAuth payload
 * containing required access_token, refresh_token, and expiry values.
 *
 * @param raw Raw credential string
 * @returns ValidationResult with typed payload on success or error message on failure
 */
export function validateOAuthPayload(raw?: string | null): ValidationResult {
  if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
    return { valid: false, error: "Empty or missing credential payload." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (err) {
    return {
      valid: false,
      error: `Invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, error: "Credential payload is not a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  const tokenCandidate =
    record.token && typeof record.token === "object"
      ? (record.token as Record<string, unknown>)
      : record;

  const accessTokenResult = extractNonEmptyString(tokenCandidate, "access_token");
  if (accessTokenResult.error || !accessTokenResult.value) {
    return { valid: false, error: accessTokenResult.error! };
  }

  const refreshTokenResult = extractNonEmptyString(tokenCandidate, "refresh_token");
  if (refreshTokenResult.error || !refreshTokenResult.value) {
    return { valid: false, error: refreshTokenResult.error! };
  }

  const expiry = tokenCandidate.expiry;
  if (!expiry || (typeof expiry !== "string" && typeof expiry !== "number")) {
    return {
      valid: false,
      error: "Missing 'expiry' field in OAuth credential payload.",
    };
  }

  const parsedDate = new Date(expiry);
  if (isNaN(parsedDate.getTime())) {
    return {
      valid: false,
      error: `Invalid 'expiry' date format in OAuth credential payload: ${expiry}`,
    };
  }

  const tokenData: OAuthTokenData = {
    access_token: accessTokenResult.value,
    refresh_token: refreshTokenResult.value,
    expiry: String(expiry),
    token_type: typeof tokenCandidate.token_type === "string" ? tokenCandidate.token_type : undefined,
  };

  const fullPayload: AntigravityOAuthPayload = {
    ...record,
    token: tokenData,
  };

  return {
    valid: true,
    payload: raw.trim(),
    token: tokenData,
    parsed: fullPayload,
  };
}

/**
 * Formats validated OAuth credentials into a standardized JSON string for container injection.
 *
 * @param source Validated auth result, parsed OAuth payload, or raw JSON string
 * @returns Clean normalized JSON payload string for SANDCASTLE_OAUTH_PAYLOAD
 */
export function formatOAuthPayloadForContainer(
  source: AuthPreflightSuccess | AntigravityOAuthPayload | string,
): string {
  if (typeof source === "string") {
    return JSON.stringify(JSON.parse(source.trim()));
  }
  if ("parsed" in source) {
    return JSON.stringify(source.parsed);
  }
  return JSON.stringify(source);
}

/**
 * Appends a structured diagnostic entry to the auth failure log file.
 */
function logAuthFailure(logPath: string, reason: string): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [ERROR] Host authentication pre-flight failed: ${reason}\n`;
    appendFileSync(logPath, entry, "utf-8");
  } catch (err) {
    // Non-fatal if log file writing encounters permission issues, but report to stderr
    console.error(`Failed to write auth failure log at ${logPath}:`, err);
  }
}

/**
 * Generates an actionable remediation notice for the terminal.
 */
function formatRemediationNotice(reason: string, target: string): string {
  return [
    "",
    "================================================================================",
    " [SANDCASTLE AUTH ERROR] Host authentication pre-flight validation failed",
    "================================================================================",
    ` Target:   ${target}`,
    ` Reason:   ${reason}`,
    "",
    " Remediation:",
    "   The Google Antigravity CLI OAuth credentials were not found on this host.",
    "   Please authenticate by running the Antigravity CLI login command on your machine:",
    "",
    "     agy login",
    "",
    "   Follow the prompt to log in via your browser, then re-run Sandcastle.",
    "================================================================================",
    "",
  ].join("\n");
}

/**
 * Handles pre-flight authentication failure: logs to file, displays remediation, and terminates.
 */
function failPreflight(
  reason: string,
  target: string,
  logPath: string,
  consoleError: (message: string) => void,
  exitFn: (code: number) => never | void,
): never {
  logAuthFailure(logPath, reason);
  consoleError(formatRemediationNotice(reason, target));
  return exitFn(1) as never;
}

/**
 * Executes host authentication pre-flight validation.
 *
 * Verifies that the required generic credential exists in Windows Credential Manager
 * and contains valid OAuth token fields. If validation fails, logs a diagnostic error
 * to `.sandcastle/logs/auth-failure.log`, prints remediation instructions to stderr,
 * and cleanly exits with code 1 before any git branches, worktrees, or containers are created.
 *
 * @param options Preflight configuration and test seams
 * @returns AuthPreflightSuccess containing the validated raw payload and parsed token
 */
export function runAuthPreflight(options?: AuthPreflightOptions): AuthPreflightSuccess {
  const target = options?.target ?? DEFAULT_CREDENTIAL_TARGET;
  const logPath = options?.logPath ?? DEFAULT_LOG_PATH;
  const consoleError = options?.consoleError ?? console.error;
  const exitFn = options?.exitFn ?? process.exit;

  const raw = options?.credentialReader
    ? options.credentialReader(target)
    : (process.env.SANDCASTLE_OAUTH_PAYLOAD ||
       extractWindowsCredential(target, {
         runner: options?.runner,
         platform: options?.platform,
       }));

  if (!raw) {
    const reason = `Antigravity generic credential '${target}' not found in Windows Credential Manager.`;
    return failPreflight(reason, target, logPath, consoleError, exitFn);
  }

  const validation = validateOAuthPayload(raw);
  if (!validation.valid) {
    const reason = `Antigravity generic credential '${target}' contains invalid OAuth token data: ${validation.error}`;
    return failPreflight(reason, target, logPath, consoleError, exitFn);
  }

  return {
    payload: validation.payload,
    token: validation.token,
    parsed: validation.parsed,
  };
}
