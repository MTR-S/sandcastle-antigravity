import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Standalone CLI Entrypoint & Operations Subcommands (Issue #10)", () => {
  describe("Seam 1: CLI Argument Parsing & Dispatch", () => {
    test("parses run command with default options when no args provided", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs([]);
      assert.equal(parsed.command, "run");
      assert.equal(parsed.repoPath, undefined);
      assert.equal(parsed.yes, false);
    });

    test("parses run subcommand with --repo and --yes flags", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["run", "--repo", "/path/to/target", "--yes"]);
      assert.equal(parsed.command, "run");
      assert.equal(parsed.repoPath, "/path/to/target");
      assert.equal(parsed.yes, true);
    });

    test("parses short options -r and -y", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["run", "-r", "../another-repo", "-y"]);
      assert.equal(parsed.command, "run");
      assert.equal(parsed.repoPath, "../another-repo");
      assert.equal(parsed.yes, true);
    });

    test("parses rescue subcommand with --repo option", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["rescue", "--repo", "./some/repo"]);
      assert.equal(parsed.command, "rescue");
      assert.equal(parsed.repoPath, "./some/repo");
    });

    test("parses doctor subcommand with --repo option", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["doctor", "-r", "./target"]);
      assert.equal(parsed.command, "doctor");
      assert.equal(parsed.repoPath, "./target");
    });

    test("parses build-image subcommand with optional --tag", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["build-image", "--tag", "custom-sandcastle-agent:v1"]);
      assert.equal(parsed.command, "build-image");
      assert.equal(parsed.tag, "custom-sandcastle-agent:v1");
    });

    test("parses build-image subcommand with --build-arg option", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["build-image", "--build-arg", "AGENT_UID=1000"]);
      assert.equal(parsed.command, "build-image");
      assert.deepEqual(parsed.buildArgs, ["AGENT_UID=1000"]);
    });

    test("parses --help and -h flags", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      assert.equal(parseCliArgs(["--help"]).command, "help");
      assert.equal(parseCliArgs(["-h"]).command, "help");
      assert.equal(parseCliArgs(["help"]).command, "help");
    });

    test("parses --version and -v flags", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      assert.equal(parseCliArgs(["--version"]).command, "version");
      assert.equal(parseCliArgs(["-v"]).command, "version");
    });

    test("identifies unknown subcommands", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["foo-bar"]);
      assert.equal(parsed.command, "unknown");
      assert.equal(parsed.unknownCommand, "foo-bar");
    });

    test("dispatches help command with usage text to logger and returns 0", async () => {
      const { dispatchCli } = await import("./cli.ts");
      const logs: string[] = [];
      const code = await dispatchCli(["--help"], {
        logger: (msg) => logs.push(msg),
      });
      assert.equal(code, 0);
      assert.ok(logs.some((l) => l.includes("sandcastle-agy")));
      assert.ok(logs.some((l) => l.includes("sc-agy")));
      assert.ok(logs.some((l) => l.includes("run")));
      assert.ok(logs.some((l) => l.includes("rescue")));
      assert.ok(logs.some((l) => l.includes("doctor")));
      assert.ok(logs.some((l) => l.includes("build-image")));
    });

    test("formatCliHelp declares usage syntax with sc-agy shorthand alias", async () => {
      const { formatCliHelp } = await import("./cli.ts");
      const help = formatCliHelp();
      assert.match(help, /Usage:\s*\n\s*sandcastle-agy \| sc-agy <command> \[options\]/);
    });

    test("dispatches version command to logger and returns 0", async () => {
      const { dispatchCli } = await import("./cli.ts");
      const logs: string[] = [];
      const code = await dispatchCli(["--version"], {
        logger: (msg) => logs.push(msg),
      });
      assert.equal(code, 0);
      assert.ok(logs.some((l) => /0\.1\.0|\d+\.\d+\.\d+/.test(l)));
    });

    test("parses options preceding subcommand correctly", async () => {
      const { parseCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["--repo", "/target", "doctor"]);
      assert.equal(parsed.command, "doctor");
      assert.equal(parsed.repoPath, "/target");
    });

    test("validates missing value for --repo flag", async () => {
      const { parseCliArgs, validateCliArgs } = await import("./cli.ts");
      const parsed = parseCliArgs(["run", "--repo"]);
      const validation = validateCliArgs(parsed);
      assert.equal(validation.valid, false);
      assert.ok(validation.error?.includes("requires a path argument"));
    });

    test("dispatchCli invokes runHandler when run command is dispatched", async () => {
      const { dispatchCli } = await import("./cli.ts");
      let executed = false;
      const code = await dispatchCli(["run", "--repo", "/my/repo", "--yes"], {
        runHandler: async (args) => {
          executed = true;
          assert.equal(args.repoPath, "/my/repo");
          assert.equal(args.yes, true);
          return 0;
        },
      });
      assert.equal(code, 0);
      assert.equal(executed, true);
    });

    test("dispatchCli fails with exit code 1 when argument validation fails", async () => {
      const { dispatchCli } = await import("./cli.ts");
      const errors: string[] = [];
      const code = await dispatchCli(["run", "--repo"], {
        errorLogger: (msg) => errors.push(msg),
      });
      assert.equal(code, 1);
      assert.ok(errors.some((e) => e.includes("requires a path argument")));
    });

    test("returns exit code 1 and prints error on unknown command", async () => {
      const { dispatchCli } = await import("./cli.ts");
      const errors: string[] = [];
      const code = await dispatchCli(["non-existent-subcommand"], {
        errorLogger: (msg) => errors.push(msg),
      });
      assert.equal(code, 1);
      assert.ok(errors.some((e) => e.includes("Unknown subcommand") || e.includes("non-existent-subcommand")));
    });

    describe("Shorthand CLI Binary Alias (sc-agy) & Argument Normalization (Issue #17)", () => {
      test("parses run command with default options when invoked via sc-agy without args", async () => {
        const { parseCliArgs } = await import("./cli.ts");
        const parsed = parseCliArgs(["sc-agy"]);
        assert.equal(parsed.command, "run");
        assert.equal(parsed.repoPath, undefined);
        assert.equal(parsed.yes, false);
      });

      test("parses all subcommands seamlessly via sc-agy", async () => {
        const { parseCliArgs } = await import("./cli.ts");

        // 1. run
        const runParsed = parseCliArgs(["sc-agy", "run", "--repo", "/path/to/target", "--yes"]);
        assert.equal(runParsed.command, "run");
        assert.equal(runParsed.repoPath, "/path/to/target");
        assert.equal(runParsed.yes, true);

        // 2. rescue
        const rescueParsed = parseCliArgs(["sc-agy", "rescue", "--repo", "./some/repo"]);
        assert.equal(rescueParsed.command, "rescue");
        assert.equal(rescueParsed.repoPath, "./some/repo");

        // 3. doctor
        const doctorParsed = parseCliArgs(["sc-agy", "doctor", "-r", "./target"]);
        assert.equal(doctorParsed.command, "doctor");
        assert.equal(doctorParsed.repoPath, "./target");

        // 4. build-image
        const buildParsed = parseCliArgs([
          "sc-agy",
          "build-image",
          "--tag",
          "custom-sandcastle-agent:v2",
          "--build-arg",
          "KEY=VAL",
        ]);
        assert.equal(buildParsed.command, "build-image");
        assert.equal(buildParsed.tag, "custom-sandcastle-agent:v2");
        assert.deepEqual(buildParsed.buildArgs, ["KEY=VAL"]);

        // 5. help
        assert.equal(parseCliArgs(["sc-agy", "--help"]).command, "help");
        assert.equal(parseCliArgs(["sc-agy", "-h"]).command, "help");
        assert.equal(parseCliArgs(["sc-agy", "help"]).command, "help");

        // 6. version
        assert.equal(parseCliArgs(["sc-agy", "--version"]).command, "version");
        assert.equal(parseCliArgs(["sc-agy", "-v"]).command, "version");
        assert.equal(parseCliArgs(["sc-agy", "version"]).command, "version");
      });

      test("parses short options (-r, -y, -t) identically when invoked via sc-agy", async () => {
        const { parseCliArgs } = await import("./cli.ts");
        const parsedRun = parseCliArgs(["sc-agy", "-r", "../another-repo", "-y"]);
        assert.equal(parsedRun.command, "run");
        assert.equal(parsedRun.repoPath, "../another-repo");
        assert.equal(parsedRun.yes, true);

        const parsedBuild = parseCliArgs(["sc-agy", "build-image", "-t", "test-tag:dev"]);
        assert.equal(parsedBuild.command, "build-image");
        assert.equal(parsedBuild.tag, "test-tag:dev");
      });

      test("correctly detects and strips platform-specific shims (.cmd, .ps1, .exe) for sc-agy and sandcastle-agy", async () => {
        const { parseCliArgs } = await import("./cli.ts");

        // sc-agy shims
        assert.equal(parseCliArgs(["sc-agy.cmd", "run", "--yes"]).command, "run");
        assert.equal(parseCliArgs(["sc-agy.ps1", "rescue", "-r", "/repo"]).command, "rescue");
        assert.equal(parseCliArgs(["sc-agy.exe", "doctor"]).command, "doctor");
        assert.equal(parseCliArgs(["sc-agy.cmd", "build-image", "-t", "img:1"]).command, "build-image");

        // sandcastle-agy shims
        assert.equal(parseCliArgs(["sandcastle-agy.cmd", "run"]).command, "run");
        assert.equal(parseCliArgs(["sandcastle-agy.ps1", "doctor"]).command, "doctor");
        assert.equal(parseCliArgs(["sandcastle-agy.exe", "rescue"]).command, "rescue");
      });

      test("normalizes argument vectors when node runtime path precedes binary alias or shims", async () => {
        const { parseCliArgs } = await import("./cli.ts");

        // POSIX node + sc-agy
        const posixArgs = parseCliArgs(["/usr/local/bin/node", "/usr/local/bin/sc-agy", "run", "--repo", "/target"]);
        assert.equal(posixArgs.command, "run");
        assert.equal(posixArgs.repoPath, "/target");

        // Windows node.exe + sc-agy.cmd
        const winCmdArgs = parseCliArgs([
          "C:\\Program Files\\nodejs\\node.exe",
          "C:\\Users\\user\\AppData\\Roaming\\npm\\sc-agy.cmd",
          "doctor",
          "-r",
          "C:\\target",
        ]);
        assert.equal(winCmdArgs.command, "doctor");
        assert.equal(winCmdArgs.repoPath, "C:\\target");

        // Windows node.exe + sc-agy.ps1
        const winPsArgs = parseCliArgs([
          "node.exe",
          "sc-agy.ps1",
          "rescue",
        ]);
        assert.equal(winPsArgs.command, "rescue");
      });

      test("identifies unknown command properly when invoked via sc-agy without mistaking binary name", async () => {
        const { parseCliArgs } = await import("./cli.ts");
        const parsed = parseCliArgs(["sc-agy", "unknown-command-xyz"]);
        assert.equal(parsed.command, "unknown");
        assert.equal(parsed.unknownCommand, "unknown-command-xyz");
      });

      test("dispatches CLI commands cleanly when invoked with sc-agy alias and shims", async () => {
        const { dispatchCli } = await import("./cli.ts");
        let ranHandler = false;
        let rescuedHandler = false;
        let doctoredHandler = false;
        let builtHandler = false;

        const codeRun = await dispatchCli(["sc-agy", "run", "--repo", "/my/repo", "--yes"], {
          runHandler: async (args) => {
            ranHandler = true;
            assert.equal(args.repoPath, "/my/repo");
            assert.equal(args.yes, true);
            return 0;
          },
        });
        assert.equal(codeRun, 0);
        assert.equal(ranHandler, true);

        const codeRescue = await dispatchCli(["sc-agy.cmd", "rescue"], {
          rescueHandler: async () => {
            rescuedHandler = true;
            return 0;
          },
        });
        assert.equal(codeRescue, 0);
        assert.equal(rescuedHandler, true);

        const codeDoctor = await dispatchCli(["sc-agy.ps1", "doctor"], {
          doctorHandler: async () => {
            doctoredHandler = true;
            return 0;
          },
        });
        assert.equal(codeDoctor, 0);
        assert.equal(doctoredHandler, true);

        const codeBuild = await dispatchCli(["sc-agy.exe", "build-image"], {
          buildImageHandler: async () => {
            builtHandler = true;
            return 0;
          },
        });
        assert.equal(codeBuild, 0);
        assert.equal(builtHandler, true);

        const logs: string[] = [];
        const codeHelp = await dispatchCli(["sc-agy", "--help"], {
          logger: (msg) => logs.push(msg),
        });
        assert.equal(codeHelp, 0);
        assert.ok(logs.some((l) => l.includes("sandcastle-agy")));

        const versionLogs: string[] = [];
        const codeVersion = await dispatchCli(["sc-agy", "--version"], {
          logger: (msg) => versionLogs.push(msg),
        });
        assert.equal(codeVersion, 0);
        assert.ok(versionLogs.some((l) => /0\.1\.0|\d+\.\d+\.\d+/.test(l)));
      });
    });
  });

  describe("Seam 2: rescue Subcommand Handler", () => {
    test("terminates dangling sandcastle-agent containers", async () => {
      const { runRescue } = await import("./cli.ts");
      const dockerCalls: string[] = [];
      const result = await runRescue({
        targetRepoPath: "/fake/repo",
        logger: () => {},
        dockerRunner: (cmd) => {
          dockerCalls.push(cmd);
          if (cmd.includes("docker ps")) {
            return { status: 0, stdout: "c123\nc456\n", stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
        gitRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        fsAdapter: {
          existsSync: () => false,
          readdirSync: () => [],
          statSync: () => ({ mtimeMs: 0, isDirectory: () => false }),
          readFileSync: () => "",
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(result.killedContainers, ["c123", "c456"]);
      assert.ok(dockerCalls.some((c) => c.includes("docker ps -q --filter ancestor=sandcastle-agent")));
      assert.ok(dockerCalls.some((c) => c.includes("kill c123") || c.includes("rm -f c123")));
      assert.ok(dockerCalls.some((c) => c.includes("kill c456") || c.includes("rm -f c456")));
    });

    test("handles zero running containers gracefully", async () => {
      const { runRescue } = await import("./cli.ts");
      const result = await runRescue({
        targetRepoPath: "/fake/repo",
        logger: () => {},
        dockerRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        gitRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        fsAdapter: {
          existsSync: () => false,
          readdirSync: () => [],
          statSync: () => ({ mtimeMs: 0, isDirectory: () => false }),
          readFileSync: () => "",
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(result.killedContainers, []);
    });

    test("executes git worktree prune in target repo and cleans worktree directory", async () => {
      const { runRescue } = await import("./cli.ts");
      const gitCalls: { cmd: string; cwd: string }[] = [];
      const removedPaths: string[] = [];

      const result = await runRescue({
        targetRepoPath: "/fake/repo",
        logger: () => {},
        dockerRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        gitRunner: (cmd, cwd) => {
          gitCalls.push({ cmd, cwd });
          return { status: 0, stdout: "", stderr: "" };
        },
        fsAdapter: {
          existsSync: (p) => p.includes("worktrees"),
          readdirSync: () => ["stale-branch-1"],
          statSync: () => ({ mtimeMs: 0, isDirectory: () => true }),
          readFileSync: () => "",
          rmSync: (p) => removedPaths.push(p),
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.prunedWorktrees, true);
      assert.ok(
        gitCalls.some(
          (g) =>
            g.cmd.includes("worktree prune") &&
            (g.cwd === "/fake/repo" || g.cwd.endsWith("fake\\repo") || g.cwd.endsWith("fake/repo")),
        ),
      );
      assert.ok(removedPaths.some((p) => p.includes("stale-branch-1")));
    });

    test("extracts last 40 lines of latest log file and copies to clipboard", async () => {
      const { runRescue } = await import("./cli.ts");
      let copiedText = "";
      const sample50Lines = Array.from({ length: 50 }, (_, i) => `log line ${i + 1}`).join("\n");

      const result = await runRescue({
        targetRepoPath: "/fake/repo",
        logger: () => {},
        dockerRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        gitRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        clipboardAdapter: (text) => {
          copiedText = text;
          return true;
        },
        fsAdapter: {
          existsSync: (p) => p.includes("logs"),
          readdirSync: () => ["old.log", "latest-failure.log"],
          statSync: (p) => ({
            mtimeMs: p.includes("latest-failure") ? 2000 : 1000,
            isDirectory: () => false,
          }),
          readFileSync: () => sample50Lines,
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.logLinesExtracted, 40);
      assert.equal(result.copiedToClipboard, true);
      assert.ok(result.logFilePath?.includes("latest-failure.log"));
      assert.ok(copiedText.includes("log line 50"));
      assert.ok(copiedText.includes("log line 11"));
      assert.ok(!copiedText.includes("log line 10\n"));
    });

    test("falls back to logging when clipboard copy fails or is unavailable", async () => {
      const { runRescue } = await import("./cli.ts");
      const logs: string[] = [];

      const result = await runRescue({
        targetRepoPath: "/fake/repo",
        dockerRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        gitRunner: () => ({ status: 0, stdout: "", stderr: "" }),
        clipboardAdapter: () => false,
        logger: (msg) => logs.push(msg),
        fsAdapter: {
          existsSync: (p) => p.includes("logs"),
          readdirSync: () => ["error.log"],
          statSync: () => ({ mtimeMs: 100, isDirectory: () => false }),
          readFileSync: () => "error details\nsecond error line",
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.copiedToClipboard, false);
      assert.ok(logs.some((l) => l.includes("error details")));
    });
  });

  describe("Seam 3: doctor Diagnostic Engine", () => {
    test("returns healthy when all diagnostic checks pass", async () => {
      const { runDoctor } = await import("./cli.ts");
      const logs: string[] = [];
      const result = await runDoctor({
        targetRepoPath: "/fake/repo",
        logger: (msg) => logs.push(msg),
        authChecker: () => ({ ok: true, details: "OAuth session active (gemini:antigravity)" }),
        dockerChecker: () => ({ ok: true, details: "Docker 27.0.3 daemon active" }),
        gitChecker: () => ({ ok: true, details: "Git 2.45.0, valid repository at /fake/repo" }),
        ghChecker: () => ({ ok: true, details: "Logged in as MTR-S" }),
        stackChecker: () => ({ ok: true, details: "Node/TypeScript (npm test)" }),
      });

      assert.equal(result.healthy, true);
      assert.equal(result.checks.length, 5);
      assert.ok(result.checks.every((c) => c.status === "pass"));
      assert.ok(logs.some((l) => l.includes("All diagnostic health checks passed")));
    });

    test("flags OAuth failure with remediation advice and returns healthy=false", async () => {
      const { runDoctor } = await import("./cli.ts");
      const logs: string[] = [];
      const result = await runDoctor({
        targetRepoPath: "/fake/repo",
        logger: (msg) => logs.push(msg),
        authChecker: () => ({
          ok: false,
          details: "No credential found in Windows Credential Manager",
          remediation: "Run 'agy login' on host machine to authenticate",
        }),
        dockerChecker: () => ({ ok: true, details: "Docker daemon responsive" }),
        gitChecker: () => ({ ok: true, details: "Valid repo" }),
        ghChecker: () => ({ ok: true, details: "Authenticated" }),
        stackChecker: () => ({ ok: true, details: "Node stack" }),
      });

      assert.equal(result.healthy, false);
      const authCheck = result.checks.find((c) => c.name.includes("OAuth"));
      assert.ok(authCheck);
      assert.equal(authCheck?.status, "fail");
      assert.ok(authCheck?.remediation?.includes("agy login"));
      assert.ok(logs.some((l) => l.includes("Remediation: Run 'agy login'")));
    });

    test("flags Docker daemon offline with remediation advice", async () => {
      const { runDoctor } = await import("./cli.ts");
      const logs: string[] = [];
      const result = await runDoctor({
        targetRepoPath: "/fake/repo",
        logger: (msg) => logs.push(msg),
        authChecker: () => ({ ok: true, details: "OK" }),
        dockerChecker: () => ({
          ok: false,
          details: "Cannot connect to the Docker daemon at npipe:////./pipe/docker_engine",
          remediation: "Ensure Docker Desktop is running",
        }),
        gitChecker: () => ({ ok: true, details: "OK" }),
        ghChecker: () => ({ ok: true, details: "OK" }),
        stackChecker: () => ({ ok: true, details: "OK" }),
      });

      assert.equal(result.healthy, false);
      const dockerCheck = result.checks.find((c) => c.name.includes("Docker"));
      assert.ok(dockerCheck);
      assert.equal(dockerCheck?.status, "fail");
      assert.ok(dockerCheck?.remediation?.includes("Ensure Docker Desktop is running"));
    });

    test("flags invalid target repository with clear remediation", async () => {
      const { runDoctor } = await import("./cli.ts");
      const result = await runDoctor({
        targetRepoPath: "/non-existent/folder",
        logger: () => {},
        authChecker: () => ({ ok: true, details: "OK" }),
        dockerChecker: () => ({ ok: true, details: "OK" }),
        gitChecker: () => ({
          ok: false,
          details: "fatal: not a git repository",
          remediation: "Run 'git init' or provide a valid repository path with '--repo <path>'",
        }),
        ghChecker: () => ({ ok: true, details: "OK" }),
        stackChecker: () => ({ ok: true, details: "OK" }),
      });

      assert.equal(result.healthy, false);
      const gitCheck = result.checks.find((c) => c.name.includes("Git"));
      assert.ok(gitCheck);
      assert.equal(gitCheck?.status, "fail");
      assert.ok(gitCheck?.remediation?.includes("git init"));
    });

    test("dispatchCli executes doctor and returns 0 when healthy, 1 when failing", async () => {
      const { dispatchCli } = await import("./cli.ts");
      const passCode = await dispatchCli(["doctor"], {
        doctorHandler: async () => 0,
      });
      assert.equal(passCode, 0);

      const failCode = await dispatchCli(["doctor"], {
        doctorHandler: async () => 1,
      });
      assert.equal(failCode, 1);
    });
  });

  describe("Seam 4: build-image Subcommand Handler", () => {
    test("assembles docker build command with default tag sandcastle-agent", async () => {
      const { runBuildImage } = await import("./cli.ts");
      let executedCmd = "";
      let executedCwd = "";

      const result = await runBuildImage({
        contextDir: "/sandcastle/root",
        dockerfile: "/sandcastle/root/Dockerfile",
        logger: () => {},
        runner: (cmd, cwd) => {
          executedCmd = cmd;
          executedCwd = cwd ?? "";
          return { status: 0, stdout: "Successfully tagged sandcastle-agent:latest", stderr: "" };
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.imageTag, "sandcastle-agent");
      assert.ok(executedCmd.includes("docker build -t sandcastle-agent"));
      assert.ok(executedCmd.includes("-f"));
      assert.ok(executedCmd.includes("Dockerfile"));
    });

    test("supports custom image tag passed via options", async () => {
      const { runBuildImage } = await import("./cli.ts");
      let executedCmd = "";

      const result = await runBuildImage({
        imageName: "custom-agent:v2",
        contextDir: "/root",
        logger: () => {},
        runner: (cmd) => {
          executedCmd = cmd;
          return { status: 0, stdout: "", stderr: "" };
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.imageTag, "custom-agent:v2");
      assert.ok(executedCmd.includes("docker build -t custom-agent:v2"));
    });

    test("appends build arguments to docker build command when provided", async () => {
      const { runBuildImage } = await import("./cli.ts");
      let executedCmd = "";

      const result = await runBuildImage({
        imageName: "custom-agent:v2",
        contextDir: "/root",
        buildArgs: { AGENT_UID: "1000", AGENT_GID: "1000" },
        logger: () => {},
        runner: (cmd) => {
          executedCmd = cmd;
          return { status: 0, stdout: "", stderr: "" };
        },
      });

      assert.equal(result.success, true);
      assert.ok(executedCmd.includes("--build-arg AGENT_UID=1000"));
      assert.ok(executedCmd.includes("--build-arg AGENT_GID=1000"));
    });

    test("handles docker build failure gracefully and returns success=false", async () => {
      const { runBuildImage } = await import("./cli.ts");
      const errors: string[] = [];

      const result = await runBuildImage({
        contextDir: "/root",
        logger: () => {},
        errorLogger: (msg) => errors.push(msg),
        runner: () => ({
          status: 1,
          stdout: "",
          stderr: "ERROR: failed to solve: Dockerfile parse error",
        }),
      });

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("failed to solve"));
      assert.ok(errors.some((e) => e.includes("failed to solve")));
    });

    test("dispatchCli executes build-image and propagates exit code", async () => {
      const { dispatchCli } = await import("./cli.ts");
      const passCode = await dispatchCli(["build-image"], {
        buildImageHandler: async () => 0,
      });
      assert.equal(passCode, 0);

      const failCode = await dispatchCli(["build-image"], {
        buildImageHandler: async () => 1,
      });
      assert.equal(failCode, 1);
    });
  });

  describe("Seam 5: Multi-Repository Orchestration Wire-up", () => {
    test("resolvePromptFile falls back to package root when prompt is absent in external target repo", async () => {
      const { resolvePromptFile } = await import("./prompts.ts");
      const { tmpdir } = await import("node:os");
      const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");

      const emptyTargetDir = mkdtempSync(join(tmpdir(), "sandcastle-target-"));
      try {
        const resolved = resolvePromptFile("plan-prompt.md", emptyTargetDir);
        assert.ok(existsSync(resolved), `Resolved prompt must exist on disk: ${resolved}`);
        assert.ok(resolved.endsWith("plan-prompt.md"));
        // Must point to orchestrator package prompt, not inside the empty external repo
        assert.ok(!resolved.startsWith(emptyTargetDir));
      } finally {
        rmSync(emptyTargetDir, { recursive: true, force: true });
      }
    });

    test("main.mts includes shebang line for CLI execution", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.ok(
        content.startsWith("#!/usr/bin/env node"),
        "main.mts must start with '#!/usr/bin/env node' shebang",
      );
    });

    test("main.mts imports parseCliArgs and dispatchCli from ./cli.ts", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /import\s+\{[^}]*(?:parseCliArgs|dispatchCli)[^}]*\}\s+from\s+["']\.\/cli\.ts["']/,
        "main.mts must import parseCliArgs and dispatchCli from ./cli.ts",
      );
    });

    test("main.mts resolves repoRoot dynamically from parsed --repo argument", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const mainPath = resolve(process.cwd(), "main.mts");
      const content = readFileSync(mainPath, "utf-8");

      assert.match(
        content,
        /(?:cliArgs\.repoPath|parsedCli\.repoPath|parsedArgs\.repoPath|cliParsed\.repoPath)/,
        "main.mts must resolve repoRoot using the CLI repoPath option",
      );
    });

    test("package.json bin field points to ./main.mts or ./cli.mts", async () => {
      const { readFileSync } = await import("node:fs");
      const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
      assert.ok(pkg.bin);
      assert.ok(
        pkg.bin["sandcastle-agy"] === "./main.mts" || pkg.bin["sandcastle-agy"] === "./cli.mts",
        "package.json bin must expose sandcastle-agy pointing to ./main.mts or ./cli.mts",
      );
      assert.ok(
        pkg.bin["sc-agy"] === "./main.mts" || pkg.bin["sc-agy"] === "./cli.mts",
        "package.json bin must expose sc-agy alias pointing to ./main.mts or ./cli.mts",
      );
    });
  });
});
