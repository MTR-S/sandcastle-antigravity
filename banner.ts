import * as p from "@clack/prompts";
import type { TargetRepoConfig } from "./target-config.ts";

export type ExecutionMode = "automatic" | "interactive";

export interface PhaseModels {
  readonly planner: string;
  readonly implementer: string;
  readonly reviewer: string;
  readonly merger: string;
}

export interface PreRunConfig {
  readonly targetRepoPath: string;
  baseBranch: string;
  protectedBranches: string[];
  gitIdentity: {
    name?: string;
    email?: string;
  };
  githubAuth: {
    account?: string;
    token?: string;
    source: string;
  };
  verifyCommand: string;
  issueLabel: string;
  models: PhaseModels;
  mode: ExecutionMode;
  concurrency: number;
  implementerEffort: "low" | "medium" | "high";
}

const DEFAULT_AGENT_MODEL = "gemini-3.8-flash-high";
const DEFAULT_ISSUE_LABEL = "ready-for-agent";
export const DEFAULT_EXECUTION_MODE: ExecutionMode = "automatic";
export const DEFAULT_PARALLEL_CONCURRENCY = 3;
export const DEFAULT_IMPLEMENTER_EFFORT = "low";

export interface ResolvePreRunConfigOptions {
  readonly mode?: ExecutionMode;
  readonly concurrency?: number;
  readonly implementerEffort?: "low" | "medium" | "high";
}

/**
 * Resolves initial PreRunConfig combining detected target repository parameters
 * with environment variable overrides and sensible fallbacks.
 */
export function resolvePreRunConfig(
  targetConfig: TargetRepoConfig,
  env: Record<string, string | undefined> = process.env,
  options?: ResolvePreRunConfigOptions | ExecutionMode,
): PreRunConfig {
  const defaultModel = env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;

  const plannerModel =
    env.PLANNER_MODEL?.trim() || defaultModel;
  const implementerModel =
    env.IMPLEMENTER_MODEL?.trim() || defaultModel;
  const reviewerModel =
    env.REVIEWER_MODEL?.trim() || defaultModel;
  const mergerModel =
    env.MERGER_MODEL?.trim() || defaultModel;

  const issueLabel =
    env.SANDCASTLE_LABEL?.trim() ||
    env.ISSUE_LABEL?.trim() ||
    DEFAULT_ISSUE_LABEL;

  const baseBranch =
    env.BASE_BRANCH?.trim() ||
    env.TARGET_BRANCH?.trim() ||
    targetConfig.baseBranch;

  const explicitMode: ExecutionMode | undefined =
    typeof options === "string" ? options : options?.mode;

  const envModeRaw = (
    env.EXECUTION_MODE?.trim() ||
    env.SANDCASTLE_MODE?.trim() ||
    env.MODE?.trim()
  )?.toLowerCase();
  const envMode: ExecutionMode | undefined =
    envModeRaw === "interactive" || envModeRaw === "automatic"
      ? envModeRaw
      : undefined;

  const mode: ExecutionMode = explicitMode ?? envMode ?? DEFAULT_EXECUTION_MODE;

  // Resolve Concurrency (options > SANDCASTLE_CONCURRENCY > default 3)
  const explicitConcurrency = typeof options === "object" ? options?.concurrency : undefined;
  let concurrency = DEFAULT_PARALLEL_CONCURRENCY;
  if (explicitConcurrency !== undefined && Number.isInteger(explicitConcurrency) && explicitConcurrency > 0) {
    concurrency = explicitConcurrency;
  } else if (env.SANDCASTLE_CONCURRENCY !== undefined && env.SANDCASTLE_CONCURRENCY.trim() !== "") {
    const envVal = Number(env.SANDCASTLE_CONCURRENCY.trim());
    if (Number.isInteger(envVal) && envVal > 0) {
      concurrency = envVal;
    }
  }

  // Resolve Implementer Effort (options > IMPLEMENTER_EFFORT > default "low")
  const explicitEffort = typeof options === "object" ? options?.implementerEffort : undefined;
  let implementerEffort: "low" | "medium" | "high" = DEFAULT_IMPLEMENTER_EFFORT;
  if (explicitEffort === "low" || explicitEffort === "medium" || explicitEffort === "high") {
    implementerEffort = explicitEffort;
  } else if (env.IMPLEMENTER_EFFORT !== undefined && env.IMPLEMENTER_EFFORT.trim() !== "") {
    const rawEffort = env.IMPLEMENTER_EFFORT.trim().toLowerCase();
    if (rawEffort === "low" || rawEffort === "medium" || rawEffort === "high") {
      implementerEffort = rawEffort;
    }
  }

  return {
    targetRepoPath: targetConfig.targetRepoPath,
    baseBranch,
    protectedBranches: [...targetConfig.protectedBranches],
    gitIdentity: {
      name: env.GIT_USER_NAME?.trim() || targetConfig.gitIdentity.name,
      email: env.GIT_USER_EMAIL?.trim() || targetConfig.gitIdentity.email,
    },
    githubAuth: {
      account: env.GH_USER?.trim() || targetConfig.githubAuth.account,
      token: env.GH_TOKEN?.trim() || targetConfig.githubAuth.token,
      source: targetConfig.githubAuth.source,
    },
    verifyCommand: targetConfig.verifyCommand,
    issueLabel,
    models: {
      planner: plannerModel,
      implementer: implementerModel,
      reviewer: reviewerModel,
      merger: mergerModel,
    },
    mode,
    concurrency,
    implementerEffort,
  };
}

/**
 * Formats the ExecutionMode into a human-readable display string.
 */
export function formatExecutionMode(mode: ExecutionMode): string {
  return mode === "interactive" ? "interactive" : `${DEFAULT_EXECUTION_MODE} (default)`;
}

/**
 * Formats a clean, readable inspection summary of all resolved parameters.
 */
export function formatPreRunSummary(config: PreRunConfig): string {
  const gitIdentityStr =
    config.gitIdentity.name || config.gitIdentity.email
      ? `${config.gitIdentity.name ?? "(no name)"} <${config.gitIdentity.email ?? "no-email"}>`
      : "(not configured)";

  const githubAuthStr =
    config.githubAuth.account || config.githubAuth.token
      ? `${config.githubAuth.account ?? "unknown"} (token: ${
          config.githubAuth.token ? "configured" : "none"
        } [${config.githubAuth.source}])`
      : "(not authenticated)";

  const verifyCmdStr = config.verifyCommand.trim() || "(none)";
  const modeStr = formatExecutionMode(config.mode);

  const lines = [
    `Target Repository Path : ${config.targetRepoPath}`,
    `Active Base Branch     : ${config.baseBranch}`,
    `Protected Branches     : ${config.protectedBranches.join(", ")}`,
    `Git Author Identity    : ${gitIdentityStr}`,
    `GitHub User/Token      : ${githubAuthStr}`,
    `Verification Command   : ${verifyCmdStr}`,
    `Issue Label filter     : ${config.issueLabel}`,
    `Execution Mode         : ${modeStr}`,
    `Parallel Concurrency   : ${config.concurrency}`,
    `Implementer Effort     : ${config.implementerEffort}`,
    `Models assigned per phase:`,
    `  • Planner: ${config.models.planner}`,
    `  • Implementer: ${config.models.implementer}`,
    `  • Reviewer: ${config.models.reviewer}`,
    `  • Merger: ${config.models.merger}`,
  ];

  return lines.join("\n");
}

export type BannerAction = "start" | "cancel";

export interface BannerResult {
  readonly action: BannerAction;
  readonly config: PreRunConfig;
}

export interface PromptOption {
  readonly value: string;
  readonly label?: string;
  readonly hint?: string;
}

export interface PromptAdapter {
  intro: (title: string) => void;
  outro: (message: string) => void;
  note: (message: string, title?: string) => void;
  select: (opts: {
    message: string;
    options: readonly PromptOption[];
    initialValue?: string;
  }) => Promise<string | symbol>;
  text: (opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    initialValue?: string;
  }) => Promise<string | symbol>;
  cancel: (message: string) => void;
  isCancel: (value: unknown) => boolean;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    success: (message: string) => void;
  };
}

export const defaultPromptAdapter: PromptAdapter = {
  intro: p.intro,
  outro: p.outro,
  note: p.note,
  select: (opts) =>
    p.select(opts as Parameters<typeof p.select>[0]) as Promise<string | symbol>,
  text: (opts) =>
    p.text(opts as Parameters<typeof p.text>[0]) as Promise<string | symbol>,
  cancel: p.cancel,
  isCancel: p.isCancel,
  log: p.log,
};

export interface PreRunBannerOptions {
  readonly config: PreRunConfig;
  readonly nonInteractive?: boolean;
  readonly argv?: string[];
  readonly promptAdapter?: PromptAdapter;
  readonly logger?: (message: string) => void;
  readonly onCancel?: () => void;
}

/**
 * Runs the Pre-Run Configuration Banner.
 * When nonInteractive or --yes/-y is present, logs summary and immediately begins execution.
 */
export async function runPreRunConfigurationBanner(
  options: PreRunBannerOptions,
): Promise<BannerResult> {
  const argv = options.argv ?? process.argv;
  const isNonInteractive =
    options.nonInteractive === true ||
    argv.includes("--yes") ||
    argv.includes("-y");

  const logger = options.logger ?? console.log;

  if (isNonInteractive) {
    logger("\n--- Sandcastle Antigravity Pre-Run Configuration (--yes) ---");
    logger(formatPreRunSummary(options.config));
    logger("-----------------------------------------------------------\n");
    return {
      action: "start",
      config: options.config,
    };
  }

  const prompts = options.promptAdapter ?? defaultPromptAdapter;
  const currentConfig: PreRunConfig = {
    ...options.config,
    protectedBranches: [...options.config.protectedBranches],
    gitIdentity: { ...options.config.gitIdentity },
    githubAuth: { ...options.config.githubAuth },
    models: { ...options.config.models },
    mode: options.config.mode ?? "automatic",
  };

  prompts.intro("Sandcastle Antigravity Orchestrator");
  prompts.note(
    formatPreRunSummary(currentConfig),
    "Pre-Run Configuration Inspection",
  );

  while (true) {
    const action = await prompts.select({
      message: "Choose an action before proceeding:",
      options: [
        {
          value: "confirm",
          label: "Confirm and Start",
          hint: "Proceed immediately to sandbox execution",
        },
        {
          value: "edit",
          label: "Edit a Configuration",
          hint: "Override any setting on the fly",
        },
        {
          value: "cancel",
          label: "Cancel",
          hint: "Gracefully abort without executing changes",
        },
      ],
    });

    if (prompts.isCancel(action) || action === "cancel") {
      prompts.cancel("Execution aborted by operator. Zero changes applied.");
      if (options.onCancel) {
        options.onCancel();
      }
      return {
        action: "cancel",
        config: currentConfig,
      };
    }

    if (action === "confirm") {
      prompts.outro("Configuration confirmed. Launching orchestration pipeline...");
      return {
        action: "start",
        config: currentConfig,
      };
    }

    if (action === "edit") {
      const field = await prompts.select({
        message: "Select a configuration field to override:",
        options: [
          {
            value: "baseBranch",
            label: "Active Base Branch",
            hint: currentConfig.baseBranch,
          },
          {
            value: "protectedBranches",
            label: "Protected Branches",
            hint: currentConfig.protectedBranches.join(", "),
          },
          {
            value: "gitIdentity",
            label: "Git Author Identity",
            hint: currentConfig.gitIdentity.name
              ? `${currentConfig.gitIdentity.name} <${currentConfig.gitIdentity.email ?? ""}>`
              : "unset",
          },
          {
            value: "verifyCommand",
            label: "Verification Command",
            hint: currentConfig.verifyCommand || "(none)",
          },
          {
            value: "issueLabel",
            label: "Issue Label filter",
            hint: currentConfig.issueLabel,
          },
          {
            value: "mode",
            label: "Execution Mode",
            hint: formatExecutionMode(currentConfig.mode),
          },
          {
            value: "concurrency",
            label: "Parallel Concurrency",
            hint: String(currentConfig.concurrency),
          },
          {
            value: "implementerEffort",
            label: "Implementer Effort",
            hint: currentConfig.implementerEffort,
          },
          {
            value: "models",
            label: "Phase Models",
            hint: `Planner: ${currentConfig.models.planner}...`,
          },
          {
            value: "back",
            label: "< Back to main menu",
            hint: "Return without modifying settings",
          },
        ],
      });

      if (prompts.isCancel(field)) {
        prompts.cancel("Execution aborted by operator. Zero changes applied.");
        if (options.onCancel) {
          options.onCancel();
        }
        return {
          action: "cancel",
          config: currentConfig,
        };
      }

      if (field === "back") {
        continue;
      }

      if (field === "baseBranch") {
        const val = await prompts.text({
          message: "Enter Active Base Branch:",
          initialValue: currentConfig.baseBranch,
          defaultValue: currentConfig.baseBranch,
        });
        if (prompts.isCancel(val)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        if (typeof val === "string" && val.trim()) {
          currentConfig.baseBranch = val.trim();
        }
      } else if (field === "protectedBranches") {
        const val = await prompts.text({
          message: "Enter Protected Branches (comma-separated):",
          initialValue: currentConfig.protectedBranches.join(", "),
          defaultValue: currentConfig.protectedBranches.join(", "),
        });
        if (prompts.isCancel(val)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        if (typeof val === "string") {
          const parsed = val
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (parsed.length > 0) {
            currentConfig.protectedBranches = parsed;
          }
        }
      } else if (field === "gitIdentity") {
        const nameVal = await prompts.text({
          message: "Enter Git Author Name:",
          initialValue: currentConfig.gitIdentity.name ?? "",
          defaultValue: currentConfig.gitIdentity.name ?? "",
        });
        if (prompts.isCancel(nameVal)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        const emailVal = await prompts.text({
          message: "Enter Git Author Email:",
          initialValue: currentConfig.gitIdentity.email ?? "",
          defaultValue: currentConfig.gitIdentity.email ?? "",
        });
        if (prompts.isCancel(emailVal)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        currentConfig.gitIdentity = {
          name: typeof nameVal === "string" ? nameVal.trim() : currentConfig.gitIdentity.name,
          email: typeof emailVal === "string" ? emailVal.trim() : currentConfig.gitIdentity.email,
        };
      } else if (field === "verifyCommand") {
        const val = await prompts.text({
          message: "Enter Verification Command:",
          initialValue: currentConfig.verifyCommand,
          defaultValue: currentConfig.verifyCommand,
        });
        if (prompts.isCancel(val)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        if (typeof val === "string") {
          currentConfig.verifyCommand = val.trim();
        }
      } else if (field === "issueLabel") {
        const val = await prompts.text({
          message: "Enter Issue Label filter:",
          initialValue: currentConfig.issueLabel,
          defaultValue: currentConfig.issueLabel,
        });
        if (prompts.isCancel(val)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        if (typeof val === "string" && val.trim()) {
          currentConfig.issueLabel = val.trim();
        }
      } else if (field === "mode" || field === "executionMode") {
        const modeChoice = await prompts.select({
          message: "Select Execution Mode:",
          options: [
            {
              value: "automatic",
              label: "Automatic (continuous loop)",
              hint: "Run all iterations continuously without pausing (default)",
            },
            {
              value: "interactive",
              label: "Interactive (checkpoint pauses)",
              hint: "Pause after each iteration to inspect and confirm next steps",
            },
          ],
          initialValue: currentConfig.mode,
        });

        if (prompts.isCancel(modeChoice)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }

        if (modeChoice === "automatic" || modeChoice === "interactive") {
          currentConfig.mode = modeChoice;
        }
      } else if (field === "concurrency" || field === "parallelConcurrency") {
        const val = await prompts.text({
          message: "Enter Parallel Concurrency limit (positive integer):",
          initialValue: String(currentConfig.concurrency),
          defaultValue: String(currentConfig.concurrency),
        });
        if (prompts.isCancel(val)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }
        if (typeof val === "string") {
          const parsed = Number(val.trim());
          if (Number.isInteger(parsed) && parsed > 0) {
            currentConfig.concurrency = parsed;
          }
        }
      } else if (field === "implementerEffort") {
        const effortChoice = await prompts.select({
          message: "Select Implementer Reasoning Effort:",
          options: [
            {
              value: "low",
              label: "low (default)",
              hint: "Minimal thinking tokens, safe burst prevention",
            },
            {
              value: "medium",
              label: "medium",
              hint: "Balanced reasoning effort",
            },
            {
              value: "high",
              label: "high",
              hint: "Exhaustive reasoning effort (quota heavy)",
            },
          ],
          initialValue: currentConfig.implementerEffort,
        });

        if (prompts.isCancel(effortChoice)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }

        if (effortChoice === "low" || effortChoice === "medium" || effortChoice === "high") {
          currentConfig.implementerEffort = effortChoice;
        }
      } else if (field === "models") {
        const phase = await prompts.select({
          message: "Select phase model to override:",
          options: [
            {
              value: "planner",
              label: "Planner Model",
              hint: currentConfig.models.planner,
            },
            {
              value: "implementer",
              label: "Implementer Model",
              hint: currentConfig.models.implementer,
            },
            {
              value: "reviewer",
              label: "Reviewer Model",
              hint: currentConfig.models.reviewer,
            },
            {
              value: "merger",
              label: "Merger Model",
              hint: currentConfig.models.merger,
            },
            {
              value: "back",
              label: "< Back",
              hint: "Return without modifying models",
            },
          ],
        });

        if (prompts.isCancel(phase)) {
          prompts.cancel("Execution aborted by operator. Zero changes applied.");
          if (options.onCancel) options.onCancel();
          return { action: "cancel", config: currentConfig };
        }

        if (typeof phase === "string" && phase !== "back") {
          const initial = currentConfig.models[phase as keyof PhaseModels];

          const modelVal = await prompts.text({
            message: `Enter model identifier for ${phase}:`,
            initialValue: initial,
            defaultValue: initial,
          });

          if (prompts.isCancel(modelVal)) {
            prompts.cancel("Execution aborted by operator. Zero changes applied.");
            if (options.onCancel) options.onCancel();
            return { action: "cancel", config: currentConfig };
          }

          if (typeof modelVal === "string" && modelVal.trim()) {
            const modelIdentifier = modelVal.trim();
            currentConfig.models = {
              ...currentConfig.models,
              [phase as keyof PhaseModels]: modelIdentifier,
            };
          }
        }
      }

      prompts.note(
        formatPreRunSummary(currentConfig),
        "Updated Pre-Run Configuration",
      );
      continue;
    }
  }
}
