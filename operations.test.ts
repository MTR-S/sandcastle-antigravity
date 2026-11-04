import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  getBranchCommits,
  formatBranchCommitsSummary,
  parseCommitLine,
  type GitCommitInfo,
} from "./operations.ts";

describe("Branch Commit Inspection Seam for Iteration Commits (Issue #20)", () => {
  describe("Seam 1: GitCommitInfo & getBranchCommits", () => {
    test("single branch with a single commit parses short SHA and message correctly", () => {
      const executedCommands: { cmd: string; cwd: string }[] = [];
      const mockGitRunner = (cmd: string, cwd: string) => {
        executedCommands.push({ cmd, cwd });
        return {
          status: 0,
          stdout: "a1b2c3d4e5f67890123456789012345678901234\x1fa1b2c3d\x1ffeat(cli): add initial branch implementation\n",
          stderr: "",
        };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        { gitRunner: mockGitRunner },
      );

      assert.equal(commits.length, 1);
      assert.equal(commits[0].sha, "a1b2c3d4e5f67890123456789012345678901234");
      assert.equal(commits[0].shortSha, "a1b2c3d");
      assert.equal(commits[0].message, "feat(cli): add initial branch implementation");

      assert.equal(executedCommands.length, 1);
      assert.equal(executedCommands[0].cwd, "/mock/repo");
      assert.match(executedCommands[0].cmd, /git log/);
      assert.match(executedCommands[0].cmd, /--reverse/);
      assert.match(executedCommands[0].cmd, /feat\/sc-agy\.\.sandcastle\/issue-20/);
    });

    test("single branch with multiple commits (Implementer + Reviewer) preserves chronological order", () => {
      const mockGitRunner = (cmd: string, cwd: string) => {
        return {
          status: 0,
          stdout: [
            "08f0e65ce7d4df3da458063f18e3de2b817ef0cc\x1f08f0e65\x1fRALPH: Register sc-agy binary alias and normalize CLI argument parsing (#17)",
            "8969983b848379002df42a1a7f60604ea39a1958\x1f8969983\x1fRALPH: Update CLI help usage syntax and distribution documentation for sc-agy (#18)",
          ].join("\n"),
          stderr: "",
        };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-18",
        { gitRunner: mockGitRunner },
      );

      assert.equal(commits.length, 2);
      // First: Implementer commit (oldest)
      assert.equal(commits[0].sha, "08f0e65ce7d4df3da458063f18e3de2b817ef0cc");
      assert.equal(commits[0].shortSha, "08f0e65");
      assert.equal(
        commits[0].message,
        "RALPH: Register sc-agy binary alias and normalize CLI argument parsing (#17)",
      );

      // Second: Reviewer commit (newest)
      assert.equal(commits[1].sha, "8969983b848379002df42a1a7f60604ea39a1958");
      assert.equal(commits[1].shortSha, "8969983");
      assert.equal(
        commits[1].message,
        "RALPH: Update CLI help usage syntax and distribution documentation for sc-agy (#18)",
      );
    });

    test("falls back gracefully to short SHA and unavailable message placeholder on git log failure without throwing", () => {
      const mockGitRunner = (cmd: string) => {
        if (cmd.includes("git log")) {
          return {
            status: 1,
            stdout: "",
            stderr: "fatal: ambiguous argument 'feat/sc-agy..sandcastle/issue-20': unknown revision",
          };
        }
        if (cmd.includes("git rev-list")) {
          return {
            status: 0,
            stdout: "c3d4e5f678901234567890123456789012345678\n",
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "" };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        { gitRunner: mockGitRunner },
      );

      assert.equal(commits.length, 1);
      assert.equal(commits[0].sha, "c3d4e5f678901234567890123456789012345678");
      assert.equal(commits[0].shortSha, "c3d4e5f");
      assert.match(commits[0].message, /unavailable/i);
    });

    test("falls back gracefully when commit message is blank or missing", () => {
      const mockGitRunner = () => {
        return {
          status: 0,
          stdout: "b2c3d4e5f6789012345678901234567890123456\x1fb2c3d4e\x1f\n",
          stderr: "",
        };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        { gitRunner: mockGitRunner },
      );

      assert.equal(commits.length, 1);
      assert.equal(commits[0].sha, "b2c3d4e5f6789012345678901234567890123456");
      assert.equal(commits[0].shortSha, "b2c3d4e");
      assert.equal(commits[0].message, "(commit message unavailable)");
    });

    test("respects custom fallbackMessage option when commit message is missing", () => {
      const mockGitRunner = () => {
        return {
          status: 0,
          stdout: "b2c3d4e5f6789012345678901234567890123456\x1fb2c3d4e\x1f   \n",
          stderr: "",
        };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        {
          gitRunner: mockGitRunner,
          fallbackMessage: "Subject pending review",
        },
      );

      assert.equal(commits.length, 1);
      assert.equal(commits[0].shortSha, "b2c3d4e");
      assert.equal(commits[0].message, "Subject pending review");
    });

    test("never throws when git runner throws an unexpected exception", () => {
      const mockGitRunner = () => {
        throw new Error("Git binary crashed unexpectedly");
      };

      const loggedErrors: string[] = [];
      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        {
          gitRunner: mockGitRunner,
          errorLogger: (msg) => loggedErrors.push(msg),
        },
      );

      assert.deepEqual(commits, []);
      assert.equal(loggedErrors.length, 1);
      assert.match(loggedErrors[0], /Git binary crashed unexpectedly/);
    });

    test("falls back to target branch SHA when branch is a commit hash and git log fails", () => {
      const mockGitRunner = () => {
        return {
          status: 128,
          stdout: "",
          stderr: "fatal: not a valid object name",
        };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3",
        { gitRunner: mockGitRunner },
      );

      assert.equal(commits.length, 1);
      assert.equal(commits[0].sha, "e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3");
      assert.equal(commits[0].shortSha, "e4f5a6b");
      assert.equal(commits[0].message, "(commit message unavailable)");
    });

    test("parses space-separated git output flexibly without error", () => {
      const mockGitRunner = () => {
        return {
          status: 0,
          stdout: [
            "a1b2c3d4e5f67890123456789012345678901234 a1b2c3d fix(auth): resolve preflight check",
            "d4e5f67890123456789012345678901234567890 docs: update architecture diagrams",
            "f7a8b9c chore: housekeeping",
          ].join("\n"),
          stderr: "",
        };
      };

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        { gitRunner: mockGitRunner },
      );

      assert.equal(commits.length, 3);
      assert.equal(commits[0].shortSha, "a1b2c3d");
      assert.equal(commits[0].message, "fix(auth): resolve preflight check");

      assert.equal(commits[1].shortSha, "d4e5f67");
      assert.equal(commits[1].message, "docs: update architecture diagrams");

      assert.equal(commits[2].shortSha, "f7a8b9c");
      assert.equal(commits[2].message, "chore: housekeeping");
    });

    test("returns empty array when git log reports no commits in range", () => {
      const mockGitRunner = () => ({
        status: 0,
        stdout: "\n",
        stderr: "",
      });

      const commits = getBranchCommits(
        "/mock/repo",
        "feat/sc-agy",
        "sandcastle/issue-20",
        { gitRunner: mockGitRunner },
      );

      assert.deepEqual(commits, []);
    });

    test("parseCommitLine handles tab-delimited outputs and empty lines", () => {
      // 3-part tab-delimited: full SHA, short SHA, message
      const threePart = parseCommitLine(
        "a1b2c3d4e5f67890123456789012345678901234\ta1b2c3d\tfeat: tab delimited 3 parts",
      );
      assert.notEqual(threePart, null);
      assert.equal(threePart?.sha, "a1b2c3d4e5f67890123456789012345678901234");
      assert.equal(threePart?.shortSha, "a1b2c3d");
      assert.equal(threePart?.message, "feat: tab delimited 3 parts");

      // 2-part tab-delimited: full SHA, message
      const twoPart = parseCommitLine(
        "b2c3d4e5f6789012345678901234567890123456\tfix: tab delimited 2 parts",
      );
      assert.notEqual(twoPart, null);
      assert.equal(twoPart?.sha, "b2c3d4e5f6789012345678901234567890123456");
      assert.equal(twoPart?.shortSha, "b2c3d4e");
      assert.equal(twoPart?.message, "fix: tab delimited 2 parts");

      // Empty or whitespace lines
      assert.equal(parseCommitLine(""), null);
      assert.equal(parseCommitLine("   \n\t  "), null);
    });
  });

  describe("Seam 2: formatBranchCommitsSummary", () => {
    test("formats candidate branch commits with consistent indentation and unicode bullet markers", () => {
      const commits: GitCommitInfo[] = [
        {
          sha: "8969983b848379002df42a1a7f60604ea39a1958",
          shortSha: "8969983",
          message: "Update CLI help usage syntax and distribution documentation for sc-agy",
        },
      ];

      const lines = formatBranchCommitsSummary("sandcastle/issue-18", commits);

      assert.equal(lines.length, 2);
      assert.equal(lines[0], "  sandcastle/issue-18");
      assert.equal(
        lines[1],
        "      • 8969983 Update CLI help usage syntax and distribution documentation for sc-agy",
      );
      assert.match(lines[1], /^\s+•\s+8969983\s+/);
    });

    test("formats multiple chronological commits (Implementer + Reviewer) sequentially", () => {
      const commits: GitCommitInfo[] = [
        {
          sha: "08f0e65ce7d4df3da458063f18e3de2b817ef0cc",
          shortSha: "08f0e65",
          message: "Register sc-agy binary alias and normalize CLI argument parsing",
        },
        {
          sha: "8969983b848379002df42a1a7f60604ea39a1958",
          shortSha: "8969983",
          message: "Update CLI help usage syntax and distribution documentation for sc-agy",
        },
      ];

      const lines = formatBranchCommitsSummary("sandcastle/issue-18", commits);

      assert.equal(lines.length, 3);
      assert.equal(lines[0], "  sandcastle/issue-18");
      assert.equal(
        lines[1],
        "      • 08f0e65 Register sc-agy binary alias and normalize CLI argument parsing",
      );
      assert.equal(
        lines[2],
        "      • 8969983 Update CLI help usage syntax and distribution documentation for sc-agy",
      );
    });

    test("supports formatting commits array directly without branch header", () => {
      const commits: GitCommitInfo[] = [
        {
          sha: "a1b2c3d4e5f67890123456789012345678901234",
          shortSha: "a1b2c3d",
          message: "Standalone commit entry",
        },
      ];

      const lines = formatBranchCommitsSummary(commits);

      assert.equal(lines.length, 1);
      assert.equal(lines[0], "      • a1b2c3d Standalone commit entry");
    });

    test("handles empty commits array with optional placeholder", () => {
      const linesWithoutPlaceholder = formatBranchCommitsSummary("sandcastle/issue-20", []);
      assert.deepEqual(linesWithoutPlaceholder, ["  sandcastle/issue-20"]);

      const linesWithPlaceholder = formatBranchCommitsSummary("sandcastle/issue-20", [], {
        emptyPlaceholder: "(no commits)",
      });
      assert.deepEqual(linesWithPlaceholder, [
        "  sandcastle/issue-20",
        "      (no commits)",
      ]);
    });

    test("supports custom branch and commit indentation options", () => {
      const commits: GitCommitInfo[] = [
        {
          sha: "a1b2c3d4e5f67890123456789012345678901234",
          shortSha: "a1b2c3d",
          message: "Custom indented commit",
        },
      ];

      const lines = formatBranchCommitsSummary("custom-branch", commits, {
        branchIndent: "    ",
        commitIndent: "        ",
      });

      assert.equal(lines[0], "    custom-branch");
      assert.equal(lines[1], "        • a1b2c3d Custom indented commit");
    });

    test("trims leading and trailing whitespace on branch name", () => {
      const commits: GitCommitInfo[] = [
        {
          sha: "a1b2c3d4e5f67890123456789012345678901234",
          shortSha: "a1b2c3d",
          message: "Trim test commit",
        },
      ];

      const lines = formatBranchCommitsSummary("   sandcastle/issue-20   ", commits);
      assert.equal(lines[0], "  sandcastle/issue-20");
    });
  });
});
