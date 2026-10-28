#!/usr/bin/env node
// ===========================================================================
// Sandcastle Antigravity Orchestrator (MTR-S/sandcastle-antigravity)
//
// Adapted from the "Parallel Planner with Review" template in @ai-hero/sandcastle
// (https://github.com/mattpocock/sandcastle) — Copyright (c) 2026 Matt Pocock (MIT).
// Extended by MTR-S with Google Antigravity CLI (`agy`) provider and Host OAuth Bridge.
// ===========================================================================
//
// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx main.mts run [--repo <path>] [--yes]
//   npx tsx main.mts rescue [--repo <path>]
//   npx tsx main.mts doctor [--repo <path>]
//   npx tsx main.mts build-image

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { antigravity } from "./antigravity.ts";
import { runAuthPreflight, formatOAuthPayloadForContainer } from "./auth-preflight.ts";
import { getSandboxEnv as resolveSandboxEnv, getSandboxMounts } from "./docker-config.ts";
import { detectTargetConfig } from "./target-config.ts";
import { buildPromptArgs, resolvePromptFile } from "./prompts.ts";
import { resolvePreRunConfig, runPreRunConfigurationBanner } from "./banner.ts";
import { parseCliArgs, dispatchCli } from "./cli.ts";

// ---------------------------------------------------------------------------
// CLI Argument Parsing & Operations Dispatch (Issue #10)
// ---------------------------------------------------------------------------
const parsedCli = parseCliArgs(process.argv);

if (parsedCli.command !== "run") {
  const exitCode = await dispatchCli(process.argv);
  process.exit(exitCode);
}

const repoRoot = parsedCli.repoPath
  ? resolve(parsedCli.repoPath)
  : (existsSync(".git") ? process.cwd() : resolve(process.cwd(), ".."));

// Load local environment variables from .sandcastle/.env or .env if present
for (const envPath of [
  resolve(repoRoot, ".sandcastle/.env"),
  resolve(repoRoot, ".env"),
]) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Ignore missing env file
  }
}

// ---------------------------------------------------------------------------
// Target Repository Autodetection & Pre-Run Inspection Gate (Issue #9)
// ---------------------------------------------------------------------------
let targetConfig = detectTargetConfig({ targetRepoPath: repoRoot });
const baseBranch = process.env.BASE_BRANCH ?? process.env.TARGET_BRANCH ?? targetConfig.baseBranch;

const initialPreRunConfig = resolvePreRunConfig(targetConfig, process.env);
const bannerResult = await runPreRunConfigurationBanner({
  config: initialPreRunConfig,
  argv: process.argv,
});

if (bannerResult.action === "cancel") {
  process.exit(0);
}

const activeConfig = bannerResult.config;
const activeBaseBranch = activeConfig.baseBranch;

// Construct effective targetConfig with active overrides
targetConfig = Object.freeze({
  ...targetConfig,
  baseBranch: activeBaseBranch,
  protectedBranches: activeConfig.protectedBranches,
  gitIdentity: activeConfig.gitIdentity,
  verifyCommand: activeConfig.verifyCommand,
});

// ---------------------------------------------------------------------------
// Schemas and Types
// ---------------------------------------------------------------------------

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

type PlanOutput = z.infer<typeof planSchema>;
type PlannedIssue = PlanOutput["issues"][number];

// ---------------------------------------------------------------------------
// Configuration & Environment
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Host Authentication Pre-flight Check
// ---------------------------------------------------------------------------
// Validate Antigravity OAuth credentials in Windows Credential Manager before
// creating any sandboxes, worktrees, or branches. If missing or invalid, logs a
// diagnostic failure and exits with code 1 immediately.
const authResult = runAuthPreflight();
const oauthPayload = formatOAuthPayloadForContainer(authResult);

/**
 * Collect authentication tokens from the environment to forward into the Docker sandbox.
 */
function getSandboxEnv(): Readonly<Record<string, string>> {
  // Reads tokens, labels (process.env.SANDCASTLE_LABEL), and git identity
  const env = resolveSandboxEnv(process.env);
  const overrides: Record<string, string> = {};
  if (activeConfig.gitIdentity.name) {
    overrides.GIT_USER_NAME = activeConfig.gitIdentity.name;
    overrides.GIT_AUTHOR_NAME = activeConfig.gitIdentity.name;
    overrides.GIT_COMMITTER_NAME = activeConfig.gitIdentity.name;
  }
  if (activeConfig.gitIdentity.email) {
    overrides.GIT_USER_EMAIL = activeConfig.gitIdentity.email;
    overrides.GIT_AUTHOR_EMAIL = activeConfig.gitIdentity.email;
    overrides.GIT_COMMITTER_EMAIL = activeConfig.gitIdentity.email;
  }
  if (activeConfig.issueLabel) {
    overrides.SANDCASTLE_LABEL = activeConfig.issueLabel;
  }
  return { ...env, ...overrides };
}

const sandboxEnv: Record<string, string> = {
  ...getSandboxEnv(),
  SANDCASTLE_OAUTH_PAYLOAD: oauthPayload,
};
const sandboxImageName = process.env.SANDCASTLE_IMAGE ?? "sandcastle-agent";
const defaultAgentModel = process.env.AGENT_MODEL ?? "gemini-3.8-flash-high";

const PROTECTED_BRANCHES = new Set(activeConfig.protectedBranches);
if (PROTECTED_BRANCHES.has(activeBaseBranch)) {
  console.error(
    `[ERROR] Base branch cannot be one of the protected branches (${Array.from(PROTECTED_BRANCHES).join(", ")}). Configured: "${activeBaseBranch}". ` +
      `Sandcastle agents are strictly restricted to base branch and its child branches.`,
  );
  process.exit(1);
}

/**
 * Creates a Docker sandbox provider with forwarded API authentication, GitHub tokens, and cache mounts.
 */
function createSandboxProvider() {
  const mounts = [...getSandboxMounts()];

  return docker({
    imageName: sandboxImageName,
    env: sandboxEnv,
    mounts,
  });
}

/**
 * Phase-specific model resolvers for PLANNER_MODEL, IMPLEMENTER_MODEL, REVIEWER_MODEL,
 * and MERGER_MODEL defaulting to AGENT_MODEL (and fallback "gemini-3.8-flash-high").
 */
export const plannerModel = activeConfig.models.planner ?? process.env.PLANNER_MODEL ?? defaultAgentModel;
export const implementerModel = activeConfig.models.implementer ?? process.env.IMPLEMENTER_MODEL ?? defaultAgentModel;
export const reviewerModel = activeConfig.models.reviewer ?? process.env.REVIEWER_MODEL ?? defaultAgentModel;
export const mergerModel = activeConfig.models.merger ?? process.env.MERGER_MODEL ?? defaultAgentModel;

/**
 * Creates an Antigravity agent provider instance configured with the specified model and options.
 */
function createAgent(
  model: string,
  options?: {
    effort?: "low" | "medium" | "high";
    mode?: "accept-edits" | "plan";
  },
) {
  return antigravity(model, options);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent analyzes open issues, builds a dependency graph, and
  // selects issues that can be worked in parallel right now.
  //
  // It outputs a <plan> JSON block — Output.object parses and validates it.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    cwd: repoRoot,
    sandbox: createSandboxProvider(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code. (Structured output requires maxIterations: 1.)
    maxIterations: 1,
    // Antigravity agent provider configured for the planning phase
    agent: createAgent(plannerModel, {
      effort: "high",
      mode: "plan",
    }),
    promptFile: resolvePromptFile("plan-prompt.md", repoRoot),
    promptArgs: buildPromptArgs(targetConfig),
    // Extract and validate the <plan> JSON into a typed object. Throws
    // StructuredOutputError if the tag is missing, the JSON is malformed, or
    // validation fails — which aborts the loop.
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues: PlannedIssue[] = plan.output.issues;

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const settled = await Promise.allSettled(
    issues.map(async (issue: PlannedIssue) => {
      const sandbox = await sandcastle.createSandbox({
        cwd: repoRoot,
        branch: issue.branch,
        sandbox: createSandboxProvider(),
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: createAgent(implementerModel, {
            effort: "high",
            mode: "accept-edits",
          }),
          promptFile: resolvePromptFile("implement-prompt.md", repoRoot),
          promptArgs: buildPromptArgs(targetConfig, {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          }),
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          try {
            const review = await sandbox.run({
              name: "reviewer",
              maxIterations: 1,
              agent: createAgent(reviewerModel, {
                effort: "medium",
                mode: "accept-edits",
              }),
              promptFile: resolvePromptFile("review-prompt.md", repoRoot),
              promptArgs: buildPromptArgs(targetConfig, {
                BRANCH: issue.branch,
              }),
            });

            // Merge commits from both runs so the merge phase sees all of them.
            // Each sandbox.run() only returns commits from its own run.
            return {
              ...review,
              commits: [...implement.commits, ...review.commits],
            };
          } catch (reviewErr) {
            console.warn(
              `  [reviewer] Warning: Reviewer step failed or timed out for ${issue.id} (${issue.branch}): ${reviewErr}. Proceeding with implementer commits.`,
            );
            return implement;
          }
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (
        entry,
      ): entry is {
        outcome: PromiseFulfilledResult<sandcastle.SandboxRunResult>;
        issue: PlannedIssue;
      } =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i: PlannedIssue) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  await sandcastle.run({
    cwd: repoRoot,
    sandbox: createSandboxProvider(),
    name: "merger",
    maxIterations: 15,
    agent: createAgent(mergerModel, {
      effort: "high",
      mode: "accept-edits",
    }),
    promptFile: resolvePromptFile("merge-prompt.md", repoRoot),
    promptArgs: buildPromptArgs(targetConfig, {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b: string) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i: PlannedIssue) => `- ${i.id}: ${i.title}`).join("\n"),
    }),
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
process.exit(0);
