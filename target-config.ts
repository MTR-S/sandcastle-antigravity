import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSandboxMounts, type DockerMount } from "./docker-config.ts";

export type { DockerMount };

export type TechStack = "maven" | "gradle" | "node" | "unknown";

export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = [
  "main",
  "master",
  "homol",
  "developer",
  "staging",
  "production",
] as const;

export type GitRunner = (
  args: string[],
  cwd: string,
) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

const defaultGitRunner: GitRunner = (args, cwd) => {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
};

export interface ResolveBaseBranchOptions {
  readonly gitRunner?: GitRunner;
  readonly env?: Record<string, string | undefined>;
}

export interface TargetGitIdentity {
  readonly name?: string;
  readonly email?: string;
}

export interface ResolveGitIdentityOptions {
  readonly gitRunner?: GitRunner;
  readonly env?: Record<string, string | undefined>;
}

export type GitHubAuthSource = "env:GH_TOKEN" | "env:GITHUB_TOKEN" | "gh:cli" | "none";

export interface TargetGitHubAuth {
  readonly account?: string;
  readonly token?: string;
  readonly source: GitHubAuthSource;
}

export type GhRunner = (
  args: string[],
  env?: Record<string, string | undefined>,
) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

const defaultGhRunner: GhRunner = (args, customEnv) => {
  const env = customEnv ? { ...process.env, ...customEnv } : process.env;
  const res = spawnSync("gh", args, {
    encoding: "utf-8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
};

export interface ResolveGitHubAuthOptions {
  readonly ghRunner?: GhRunner;
  readonly env?: Record<string, string | undefined>;
}

/**
 * Parses active GitHub username from `gh auth status` command output.
 */
export function parseActiveAccountFromAuthStatus(output: string): string | undefined {
  const blocks = output.split(/github\.com/i);
  for (const block of blocks) {
    if (/Active account:\s*true/i.test(block)) {
      const match = block.match(/account\s+([A-Za-z0-9_-]+)/i);
      if (match) return match[1];
    }
  }
  const fallbackMatch = output.match(/account\s+([A-Za-z0-9_-]+)/i);
  return fallbackMatch ? fallbackMatch[1] : undefined;
}

/**
 * Resolves active GitHub user account and authorization token:
 * 1. Honors GH_TOKEN / GITHUB_TOKEN environment variables
 * 2. Falls back to querying `gh auth token` via GitHub CLI
 * 3. Resolves the active account login via GH_USER, `gh api user`, or `gh auth status`
 */
export function resolveGitHubAuth(
  options: ResolveGitHubAuthOptions = {},
): TargetGitHubAuth {
  const env = options.env ?? process.env;
  const runner = options.ghRunner ?? defaultGhRunner;

  let token: string | undefined;
  let source: GitHubAuthSource = "none";

  if (env.GH_TOKEN && env.GH_TOKEN.trim()) {
    token = env.GH_TOKEN.trim();
    source = "env:GH_TOKEN";
  } else if (env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()) {
    token = env.GITHUB_TOKEN.trim();
    source = "env:GITHUB_TOKEN";
  } else {
    try {
      const tokenRes = runner(["auth", "token"], env);
      if (tokenRes.status === 0 && tokenRes.stdout.trim()) {
        token = tokenRes.stdout.trim();
        source = "gh:cli";
      }
    } catch {
      // Ignore
    }
  }

  if (!token) {
    return Object.freeze({
      account: undefined,
      token: undefined,
      source: "none",
    });
  }

  let account = env.GH_USER?.trim() || env.GITHUB_USER?.trim() || undefined;

  if (!account) {
    try {
      const apiRes = runner(["api", "user", "-q", ".login"], env);
      if (apiRes.status === 0 && apiRes.stdout.trim()) {
        account = apiRes.stdout.trim();
      }
    } catch {
      // Ignore
    }
  }

  if (!account) {
    try {
      const statusRes = runner(["auth", "status"], env);
      const combined = (statusRes.stdout || "") + "\n" + (statusRes.stderr || "");
      const parsed = parseActiveAccountFromAuthStatus(combined);
      if (parsed) {
        account = parsed;
      }
    } catch {
      // Ignore
    }
  }

  return Object.freeze({
    account,
    token,
    source,
  });
}

function readGitConfig(
  runner: GitRunner,
  repoPath: string,
  key: string,
): string | undefined {
  try {
    const localRes = runner(["config", "--local", key], repoPath);
    if (localRes.status === 0 && localRes.stdout.trim()) {
      return localRes.stdout.trim();
    }
    const globalRes = runner(["config", "--global", key], repoPath);
    if (globalRes.status === 0 && globalRes.stdout.trim()) {
      return globalRes.stdout.trim();
    }
  } catch {
    // Ignore
  }
  return undefined;
}

/**
 * Resolves Git identity (user.name and user.email):
 * 1. Checks explicit GIT_USER_NAME / GIT_USER_EMAIL env vars
 * 2. Checks target repository-scoped config (`git config --local`)
 * 3. Falls back to host global config (`git config --global`)
 */
export function resolveGitIdentity(
  repoPath: string,
  options: ResolveGitIdentityOptions = {},
): TargetGitIdentity {
  const env = options.env ?? process.env;
  const runner = options.gitRunner ?? defaultGitRunner;

  const name =
    env.GIT_USER_NAME?.trim() || readGitConfig(runner, repoPath, "user.name");
  const email =
    env.GIT_USER_EMAIL?.trim() || readGitConfig(runner, repoPath, "user.email");

  return Object.freeze({ name, email });
}

/**
 * Resolves the active Base Branch for a repository:
 * 1. Honors explicit env.BASE_BRANCH if provided
 * 2. Queries active checked-out git branch
 * 3. Falls back to "main" on detached HEAD, failure, or non-git directories
 */
export function resolveBaseBranch(
  repoPath: string,
  options: ResolveBaseBranchOptions = {},
): string {
  const env = options.env ?? process.env;
  if (env.BASE_BRANCH && env.BASE_BRANCH.trim()) {
    return env.BASE_BRANCH.trim();
  }

  const runner = options.gitRunner ?? defaultGitRunner;
  try {
    const res = runner(["branch", "--show-current"], repoPath);
    if (res.status === 0 && res.stdout.trim()) {
      const current = res.stdout.trim();
      if (current !== "HEAD") {
        return current;
      }
    }
  } catch {
    // Ignore and fallback
  }

  return "main";
}

export interface ResolveCacheMountsOptions {
  readonly userHome?: string;
  readonly fsExists?: (path: string) => boolean;
  readonly fsIsDir?: (path: string) => boolean;
  readonly filterByStack?: boolean;
}

/**
 * Resolves host build cache mounts available for the detected tech stack.
 */
export function resolveCacheMounts(
  techStack: TechStack,
  options: ResolveCacheMountsOptions = {},
): readonly DockerMount[] {
  const allMounts = getSandboxMounts(
    options.userHome,
    options.fsExists,
    options.fsIsDir,
  );

  if (!options.filterByStack || techStack === "unknown") {
    return allMounts;
  }

  if (techStack === "maven" || techStack === "gradle") {
    return Object.freeze(allMounts.filter((m) => m.sandboxPath === "/home/agent/.m2"));
  }

  if (techStack === "node") {
    return Object.freeze(allMounts.filter((m) => m.sandboxPath === "/home/agent/.npm"));
  }

  return allMounts;
}

export interface DetectTargetConfigOptions {
  readonly targetRepoPath?: string;
  readonly env?: Record<string, string | undefined>;
  readonly gitRunner?: GitRunner;
  readonly ghRunner?: GhRunner;
  readonly fileExists?: (path: string) => boolean;
  readonly fsExists?: (path: string) => boolean;
  readonly fsIsDir?: (path: string) => boolean;
  readonly userHome?: string;
  readonly filterCachesByStack?: boolean;
}

export interface TargetRepoConfig {
  readonly targetRepoPath: string;
  readonly baseBranch: string;
  readonly protectedBranches: readonly string[];
  readonly gitIdentity: TargetGitIdentity;
  readonly githubAuth: TargetGitHubAuth;
  readonly techStack: TechStack;
  readonly verifyCommand: string;
  readonly cacheMounts: readonly DockerMount[];
}

/**
 * Autodetects all key target repository parameters:
 * 1. Base Branch & Protected Branches
 * 2. Local Git identity (user.name & user.email) with global fallback
 * 3. Active GitHub CLI authentication (account & token)
 * 4. Tech stack (Maven, Gradle, Node/TS) and canonical verification command
 * 5. Host dependency cache mounts available for the stack
 */
export function detectTargetConfig(
  options: DetectTargetConfigOptions = {},
): TargetRepoConfig {
  const repoPath = options.targetRepoPath
    ? resolve(options.targetRepoPath)
    : process.cwd();

  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? options.fsExists ?? existsSync;

  const techStack = detectTechStack(repoPath, fileExists);
  const verifyCommand = resolveVerifyCommand(techStack);

  const baseBranch = resolveBaseBranch(repoPath, {
    gitRunner: options.gitRunner,
    env,
  });

  const gitIdentity = resolveGitIdentity(repoPath, {
    gitRunner: options.gitRunner,
    env,
  });

  const githubAuth = resolveGitHubAuth({
    ghRunner: options.ghRunner,
    env,
  });

  const cacheMounts = resolveCacheMounts(techStack, {
    userHome: options.userHome,
    fsExists: options.fsExists ?? fileExists,
    fsIsDir: options.fsIsDir,
    filterByStack: options.filterCachesByStack ?? true,
  });

  return Object.freeze({
    targetRepoPath: repoPath,
    baseBranch,
    protectedBranches: DEFAULT_PROTECTED_BRANCHES,
    gitIdentity,
    githubAuth,
    techStack,
    verifyCommand,
    cacheMounts,
  });
}

/**
 * Autodetects the primary build and test technology stack for a given repository.
 */
export function detectTechStack(
  repoPath: string,
  fileExists: (path: string) => boolean = existsSync,
): TechStack {
  // Check Maven: pom.xml or mvnw
  if (fileExists(join(repoPath, "pom.xml")) || fileExists(join(repoPath, "mvnw"))) {
    return "maven";
  }

  // Check Gradle: build.gradle, build.gradle.kts, or gradlew
  if (
    fileExists(join(repoPath, "build.gradle")) ||
    fileExists(join(repoPath, "build.gradle.kts")) ||
    fileExists(join(repoPath, "gradlew"))
  ) {
    return "gradle";
  }

  // Check Node/TypeScript: package.json
  if (fileExists(join(repoPath, "package.json"))) {
    return "node";
  }

  return "unknown";
}

/**
 * Resolves the canonical verification command for the detected tech stack.
 */
export function resolveVerifyCommand(
  techStackOrRepoPath: TechStack | string,
  maybeStack?: TechStack,
): string {
  const stack: TechStack =
    typeof maybeStack === "string"
      ? maybeStack
      : (techStackOrRepoPath as TechStack);

  switch (stack) {
    case "maven":
      return "./mvnw test-compile && ./mvnw test";
    case "gradle":
      return "./gradlew test";
    case "node":
      return "npm test";
    case "unknown":
    default:
      return "";
  }
}
