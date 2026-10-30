import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { resolve, join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { cleanupTargetRepository } from "./operations.ts";
import { getSandboxMounts } from "./docker-config.ts";

describe("Multi-Repository Verification Smoke Test (Issue #11)", () => {
  const packageRoot = process.cwd();
  let testTempDir: string;

  before(() => {
    testTempDir = fs.mkdtempSync(join(tmpdir(), "sandcastle-multi-repo-smoke-"));
  });

  after(() => {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Seam 1: Target Repository Zero-Footprint & Cleanup Engine", () => {
    test("cleans up .sandcastle directory from external target repository and preserves logs", () => {
      const mockRepoPath = join(testTempDir, "external-mock-repo");
      fs.mkdirSync(mockRepoPath, { recursive: true });

      // Simulate git repo
      execSync("git init", { cwd: mockRepoPath });
      execSync('git config user.name "Test Dev"', { cwd: mockRepoPath });
      execSync('git config user.email "test@example.com"', { cwd: mockRepoPath });
      fs.writeFileSync(join(mockRepoPath, "README.md"), "# Mock Repo\n");
      execSync("git add .", { cwd: mockRepoPath });
      execSync('git commit -m "initial commit"', { cwd: mockRepoPath });

      // Simulate orchestrator pollution in target repository
      const targetSandcastleDir = join(mockRepoPath, ".sandcastle");
      const targetLogsDir = join(targetSandcastleDir, "logs");
      const targetWorktreesDir = join(targetSandcastleDir, "worktrees");
      fs.mkdirSync(targetLogsDir, { recursive: true });
      fs.mkdirSync(targetWorktreesDir, { recursive: true });

      const sampleLogContent = "[planner] Iteration 1 started\nPlan generated successfully\n";
      fs.writeFileSync(join(targetLogsDir, "planner-smoke.log"), sampleLogContent, "utf-8");

      assert.ok(fs.existsSync(targetSandcastleDir), ".sandcastle should exist before cleanup");

      // Execute cleanup
      const result = cleanupTargetRepository(mockRepoPath, packageRoot);

      assert.equal(result.cleanedSandcastleDir, true, "Should report that .sandcastle was cleaned");
      assert.ok(result.logsPreserved >= 1, "Should report at least 1 log file preserved");
      assert.ok(
        !fs.existsSync(targetSandcastleDir),
        ".sandcastle directory must be removed from target repository",
      );

      // Verify logs were copied to package root .sandcastle/logs
      const preservedLog = join(packageRoot, ".sandcastle", "logs", "planner-smoke.log");
      assert.ok(fs.existsSync(preservedLog), "Preserved log file must exist in package .sandcastle/logs");
      assert.equal(fs.readFileSync(preservedLog, "utf-8"), sampleLogContent);

      // Verify working tree is completely clean
      const gitStatus = execSync("git status --porcelain", { cwd: mockRepoPath, encoding: "utf-8" });
      assert.equal(gitStatus.trim(), "", "Working tree of target repo must have 0 untracked files");
    });

    test("does not delete .sandcastle when target repository is orchestrator package root itself", () => {
      const result = cleanupTargetRepository(packageRoot, packageRoot);
      assert.equal(result.cleanedSandcastleDir, false);
      assert.equal(result.logsPreserved, 0);
    });

    test("handles target repositories that do not have a .sandcastle directory gracefully", () => {
      const cleanRepoPath = join(testTempDir, "already-clean-repo");
      fs.mkdirSync(cleanRepoPath, { recursive: true });
      const result = cleanupTargetRepository(cleanRepoPath, packageRoot);
      assert.equal(result.cleanedSandcastleDir, false);
      assert.equal(result.logsPreserved, 0);
    });
  });

  describe("Seam 2: Multi-Repository Orchestration Execution & Dry-Run Dispatch", () => {
    function createDryRunEnv(): Record<string, string | undefined> {
      const dryRunEnv: Record<string, string | undefined> = {
        ...process.env,
        SANDCASTLE_DRY_RUN: "1",
        GH_TOKEN: "mock-gh-token-test",
      };
      delete dryRunEnv.GIT_USER_NAME;
      delete dryRunEnv.GIT_USER_EMAIL;
      return dryRunEnv;
    }

    function createMockGitRepo(
      repoPath: string,
      authorName: string,
      authorEmail: string,
      files: Record<string, string>,
    ): string {
      fs.mkdirSync(repoPath, { recursive: true });
      execSync("git init", { cwd: repoPath });
      execSync(`git config user.name "${authorName}"`, { cwd: repoPath });
      execSync(`git config user.email "${authorEmail}"`, { cwd: repoPath });

      for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = join(repoPath, relativePath);
        fs.mkdirSync(resolve(fullPath, ".."), { recursive: true });
        fs.writeFileSync(fullPath, content, "utf-8");
      }

      execSync("git add .", { cwd: repoPath });
      execSync('git commit -m "initial commit"', { cwd: repoPath });
      execSync("git checkout -b develop", { cwd: repoPath });
      return repoPath;
    }

    test("executes CLI against Java Maven mock target repository without polluting repo", () => {
      const mavenRepoPath = join(testTempDir, "mock-java-maven");
      createMockGitRepo(mavenRepoPath, "Maven Dev", "maven@example.com", {
        "pom.xml": '<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>demo</artifactId><version>1.0.0</version></project>',
        "mvnw": "#!/bin/sh\necho Maven Wrapper",
        "mvnw.cmd": "@echo off\necho Maven Wrapper",
        "AGENTS.md": "# Maven Project Agents\nUse Maven build conventions.",
        "CONTEXT.md": "# Maven Project Context\nDomain concepts.",
        "CODING_STANDARDS.md": "# Coding Standards\nStandard Java rules.",
      });

      const dryRunEnv = createDryRunEnv();

      const proc = spawnSync(
        process.execPath,
        ["main.mts", "run", "--repo", mavenRepoPath, "--yes"],
        {
          cwd: packageRoot,
          encoding: "utf-8",
          env: dryRunEnv,
        },
      );

      const combinedOutput = (proc.stdout ?? "") + (proc.stderr ?? "");
      assert.equal(proc.status, 0, `CLI run failed with status ${proc.status}: ${combinedOutput}`);
      assert.match(combinedOutput, /maven/i, "Should detect maven stack");
      assert.match(
        combinedOutput,
        /\.\/mvnw test-compile && \.\/mvnw test/,
        "Should detect canonical Maven verification command",
      );
      assert.match(combinedOutput, /Maven Dev <maven@example\.com>/, "Should detect dynamic Git identity");
      assert.match(combinedOutput, /DRY-RUN/i, "Should confirm dry run execution");

      // Verify zero-footprint in target working tree
      assert.ok(
        !fs.existsSync(join(mavenRepoPath, ".sandcastle")),
        "Target Maven repository must not contain .sandcastle directory post-run",
      );
      assert.ok(
        !fs.existsSync(join(mavenRepoPath, "plan-prompt.md")),
        "Orchestrator prompt files must not be copied into target repository",
      );
      const status = execSync("git status --porcelain", { cwd: mavenRepoPath, encoding: "utf-8" });
      assert.equal(status.trim(), "", "Working tree of mock Maven repository must remain 100% clean");
    });

    test("executes CLI against Java Gradle mock target repository without polluting repo", () => {
      const gradleRepoPath = join(testTempDir, "mock-java-gradle");
      createMockGitRepo(gradleRepoPath, "Gradle Dev", "gradle@example.com", {
        "build.gradle": 'plugins { id "java" }\ngroup = "com.example"\nversion = "1.0.0"',
        "gradlew": "#!/bin/sh\necho Gradle Wrapper",
        "gradlew.bat": "@echo off\necho Gradle Wrapper",
        "AGENTS.md": "# Gradle Project Agents\n",
        "CONTEXT.md": "# Gradle Context\n",
      });

      const dryRunEnv = createDryRunEnv();

      const proc = spawnSync(
        process.execPath,
        ["main.mts", "run", "--repo", gradleRepoPath, "--yes"],
        {
          cwd: packageRoot,
          encoding: "utf-8",
          env: dryRunEnv,
        },
      );

      const combinedOutput = (proc.stdout ?? "") + (proc.stderr ?? "");
      assert.equal(proc.status, 0, `CLI run failed with status ${proc.status}: ${combinedOutput}`);
      assert.match(combinedOutput, /gradle/i, "Should detect gradle stack");
      assert.match(
        combinedOutput,
        /\.\/gradlew test/,
        "Should detect canonical Gradle verification command",
      );
      assert.match(combinedOutput, /Gradle Dev <gradle@example\.com>/, "Should detect dynamic Git identity");

      // Verify zero-footprint in target working tree
      assert.ok(
        !fs.existsSync(join(gradleRepoPath, ".sandcastle")),
        "Target Gradle repository must not contain .sandcastle directory post-run",
      );
      const status = execSync("git status --porcelain", { cwd: gradleRepoPath, encoding: "utf-8" });
      assert.equal(status.trim(), "", "Working tree of mock Gradle repository must remain 100% clean");
    });

    test("executes CLI against Node/TypeScript mock target repository without polluting repo", () => {
      const nodeRepoPath = join(testTempDir, "mock-node-ts");
      createMockGitRepo(nodeRepoPath, "Node Dev", "node@example.com", {
        "package.json": JSON.stringify({
          name: "mock-node-ts",
          version: "1.0.0",
          scripts: { test: "node --test" },
        }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { target: "esnext" } }),
        "AGENTS.md": "# Node TS Agents\n",
        "CODING_STANDARDS.md": "# Standards\n",
      });

      const dryRunEnv = createDryRunEnv();

      const proc = spawnSync(
        process.execPath,
        ["main.mts", "run", "--repo", nodeRepoPath, "--yes"],
        {
          cwd: packageRoot,
          encoding: "utf-8",
          env: dryRunEnv,
        },
      );

      const combinedOutput = (proc.stdout ?? "") + (proc.stderr ?? "");
      assert.equal(proc.status, 0, `CLI run failed with status ${proc.status}: ${combinedOutput}`);
      assert.match(combinedOutput, /node/i, "Should detect node stack");
      assert.match(combinedOutput, /npm test/, "Should detect canonical Node verification command");
      assert.match(combinedOutput, /Node Dev <node@example\.com>/, "Should detect dynamic Git identity");

      // Verify zero-footprint in target working tree
      assert.ok(
        !fs.existsSync(join(nodeRepoPath, ".sandcastle")),
        "Target Node repository must not contain .sandcastle directory post-run",
      );
      const status = execSync("git status --porcelain", { cwd: nodeRepoPath, encoding: "utf-8" });
      assert.equal(status.trim(), "", "Working tree of mock Node repository must remain 100% clean");
    });
  });

  describe("Seam 3: Automated Multi-Repository End-to-End Containerized Smoke Test", () => {
    test("executes inside Docker sandbox against external mock repository with clean teardown", async () => {
      // Check if Docker daemon is available
      const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
      if (dockerCheck.status !== 0) {
        console.warn("Skipping containerized smoke test: Docker daemon is unavailable");
        return;
      }

      const mockRepoPath = resolve(packageRoot, ".sandcastle", "smoke-target-repo");
      fs.rmSync(mockRepoPath, { recursive: true, force: true });
      fs.mkdirSync(mockRepoPath, { recursive: true });
      execSync("git init", { cwd: mockRepoPath });
      execSync('git config user.name "Container Dev"', { cwd: mockRepoPath });
      execSync('git config user.email "container@example.com"', { cwd: mockRepoPath });
      fs.writeFileSync(join(mockRepoPath, "README.md"), "# Container Mock Repo\n");
      fs.writeFileSync(
        join(mockRepoPath, "package.json"),
        JSON.stringify({ name: "container-mock", version: "1.0.0" }),
      );
      execSync("git add .", { cwd: mockRepoPath });
      execSync('git commit -m "initial commit"', { cwd: mockRepoPath });
      execSync("git checkout -b develop", { cwd: mockRepoPath });

      const testBranch = `sandcastle/multi-repo-smoke-${Date.now()}`;
      const sandbox = await sandcastle.createSandbox({
        cwd: mockRepoPath,
        branch: testBranch,
        sandbox: docker({
          imageName: process.env.SANDCASTLE_IMAGE ?? "sandcastle-agent",
          env: {
            GH_TOKEN: "container-smoke-token",
            GIT_USER_NAME: "Container Dev",
            GIT_USER_EMAIL: "container@example.com",
          },
          mounts: [...getSandboxMounts()],
        }),
      });

      try {
        assert.ok(sandbox.worktreePath, "Worktree path should be defined");
        const nodeVer = await sandbox.exec("node -v");
        assert.equal(nodeVer.exitCode, 0, `node -v failed: ${nodeVer.stderr}`);
        assert.match(nodeVer.stdout, /v22\./);

        const gitUser = await sandbox.exec("git config --global user.name");
        assert.equal(gitUser.stdout.trim(), "Container Dev");
      } finally {
        await sandbox.close();
        cleanupTargetRepository(mockRepoPath, packageRoot);
      }

      // Assert target repository is 100% clean
      assert.ok(
        !fs.existsSync(join(mockRepoPath, ".sandcastle")),
        "Target repository must be free of .sandcastle directory post-run",
      );
      const status = execSync("git status --porcelain", { cwd: mockRepoPath, encoding: "utf-8" });
      assert.equal(status.trim(), "", "Working tree of target repo must have 0 untracked files");
    });
  });
});
