import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractWindowsCredential, validateOAuthPayload } from "./auth-preflight.ts";
import { detectTargetConfig } from "./target-config.ts";

export interface DoctorCheckResult {
  readonly name: string;
  readonly status: "pass" | "fail" | "warn";
  readonly details?: string;
  readonly remediation?: string;
}

export interface DoctorResult {
  readonly healthy: boolean;
  readonly checks: readonly DoctorCheckResult[];
}

export interface DoctorOptions {
  readonly targetRepoPath?: string;
  readonly authChecker?: () => { ok: boolean; details?: string; remediation?: string };
  readonly dockerChecker?: () => { ok: boolean; details?: string; remediation?: string };
  readonly gitChecker?: (repoPath: string) => { ok: boolean; details?: string; remediation?: string };
  readonly ghChecker?: () => { ok: boolean; details?: string; remediation?: string };
  readonly stackChecker?: (repoPath: string) => { ok: boolean; details?: string; remediation?: string };
  readonly logger?: (msg: string) => void;
  readonly errorLogger?: (msg: string) => void;
}

export interface BuildImageOptions {
  readonly imageName?: string;
  readonly dockerfile?: string;
  readonly contextDir?: string;
  readonly buildArgs?: Record<string, string>;
  readonly runner?: (cmd: string, cwd?: string) => { status: number; stdout: string; stderr: string };
  readonly logger?: (msg: string) => void;
  readonly errorLogger?: (msg: string) => void;
}

export interface BuildImageResult {
  readonly success: boolean;
  readonly imageTag: string;
  readonly command: string;
  readonly error?: string;
}

export interface RescueOptions {
  readonly targetRepoPath?: string;
  readonly dockerRunner?: (cmd: string) => { status: number; stdout: string; stderr: string };
  readonly gitRunner?: (cmd: string, cwd: string) => { status: number; stdout: string; stderr: string };
  readonly clipboardAdapter?: (text: string) => boolean;
  readonly fsAdapter?: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => string[];
    statSync: (path: string) => { mtimeMs: number; isDirectory: () => boolean };
    readFileSync: (path: string, encoding: string) => string;
    rmSync?: (path: string, options?: fs.RmOptions) => void;
  };
  readonly logger?: (msg: string) => void;
  readonly errorLogger?: (msg: string) => void;
}

export interface RescueResult {
  readonly success: boolean;
  readonly killedContainers: readonly string[];
  readonly prunedWorktrees: boolean;
  readonly logFilePath?: string;
  readonly logLinesExtracted: number;
  readonly copiedToClipboard: boolean;
}

export function defaultCopyToClipboard(text: string): boolean {
  try {
    if (process.platform === "win32") {
      const child = spawnSync("clip.exe", { input: text, encoding: "utf-8" });
      return child.status === 0;
    } else if (process.platform === "darwin") {
      const child = spawnSync("pbcopy", { input: text, encoding: "utf-8" });
      return child.status === 0;
    } else {
      const child = spawnSync("xclip", ["-selection", "clipboard"], { input: text, encoding: "utf-8" });
      if (child.status === 0) return true;
      const child2 = spawnSync("wl-copy", { input: text, encoding: "utf-8" });
      return child2.status === 0;
    }
  } catch {
    return false;
  }
}

function runExecCommand(cmd: string, cwd?: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      status: execErr.status ?? 1,
      stdout: execErr.stdout?.toString() ?? "",
      stderr: execErr.stderr?.toString() ?? (execErr.message || String(err)),
    };
  }
}

/**
 * Executes rescue operation:
 * 1. Stops & kills lingering sandcastle-agent containers.
 * 2. Prunes Git worktrees in target repository and cleans stale worktree folders.
 * 3. Extracts last 40 lines of latest log and copies to system clipboard.
 */
export async function runRescue(options: RescueOptions = {}): Promise<RescueResult> {
  const log = options.logger ?? console.log;
  const targetRepo = options.targetRepoPath
    ? resolve(options.targetRepoPath)
    : process.cwd();

  const dockerRun = options.dockerRunner ?? runExecCommand;
  const gitRun = options.gitRunner ?? runExecCommand;
  const copyClip = options.clipboardAdapter ?? defaultCopyToClipboard;
  const fsOps = options.fsAdapter ?? {
    existsSync: fs.existsSync,
    readdirSync: fs.readdirSync,
    statSync: fs.statSync,
    readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
    rmSync: fs.rmSync,
  };

  log(`[RESCUE] Initiating Sandcastle rescue operation against: ${targetRepo}`);

  // 1. Terminate orphan sandcastle-agent containers
  log("[RESCUE] 1. Inspecting dangling Sandcastle Docker containers...");
  const psResult = dockerRun("docker ps -q --filter ancestor=sandcastle-agent");
  const containerIds = psResult.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const killed: string[] = [];
  if (containerIds.length > 0) {
    log(`[RESCUE] Found ${containerIds.length} active Sandcastle container(s). Terminating...`);
    for (const cid of containerIds) {
      dockerRun(`docker kill ${cid}`);
      dockerRun(`docker rm -f ${cid}`);
      killed.push(cid);
    }
    log(`[RESCUE] Terminated containers: ${killed.join(", ")}`);
  } else {
    log("[RESCUE] No active Sandcastle containers found.");
  }

  // 2. Prune git worktrees
  log("[RESCUE] 2. Pruning Git worktrees...");
  gitRun("git worktree prune", targetRepo);

  const worktreesDir = join(targetRepo, ".sandcastle", "worktrees");
  if (fsOps.existsSync(worktreesDir)) {
    try {
      const subdirs = fsOps.readdirSync(worktreesDir);
      for (const subdir of subdirs) {
        const fullSubPath = join(worktreesDir, subdir);
        try {
          const stat = fsOps.statSync(fullSubPath);
          if (stat.isDirectory()) {
            gitRun(`git worktree remove --force "${fullSubPath}"`, targetRepo);
            if (fsOps.rmSync) {
              fsOps.rmSync(fullSubPath, { recursive: true, force: true });
            }
          }
        } catch {
          // Ignore individual worktree directory removal errors
        }
      }
    } catch {
      // Ignore reading worktrees directory errors
    }
    gitRun("git worktree prune", targetRepo);
  }
  log("[RESCUE] Git worktrees pruned successfully.");

  // 3. Extract last 40 lines of latest log
  log("[RESCUE] 3. Extracting latest log diagnostics...");
  let latestLogPath: string | undefined;
  let highestMtime = -1;

  const candidateLogDirs = [
    join(targetRepo, ".sandcastle", "logs"),
    join(process.cwd(), ".sandcastle", "logs"),
    join(resolve(fileURLToPath(new URL(".", import.meta.url))), ".sandcastle", "logs"),
  ];

  for (const logDir of candidateLogDirs) {
    if (fsOps.existsSync(logDir)) {
      try {
        const files = fsOps.readdirSync(logDir);
        for (const f of files) {
          if (f.endsWith(".log")) {
            const p = join(logDir, f);
            try {
              const stat = fsOps.statSync(p);
              if (stat.mtimeMs > highestMtime) {
                highestMtime = stat.mtimeMs;
                latestLogPath = p;
              }
            } catch {
              // Ignore stat error
            }
          }
        }
      } catch {
        // Ignore read error
      }
    }
  }

  let extractedLinesCount = 0;
  let copied = false;

  if (latestLogPath) {
    log(`[RESCUE] Latest log identified: ${latestLogPath}`);
    try {
      const content = fsOps.readFileSync(latestLogPath, "utf-8");
      const lines = content.split(/\r?\n/);
      const tailLines = lines.slice(-40);
      extractedLinesCount = tailLines.length;
      const tailText = tailLines.join("\n");

      copied = copyClip(tailText);
      if (copied) {
        log("[RESCUE] Copied last 40 lines to clipboard successfully (Ctrl+V)!");
      } else {
        log("[RESCUE] Clipboard unavailable. Tail output from latest log:");
        log(tailText);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[RESCUE] Could not read log file: ${msg}`);
    }
  } else {
    log("[RESCUE] No execution logs found.");
  }

  return {
    success: true,
    killedContainers: Object.freeze(killed),
    prunedWorktrees: true,
    logFilePath: latestLogPath,
    logLinesExtracted: extractedLinesCount,
    copiedToClipboard: copied,
  };
}

function defaultAuthChecker(): { ok: boolean; details?: string; remediation?: string } {
  try {
    const raw = extractWindowsCredential();
    if (!raw) {
      return {
        ok: false,
        details: "No credential found in Windows Credential Manager (gemini:antigravity).",
        remediation: "Run 'agy login' on host machine to authenticate with Google Antigravity.",
      };
    }
    const token = validateOAuthPayload(raw);
    if (!token) {
      return {
        ok: false,
        details: "Stored gemini:antigravity payload failed schema validation.",
        remediation: "Run 'agy login' to re-authenticate with Google Antigravity.",
      };
    }
    return {
      ok: true,
      details: "Valid Google Antigravity session token found in Windows Credential Manager.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      details: `Auth check threw: ${msg}`,
      remediation: "Run 'agy login' to refresh credentials.",
    };
  }
}

function defaultDockerChecker(): { ok: boolean; details?: string; remediation?: string } {
  try {
    const res = runExecCommand("docker info");
    if (res.status === 0) {
      return { ok: true, details: "Docker daemon is active and responsive." };
    }
    return {
      ok: false,
      details: res.stderr || "Docker daemon not responding.",
      remediation: "Start Docker Desktop or ensure the Docker daemon service is running.",
    };
  } catch {
    return {
      ok: false,
      details: "docker CLI command failed to execute.",
      remediation: "Install Docker Desktop and verify docker is on your system PATH.",
    };
  }
}

function defaultGitChecker(repoPath: string): { ok: boolean; details?: string; remediation?: string } {
  try {
    const gitVer = runExecCommand("git --version", repoPath);
    if (gitVer.status !== 0) {
      return {
        ok: false,
        details: "git binary not found or failed.",
        remediation: "Install Git and ensure it is available on system PATH.",
      };
    }
    const worktreeCheck = runExecCommand("git rev-parse --is-inside-work-tree", repoPath);
    if (worktreeCheck.status !== 0 || !worktreeCheck.stdout.trim().includes("true")) {
      return {
        ok: false,
        details: `Path is not inside a git work tree: "${repoPath}".`,
        remediation: "Run 'git init' or pass a valid target repository path with '--repo <path>'.",
      };
    }
    return {
      ok: true,
      details: `Git is available and repository at "${repoPath}" is valid.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      details: `Git validation failed: ${msg}`,
      remediation: "Verify Git installation and target repository path.",
    };
  }
}

function defaultGhChecker(): { ok: boolean; details?: string; remediation?: string } {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return { ok: true, details: "GitHub authentication configured via environment variable." };
  }
  try {
    execSync("gh auth status", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, details: "GitHub CLI is authenticated." };
  } catch {
    return {
      ok: false,
      details: "GitHub CLI is not authenticated or gh is not installed.",
      remediation: "Run 'gh auth login' or export GH_TOKEN in environment.",
    };
  }
}

function defaultStackChecker(repoPath: string): { ok: boolean; details?: string; remediation?: string } {
  try {
    const config = detectTargetConfig({ targetRepoPath: repoPath });
    if (config.techStack === "maven" || config.techStack === "gradle") {
      try {
        execSync("java -version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        return {
          ok: true,
          details: `Detected ${config.techStack} project with Java JDK available. Verification: "${config.verifyCommand}".`,
        };
      } catch {
        return {
          ok: false,
          details: `Detected ${config.techStack} project but java is not found on PATH.`,
          remediation: "Install Java JDK 17+ and configure JAVA_HOME.",
        };
      }
    } else if (config.techStack === "node") {
      try {
        execSync("node -v", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        return {
          ok: true,
          details: `Detected Node/TypeScript project. Verification: "${config.verifyCommand}".`,
        };
      } catch {
        return {
          ok: false,
          details: "Node.js runtime not found on PATH.",
          remediation: "Install Node.js (LTS version recommended).",
        };
      }
    } else {
      return {
        ok: true,
        details: "No standard Maven, Gradle, or Node marker found. Verification command can be configured via banner or .env.",
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      details: `Tech stack detection failed: ${msg}`,
      remediation: "Verify target repository files.",
    };
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const log = options.logger ?? console.log;
  const targetRepo = options.targetRepoPath
    ? resolve(options.targetRepoPath)
    : process.cwd();

  log(`[DOCTOR] Running Sandcastle Antigravity diagnostic health checks...`);
  log(`[DOCTOR] Target Repository: ${targetRepo}\n`);

  const checks: DoctorCheckResult[] = [];

  // Check 1: Host OAuth Session
  const authCheck = options.authChecker ? options.authChecker() : defaultAuthChecker();
  checks.push({
    name: "Host OAuth Session (gemini:antigravity)",
    status: authCheck.ok ? "pass" : "fail",
    details: authCheck.details,
    remediation: authCheck.remediation,
  });

  // Check 2: Docker Daemon
  const dockerCheck = options.dockerChecker ? options.dockerChecker() : defaultDockerChecker();
  checks.push({
    name: "Docker Daemon",
    status: dockerCheck.ok ? "pass" : "fail",
    details: dockerCheck.details,
    remediation: dockerCheck.remediation,
  });

  // Check 3: Git & Target Repository
  const gitCheck = options.gitChecker ? options.gitChecker(targetRepo) : defaultGitChecker(targetRepo);
  checks.push({
    name: "Git & Target Repository",
    status: gitCheck.ok ? "pass" : "fail",
    details: gitCheck.details,
    remediation: gitCheck.remediation,
  });

  // Check 4: GitHub CLI
  const ghCheck = options.ghChecker ? options.ghChecker() : defaultGhChecker();
  checks.push({
    name: "GitHub CLI Authentication",
    status: ghCheck.ok ? "pass" : "fail",
    details: ghCheck.details,
    remediation: ghCheck.remediation,
  });

  // Check 5: Tech Stack Toolchain
  const stackCheck = options.stackChecker ? options.stackChecker(targetRepo) : defaultStackChecker(targetRepo);
  checks.push({
    name: "Target Tech Stack Toolchain",
    status: stackCheck.ok ? "pass" : "fail",
    details: stackCheck.details,
    remediation: stackCheck.remediation,
  });

  // Log summary
  let allPassed = true;
  for (const check of checks) {
    if (check.status === "pass") {
      log(`  ✓ [PASS] ${check.name}: ${check.details ?? "OK"}`);
    } else {
      allPassed = false;
      log(`  ✗ [FAIL] ${check.name}: ${check.details ?? "Check failed"}`);
      if (check.remediation) {
        log(`           Remediation: ${check.remediation}`);
      }
    }
  }

  if (allPassed) {
    log("\nAll diagnostic health checks passed successfully! Your environment is ready.");
  } else {
    log("\nSome diagnostic health checks failed. See remediation advice above.");
  }

  return {
    healthy: allPassed,
    checks: Object.freeze(checks),
  };
}

/**
 * Builds the sandcastle-agent Docker container image locally.
 */
export async function runBuildImage(options: BuildImageOptions = {}): Promise<BuildImageResult> {
  const log = options.logger ?? console.log;
  const errorLog = options.errorLogger ?? console.error;
  const imageTag = options.imageName ?? process.env.SANDCASTLE_IMAGE ?? "sandcastle-agent";

  const packageRoot = typeof __dirname !== "undefined"
    ? __dirname
    : fileURLToPath(new URL(".", import.meta.url));
  const contextDir = options.contextDir ?? packageRoot;
  const dockerfile = options.dockerfile ?? resolve(contextDir, "Dockerfile");

  let cmd = `docker build -t ${imageTag} -f "${dockerfile}" "${contextDir}"`;
  if (options.buildArgs) {
    for (const [key, val] of Object.entries(options.buildArgs)) {
      cmd += ` --build-arg ${key}=${val}`;
    }
  }
  log(`[BUILD-IMAGE] Building Docker container image: ${imageTag}`);
  log(`[BUILD-IMAGE] Executing: ${cmd}`);

  const run = options.runner ?? ((command: string, cwd?: string) => {
    try {
      const res = spawnSync(command, { shell: true, stdio: "inherit", cwd });
      return {
        status: res.status ?? 0,
        stdout: "",
        stderr: res.error?.message ?? "",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 1, stdout: "", stderr: msg };
    }
  });

  const outcome = run(cmd, contextDir);
  if (outcome.status === 0) {
    log(`[BUILD-IMAGE] Successfully built and tagged Docker image "${imageTag}".`);
    return {
      success: true,
      imageTag,
      command: cmd,
    };
  } else {
    const errorMsg = outcome.stderr || `Docker build exited with status ${outcome.status}`;
    errorLog(`[BUILD-IMAGE] Failed to build Docker image "${imageTag}": ${errorMsg}`);
    return {
      success: false,
      imageTag,
      command: cmd,
      error: errorMsg,
    };
  }
}

export interface CleanupTargetRepoResult {
  readonly cleanedSandcastleDir: boolean;
  readonly logsPreserved: number;
}

/**
 * Ensures that external target repositories remain completely clean after an orchestrator run.
 * 1. Preserves any generated .sandcastle/logs by archiving them to the orchestrator package root.
 * 2. Prunes any leftover git worktrees in the target repository.
 * 3. Removes the .sandcastle directory from the target repository working tree.
 */
export function cleanupTargetRepository(
  targetRepoPath: string,
  packageRoot?: string,
): CleanupTargetRepoResult {
  const targetDir = resolve(targetRepoPath);
  const pkgDir = packageRoot
    ? resolve(packageRoot)
    : resolve(fileURLToPath(new URL(".", import.meta.url)));

  // Do not clean up .sandcastle if target repository is the orchestrator package itself
  if (targetDir === pkgDir) {
    return { cleanedSandcastleDir: false, logsPreserved: 0 };
  }

  const targetSandcastleDir = join(targetDir, ".sandcastle");
  if (!fs.existsSync(targetSandcastleDir)) {
    return { cleanedSandcastleDir: false, logsPreserved: 0 };
  }

  let logsPreserved = 0;
  const targetLogsDir = join(targetSandcastleDir, "logs");
  if (fs.existsSync(targetLogsDir)) {
    const pkgLogsDir = join(pkgDir, ".sandcastle", "logs");
    if (!fs.existsSync(pkgLogsDir)) {
      try {
        fs.mkdirSync(pkgLogsDir, { recursive: true });
      } catch {
        // Ignore mkdir error
      }
    }

    try {
      const files = fs.readdirSync(targetLogsDir);
      for (const file of files) {
        if (file.endsWith(".log")) {
          const src = join(targetLogsDir, file);
          const dest = join(pkgLogsDir, file);
          try {
            fs.copyFileSync(src, dest);
            logsPreserved++;
          } catch {
            // Ignore individual file copy error
          }
        }
      }
    } catch {
      // Ignore readdir error
    }
  }

  // Prune any stale git worktrees in target repository if git is present
  try {
    if (fs.existsSync(join(targetDir, ".git"))) {
      spawnSync("git", ["worktree", "prune"], { cwd: targetDir, stdio: "ignore" });
    }
  } catch {
    // Ignore git prune failure
  }

  // Remove .sandcastle folder recursively from target repository
  try {
    fs.rmSync(targetSandcastleDir, { recursive: true, force: true });
    return { cleanedSandcastleDir: true, logsPreserved };
  } catch {
    return { cleanedSandcastleDir: false, logsPreserved };
  }
}

export interface GitCommitInfo {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
}

export type OperationsGitRunner = (
  cmd: string,
  cwd: string,
) => { status: number | null; stdout: string; stderr: string };

export interface GetBranchCommitsOptions {
  readonly gitRunner?: OperationsGitRunner;
  readonly fallbackMessage?: string;
  readonly logger?: (msg: string) => void;
  readonly errorLogger?: (msg: string) => void;
}

export interface FormatBranchCommitsOptions {
  readonly branchIndent?: string;
  readonly commitIndent?: string;
  readonly emptyPlaceholder?: string;
}

export const DEFAULT_COMMIT_FALLBACK_MESSAGE = "(commit message unavailable)";

/**
 * Parses a single line from git log output into a GitCommitInfo structure.
 * Supports unit-separator delimited output, tab-delimited output, and space-separated lines.
 */
export function parseCommitLine(line: string, fallbackMessage: string = DEFAULT_COMMIT_FALLBACK_MESSAGE): GitCommitInfo | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 1. Check unit-separator delimiter (\x1f)
  if (trimmed.includes("\x1f")) {
    const parts = trimmed.split("\x1f");
    const sha = parts[0]?.trim() || "";
    const shortSha = parts[1]?.trim() || sha.slice(0, 7);
    const rawMessage = parts.slice(2).join("\x1f").trim();
    const message = rawMessage.length > 0 ? rawMessage : fallbackMessage;
    return {
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      message,
    };
  }

  // 2. Check tab delimiter
  if (trimmed.includes("\t")) {
    const parts = trimmed.split("\t");
    const sha = parts[0]?.trim() || "";
    const shortSha = (parts.length > 2 ? parts[1]?.trim() : "") || sha.slice(0, 7);
    const rawMessage = (parts.length > 2 ? parts.slice(2).join("\t") : parts[1] || "").trim();
    const message = rawMessage.length > 0 ? rawMessage : fallbackMessage;
    return {
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      message,
    };
  }

  // 3. Regex matching standard git log lines:
  // e.g. "40-hex 7-hex Subject message"
  const fullAndShortMatch = trimmed.match(/^([0-9a-fA-F]{40})\s+([0-9a-fA-F]{7,12})\s*(.*)$/);
  if (fullAndShortMatch) {
    const sha = fullAndShortMatch[1];
    const shortSha = fullAndShortMatch[2];
    const rawMsg = fullAndShortMatch[3].trim();
    return {
      sha,
      shortSha,
      message: rawMsg.length > 0 ? rawMsg : fallbackMessage,
    };
  }

  // e.g. "40-hex Subject message"
  const fullMatch = trimmed.match(/^([0-9a-fA-F]{40})\s*(.*)$/);
  if (fullMatch) {
    const sha = fullMatch[1];
    const shortSha = sha.slice(0, 7);
    const rawMsg = fullMatch[2].trim();
    return {
      sha,
      shortSha,
      message: rawMsg.length > 0 ? rawMsg : fallbackMessage,
    };
  }

  // e.g. "7-12 hex Subject message"
  const shortMatch = trimmed.match(/^([0-9a-fA-F]{7,12})\s*(.*)$/);
  if (shortMatch) {
    const shortSha = shortMatch[1].slice(0, 7);
    const rawMsg = shortMatch[2].trim();
    return {
      sha: shortMatch[1],
      shortSha,
      message: rawMsg.length > 0 ? rawMsg : fallbackMessage,
    };
  }

  // Any leftover non-empty line without explicit sha
  return {
    sha: trimmed.slice(0, 40),
    shortSha: trimmed.slice(0, 7),
    message: fallbackMessage,
  };
}

/**
 * Queries commits produced on candidate branch relative to Base Branch (baseBranch..targetBranch)
 * in chronological order (oldest to newest).
 * Tolerant to Git query errors and falls back gracefully to short SHAs with unavailable placeholder without throwing.
 */
export function getBranchCommits(
  repoRoot: string,
  baseBranch: string,
  targetBranch: string,
  options: GetBranchCommitsOptions = {},
): readonly GitCommitInfo[] {
  const runner = options.gitRunner ?? runExecCommand;
  const fallbackMessage = options.fallbackMessage ?? DEFAULT_COMMIT_FALLBACK_MESSAGE;
  const errorLog = options.errorLogger ?? console.error;

  const targetRepo = resolve(repoRoot);
  const range = `${baseBranch}..${targetBranch}`;
  const gitLogCmd = `git log --reverse --format="%H%x1f%h%x1f%s" ${range}`;

  try {
    const outcome = runner(gitLogCmd, targetRepo);
    if (outcome.status === 0 && outcome.stdout.trim().length > 0) {
      const lines = outcome.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const commits: GitCommitInfo[] = [];
      for (const line of lines) {
        const parsed = parseCommitLine(line, fallbackMessage);
        if (parsed) {
          commits.push(parsed);
        }
      }
      return Object.freeze(commits);
    }

    // Fallback: If git log failed or returned non-zero status
    if (outcome.status !== 0) {
      // Attempt rev-list fallback
      try {
        const revListRes = runner(`git rev-list --reverse ${range}`, targetRepo);
        if (revListRes.status === 0 && revListRes.stdout.trim().length > 0) {
          const hashes = revListRes.stdout.split(/\r?\n/).map((h) => h.trim()).filter((h) => h.length > 0);
          const fallbackCommits = hashes.map((h) => ({
            sha: h,
            shortSha: h.slice(0, 7),
            message: fallbackMessage,
          }));
          return Object.freeze(fallbackCommits);
        }
      } catch {
        // Ignore rev-list failure
      }

      // If targetBranch itself looks like a commit hash (7-40 hex chars)
      if (/^[0-9a-fA-F]{7,40}$/.test(targetBranch)) {
        return Object.freeze([
          {
            sha: targetBranch,
            shortSha: targetBranch.slice(0, 7),
            message: fallbackMessage,
          },
        ]);
      }
    }

    return Object.freeze([]);
  } catch (err: unknown) {
    // Never throw: fall back gracefully
    const msg = err instanceof Error ? err.message : String(err);
    if (options.errorLogger) {
      errorLog(`[COMMIT-INSPECTION] Git query failed for ${range}: ${msg}`);
    }

    if (/^[0-9a-fA-F]{7,40}$/.test(targetBranch)) {
      return Object.freeze([
        {
          sha: targetBranch,
          shortSha: targetBranch.slice(0, 7),
          message: fallbackMessage,
        },
      ]);
    }

    return Object.freeze([]);
  }
}

/**
 * Formats candidate branch commits with consistent indentation and unicode bullet markers ( • ).
 * Overload 1: formatBranchCommitsSummary(branch, commits, options?)
 * Overload 2: formatBranchCommitsSummary(commits, options?)
 */
export function formatBranchCommitsSummary(
  branch: string,
  commits: readonly GitCommitInfo[],
  options?: FormatBranchCommitsOptions,
): readonly string[];
export function formatBranchCommitsSummary(
  commits: readonly GitCommitInfo[],
  options?: FormatBranchCommitsOptions,
): readonly string[];
export function formatBranchCommitsSummary(
  firstArg: string | readonly GitCommitInfo[],
  secondArg?: readonly GitCommitInfo[] | FormatBranchCommitsOptions,
  thirdArg?: FormatBranchCommitsOptions,
): readonly string[] {
  let branchName: string | undefined;
  let commits: readonly GitCommitInfo[] = [];
  let options: FormatBranchCommitsOptions | undefined;

  if (typeof firstArg === "string") {
    branchName = firstArg;
    commits = (secondArg as readonly GitCommitInfo[]) ?? [];
    options = thirdArg;
  } else {
    commits = firstArg;
    options = secondArg as FormatBranchCommitsOptions | undefined;
  }

  const branchIndent = options?.branchIndent ?? "  ";
  const commitIndent = options?.commitIndent ?? "      ";
  const lines: string[] = [];

  if (branchName !== undefined) {
    lines.push(`${branchIndent}${branchName.trim()}`);
  }

  if (commits.length === 0) {
    if (options?.emptyPlaceholder) {
      lines.push(`${commitIndent}${options.emptyPlaceholder}`);
    }
    return Object.freeze(lines);
  }

  for (const commit of commits) {
    const shortSha = commit.shortSha || commit.sha.slice(0, 7);
    lines.push(`${commitIndent}• ${shortSha} ${commit.message}`);
  }

  return Object.freeze(lines);
}

