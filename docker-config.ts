import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";

export interface DockerMount {
  readonly hostPath: string;
  readonly sandboxPath: string;
}

/**
 * Collect authentication tokens, labels, and git identity from the environment
 * to forward into the Docker sandbox.
 */
export function getSandboxEnv(
  sourceEnv: Record<string, string | undefined> = process.env,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};

  if (sourceEnv.GH_TOKEN) {
    env.GH_TOKEN = sourceEnv.GH_TOKEN;
  }
  if (sourceEnv.GITHUB_TOKEN) {
    env.GITHUB_TOKEN = sourceEnv.GITHUB_TOKEN;
  }
  if (sourceEnv.SANDCASTLE_LABEL) {
    env.SANDCASTLE_LABEL = sourceEnv.SANDCASTLE_LABEL;
  }
  // Mirror GH_TOKEN <-> GITHUB_TOKEN if only one is present
  if (env.GH_TOKEN && !env.GITHUB_TOKEN) {
    env.GITHUB_TOKEN = env.GH_TOKEN;
  } else if (env.GITHUB_TOKEN && !env.GH_TOKEN) {
    env.GH_TOKEN = env.GITHUB_TOKEN;
  }

  // Dynamic Git authorship identity injection (Issue #6)
  // Injects both config vars and standard Git author/committer env vars to guarantee
  // that commits inside target repo worktrees carry the intended identity and never leak
  // host/corporate identities from target repo local .git/config.
  if (sourceEnv.GIT_USER_NAME) {
    env.GIT_USER_NAME = sourceEnv.GIT_USER_NAME;
    env.GIT_AUTHOR_NAME = sourceEnv.GIT_USER_NAME;
    env.GIT_COMMITTER_NAME = sourceEnv.GIT_USER_NAME;
  }
  if (sourceEnv.GIT_USER_EMAIL) {
    env.GIT_USER_EMAIL = sourceEnv.GIT_USER_EMAIL;
    env.GIT_AUTHOR_EMAIL = sourceEnv.GIT_USER_EMAIL;
    env.GIT_COMMITTER_EMAIL = sourceEnv.GIT_USER_EMAIL;
  }

  return Object.freeze(env);
}

function isDirectory(
  path: string,
  fsExists: (p: string) => boolean,
  fsIsDir?: (p: string) => boolean,
): boolean {
  if (!fsExists(path)) return false;
  if (fsIsDir) return fsIsDir(path);
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves host build caches (Maven ~/.m2 and Node ~/.npm) to conditionally
 * mount into the agent sandbox if present on the host system.
 */
export function getSandboxMounts(
  userHome: string = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir() ?? "",
  fsExists: (path: string) => boolean = existsSync,
  fsIsDir?: (path: string) => boolean,
): readonly DockerMount[] {
  const mounts: DockerMount[] = [];
  if (!userHome) {
    return mounts;
  }

  const m2Path = resolve(userHome, ".m2");
  if (isDirectory(m2Path, fsExists, fsIsDir)) {
    mounts.push({
      hostPath: m2Path,
      sandboxPath: "/home/agent/.m2",
    });
  }

  const npmPath = resolve(userHome, ".npm");
  if (isDirectory(npmPath, fsExists, fsIsDir)) {
    mounts.push({
      hostPath: npmPath,
      sandboxPath: "/home/agent/.npm",
    });
  }

  return Object.freeze(mounts);
}
