import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  detectTechStack,
  resolveVerifyCommand,
  resolveBaseBranch,
  resolveGitIdentity,
  resolveGitHubAuth,
  resolveCacheMounts,
  detectTargetConfig,
  DEFAULT_PROTECTED_BRANCHES,
  type TechStack,
  type TargetGitIdentity,
  type TargetGitHubAuth,
  type TargetRepoConfig,
} from "./target-config.ts";

describe("Target Repository Autodetection Engine (Issue #7)", () => {
  describe("Seam 1: Tech Stack & Verification Command Detection", () => {
    test("autodetects Java Maven project when pom.xml and mvnw exist", () => {
      const files = new Set(["/repo/pom.xml", "/repo/mvnw"]);
      const fileExists = (path: string) => files.has(path.replace(/\\/g, "/"));

      const stack = detectTechStack("/repo", fileExists);
      assert.equal(stack, "maven");

      const cmd = resolveVerifyCommand("/repo", stack, fileExists);
      assert.equal(cmd, "./mvnw test-compile && ./mvnw test");
    });

    test("autodetects Java Maven project when only pom.xml exists", () => {
      const files = new Set(["/repo/pom.xml"]);
      const fileExists = (path: string) => files.has(path.replace(/\\/g, "/"));

      const stack = detectTechStack("/repo", fileExists);
      assert.equal(stack, "maven");

      const cmd = resolveVerifyCommand("/repo", stack, fileExists);
      assert.equal(cmd, "./mvnw test-compile && ./mvnw test");
    });

    test("autodetects Java Gradle project when build.gradle and gradlew exist", () => {
      const files = new Set(["/repo/build.gradle", "/repo/gradlew"]);
      const fileExists = (path: string) => files.has(path.replace(/\\/g, "/"));

      const stack = detectTechStack("/repo", fileExists);
      assert.equal(stack, "gradle");

      const cmd = resolveVerifyCommand("/repo", stack, fileExists);
      assert.equal(cmd, "./gradlew test");
    });

    test("autodetects Java Gradle project when build.gradle.kts exists", () => {
      const files = new Set(["/repo/build.gradle.kts"]);
      const fileExists = (path: string) => files.has(path.replace(/\\/g, "/"));

      const stack = detectTechStack("/repo", fileExists);
      assert.equal(stack, "gradle");

      const cmd = resolveVerifyCommand("/repo", stack, fileExists);
      assert.equal(cmd, "./gradlew test");
    });

    test("autodetects Node/TypeScript project when package.json exists", () => {
      const files = new Set(["/repo/package.json"]);
      const fileExists = (path: string) => files.has(path.replace(/\\/g, "/"));

      const stack = detectTechStack("/repo", fileExists);
      assert.equal(stack, "node");

      const cmd = resolveVerifyCommand("/repo", stack, fileExists);
      assert.equal(cmd, "npm test");
    });

    test("returns unknown and empty verify command when no stack markers are present", () => {
      const files = new Set<string>();
      const fileExists = (path: string) => files.has(path.replace(/\\/g, "/"));

      const stack = detectTechStack("/repo", fileExists);
      assert.equal(stack, "unknown");

      const cmd = resolveVerifyCommand("/repo", stack, fileExists);
      assert.equal(cmd, "");
    });
  });

  describe("Seam 2: Git Base Branch & Protected Branches Defaults", () => {
    test("defines default protected branches with all required canonical branches", () => {
      assert.deepEqual(DEFAULT_PROTECTED_BRANCHES, [
        "main",
        "master",
        "homol",
        "developer",
        "staging",
        "production",
      ]);
    });

    test("resolves active checked-out branch via git runner", () => {
      const mockGitRunner = (args: string[], cwd: string) => {
        assert.equal(cwd, "/test-target-repo");
        if (args[0] === "branch" && args[1] === "--show-current") {
          return { status: 0, stdout: "develop\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unknown command" };
      };

      const branch = resolveBaseBranch("/test-target-repo", {
        gitRunner: mockGitRunner,
      });

      assert.equal(branch, "develop");
    });

    test("falls back to main when git runner exits non-zero or returns empty", () => {
      const failingRunner = () => ({ status: 1, stdout: "", stderr: "fatal: not a git repo" });

      const branch = resolveBaseBranch("/not-a-repo", {
        gitRunner: failingRunner,
      });

      assert.equal(branch, "main");
    });

    test("falls back to main when git returns HEAD (detached HEAD state)", () => {
      const detachedRunner = () => ({ status: 0, stdout: "HEAD\n", stderr: "" });

      const branch = resolveBaseBranch("/repo", {
        gitRunner: detachedRunner,
      });

      assert.equal(branch, "main");
    });

    test("respects BASE_BRANCH environment variable override", () => {
      const mockGitRunner = () => ({ status: 0, stdout: "develop\n", stderr: "" });

      const branch = resolveBaseBranch("/repo", {
        gitRunner: mockGitRunner,
        env: { BASE_BRANCH: "release/v1.0" },
      });

      assert.equal(branch, "release/v1.0");
    });
  });

  describe("Seam 3: Git Authorship Identity Resolution", () => {
    test("reads repository-scoped git config user.name and user.email when set locally", () => {
      const mockGitRunner = (args: string[], cwd: string) => {
        assert.equal(cwd, "/target/repo");
        if (args.includes("--local") && args.includes("user.name")) {
          return { status: 0, stdout: "Local Committer\n", stderr: "" };
        }
        if (args.includes("--local") && args.includes("user.email")) {
          return { status: 0, stdout: "local@example.com\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "key not found" };
      };

      const identity = resolveGitIdentity("/target/repo", {
        gitRunner: mockGitRunner,
      });

      assert.deepEqual(identity, {
        name: "Local Committer",
        email: "local@example.com",
      });
    });

    test("falls back to global git config when repository-scoped config is unset", () => {
      const mockGitRunner = (args: string[]) => {
        if (args.includes("--local")) {
          return { status: 1, stdout: "", stderr: "key does not exist" };
        }
        if (args.includes("--global") && args.includes("user.name")) {
          return { status: 0, stdout: "Global Author\n", stderr: "" };
        }
        if (args.includes("--global") && args.includes("user.email")) {
          return { status: 0, stdout: "global@example.com\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "not found" };
      };

      const identity = resolveGitIdentity("/target/repo", {
        gitRunner: mockGitRunner,
      });

      assert.deepEqual(identity, {
        name: "Global Author",
        email: "global@example.com",
      });
    });

    test("resolves local name and falls back to global email when local email is missing", () => {
      const mockGitRunner = (args: string[]) => {
        if (args.includes("--local") && args.includes("user.name")) {
          return { status: 0, stdout: "Scoped Developer\n", stderr: "" };
        }
        if (args.includes("--local") && args.includes("user.email")) {
          return { status: 1, stdout: "", stderr: "missing" };
        }
        if (args.includes("--global") && args.includes("user.email")) {
          return { status: 0, stdout: "fallback@example.com\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "not found" };
      };

      const identity = resolveGitIdentity("/target/repo", {
        gitRunner: mockGitRunner,
      });

      assert.deepEqual(identity, {
        name: "Scoped Developer",
        email: "fallback@example.com",
      });
    });

    test("returns undefined for fields when neither local nor global git config is set", () => {
      const mockGitRunner = () => ({ status: 1, stdout: "", stderr: "key not found" });

      const identity = resolveGitIdentity("/target/repo", {
        gitRunner: mockGitRunner,
      });

      assert.deepEqual(identity, {
        name: undefined,
        email: undefined,
      });
    });

    test("allows explicit environment variable overrides for GIT_USER_NAME and GIT_USER_EMAIL", () => {
      const mockGitRunner = () => ({ status: 0, stdout: "from-git\n", stderr: "" });

      const identity = resolveGitIdentity("/target/repo", {
        gitRunner: mockGitRunner,
        env: {
          GIT_USER_NAME: "Override Name",
          GIT_USER_EMAIL: "override@example.com",
        },
      });

      assert.deepEqual(identity, {
        name: "Override Name",
        email: "override@example.com",
      });
    });
  });

  describe("Seam 4: GitHub Authentication & Account Resolution", () => {
    test("resolves token and account from GH_TOKEN and GH_USER environment variables", () => {
      const auth = resolveGitHubAuth({
        env: {
          GH_TOKEN: "gho_testToken123456",
          GH_USER: "octocat",
        },
      });

      assert.deepEqual(auth, {
        account: "octocat",
        token: "gho_testToken123456",
        source: "env:GH_TOKEN",
      });
    });

    test("resolves token from GITHUB_TOKEN environment variable", () => {
      const mockGhRunner = () => ({ status: 1, stdout: "", stderr: "disabled in test" });
      const auth = resolveGitHubAuth({
        env: {
          GITHUB_TOKEN: "gho_githubToken654321",
        },
        ghRunner: mockGhRunner,
      });

      assert.equal(auth.token, "gho_githubToken654321");
      assert.equal(auth.source, "env:GITHUB_TOKEN");
    });

    test("resolves token and account from gh CLI when environment variables are absent", () => {
      const mockGhRunner = (args: string[]) => {
        if (args[0] === "auth" && args[1] === "token") {
          return { status: 0, stdout: "gho_cliToken7890\n", stderr: "" };
        }
        if (args[0] === "api" && args[1] === "user") {
          return { status: 0, stdout: "MTR-S\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unknown command" };
      };

      const auth = resolveGitHubAuth({
        env: {},
        ghRunner: mockGhRunner,
      });

      assert.deepEqual(auth, {
        account: "MTR-S",
        token: "gho_cliToken7890",
        source: "gh:cli",
      });
    });

    test("parses active account from gh auth status output when gh api user fails", () => {
      const authStatusOutput = `
github.com
  ✓ Logged in to github.com account MTR-S (keyring)
  - Active account: true
  - Git operations protocol: https
`;
      const mockGhRunner = (args: string[]) => {
        if (args[0] === "auth" && args[1] === "token") {
          return { status: 0, stdout: "gho_cliToken7890\n", stderr: "" };
        }
        if (args[0] === "api" && args[1] === "user") {
          return { status: 1, stdout: "", stderr: "network unreachable" };
        }
        if (args[0] === "auth" && args[1] === "status") {
          return { status: 0, stdout: authStatusOutput, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unknown command" };
      };

      const auth = resolveGitHubAuth({
        env: {},
        ghRunner: mockGhRunner,
      });

      assert.deepEqual(auth, {
        account: "MTR-S",
        token: "gho_cliToken7890",
        source: "gh:cli",
      });
    });

    test("returns none when neither env tokens nor gh auth token succeed", () => {
      const mockGhRunner = () => ({ status: 1, stdout: "", stderr: "not logged in" });

      const auth = resolveGitHubAuth({
        env: {},
        ghRunner: mockGhRunner,
      });

      assert.deepEqual(auth, {
        account: undefined,
        token: undefined,
        source: "none",
      });
    });
  });

  describe("Seam 5: Dependency Cache Mount Resolution", () => {
    test("resolves Maven host cache ~/.m2 when stack is maven and directory exists", () => {
      const mockHome = resolve("/mock/user");
      const mockM2 = resolve(mockHome, ".m2");
      const mockNpm = resolve(mockHome, ".npm");
      const existingDirs = new Set([mockM2, mockNpm]);
      const fsExists = (p: string) => existingDirs.has(p);
      const fsIsDir = (p: string) => existingDirs.has(p);

      const mounts = resolveCacheMounts("maven", {
        userHome: mockHome,
        fsExists,
        fsIsDir,
        filterByStack: true,
      });

      assert.equal(mounts.length, 1);
      assert.equal(mounts[0].sandboxPath, "/home/agent/.m2");
    });

    test("resolves npm host cache ~/.npm when stack is node and directory exists", () => {
      const mockHome = resolve("/mock/user");
      const mockM2 = resolve(mockHome, ".m2");
      const mockNpm = resolve(mockHome, ".npm");
      const existingDirs = new Set([mockM2, mockNpm]);
      const fsExists = (p: string) => existingDirs.has(p);
      const fsIsDir = (p: string) => existingDirs.has(p);

      const mounts = resolveCacheMounts("node", {
        userHome: mockHome,
        fsExists,
        fsIsDir,
        filterByStack: true,
      });

      assert.equal(mounts.length, 1);
      assert.equal(mounts[0].sandboxPath, "/home/agent/.npm");
    });

    test("resolves all available caches when filterByStack is false or stack is unknown", () => {
      const mockHome = resolve("/mock/user");
      const mockM2 = resolve(mockHome, ".m2");
      const mockNpm = resolve(mockHome, ".npm");
      const existingDirs = new Set([mockM2, mockNpm]);
      const fsExists = (p: string) => existingDirs.has(p);
      const fsIsDir = (p: string) => existingDirs.has(p);

      const mounts = resolveCacheMounts("unknown", {
        userHome: mockHome,
        fsExists,
        fsIsDir,
      });

      assert.equal(mounts.length, 2);
      assert.ok(mounts.some((m) => m.sandboxPath === "/home/agent/.m2"));
      assert.ok(mounts.some((m) => m.sandboxPath === "/home/agent/.npm"));
    });

    test("returns empty array when neither cache directory exists on host", () => {
      const fsExists = () => false;
      const fsIsDir = () => false;

      const mounts = resolveCacheMounts("node", {
        userHome: resolve("/mock/empty"),
        fsExists,
        fsIsDir,
      });

      assert.deepEqual(mounts, []);
    });
  });

  describe("Seam 6: Unified Target Autodetection Engine", () => {
    test("autodetects Java Maven fixture repository with local git config and gh cli token", () => {
      const repoDir = resolve("/mock/maven-project");
      const userHome = resolve("/mock/home");
      const files = new Set([
        resolve(repoDir, "pom.xml"),
        resolve(repoDir, "mvnw"),
        resolve(userHome, ".m2"),
      ]);

      const mockGitRunner = (args: string[]) => {
        if (args[0] === "branch" && args[1] === "--show-current") {
          return { status: 0, stdout: "main\n", stderr: "" };
        }
        if (args.includes("--local") && args.includes("user.name")) {
          return { status: 0, stdout: "Maven Local Committer\n", stderr: "" };
        }
        if (args.includes("--local") && args.includes("user.email")) {
          return { status: 0, stdout: "maven@local.org\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      };

      const mockGhRunner = (args: string[]) => {
        if (args[0] === "auth" && args[1] === "token") {
          return { status: 0, stdout: "gho_mavenToken123\n", stderr: "" };
        }
        if (args[0] === "api" && args[1] === "user") {
          return { status: 0, stdout: "mavenDeveloper\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      };

      const config = detectTargetConfig({
        targetRepoPath: repoDir,
        userHome,
        fileExists: (p) => files.has(p),
        fsExists: (p) => files.has(p),
        fsIsDir: (p) => files.has(p),
        gitRunner: mockGitRunner,
        ghRunner: mockGhRunner,
      });

      assert.equal(config.targetRepoPath, repoDir);
      assert.equal(config.baseBranch, "main");
      assert.deepEqual(config.protectedBranches, [
        "main",
        "master",
        "homol",
        "developer",
        "staging",
        "production",
      ]);
      assert.equal(config.techStack, "maven");
      assert.equal(config.verifyCommand, "./mvnw test-compile && ./mvnw test");
      assert.deepEqual(config.gitIdentity, {
        name: "Maven Local Committer",
        email: "maven@local.org",
      });
      assert.deepEqual(config.githubAuth, {
        account: "mavenDeveloper",
        token: "gho_mavenToken123",
        source: "gh:cli",
      });
      assert.equal(config.cacheMounts.length, 1);
      assert.equal(config.cacheMounts[0].sandboxPath, "/home/agent/.m2");
    });

    test("autodetects Java Gradle fixture repository with global git fallback", () => {
      const repoDir = resolve("/mock/gradle-project");
      const userHome = resolve("/mock/home");
      const files = new Set([
        resolve(repoDir, "build.gradle"),
        resolve(repoDir, "gradlew"),
        resolve(userHome, ".m2"),
      ]);

      const mockGitRunner = (args: string[]) => {
        if (args[0] === "branch" && args[1] === "--show-current") {
          return { status: 0, stdout: "developer\n", stderr: "" };
        }
        if (args.includes("--local")) {
          return { status: 1, stdout: "", stderr: "not found" };
        }
        if (args.includes("--global") && args.includes("user.name")) {
          return { status: 0, stdout: "Global Gradle Dev\n", stderr: "" };
        }
        if (args.includes("--global") && args.includes("user.email")) {
          return { status: 0, stdout: "gradle@global.org\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      };

      const mockGhRunner = (args: string[]) => {
        if (args[0] === "auth" && args[1] === "token") {
          return { status: 0, stdout: "gho_gradleToken456\n", stderr: "" };
        }
        if (args[0] === "api") {
          return { status: 0, stdout: "gradleUser\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      };

      const config = detectTargetConfig({
        targetRepoPath: repoDir,
        userHome,
        fileExists: (p) => files.has(p),
        fsExists: (p) => files.has(p),
        fsIsDir: (p) => files.has(p),
        gitRunner: mockGitRunner,
        ghRunner: mockGhRunner,
      });

      assert.equal(config.techStack, "gradle");
      assert.equal(config.verifyCommand, "./gradlew test");
      assert.equal(config.baseBranch, "developer");
      assert.deepEqual(config.gitIdentity, {
        name: "Global Gradle Dev",
        email: "gradle@global.org",
      });
      assert.equal(config.cacheMounts.length, 1);
      assert.equal(config.cacheMounts[0].sandboxPath, "/home/agent/.m2");
    });

    test("autodetects Node/TypeScript fixture repository with GH_TOKEN environment variable", () => {
      const repoDir = resolve("/mock/node-project");
      const userHome = resolve("/mock/home");
      const files = new Set([
        resolve(repoDir, "package.json"),
        resolve(userHome, ".npm"),
      ]);

      const mockGitRunner = (args: string[]) => {
        if (args[0] === "branch" && args[1] === "--show-current") {
          return { status: 0, stdout: "staging\n", stderr: "" };
        }
        if (args.includes("user.name")) {
          return { status: 0, stdout: "Node Developer\n", stderr: "" };
        }
        if (args.includes("user.email")) {
          return { status: 0, stdout: "node@example.com\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      };

      const mockGhRunner = () => ({ status: 1, stdout: "", stderr: "unused" });

      const config = detectTargetConfig({
        targetRepoPath: repoDir,
        userHome,
        env: {
          GH_TOKEN: "gho_nodeEnvToken789",
          GH_USER: "nodeAuthor",
        },
        fileExists: (p) => files.has(p),
        fsExists: (p) => files.has(p),
        fsIsDir: (p) => files.has(p),
        gitRunner: mockGitRunner,
        ghRunner: mockGhRunner,
      });

      assert.equal(config.techStack, "node");
      assert.equal(config.verifyCommand, "npm test");
      assert.equal(config.baseBranch, "staging");
      assert.deepEqual(config.githubAuth, {
        account: "nodeAuthor",
        token: "gho_nodeEnvToken789",
        source: "env:GH_TOKEN",
      });
      assert.equal(config.cacheMounts.length, 1);
      assert.equal(config.cacheMounts[0].sandboxPath, "/home/agent/.npm");
    });

    test("defaults to process.cwd() when targetRepoPath is omitted", () => {
      const config = detectTargetConfig({
        env: { GH_TOKEN: "mock-token", GH_USER: "mock-user" },
        ghRunner: () => ({ status: 1, stdout: "", stderr: "" }),
      });

      assert.equal(config.targetRepoPath, process.cwd());
      assert.ok(config.baseBranch);
      assert.equal(config.techStack, "node"); // sandcastle-antigravity is a Node/TS project
      assert.equal(config.verifyCommand, "npm test");
    });
  });
});
