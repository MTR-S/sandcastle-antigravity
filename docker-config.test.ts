import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSandboxEnv, getSandboxMounts } from "./docker-config.ts";

describe("Docker Container & Git Identity Decoupling (Issue #6)", () => {
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
        /matheus-sortech/i,
        "Dockerfile must not contain hardcoded 'matheus-sortech'",
      );
      assert.doesNotMatch(
        dockerfileContent,
        /sortech\.com\.br/i,
        "Dockerfile must not contain hardcoded corporate email domain 'sortech.com.br'",
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
        GIT_USER_EMAIL: "matheusalmeidass14@gmail.com",
        GH_TOKEN: "mock-gh-token",
        SANDCASTLE_LABEL: "ready-for-agent",
      });

      assert.equal(env.GIT_USER_NAME, "MTR-S");
      assert.equal(env.GIT_USER_EMAIL, "matheusalmeidass14@gmail.com");
      assert.equal(env.GH_TOKEN, "mock-gh-token");
      assert.equal(env.GITHUB_TOKEN, "mock-gh-token");
      assert.equal(env.SANDCASTLE_LABEL, "ready-for-agent");
      assert.ok(Object.isFrozen(env), "getSandboxEnv must return frozen/immutable object");
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

  describe("Seam 3: Container entrypoint dynamic Git identity specification", () => {
    test("entrypoint.sh configures git user.name and user.email from environment variables", () => {
      const entrypointContent = readFileSync(entrypointPath, "utf-8");

      assert.match(
        entrypointContent,
        /GIT_USER_NAME/,
        "entrypoint.sh must reference GIT_USER_NAME",
      );
      assert.match(
        entrypointContent,
        /git\s+config\s+--global\s+user\.name\s+["']\$GIT_USER_NAME["']/,
        "entrypoint.sh must dynamically configure git user.name from $GIT_USER_NAME",
      );
      assert.match(
        entrypointContent,
        /GIT_USER_EMAIL/,
        "entrypoint.sh must reference GIT_USER_EMAIL",
      );
      assert.match(
        entrypointContent,
        /git\s+config\s+--global\s+user\.email\s+["']\$GIT_USER_EMAIL["']/,
        "entrypoint.sh must dynamically configure git user.email from $GIT_USER_EMAIL",
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
});
