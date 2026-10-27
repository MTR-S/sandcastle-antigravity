import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  antigravity,
  parseAntigravityStreamLine,
  resolveRoleModel,
  type AgentRole,
  type RoleModelConfig,
} from "./antigravity.ts";

describe("Antigravity Agent Provider", () => {
  describe("antigravity factory", () => {
    test("creates provider with default configuration", () => {
      const provider = antigravity();
      assert.equal(provider.name, "antigravity");
      assert.equal(provider.captureSessions, false);
      assert.deepEqual(provider.env, {});
    });

    test("passes custom env options", () => {
      const provider = antigravity("gemini-2.5-pro", {
        env: { GEMINI_API_KEY: "secret" },
      });
      assert.equal(provider.env.GEMINI_API_KEY, "secret");
    });
  });

  describe("buildPrintCommand", () => {
    test("builds headless non-interactive command streaming prompt via stdin", () => {
      const provider = antigravity();
      const printCmd = provider.buildPrintCommand({
        prompt: "Refactor the module",
      });

      assert.equal(printCmd.stdin, "Refactor the module");
      assert.match(printCmd.command, /^agy\b/);
      assert.match(printCmd.command, /--input-format text/);
      assert.match(printCmd.command, /--output-format stream-json/);
      assert.match(printCmd.command, /--dangerously-skip-permissions/);
      assert.match(printCmd.command, /--mode accept-edits/);
      assert.doesNotMatch(printCmd.command, /-p -/);
      assert.doesNotMatch(printCmd.command, /Refactor the module/);
    });

    test("includes model and effort flags when configured", () => {
      const provider = antigravity("gemini-2.5-pro", { effort: "high" });
      const printCmd = provider.buildPrintCommand({
        prompt: "Verify types",
      });

      assert.match(printCmd.command, /--model gemini-2.5-pro/);
      assert.match(printCmd.command, /--effort high/);
    });

    test("parses compound model identifier with effort suffix into separate model and effort flags (gemini-4-argon-high)", () => {
      const provider = antigravity("gemini-4-argon-high");
      const printCmd = provider.buildPrintCommand({
        prompt: "Plan implementation",
      });

      assert.match(printCmd.command, /--model gemini-4-argon/);
      assert.match(printCmd.command, /--effort high/);
      assert.doesNotMatch(printCmd.command, /--model gemini-4-argon-high/);
    });

    test("parses compound model identifier with effort suffix (gemini-3.8-flash-high)", () => {
      const provider = antigravity("gemini-3.8-flash-high");
      const printCmd = provider.buildPrintCommand({
        prompt: "Write code",
      });

      assert.match(printCmd.command, /--model gemini-3.8-flash/);
      assert.match(printCmd.command, /--effort high/);
      assert.doesNotMatch(printCmd.command, /--model gemini-3.8-flash-high/);
    });

    test("supports custom mode configuration", () => {
      const provider = antigravity(undefined, { mode: "plan" });
      const printCmd = provider.buildPrintCommand({
        prompt: "Plan tickets",
      });

      assert.match(printCmd.command, /--mode plan/);
    });

    test("respects dangerouslySkipPermissions = false", () => {
      const provider = antigravity();
      const printCmd = provider.buildPrintCommand({
        prompt: "Check permissions",
        dangerouslySkipPermissions: false,
      });

      assert.doesNotMatch(printCmd.command, /--dangerously-skip-permissions/);
    });
  });

  describe("phase-specific role model configuration", () => {
    const roles: AgentRole[] = ["planner", "implementer", "reviewer", "merger"];

    test("configures dedicated models for each role when role-specific models are provided", () => {
      const roleModels: RoleModelConfig = {
        planner: "gemini-4-argon-high",
        implementer: "gemini-3.8-flash-high",
        reviewer: "gemini-3.8-flash-medium",
        merger: "gemini-4-argon-high",
      };

      const expected: Record<AgentRole, { model: string; effort: string }> = {
        planner: { model: "gemini-4-argon", effort: "high" },
        implementer: { model: "gemini-3.8-flash", effort: "high" },
        reviewer: { model: "gemini-3.8-flash", effort: "medium" },
        merger: { model: "gemini-4-argon", effort: "high" },
      };

      for (const role of roles) {
        const provider = antigravity({ role, roleModels });
        const cmd = provider.buildPrintCommand({ prompt: `Run ${role}` });

        assert.match(
          cmd.command,
          new RegExp(`--model ${expected[role].model}`),
          `${role} should configure --model ${expected[role].model}`,
        );
        assert.match(
          cmd.command,
          new RegExp(`--effort ${expected[role].effort}`),
          `${role} should configure --effort ${expected[role].effort}`,
        );
      }
    });

    test("falls back to AGENT_MODEL for every role when role-specific models are omitted", () => {
      const env = { AGENT_MODEL: "gemini-3.8-flash-high" };

      for (const role of roles) {
        const provider = antigravity({ role, env });
        const cmd = provider.buildPrintCommand({ prompt: `Run ${role}` });

        assert.match(
          cmd.command,
          /--model gemini-3.8-flash/,
          `${role} should fall back to AGENT_MODEL`,
        );
        assert.match(
          cmd.command,
          /--effort high/,
          `${role} should inherit AGENT_MODEL effort`,
        );
      }
    });

    test("resolves role models from environment variables with AGENT_MODEL fallback", () => {
      const env: Record<string, string> = {
        PLANNER_MODEL: "gemini-4-argon-high",
        IMPLEMENTER_MODEL: "gemini-3.8-flash-high",
        AGENT_MODEL: "gemini-3.8-flash-low",
      };

      // Roles with specific env vars
      const plannerProvider = antigravity({ role: "planner", env });
      const plannerCmd = plannerProvider.buildPrintCommand({ prompt: "plan" });
      assert.match(plannerCmd.command, /--model gemini-4-argon/);
      assert.match(plannerCmd.command, /--effort high/);

      const implProvider = antigravity({ role: "implementer", env });
      const implCmd = implProvider.buildPrintCommand({ prompt: "code" });
      assert.match(implCmd.command, /--model gemini-3.8-flash/);
      assert.match(implCmd.command, /--effort high/);

      // Roles without specific env vars fall back to AGENT_MODEL
      const reviewerProvider = antigravity({ role: "reviewer", env });
      const reviewerCmd = reviewerProvider.buildPrintCommand({ prompt: "review" });
      assert.match(reviewerCmd.command, /--model gemini-3.8-flash/);
      assert.match(reviewerCmd.command, /--effort low/);

      const mergerProvider = antigravity({ role: "merger", env });
      const mergerCmd = mergerProvider.buildPrintCommand({ prompt: "merge" });
      assert.match(mergerCmd.command, /--model gemini-3.8-flash/);
      assert.match(mergerCmd.command, /--effort low/);
    });

    test("explicit model argument overrides role configuration", () => {
      const provider = antigravity("gemini-3.8-flash-low", {
        role: "planner",
        roleModels: { planner: "gemini-4-argon-high" },
      });
      const cmd = provider.buildPrintCommand({ prompt: "plan" });

      assert.match(cmd.command, /--model gemini-3.8-flash/);
      assert.match(cmd.command, /--effort low/);
    });
  });

  describe("parseAntigravityStreamLine", () => {
    test("parses init event to extract session_id", () => {
      const line = JSON.stringify({
        event: "init",
        conversation_id: "conv-456",
        init: { cwd: "/app" },
      });

      const events = parseAntigravityStreamLine(line);
      assert.deepEqual(events, [
        { type: "session_id", sessionId: "conv-456" },
      ]);
    });

    test("parses init event with nested conversation_id", () => {
      const line = JSON.stringify({
        event: "init",
        init: { conversation_id: "conv-789" },
      });

      const events = parseAntigravityStreamLine(line);
      assert.deepEqual(events, [
        { type: "session_id", sessionId: "conv-789" },
      ]);
    });

    test("parses step_update text delta", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          delta: "Analyzing files...",
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.deepEqual(events, [
        { type: "text", text: "Analyzing files..." },
      ]);
    });

    test("parses real agy step_update with text_delta", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-123",
          step_index: 1,
          state: "ACTIVE",
          step_type: "agent_response",
          text_delta: "Hello! <promise>COMPLETE</promise>",
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.deepEqual(events, [
        { type: "text", text: "Hello! <promise>COMPLETE</promise>" },
      ]);
    });

    test("parses real agy step_update tool invocation with tool_info", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-123",
          step_index: 2,
          state: "ACTIVE",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "echo test-run" },
          },
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.type, "tool_call");
      assert.equal(events[0]?.name, "run_command");
      assert.equal(events[0]?.args, JSON.stringify({ CommandLine: "echo test-run" }));
    });

    test("parses real agy step_update tool completion with output", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-123",
          step_index: 2,
          state: "DONE",
          step_type: "tool",
          tool_name: "run_command",
          duration_seconds: 0.63,
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "echo test-run" },
            output: "Command exited with code 0.",
          },
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.equal(events.length, 2);
      assert.equal(events[0]?.type, "tool_call");
      assert.deepEqual(events[1], {
        type: "text",
        text: "Command exited with code 0.",
      });
    });

    test("parses step_update with multiple tool_calls", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          tool_calls: [
            { name: "read_file", args: { path: "a.txt" } },
            { name: "write_file", args: { path: "b.txt" } },
          ],
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.equal(events.length, 2);
      assert.equal(events[0]?.type, "tool_call");
      assert.equal(events[1]?.type, "tool_call");
    });

    test("parses step_update with single tool_call object", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          tool_call: {
            name: "run_command",
            arguments: "mvn clean test",
          },
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.deepEqual(events, [
        { type: "tool_call", name: "run_command", args: "mvn clean test" },
      ]);
    });

    test("parses step_update tool response", () => {
      const line = JSON.stringify({
        event: "step_update",
        step_update: {
          tool_response: "BUILD SUCCESS",
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.deepEqual(events, [
        { type: "text", text: "BUILD SUCCESS" },
      ]);
    });

    test("parses result event with usage metrics", () => {
      const line = JSON.stringify({
        event: "result",
        result: "Task completed successfully",
        usage: {
          input_tokens: 1500,
          output_tokens: 250,
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.equal(events.length, 2);
      assert.deepEqual(events[0], {
        type: "result",
        result: "Task completed successfully",
      });
      assert.deepEqual(events[1], {
        type: "usage",
        usage: {
          inputTokens: 1500,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 250,
        },
      });
    });

    test("parses real agy result event with object-wrapped response and usage", () => {
      const line = JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-123",
          status: "SUCCESS",
          response: "<plan>\n{\"issues\": []}\n</plan>",
          duration_seconds: 4.5,
          num_turns: 1,
          usage: {
            input_tokens: 2000,
            output_tokens: 100,
            thinking_tokens: 50,
            cache_read_tokens: 500,
            total_tokens: 2650,
          },
        },
      });

      const events = parseAntigravityStreamLine(line);
      assert.equal(events.length, 2);
      assert.deepEqual(events[0], {
        type: "result",
        result: "<plan>\n{\"issues\": []}\n</plan>",
      });
      assert.deepEqual(events[1], {
        type: "usage",
        usage: {
          inputTokens: 2000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 100,
        },
      });
    });

    test("safely ignores non-json, malformed lines, or unrelated logs", () => {
      assert.deepEqual(parseAntigravityStreamLine(""), []);
      assert.deepEqual(parseAntigravityStreamLine("    "), []);
      assert.deepEqual(parseAntigravityStreamLine("INFO: Starting agy..."), []);
      assert.deepEqual(parseAntigravityStreamLine("{ malformed json"), []);
      assert.deepEqual(
        parseAntigravityStreamLine(JSON.stringify({ event: "unknown_event" })),
        [],
      );
    });
  });
});
