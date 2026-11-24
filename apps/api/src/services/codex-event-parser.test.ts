import { describe, it, expect } from "vitest";
import { parseCodexEvent } from "./codex-event-parser.js";

const TASK_ID = "test-task-456";

describe("parseCodexEvent", () => {
  it("parses system message", () => {
    const line = JSON.stringify({
      type: "message",
      role: "system",
      content: "You are a coding assistant.",
    });
    const result = parseCodexEvent(line, TASK_ID);
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
    const result = parseCodexEvent(line, TASK_ID);
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
        { type: "output_text", text: "Part 2" },
      ],
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("text");
    expect(result.entries[0].content).toBe("Part 1\nPart 2");
  });

  it("parses function call (shell)", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "shell",
      call_id: "call-1",
      arguments: JSON.stringify({ command: "git status" }),
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("tool_use");
    expect(result.entries[0].content).toBe("$ git status");
    expect(result.entries[0].metadata?.toolName).toBe("shell");
    expect(result.entries[0].metadata?.toolUseId).toBe("call-1");
  });

  it("parses function call (read_file)", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "read_file",
      arguments: { path: "/src/main.ts" },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Read /src/main.ts");
  });

  it("parses function call (write_file)", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "write_file",
      arguments: { path: "/src/new.ts" },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Write /src/new.ts");
  });

  it("parses function call (edit_file)", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "apply_diff",
      arguments: { path: "/src/main.ts" },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Edit /src/main.ts");
  });

  it("parses function call output", () => {
    const line = JSON.stringify({
      type: "function_call_output",
      call_id: "call-1",
      output: "On branch main\nnothing to commit",
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("tool_result");
    expect(result.entries[0].content).toContain("On branch main");
  });

  it("truncates long function call output", () => {
    const longOutput = "x".repeat(500);
    const line = JSON.stringify({
      type: "function_call_output",
      call_id: "call-1",
      output: longOutput,
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].content.length).toBeLessThan(400);
    expect(result.entries[0].content).toContain("\u2026");
  });

  it("parses error event", () => {
    const line = JSON.stringify({
      type: "error",
      message: "API key is invalid",
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("error");
    expect(result.entries[0].content).toBe("API key is invalid");
  });

  it("parses reasoning event as thinking", () => {
    const line = JSON.stringify({
      type: "reasoning",
      content: "Let me analyze this code...",
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("thinking");
    expect(result.entries[0].content).toBe("Let me analyze this code...");
  });

  it("extracts session ID from event", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Hello",
      id: "session-abc",
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.sessionId).toBe("session-abc");
  });

  it("handles non-JSON lines as raw text", () => {
    const result = parseCodexEvent("[optio] Running OpenAI Codex...", TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("text");
    expect(result.entries[0].content).toBe("[optio] Running OpenAI Codex...");
  });

  it("strips terminal control sequences", () => {
    const result = parseCodexEvent("\x1b[32mgreen text\x1b[0m\r", TASK_ID);
    expect(result.entries[0].content).toBe("green text");
  });

  it("skips empty lines", () => {
    expect(parseCodexEvent("", TASK_ID).entries).toHaveLength(0);
    expect(parseCodexEvent("   ", TASK_ID).entries).toHaveLength(0);
  });

  it("parses usage data in message event", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Done",
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const result = parseCodexEvent(line, TASK_ID);
    // Should have text entry + info entry for usage
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
    const infoEntry = result.entries.find((e) => e.type === "info");
    expect(infoEntry).toBeDefined();
    expect(infoEntry?.content).toContain("1000 input tokens");
    expect(infoEntry?.metadata?.inputTokens).toBe(1000);
  });

  it("parses standalone usage event", () => {
    const line = JSON.stringify({
      usage: { prompt_tokens: 2000, completion_tokens: 1000 },
      total_cost_usd: 0.05,
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("info");
    expect(result.entries[0].content).toContain("$0.0500");
  });

  it("skips unknown JSON events", () => {
    const line = JSON.stringify({ type: "stream_delta", data: "partial" });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(0);
  });

  it("takes the thread id of thread.started as the session", () => {
    const line = JSON.stringify({ type: "thread.started", thread_id: "01a2-thread" });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.sessionId).toBe("01a2-thread");
    expect(result.entries).toHaveLength(0);
  });

  it("parses an agent_message item as text", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "Vou ler o repositório." },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("text");
    expect(result.entries[0].content).toBe("Vou ler o repositório.");
  });

  it("parses a started command_execution as a tool use", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "/bin/bash -lc 'ls'",
        status: "in_progress",
      },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("tool_use");
    expect(result.entries[0].content).toBe("$ /bin/bash -lc 'ls'");
    expect(result.entries[0].metadata?.toolUseId).toBe("item_1");
  });

  it("parses a completed command_execution as a result with its exit code", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "false",
        aggregated_output: "boom",
        exit_code: 1,
        status: "failed",
      },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("tool_result");
    expect(result.entries[0].content).toBe("exit 1\nboom");
  });

  it("parses an mcp_tool_call item", () => {
    const started = parseCodexEvent(
      JSON.stringify({
        type: "item.started",
        item: {
          id: "item_2",
          type: "mcp_tool_call",
          server: "graphify",
          tool: "query_graph",
          arguments: {},
        },
      }),
      TASK_ID,
    );
    expect(started.entries[0].content).toBe("graphify__query_graph");
    const done = parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "mcp_tool_call",
          server: "graphify",
          tool: "query_graph",
          result: { content: "ok" },
        },
      }),
      TASK_ID,
    );
    expect(done.entries[0].type).toBe("tool_result");
  });

  it("parses a completed file_change item", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_3", type: "file_change", changes: [{ path: "a.java", kind: "update" }] },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].content).toBe("Edit update a.java");
  });

  it("parses turn.failed as an error", () => {
    const line = JSON.stringify({ type: "turn.failed", error: { message: "rate limited" } });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].type).toBe("error");
    expect(result.entries[0].content).toBe("rate limited");
  });

  it("reports the usage of turn.completed", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 5 },
    });
    const result = parseCodexEvent(line, TASK_ID);
    expect(result.entries[0].content).toContain("120 input tokens");
  });
});
