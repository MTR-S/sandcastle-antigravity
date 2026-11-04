import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSandboxEnv, getSandboxMounts, getSandboxHooks } from "./docker-config.ts";

describe("Docker Container & Git Identity Decoupling (Issue #6, Issue #26)", () => {
  const repoRoot = existsSync(".git") ? process.cwd() : resolve(process.cwd(), "..");
  const dockerfilePath = resolve(repoRoot, "Dockerfile");
  const entrypointPath = resolve(repoRoot, "entrypoint.sh");

  describe("Seam 1: Dockerfile identity decoupling", () => {
    test("Dockerfile exists at repository root", () => {
      assert.ok(existsSync(dockerfilePath), "Dockerfile must exist at repository root");
    });

    test("Dockerfile has zero hardcoded user.name and user.email configurations", () => {
      const dockerfileContent = readFileSync(dockerfilePath, "utf-8");

      assert.doesNotMatch(
        dockerfileContent,
        /git\s+config\s+.*user\.name/i,
        "Dockerfile must not contain hardcoded git config user.name",
      );
      assert.doesNotMatch(
        dockerfileContent,
        /git\s+config\s+.*user\.email/i,
        "Dockerfile must not contain hardcoded git config user.email",
      );
      assert.doesNotMatch(
        dockerfileContent,
        /corporate-username/i,
        "Dockerfile must not contain hardcoded corporate username",
      );
      assert.doesNotMatch(
        dockerfileContent,
        /corporate-domain\.com/i,
        "Dockerfile must not contain hardcoded corporate email domain",
      );
    });

    test("Dockerfile retains safe.directory wildcard configuration", () => {
      const dockerfileContent = readFileSync(dockerfilePath, "utf-8");

      assert.match(
        dockerfileContent,
        /git\s+config\s+--global\s+--add\s+safe\.directory\s+['"]?\*['"]?/,
        "Dockerfile must preserve safe.directory wildcard configuration for container execution",
      );
    });
  });

  describe("Seam 2: Host cache mounts & env forwarding", () => {
    test("getSandboxEnv forwards GIT_USER_NAME and GIT_USER_EMAIL when present", () => {
      const env = getSandboxEnv({
        GIT_USER_NAME: "MTR-S",
        GIT_USER_EMAIL: "dev@example.com",
        GH_TOKEN: "mock-gh-token",
        SANDCASTLE_LABEL: "ready-for-agent",
      });

      assert.equal(env.GIT_USER_NAME, "MTR-S");
      assert.equal(env.GIT_USER_EMAIL, "dev@example.com");
      assert.equal(env.GH_TOKEN, "mock-gh-token");
      assert.equal(env.GITHUB_TOKEN, "mock-gh-token");
      assert.equal(env.SANDCASTLE_LABEL, "ready-for-agent");
      assert.ok(Object.isFrozen(env), "getSandboxEnv must return frozen/immutable object");
    });

    test("getSandboxEnv forwards GH_USER when present and omits when undefined", () => {
      const envWithUser = getSandboxEnv({
        GH_USER: "MTR-S",
        GH_TOKEN: "mock-gh-token",
      });
      assert.equal(envWithUser.GH_USER, "MTR-S");

      const envWithoutUser = getSandboxEnv({
        GH_TOKEN: "mock-gh-token",
      });
      assert.equal(envWithoutUser.GH_USER, undefined);
    });

    test("getSandboxEnv omits GIT_USER_NAME and GIT_USER_EMAIL when not defined", () => {
      const env = getSandboxEnv({});

      assert.equal(env.GIT_USER_NAME, undefined);
      assert.equal(env.GIT_USER_EMAIL, undefined);
    });

    test("getSandboxEnv never forwards GEMINI_API_KEY into sandbox env", () => {
      const env = getSandboxEnv({
        GEMINI_API_KEY: "secret-gemini-key",
        GIT_USER_NAME: "MTR-S",
      });

      assert.equal(env.GEMINI_API_KEY, undefined);
    });

    test("getSandboxMounts mounts both ~/.m2 and ~/.npm when both exist as directories on host", () => {
      const mockHome = resolve("/mock/home");
      const mockM2 = resolve(mockHome, ".m2");
      const mockNpm = resolve(mockHome, ".npm");

      const existingPaths = new Set([mockM2, mockNpm]);
      const mounts = getSandboxMounts(
        mockHome,
        (p) => existingPaths.has(p),
        (p) => existingPaths.has(p),
      );

      assert.deepEqual(mounts, [
        {
          hostPath: mockM2,
          sandboxPath: "/home/agent/.m2",
        },
        {
          hostPath: mockNpm,
          sandboxPath: "/home/agent/.npm",
        },
      ]);
      assert.ok(Object.isFrozen(mounts), "getSandboxMounts must return frozen/immutable array");
    });

    test("getSandboxMounts skips plain files even if path exists", () => {
      const mockHome = resolve("/mock/home");
      const mockM2 = resolve(mockHome, ".m2");
      const mockNpm = resolve(mockHome, ".npm");

      // .m2 is a directory, .npm is a regular file
      const mounts = getSandboxMounts(
        mockHome,
        (p) => p === mockM2 || p === mockNpm,
        (p) => p === mockM2,
      );

      assert.deepEqual(mounts, [
        {
          hostPath: mockM2,
          sandboxPath: "/home/agent/.m2",
        },
      ]);
    });

    test("getSandboxMounts mounts only ~/.m2 when ~/.npm does not exist on host", () => {
      const mockHome = resolve("/mock/home");
      const mockM2 = resolve(mockHome, ".m2");

      const existingPaths = new Set([mockM2]);
      const mounts = getSandboxMounts(
        mockHome,
        (p) => existingPaths.has(p),
        (p) => existingPaths.has(p),
      );

      assert.deepEqual(mounts, [
        {
          hostPath: mockM2,
          sandboxPath: "/home/agent/.m2",
        },
      ]);
    });

    test("getSandboxMounts mounts only ~/.npm when ~/.m2 does not exist on host", () => {
      const mockHome = resolve("/mock/home");
      const mockNpm = resolve(mockHome, ".npm");

      const existingPaths = new Set([mockNpm]);
      const mounts = getSandboxMounts(
        mockHome,
        (p) => existingPaths.has(p),
        (p) => existingPaths.has(p),
      );

      assert.deepEqual(mounts, [
        {
          hostPath: mockNpm,
          sandboxPath: "/home/agent/.npm",
        },
      ]);
    });

    test("getSandboxMounts returns empty array when neither cache directory exists", () => {
      const mockHome = resolve("/mock/home");
      const mounts = getSandboxMounts(mockHome, () => false, () => false);

      assert.deepEqual(mounts, []);
    });
  });

  describe("Seam 3: Container entrypoint dynamic Git identity specification (Issue #6, Issue #26)", () => {
    test("entrypoint.sh safely removes stale .gitconfig.lock upon boot", () => {
      const entrypointContent = readFileSync(entrypointPath, "utf-8");

      assert.match(
        entrypointContent,
        /rm\s+-f\s+["']?\$HOME\/\.gitconfig\.lock["']?/,
        "entrypoint.sh must safely remove stale .gitconfig.lock upon boot to prevent orphan lock errors",
      );
    });

    test("entrypoint.sh eliminates uncoordinated git config mutations during boot to avoid race condition", () => {
      const entrypointContent = readFileSync(entrypointPath, "utf-8");

      assert.doesNotMatch(
        entrypointContent,
        /git\s+config\s+--global/,
        "entrypoint.sh must not mutate global git config during container boot",
      );
    });

    test("entrypoint.sh exports GIT_AUTHOR_* and GIT_COMMITTER_* from environment variables", () => {
      const entrypointContent = readFileSync(entrypointPath, "utf-8");

      assert.match(
        entrypointContent,
        /GIT_USER_NAME/,
        "entrypoint.sh must reference GIT_USER_NAME",
      );
      assert.match(
        entrypointContent,
        /export\s+GIT_AUTHOR_NAME=["']\$GIT_USER_NAME["']/,
        "entrypoint.sh must export GIT_AUTHOR_NAME from $GIT_USER_NAME",
      );
      assert.match(
        entrypointContent,
        /export\s+GIT_COMMITTER_NAME=["']\$GIT_USER_NAME["']/,
        "entrypoint.sh must export GIT_COMMITTER_NAME from $GIT_USER_NAME",
      );
      assert.match(
        entrypointContent,
        /GIT_USER_EMAIL/,
        "entrypoint.sh must reference GIT_USER_EMAIL",
      );
      assert.match(
        entrypointContent,
        /export\s+GIT_AUTHOR_EMAIL=["']\$GIT_USER_EMAIL["']/,
        "entrypoint.sh must export GIT_AUTHOR_EMAIL from $GIT_USER_EMAIL",
      );
      assert.match(
        entrypointContent,
        /export\s+GIT_COMMITTER_EMAIL=["']\$GIT_USER_EMAIL["']/,
        "entrypoint.sh must export GIT_COMMITTER_EMAIL from $GIT_USER_EMAIL",
      );
    });

    test("entrypoint.sh handles absent GIT_USER_NAME and GIT_USER_EMAIL conditionally", () => {
      const entrypointContent = readFileSync(entrypointPath, "utf-8");

      assert.match(
        entrypointContent,
        /if\s+\[\s+-n\s+"\$GIT_USER_NAME"\s+\]/,
        "entrypoint.sh must check if GIT_USER_NAME is non-empty before configuring",
      );
      assert.match(
        entrypointContent,
        /if\s+\[\s+-n\s+"\$GIT_USER_EMAIL"\s+\]/,
        "entrypoint.sh must check if GIT_USER_EMAIL is non-empty before configuring",
      );
    });
  });

  describe("Seam 4: Sequential sandbox Git identity lifecycle hooks (Issue #26)", () => {
    test("getSandboxHooks builds empty hooks when identity and env are undefined", () => {
      const hooks = getSandboxHooks();

      assert.deepEqual(hooks, {
        sandbox: {
          onSandboxReady: [],
        },
      });
      assert.ok(Object.isFrozen(hooks), "hooks must be frozen");
      assert.ok(Object.isFrozen(hooks.sandbox), "sandbox hooks must be frozen");
      assert.ok(Object.isFrozen(hooks.sandbox?.onSandboxReady), "onSandboxReady must be frozen");
    });

    test("getSandboxHooks builds sequential git config compound command from GitIdentityInput", () => {
      const hooks = getSandboxHooks({
        name: "Dynamic Agent",
        email: "agent@sandcastle-dynamic.org",
      });

      assert.deepEqual(hooks.sandbox?.onSandboxReady, [
        {
          command:
            'git config --global user.name "Dynamic Agent" && git config --global user.email "agent@sandcastle-dynamic.org"',
        },
      ]);
    });

    test("getSandboxHooks builds sequential compound command from environment dictionary", () => {
      const hooks = getSandboxHooks({
        GIT_USER_NAME: "Env Agent",
        GIT_USER_EMAIL: "env-agent@example.com",
      });

      assert.deepEqual(hooks.sandbox?.onSandboxReady, [
        {
          command:
            'git config --global user.name "Env Agent" && git config --global user.email "env-agent@example.com"',
        },
      ]);
    });

    test("getSandboxHooks escapes double quotes in git identity strings", () => {
      const hooks = getSandboxHooks({
        name: 'Agent "Danger" Smith',
        email: 'danger"smith@example.com',
      });

      assert.deepEqual(hooks.sandbox?.onSandboxReady, [
        {
          command:
            'git config --global user.name "Agent \\"Danger\\" Smith" && git config --global user.email "danger\\"smith@example.com"',
        },
      ]);
    });

    test("getSandboxHooks handles partial configuration (name only or email only)", () => {
      const nameOnlyHooks = getSandboxHooks({ name: "Solo Name" });
      assert.deepEqual(nameOnlyHooks.sandbox?.onSandboxReady, [
        { command: 'git config --global user.name "Solo Name"' },
      ]);

      const emailOnlyHooks = getSandboxHooks({ email: "solo@example.com" });
      assert.deepEqual(emailOnlyHooks.sandbox?.onSandboxReady, [
        { command: 'git config --global user.email "solo@example.com"' },
      ]);
    });
  });

  describe("Seam 5: Orchestrator main.mts lifecycle hooks integration (Issue #26)", () => {
    const mainMtsPath = resolve(repoRoot, "main.mts");

    test("main.mts imports getSandboxHooks from ./docker-config.ts", () => {
      const mainContent = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        mainContent,
        /import\s+{[^}]*getSandboxHooks[^}]*}\s+from\s+["']\.\/docker-config\.ts["']/,
        "main.mts must import getSandboxHooks from ./docker-config.ts",
      );
    });

    test("main.mts creates sandboxHooks and injects into plan, execute, and merge phases", () => {
      const mainContent = readFileSync(mainMtsPath, "utf-8");

      assert.match(
        mainContent,
        /sandboxHooks\s*=\s*getSandboxHooks\(/,
        "main.mts must initialize sandboxHooks via getSandboxHooks()",
      );
      assert.match(
        mainContent,
        /sandcastle\.run\({[\s\S]*?hooks:\s*sandboxHooks[\s\S]*?name:\s*["']planner["']/,
        "main.mts planner phase must supply hooks: sandboxHooks",
      );
      assert.match(
        mainContent,
        /sandcastle\.createSandbox\({[\s\S]*?hooks:\s*sandboxHooks/,
        "main.mts execute phase must supply hooks: sandboxHooks to createSandbox",
      );
      assert.match(
        mainContent,
        /sandcastle\.run\({[\s\S]*?hooks:\s*sandboxHooks[\s\S]*?name:\s*["']merger["']/,
        "main.mts merger phase must supply hooks: sandboxHooks",
      );
    });
  });
});
