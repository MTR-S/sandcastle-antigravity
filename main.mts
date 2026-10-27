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
//   npx tsx .sandcastle/main.mts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { antigravity } from "./antigravity.ts";
import { runAuthPreflight, formatOAuthPayloadForContainer } from "./auth-preflight.ts";

const repoRoot = existsSync(".git") ? process.cwd() : resolve(process.cwd(), "..");

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
function getSandboxEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  if (process.env.GH_TOKEN) {
    env.GH_TOKEN = process.env.GH_TOKEN;
  }
  if (process.env.GITHUB_TOKEN) {
    env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (process.env.SANDCASTLE_LABEL) {
    env.SANDCASTLE_LABEL = process.env.SANDCASTLE_LABEL;
  }
  // Mirror GH_TOKEN <-> GITHUB_TOKEN if only one is present
  if (env.GH_TOKEN && !env.GITHUB_TOKEN) {
    env.GITHUB_TOKEN = env.GH_TOKEN;
  } else if (env.GITHUB_TOKEN && !env.GH_TOKEN) {
    env.GH_TOKEN = env.GITHUB_TOKEN;
  }

  return env;
}

const sandboxEnv: Record<string, string> = {
  ...getSandboxEnv(),
  SANDCASTLE_OAUTH_PAYLOAD: oauthPayload,
};
const sandboxImageName = process.env.SANDCASTLE_IMAGE ?? "sandcastle-agent";
const defaultAgentModel = process.env.AGENT_MODEL ?? "gemini-3.8-flash-high";
const baseBranch = process.env.BASE_BRANCH ?? process.env.TARGET_BRANCH ?? "refractor/ai-main-implementation";

const PROTECTED_BRANCHES = new Set(["main", "homol", "developer"]);
if (PROTECTED_BRANCHES.has(baseBranch)) {
  console.error(
    `[ERROR] Base branch cannot be one of the protected branches (main, homol, developer). Configured: "${baseBranch}". ` +
      `Sandcastle agents are strictly restricted to refractor/ai-main-implementation and its child branches.`,
  );
  process.exit(1);
}

/**
 * Creates a Docker sandbox provider with forwarded API authentication and GitHub tokens.
 */
function createSandboxProvider() {
  const userHome = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const m2Path = resolve(userHome, ".m2");
  const mounts = existsSync(m2Path)
    ? [
        {
          hostPath: m2Path,
          sandboxPath: "/home/agent/.m2",
        },
      ]
    : [];

  return docker({
    imageName: sandboxImageName,
    env: {
      ...sandboxEnv,
      SANDCASTLE_OAUTH_PAYLOAD: oauthPayload,
    },
    mounts,
  });
}

/**
 * Phase-specific model resolvers for PLANNER_MODEL, IMPLEMENTER_MODEL, REVIEWER_MODEL,
 * and MERGER_MODEL defaulting to AGENT_MODEL (and fallback "gemini-3.8-flash-high").
 */
export const plannerModel = process.env.PLANNER_MODEL ?? defaultAgentModel;
export const implementerModel = process.env.IMPLEMENTER_MODEL ?? defaultAgentModel;
export const reviewerModel = process.env.REVIEWER_MODEL ?? defaultAgentModel;
export const mergerModel = process.env.MERGER_MODEL ?? defaultAgentModel;

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
    promptFile: resolve(repoRoot, ".sandcastle/plan-prompt.md"),
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
          promptFile: resolve(repoRoot, ".sandcastle/implement-prompt.md"),
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
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
              promptFile: resolve(repoRoot, ".sandcastle/review-prompt.md"),
              promptArgs: {
                BRANCH: issue.branch,
                BASE_BRANCH: baseBranch,
              },
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
    promptFile: resolve(repoRoot, ".sandcastle/merge-prompt.md"),
    promptArgs: {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b: string) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i: PlannedIssue) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
process.exit(0);
