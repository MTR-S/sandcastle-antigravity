import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TargetRepoConfig } from "./target-config.ts";

export const PROMPT_FILE_NAMES = [
  "plan-prompt.md",
  "implement-prompt.md",
  "review-prompt.md",
  "merge-prompt.md",
] as const;

export type PromptFileName = (typeof PROMPT_FILE_NAMES)[number];

export const REQUIRED_PROMPT_VARIABLES = [
  "VERIFY_COMMAND",
  "BASE_BRANCH",
  "PROTECTED_BRANCHES",
] as const;

export type RequiredPromptVariable = (typeof REQUIRED_PROMPT_VARIABLES)[number];

export const TARGET_DOMAIN_DOC_FILES = [
  "AGENTS.md",
  "CONTEXT.md",
  "CODING_STANDARDS.md",
] as const;

export interface CommonPromptArgs {
  readonly BASE_BRANCH: string;
  readonly VERIFY_COMMAND: string;
  readonly PROTECTED_BRANCHES: string;
}

export type PromptArgs = Readonly<Record<string, string>>;

/**
 * Formats a list of protected branches into a canonical comma-separated string representation.
 */
export function formatProtectedBranches(branches: readonly string[]): string {
  return branches.join(", ");
}

/**
 * Resolves a prompt file from target repository root or .sandcastle directory,
 * falling back to the orchestrator package root if absent in the target repo.
 */
export function resolvePromptFile(name: string, rootDir?: string): string {
  const packageRoot = typeof __dirname !== "undefined"
    ? __dirname
    : fileURLToPath(new URL(".", import.meta.url));

  const baseDir = rootDir
    ? resolve(rootDir)
    : (existsSync(".git") ? process.cwd() : resolve(process.cwd(), ".."));
  const directPath = resolve(baseDir, name);
  if (existsSync(directPath)) {
    return directPath;
  }
  const sandcastlePath = resolve(baseDir, ".sandcastle", name);
  if (existsSync(sandcastlePath)) {
    return sandcastlePath;
  }

  // Fallback to orchestrator package directory to avoid polluting external target repositories
  const packageDirectPath = resolve(packageRoot, name);
  if (existsSync(packageDirectPath)) {
    return packageDirectPath;
  }
  const packageSandcastlePath = resolve(packageRoot, ".sandcastle", name);
  if (existsSync(packageSandcastlePath)) {
    return packageSandcastlePath;
  }

  return directPath;
}

/**
 * Builds common prompt arguments derived from a resolved TargetRepoConfig.
 */
export function buildCommonPromptArgs(
  config: Pick<TargetRepoConfig, "baseBranch" | "verifyCommand" | "protectedBranches">,
): CommonPromptArgs {
  return {
    BASE_BRANCH: config.baseBranch,
    VERIFY_COMMAND: config.verifyCommand,
    PROTECTED_BRANCHES: formatProtectedBranches(config.protectedBranches),
  };
}

/**
 * Builds a complete promptArgs object combining common target variables with phase-specific variables.
 */
export function buildPromptArgs(
  targetConfig: Pick<TargetRepoConfig, "baseBranch" | "verifyCommand" | "protectedBranches">,
  phaseArgs: Record<string, string> = {},
): PromptArgs {
  const common = buildCommonPromptArgs(targetConfig);
  return Object.freeze({
    ...common,
    ...phaseArgs,
  });
}

/**
 * Finds all `{{VAR}}` placeholder tags remaining in a prompt template string.
 */
export function findUnsubstitutedVariables(content: string): readonly string[] {
  const matches = content.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g);
  if (!matches) return [];
  const uniqueKeys = new Set(
    matches.map((m) => m.replace(/\{\{\s*|\s*\}\}/g, "")),
  );
  return Object.freeze(Array.from(uniqueKeys));
}

/**
 * Substitutes `{{VAR}}` placeholders in prompt text with corresponding values from args.
 */
export function substitutePromptVariables(
  content: string,
  args: Record<string, string>,
): string {
  return content.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      return args[key];
    }
    return match;
  });
}
