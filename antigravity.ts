/**
 * Antigravity Agent Provider for Sandcastle.
 *
 * Implements the Sandcastle AgentProvider contract to orchestrate headless
 * runs of the Google Antigravity CLI (`agy`).
 */

export type AgentRole = "planner" | "implementer" | "reviewer" | "merger";

export interface RoleModelConfig {
  readonly planner?: string;
  readonly implementer?: string;
  readonly reviewer?: string;
  readonly merger?: string;
}

export const ROLE_ENV_VARS: Record<AgentRole, string> = {
  planner: "PLANNER_MODEL",
  implementer: "IMPLEMENTER_MODEL",
  reviewer: "REVIEWER_MODEL",
  merger: "MERGER_MODEL",
};

export interface AntigravityOptions {
  /** Optional model identifier (e.g. "gemini-4-argon-high" or "gemini-4-argon") */
  readonly model?: string;
  /** Optional reasoning effort level ("low" | "medium" | "high") */
  readonly effort?: "low" | "medium" | "high";
  /** Execution mode (defaults to "accept-edits") */
  readonly mode?: "accept-edits" | "plan";
  /** Environment variables injected into the agent execution */
  readonly env?: Record<string, string>;
  /** Optional agent role ("planner" | "implementer" | "reviewer" | "merger") */
  readonly role?: AgentRole;
  /** Optional explicit role-to-model configuration mapping */
  readonly roleModels?: RoleModelConfig;
}

export interface PrintCommand {
  readonly command: string;
  readonly stdin?: string;
}

export interface AgentCommandOptions {
  readonly prompt: string;
  readonly dangerouslySkipPermissions?: boolean;
}

export type ParsedStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "result"; readonly result: string }
  | { readonly type: "tool_call"; readonly name: string; readonly args: string }
  | { readonly type: "session_id"; readonly sessionId: string }
  | {
      readonly type: "usage";
      readonly usage: {
        readonly inputTokens: number;
        readonly cacheCreationInputTokens: number;
        readonly cacheReadInputTokens: number;
        readonly outputTokens: number;
      };
    };

export interface AgentProvider {
  readonly name: string;
  readonly env: Record<string, string>;
  readonly captureSessions: boolean;
  buildPrintCommand(options: AgentCommandOptions): PrintCommand;
  parseStreamLine(line: string): ParsedStreamEvent[];
}

function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9_\-\.]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Parses a single NDJSON line emitted by `agy --output-format stream-json`
 * into standardized Sandcastle stream events.
 */
export function parseAntigravityStreamLine(line: string): ParsedStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return [];
  }

  try {
    const data = JSON.parse(trimmed);
    const events: ParsedStreamEvent[] = [];

    // 1. Session initialization / session identifier
    if (data.event === "init" || data.type === "init") {
      const sessionId =
        data.conversation_id ??
        data.session_id ??
        data.sessionId ??
        data.id ??
        data.init?.conversation_id ??
        data.init?.session_id ??
        data.init?.id;

      if (sessionId) {
        events.push({ type: "session_id", sessionId: String(sessionId) });
      }
      return events;
    }

    // 2. Incremental step updates (text chunks and tool calls)
    if (data.event === "step_update" || data.type === "step_update") {
      const update = data.step_update ?? data.update ?? data;

      // Text delta / message
      const text =
        update.text_delta ??
        update.delta ??
        update.text ??
        (typeof update.content === "string" ? update.content : undefined);

      if (typeof text === "string" && text.length > 0) {
        events.push({ type: "text", text });
      }

      // Normalize tool calls / events
      // Format A: update.tool_name & update.tool_info (native agy stream-json)
      if (update.tool_name || update.tool_info?.name) {
        const name = update.tool_name ?? update.tool_info?.name ?? "tool";
        const rawArgs =
          update.tool_info?.parameters ??
          update.tool_info?.arguments ??
          update.parameters ??
          "";
        const args =
          typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);

        events.push({ type: "tool_call", name: String(name), args });
      }
      const rawToolCalls = Array.isArray(update.tool_calls)
        ? update.tool_calls
        : update.tool_call
          ? [update.tool_call]
          : [];

      for (const call of rawToolCalls) {
        if (!call || typeof call !== "object") continue;
        const name =
          call.name ?? call.tool ?? call.function?.name ?? "tool";
        const rawArgs =
          call.arguments ??
          call.args ??
          call.function?.arguments ??
          call.parameters ??
          "";
        const args =
          typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);

        events.push({ type: "tool_call", name: String(name), args });
      }

      // Tool response / execution result
      const toolResult =
        update.tool_info?.output ??
        update.tool_result ??
        update.tool_response;
      if (toolResult) {
        const resultText =
          typeof toolResult === "string"
            ? toolResult
            : JSON.stringify(toolResult);
        events.push({ type: "text", text: resultText });
      }

      return events;
    }

    // 3. Final completion result
    if (data.event === "result" || data.type === "result") {
      const resultObj =
        typeof data.result === "object" && data.result !== null
          ? data.result
          : typeof data.data === "object" && data.data !== null
            ? data.data
            : undefined;

      const resultText =
        typeof data.result === "string"
          ? data.result
          : typeof data.data === "string"
            ? data.data
            : typeof data.output === "string"
              ? data.output
              : typeof resultObj?.response === "string"
                ? resultObj.response
                : typeof resultObj?.text === "string"
                  ? resultObj.text
                  : typeof resultObj?.content === "string"
                    ? resultObj.content
                    : JSON.stringify(data.result ?? data.data ?? data.output ?? "");

      events.push({ type: "result", result: resultText });

      const u =
        (data.usage && typeof data.usage === "object" ? data.usage : undefined) ??
        (resultObj?.usage && typeof resultObj.usage === "object"
          ? resultObj.usage
          : undefined);

      if (u) {
        events.push({
          type: "usage",
          usage: {
            inputTokens: Number(u.inputTokens ?? u.input_tokens ?? 0),
            cacheCreationInputTokens: Number(
              u.cacheCreationInputTokens ?? u.cache_creation_input_tokens ?? 0,
            ),
            cacheReadInputTokens: Number(
              u.cacheReadInputTokens ?? u.cache_read_input_tokens ?? 0,
            ),
            outputTokens: Number(u.outputTokens ?? u.output_tokens ?? 0),
          },
        });
      }

      return events;
    }

    return events;
  } catch {
    // Malformed line or JSON parse error safely ignored
    return [];
  }
}

export interface ParsedModelConfig {
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high";
}

/**
 * Parses a model identifier string which may include an effort suffix
 * (e.g. "gemini-4-argon-high", "gemini-3.8-flash-high", "gemini-3.8-flash-medium").
 *
 * @param modelIdentifier Raw model identifier
 * @param fallbackEffort Fallback reasoning effort if not embedded in the model name
 */
export function parseModelIdentifier(
  modelIdentifier?: string,
  fallbackEffort?: "low" | "medium" | "high",
): ParsedModelConfig {
  if (!modelIdentifier) {
    return { model: undefined, effort: fallbackEffort };
  }

  const trimmed = modelIdentifier.trim();
  const match = trimmed.match(/^(.*?)-(low|medium|high)$/i);
  if (match) {
    return {
      model: match[1],
      effort: match[2].toLowerCase() as "low" | "medium" | "high",
    };
  }

  return {
    model: trimmed,
    effort: fallbackEffort,
  };
}

/**
 * Resolves the appropriate model identifier for a given agent role,
 * checking role models, role environment variables,
 * and finally the global AGENT_MODEL environment variable.
 */
export function resolveRoleModel(
  options?: AntigravityOptions,
): string | undefined {
  const env = options?.env;
  const lookupEnv = (key: string): string | undefined =>
    env?.[key] ??
    (typeof process !== "undefined" ? process.env?.[key] : undefined);

  if (options?.role) {
    const fromRoleModels = options.roleModels?.[options.role];
    if (fromRoleModels) return fromRoleModels;

    const envVar = ROLE_ENV_VARS[options.role];
    const fromEnv = lookupEnv(envVar);
    if (fromEnv) return fromEnv;
  }

  return lookupEnv("AGENT_MODEL");
}

/**
 * Factory creating an Antigravity Agent Provider for Sandcastle.
 *
 * Supports dynamic model assignment, role-scoped configurations, and effort levels.
 *
 * @param modelOrOptions Model identifier or AntigravityOptions configuration
 * @param maybeOptions Configuration options when model is passed as first argument
 */
export function antigravity(options?: AntigravityOptions): AgentProvider;
export function antigravity(
  model?: string,
  options?: AntigravityOptions,
): AgentProvider;
export function antigravity(
  modelOrOptions?: string | AntigravityOptions,
  maybeOptions?: AntigravityOptions,
): AgentProvider {
  const options =
    typeof modelOrOptions === "object" && modelOrOptions !== null
      ? modelOrOptions
      : maybeOptions;

  const explicitModel =
    typeof modelOrOptions === "string" ? modelOrOptions : options?.model;

  const resolvedModelRaw = explicitModel ?? resolveRoleModel(options);

  const parsed = parseModelIdentifier(resolvedModelRaw, options?.effort);
  const activeModel = parsed.model;
  const effort = parsed.effort;
  const mode = options?.mode ?? "accept-edits";

  return {
    name: "antigravity",
    env: options?.env ?? {},
    captureSessions: false,

    buildPrintCommand(commandOptions: AgentCommandOptions): PrintCommand {
      const parts = [
        "agy",
        "--input-format text",
        "--output-format stream-json",
      ];

      if (commandOptions.dangerouslySkipPermissions !== false) {
        parts.push("--dangerously-skip-permissions");
      }

      parts.push(`--mode ${shellEscape(mode)}`);

      if (activeModel) {
        parts.push(`--model ${shellEscape(activeModel)}`);
      }

      if (effort) {
        parts.push(`--effort ${shellEscape(effort)}`);
      }

      return {
        command: parts.join(" "),
        stdin: commandOptions.prompt,
      };
    },

    parseStreamLine(line: string): ParsedStreamEvent[] {
      return parseAntigravityStreamLine(line);
    },
  };
}
