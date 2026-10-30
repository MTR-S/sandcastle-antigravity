import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  extractWindowsCredential,
  formatOAuthPayloadForContainer,
} from "./auth-preflight.ts";
import { antigravity, parseAntigravityStreamLine } from "./antigravity.ts";
import { getSandboxEnv, getSandboxMounts } from "./docker-config.ts";

describe("Orchestrator End-to-End Containerized Smoke Test", () => {
  // Ensure host GEMINI_API_KEY is not forwarded or leaked into the smoke tests
  delete process.env.GEMINI_API_KEY;

  const repoRoot = existsSync(".git") ? process.cwd() : resolve(process.cwd(), "..");
  const imageName = process.env.SANDCASTLE_IMAGE ?? "sandcastle-agent";

  const isDockerAvailable = (): boolean => {
    try {
      const res = spawnSync("docker", ["info"], { stdio: "ignore" });
      return res.status === 0;
    } catch {
      return false;
    }
  };

  const testEnv: Record<string, string> = {
    ...getSandboxEnv({
      GH_TOKEN: "smoke-gh-token-test",
      GIT_USER_NAME: "Dynamic Sandcastle Agent",
      GIT_USER_EMAIL: "agent@sandcastle-dynamic.org",
    }),
  };

  test("executes inside containerized sandbox, confirming tool execution and clean exit", async (t) => {
    if (!isDockerAvailable()) {
      t.skip("Skipping containerized smoke test: Docker daemon is unavailable");
      return;
    }
    const sandbox = await sandcastle.createSandbox({
      cwd: repoRoot,
      branch: "sandcastle/smoke-sandbox-test",
      sandbox: docker({
        imageName,
        env: testEnv,
        mounts: [...getSandboxMounts()],
      }),
    });

    try {
      assert.ok(sandbox.worktreePath, "Worktree path should be defined");

      // 1. Confirm Java 21 execution inside the container
      const javaResult = await sandbox.exec("java -version");
      assert.equal(javaResult.exitCode, 0, `java -version failed: ${javaResult.stderr}`);
      const javaOutput = javaResult.stdout + javaResult.stderr;
      assert.match(javaOutput, /21\./, "Java version should report OpenJDK 21");

      // 2. Confirm Google Antigravity CLI execution inside the container
      const agyResult = await sandbox.exec("agy --version");
      assert.equal(agyResult.exitCode, 0, `agy --version failed: ${agyResult.stderr}`);
      assert.match(agyResult.stdout, /\d+\.\d+\.\d+/, "agy --version should output semver");

      // 3. Confirm build tool execution in the mounted worktree
      if (existsSync(resolve(sandbox.worktreePath, "mvnw"))) {
        const mvnResult = await sandbox.exec("./mvnw -version");
        assert.equal(mvnResult.exitCode, 0, `./mvnw -version failed: ${mvnResult.stderr}`);
        assert.match(
          mvnResult.stdout + mvnResult.stderr,
          /Apache Maven/,
          "mvnw should report Apache Maven",
        );
      } else {
        const nodeResult = await sandbox.exec("node -v");
        assert.equal(nodeResult.exitCode, 0, `node -v failed: ${nodeResult.stderr}`);
        assert.match(nodeResult.stdout, /v22\./, "node -v should report Node 22");
      }

      // 4. Confirm environment token and dynamic git identity forwarding
      const envResult = await sandbox.exec('sh -c "echo GH=$GH_TOKEN"');
      assert.equal(envResult.exitCode, 0);
      assert.match(
        envResult.stdout,
        /GH=smoke-gh-token-test/,
        "Container should receive forwarded authentication tokens",
      );

      const gitUserResult = await sandbox.exec("git config --global user.name");
      assert.equal(gitUserResult.stdout.trim(), "Dynamic Sandcastle Agent");
      const gitEmailResult = await sandbox.exec("git config --global user.email");
      assert.equal(gitEmailResult.stdout.trim(), "agent@sandcastle-dynamic.org");

      // Verify git commit authorship carries the injected identity
      const commitResult = await sandbox.exec(
        'git commit --allow-empty -m "Dynamic author test" && git log -1 --format="%an <%ae>"',
      );
      assert.equal(commitResult.exitCode, 0, `git commit failed: ${commitResult.stderr}`);
      assert.match(
        commitResult.stdout,
        /Dynamic Sandcastle Agent <agent@sandcastle-dynamic\.org>/,
        "Git commit created inside container must carry the injected dynamic identity",
      );

      // Verify mounted host cache directories when configured
      const mounts = getSandboxMounts();
      for (const mount of mounts) {
        const checkResult = await sandbox.exec(`test -d "${mount.sandboxPath}"`);
        assert.equal(
          checkResult.exitCode,
          0,
          `Expected ${mount.sandboxPath} to be mounted inside container`,
        );
      }

      // Verify GEMINI_API_KEY is not forwarded
      const geminiResult = await sandbox.exec('sh -c "echo GEMINI=$GEMINI_API_KEY"');
      assert.equal(geminiResult.exitCode, 0);
      assert.equal(
        geminiResult.stdout.trim(),
        "GEMINI=",
        "GEMINI_API_KEY must not be forwarded to sandbox environment",
      );

      // 5. Confirm agent execution and stream line parsing through sandbox.run
      const mockAgyAgent: sandcastle.AgentProvider = {
        name: "antigravity",
        env: {},
        captureSessions: false,
        buildPrintCommand(options) {
          return {
            command:
              'sh -c \'echo "{\\"event\\":\\"init\\",\\"session_id\\":\\"smoke-session-123\\"}"; echo "{\\"event\\":\\"step_update\\",\\"delta\\":\\"smoke-step-verified\\"}"; echo "{\\"event\\":\\"result\\",\\"result\\":\\"SMOKE_RUN_SUCCESS\\",\\"usage\\":{\\"input_tokens\\":10,\\"output_tokens\\":20}}"\'',
            stdin: options.prompt,
          };
        },
        parseStreamLine(line) {
          return parseAntigravityStreamLine(line);
        },
      };

      const runResult = await sandbox.run({
        name: "smoke-agent",
        maxIterations: 1,
        agent: mockAgyAgent,
        prompt: "Execute smoke verification in sandbox",
      });

      assert.equal(runResult.iterations.length, 1);
      assert.match(runResult.stdout, /SMOKE_RUN_SUCCESS/);
    } finally {
      // 6. Confirm clean exit and container/worktree teardown
      const closeResult = await sandbox.close();
      assert.ok(closeResult !== undefined, "Sandbox closed cleanly");
    }
  });

  test("executes end-to-end task through sandcastle.run with clean exit", async (t) => {
    if (!isDockerAvailable()) {
      t.skip("Skipping containerized smoke test: Docker daemon is unavailable");
      return;
    }
    const mockAgyAgent: sandcastle.AgentProvider = {
      name: "antigravity",
      env: {},
      captureSessions: false,
      buildPrintCommand(options) {
        return {
          command:
            'sh -c \'echo "{\\"event\\":\\"init\\",\\"session_id\\":\\"direct-session-456\\"}"; java -version; agy --version; echo "{\\"event\\":\\"result\\",\\"result\\":\\"DIRECT_RUN_SUCCESS\\",\\"usage\\":{\\"input_tokens\\":5,\\"output_tokens\\":10}}"\'',
          stdin: options.prompt,
        };
      },
      parseStreamLine(line) {
        return parseAntigravityStreamLine(line);
      },
    };

    const runResult = await sandcastle.run({
      cwd: repoRoot,
      name: "smoke-direct-run",
      maxIterations: 1,
      sandbox: docker({
        imageName,
        env: testEnv,
        mounts: [...getSandboxMounts()],
      }),
      agent: mockAgyAgent,
      prompt: "Execute direct run verification in container",
    });

    assert.equal(runResult.iterations.length, 1);
    assert.match(runResult.stdout, /DIRECT_RUN_SUCCESS/);
  });

  test("boots with injected OAuth payload, stores into D-Bus secret service, and scrubs environment", async (t) => {
    if (!isDockerAvailable()) {
      t.skip("Skipping containerized smoke test: Docker daemon is unavailable");
      return;
    }
    const mockPayload = JSON.stringify({
      token: {
        access_token: "smoke-oauth-access-token",
        refresh_token: "smoke-oauth-refresh-token",
        expiry: "2030-01-01T00:00:00Z",
        token_type: "Bearer",
      },
      auth_method: "oauth",
    });

    const testBranch = `sandcastle/smoke-oauth-${Date.now()}`;
    const sandbox = await sandcastle.createSandbox({
      cwd: repoRoot,
      branch: testBranch,
      sandbox: docker({
        imageName,
        env: {
          SANDCASTLE_OAUTH_PAYLOAD: mockPayload,
          GH_TOKEN: "smoke-gh-token-test",
        },
        mounts: [...getSandboxMounts()],
      }),
    });

    try {
      assert.ok(sandbox.worktreePath, "Worktree path should be defined");

      // 1. Confirm D-Bus session bus address is configured
      const dbusEnvResult = await sandbox.exec("printenv DBUS_SESSION_BUS_ADDRESS");
      assert.equal(dbusEnvResult.exitCode, 0, `printenv failed: ${dbusEnvResult.stderr}`);
      assert.match(dbusEnvResult.stdout, /unix:path=\/tmp\/dbus-session\.sock/);

      // 2. Confirm token is stored in D-Bus secret service keyring
      const secretLookupResult = await sandbox.exec(
        "secret-tool lookup service gemini username antigravity",
      );
      assert.equal(secretLookupResult.exitCode, 0, `secret-tool lookup failed: ${secretLookupResult.stderr}`);
      assert.equal(secretLookupResult.stdout.trim(), mockPayload);

      // 3. Confirm SANDCASTLE_OAUTH_PAYLOAD was scrubbed from the container process environment
      const proc1Env = await sandbox.exec("cat /proc/1/environ");
      assert.ok(
        !proc1Env.stdout.includes("SANDCASTLE_OAUTH_PAYLOAD"),
        "SANDCASTLE_OAUTH_PAYLOAD should be scrubbed from container process environment",
      );
      assert.ok(
        !proc1Env.stdout.includes("smoke-oauth-access-token"),
        "Access token should not appear in container process environment",
      );

      // 4. Confirm settings.json contains clean consumer OAuth defaults (no API key modelProvider override)
      const settingsCheck = await sandbox.exec("cat /home/agent/.gemini/antigravity-cli/settings.json");
      assert.equal(settingsCheck.exitCode, 0);
      const parsedSettings = JSON.parse(settingsCheck.stdout.trim());
      assert.equal(parsedSettings.modelProvider, undefined, "settings.json must not have modelProvider override");

      // 5. Confirm agy initializes headlessly without prompting for login
      const agyVersionResult = await sandbox.exec("agy --version");
      assert.equal(agyVersionResult.exitCode, 0);
      assert.match(agyVersionResult.stdout, /\d+\.\d+\.\d+/);

      // 6. Confirm headless non-interactive stream-json execution does not prompt for interactive browser login
      const agyHeadlessResult = await sandbox.exec(
        "echo '' | agy --input-format text --output-format stream-json --dangerously-skip-permissions --mode accept-edits",
      );
      assert.doesNotMatch(
        agyHeadlessResult.stdout + agyHeadlessResult.stderr,
        /sign in via your browser|press Enter to open/i,
        "agy should not prompt for interactive browser login",
      );
    } finally {
      await sandbox.close();
    }
  });

  test("runs agent inside Docker sandbox successfully returning response using bridged host OAuth session", async (t) => {
    if (!isDockerAvailable()) {
      t.skip("Skipping containerized smoke test: Docker daemon is unavailable");
      return;
    }
    const hostCred = extractWindowsCredential();
    const payload = hostCred
      ? formatOAuthPayloadForContainer(hostCred)
      : JSON.stringify({
          token: {
            access_token: "smoke-oauth-access-token",
            refresh_token: "smoke-oauth-refresh-token",
            expiry: "2030-01-01T00:00:00Z",
            token_type: "Bearer",
          },
          auth_method: "consumer",
        });

    const testBranch = `sandcastle/smoke-oauth-agent-${Date.now()}`;
    const sandbox = await sandcastle.createSandbox({
      cwd: repoRoot,
      branch: testBranch,
      sandbox: docker({
        imageName,
        env: {
          SANDCASTLE_OAUTH_PAYLOAD: payload,
          GH_TOKEN: "smoke-gh-token-test",
        },
        mounts: [...getSandboxMounts()],
      }),
    });

    try {
      assert.ok(sandbox.worktreePath, "Worktree path should be defined");

      // Verify GEMINI_API_KEY is not forwarded or set
      const envCheck = await sandbox.exec("printenv GEMINI_API_KEY");
      assert.equal(envCheck.stdout.trim(), "", "GEMINI_API_KEY must not be present");

      if (hostCred) {
        // Live agent turn using bridged host OAuth session
        const runResult = await sandbox.run({
          name: "oauth-agent-smoke",
          maxIterations: 1,
          agent: antigravity("gemini-3.8-flash-high"),
          prompt: "Reply with the single word PONG and nothing else.",
        });

        assert.equal(runResult.iterations.length, 1);
        assert.match(
          runResult.stdout,
          /PONG/i,
          "Agent should return valid response using bridged host OAuth session",
        );
      } else {
        // Fallback for environments without host Windows credential
        const mockAgent: sandcastle.AgentProvider = {
          name: "antigravity",
          env: {},
          captureSessions: false,
          buildPrintCommand(options) {
            return {
              command:
                'sh -c \'echo "{\\"event\\":\\"init\\",\\"session_id\\":\\"oauth-mock-456\\"}"; echo "{\\"event\\":\\"result\\",\\"result\\":\\"PONG\\",\\"usage\\":{\\"input_tokens\\":5,\\"output_tokens\\":10}}"\'',
              stdin: options.prompt,
            };
          },
          parseStreamLine(line) {
            return parseAntigravityStreamLine(line);
          },
        };

        const runResult = await sandbox.run({
          name: "oauth-mock-smoke",
          maxIterations: 1,
          agent: mockAgent,
          prompt: "Verify agent execution",
        });

        assert.equal(runResult.iterations.length, 1);
        assert.match(runResult.stdout, /PONG/i);
      }
    } finally {
      await sandbox.close();
    }
  });
});
