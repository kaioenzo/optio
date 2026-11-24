import { describe, it, expect } from "vitest";
import { parseGeminiEvent } from "./gemini-event-parser.js";

const TASK_ID = "test-task-789";

describe("parseGeminiEvent", () => {
  it("parses init event with session ID and model", () => {
    const line = JSON.stringify({
      type: "init",
      session_id: "sess-abc-123",
      model: "gemini-2.5-pro",
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.sessionId).toBe("sess-abc-123");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("system");
    expect(result.entries[0].content).toContain("gemini-2.5-pro");
    expect(result.entries[0].metadata?.model).toBe("gemini-2.5-pro");
  });

  it("parses system message", () => {
    const line = JSON.stringify({
      type: "message",
      role: "system",
      content: "You are a coding assistant.",
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("system");
    expect(result.entries[0].content).toBe("You are a coding assistant.");
  });

  it("parses assistant text message", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "I will fix this bug.",
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("text");
    expect(result.entries[0].content).toBe("I will fix this bug.");
  });

  it("parses assistant message with array content", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Part 1" },
        { type: "text", text: "Part 2" },
      ],
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("text");
    expect(result.entries[0].content).toBe("Part 1\nPart 2");
  });

  it("parses tool_use event", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "shell",
      call_id: "call-1",
      arguments: JSON.stringify({ command: "git status" }),
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("tool_use");
    expect(result.entries[0].content).toBe("$ git status");
    expect(result.entries[0].metadata?.toolName).toBe("shell");
    expect(result.entries[0].metadata?.toolUseId).toBe("call-1");
  });

  it("parses tool_use with read_file", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "read_file",
      arguments: { path: "/src/main.ts" },
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Read /src/main.ts");
  });

  it("parses tool_use with write_file", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "write_file",
      arguments: { path: "/src/new.ts" },
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Write /src/new.ts");
  });

  it("parses tool_use with edit_file", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "replace_in_file",
      arguments: { path: "/src/main.ts" },
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Edit /src/main.ts");
  });

  it("parses tool_result event", () => {
    const line = JSON.stringify({
      type: "tool_result",
      call_id: "call-1",
      output: "On branch main\nnothing to commit",
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("tool_result");
    expect(result.entries[0].content).toContain("On branch main");
  });

  it("truncates long tool_result output", () => {
    const longOutput = "x".repeat(500);
    const line = JSON.stringify({
      type: "tool_result",
      call_id: "call-1",
      output: longOutput,
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries[0].content.length).toBeLessThan(400);
    expect(result.entries[0].content).toContain("\u2026");
  });

  it("parses error event", () => {
    const line = JSON.stringify({
      type: "error",
      message: "API key is invalid",
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("error");
    expect(result.entries[0].content).toBe("API key is invalid");
  });

  it("parses result event with per-model stats", () => {
    const line = JSON.stringify({
      type: "result",
      stats: {
        "gemini-2.5-pro": { input_tokens: 5000, output_tokens: 2000 },
      },
      turn_count: 10,
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("info");
    expect(result.entries[0].content).toContain("5000 input tokens");
    expect(result.entries[0].content).toContain("2000 output tokens");
    expect(result.entries[0].content).toContain("10 turns");
    expect(result.entries[0].metadata?.inputTokens).toBe(5000);
    expect(result.entries[0].metadata?.outputTokens).toBe(2000);
  });

  it("handles non-JSON lines as raw text", () => {
    const result = parseGeminiEvent("[optio] Running Google Gemini...", TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("text");
    expect(result.entries[0].content).toBe("[optio] Running Google Gemini...");
  });

  it("strips terminal control sequences", () => {
    const result = parseGeminiEvent("\x1b[32mgreen text\x1b[0m\r", TASK_ID);
    expect(result.entries[0].content).toBe("green text");
  });

  it("skips empty lines", () => {
    expect(parseGeminiEvent("", TASK_ID).entries).toHaveLength(0);
    expect(parseGeminiEvent("   ", TASK_ID).entries).toHaveLength(0);
  });

  it("skips unknown JSON events", () => {
    const line = JSON.stringify({ type: "stream_delta", data: "partial" });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(0);
  });

  it("extracts session ID from id field as fallback", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Hello",
      id: "session-xyz",
    });
    const result = parseGeminiEvent(line, TASK_ID);
    expect(result.sessionId).toBe("session-xyz");
  });
  describe("Antigravity CLI (agy) events", () => {
    const agy = (event: string, body: Record<string, unknown>) =>
      JSON.stringify({ event, [event]: { conversation_id: "conv-1", ...body } });

    it("takes the session id from the init conversation id", () => {
      const line = JSON.stringify({
        event: "init",
        conversation_id: "conv-1",
        init: {
          cwd: "/workspace",
          tools: [],
          permission_mode: "always-proceed",
          model: "gemini-3.8-flash-medium",
        },
      });
      const result = parseGeminiEvent(line, TASK_ID);
      expect(result.sessionId).toBe("conv-1");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe("system");
      expect(result.entries[0].metadata?.model).toBe("gemini-3.8-flash-medium");
    });

    it("logs a step's text delta with the session id", () => {
      const result = parseGeminiEvent(
        agy("step_update", {
          step_index: 1,
          state: "DONE",
          step_type: "agent_response",
          text_delta: "O E-APA é uma plataforma.",
        }),
        TASK_ID,
      );
      expect(result.sessionId).toBe("conv-1");
      expect(result.entries.map((e) => [e.type, e.content])).toEqual([
        ["text", "O E-APA é uma plataforma."],
      ]);
    });

    it("logs a tool step by name and arguments when present", () => {
      const result = parseGeminiEvent(
        agy("step_update", {
          step_type: "tool_call",
          state: "DONE",
          tool_info: { name: "read_file", arguments: { path: "README.md" } },
        }),
        TASK_ID,
      );
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe("tool_use");
      expect(result.entries[0].content).toBe("Read README.md");
      expect(result.entries[0].metadata?.toolName).toBe("read_file");
    });

    it("keeps an unknown tool payload visible instead of dropping it", () => {
      const result = parseGeminiEvent(
        agy("step_update", {
          step_type: "tool_call",
          tool_info: { kind: "view", target: "README.md" },
        }),
        TASK_ID,
      );
      expect(result.entries[0].type).toBe("tool_use");
      expect(result.entries[0].content).toContain("README.md");
    });

    it("reads agy's PascalCase tool parameters", () => {
      const run = parseGeminiEvent(
        agy("step_update", {
          tool_info: { name: "run_command", parameters: { CommandLine: "glab mr list --all" } },
        }),
        TASK_ID,
      );
      const read = parseGeminiEvent(
        agy("step_update", {
          tool_info: {
            name: "read_file",
            parameters: { Path: "/workspace/README.md", StartLine: 1 },
          },
        }),
        TASK_ID,
      );
      expect(run.entries[0].content).toBe("$ glab mr list --all");
      expect(read.entries[0].content).toBe("Read /workspace/README.md");
    });

    it("logs a finished tool as its result, not a second call", () => {
      const result = parseGeminiEvent(
        agy("step_update", {
          tool_info: {
            name: "read_file",
            parameters: { Path: "README.md" },
            output: "168 lines, 9342 bytes",
          },
        }),
        TASK_ID,
      );
      expect(result.entries.map((e) => [e.type, e.content])).toEqual([
        ["tool_result", "168 lines, 9342 bytes"],
      ]);
    });

    it("turns the plan tool into one line", () => {
      const steps = [
        { status: "done", title: "Check MR and read task" },
        { status: "skipped", title: "Open Merge Request" },
      ];
      const result = parseGeminiEvent(
        agy("step_update", { tool_info: { name: "update_steps", parameters: { steps } } }),
        TASK_ID,
      );
      expect(result.entries.map((e) => [e.type, e.content])).toEqual([
        ["info", "Plan: Check MR and read task (done) · Open Merge Request (skipped)"],
      ]);
    });

    it("skips empty step updates but still reports the session", () => {
      const result = parseGeminiEvent(
        agy("step_update", { step_type: "planning", state: "RUNNING", text_delta: "  " }),
        TASK_ID,
      );
      expect(result.entries).toEqual([]);
      expect(result.sessionId).toBe("conv-1");
    });

    it("summarizes a successful result's cumulative usage", () => {
      const result = parseGeminiEvent(
        agy("result", {
          status: "SUCCESS",
          response: "ok",
          num_turns: 3,
          usage: { input_tokens: 25528, output_tokens: 1830 },
        }),
        TASK_ID,
      );
      expect(result.entries.map((e) => e.type)).toEqual(["info"]);
      expect(result.entries[0].content).toBe(
        "Result: 25528 input tokens · 1830 output tokens · 3 turns",
      );
      expect(result.entries[0].metadata?.inputTokens).toBe(25528);
    });

    it("logs a failed result's error", () => {
      const result = parseGeminiEvent(
        agy("result", { status: "ERROR", error: "authentication failed or timed out" }),
        TASK_ID,
      );
      expect(result.entries.map((e) => [e.type, e.content])).toEqual([
        ["error", "authentication failed or timed out"],
      ]);
    });
  });
});
