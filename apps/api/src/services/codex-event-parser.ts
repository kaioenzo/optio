import type { AgentLogEntry } from "@optio/shared";

/**
 * Parse a single NDJSON line from the Codex CLI's --json output.
 *
 * Codex outputs events as one JSON object per line:
 * - { type: "message", role: "assistant"|"system", content: "..." }
 * - { type: "function_call", name: "shell"|"...", call_id: "...", arguments: "..." }
 * - { type: "function_call_output", call_id: "...", output: "..." }
 * - { type: "error", message: "..." }
 * - Events with usage data (input_tokens, output_tokens)
 *
 * Codex 0.160 and later speak thread events instead: `thread.started`,
 * `turn.started`, `item.started` / `item.completed` (agent_message, reasoning,
 * command_execution, mcp_tool_call, file_change, web_search, error),
 * `turn.completed` with usage, and `turn.failed`.
 *
 * Returns multiple entries per line when a message contains structured content.
 */
export function parseCodexEvent(
  line: string,
  taskId: string,
): { entries: AgentLogEntry[]; sessionId?: string; isTerminal?: boolean } {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    // Not JSON — raw text from shell/git
    if (!line.trim()) return { entries: [] };
    const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]|\r/g, "").trim();
    if (!clean || clean.length < 2) return { entries: [] };
    return {
      entries: [{ taskId, timestamp: new Date().toISOString(), type: "text", content: clean }],
    };
  }

  const timestamp = new Date().toISOString();
  const entries: AgentLogEntry[] = [];

  // Extract session/conversation ID if present
  const sessionId = (event.id ?? event.session_id ?? event.conversation_id) as string | undefined;

  // System message or init
  if (event.type === "message" && event.role === "system") {
    const content =
      typeof event.content === "string" ? event.content : JSON.stringify(event.content);
    if (content?.trim()) {
      entries.push({
        taskId,
        timestamp,
        sessionId,
        type: "system",
        content,
      });
    }
    return { entries, sessionId };
  }

  // Assistant message
  if (event.type === "message" && event.role === "assistant") {
    const content =
      typeof event.content === "string"
        ? event.content
        : Array.isArray(event.content)
          ? event.content
              .map((block: any) => {
                if (typeof block === "string") return block;
                if (block.type === "text") return block.text;
                if (block.type === "output_text") return block.text;
                return "";
              })
              .filter(Boolean)
              .join("\n")
          : "";
    if (content?.trim()) {
      entries.push({
        taskId,
        timestamp,
        sessionId,
        type: "text",
        content,
      });
    }

    // Check for usage data in the message event
    const usage = event.usage ?? event.response?.usage;
    if (usage) {
      const meta: string[] = [];
      const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
      if (inputTokens) meta.push(`${inputTokens} input tokens`);
      if (outputTokens) meta.push(`${outputTokens} output tokens`);
      if (event.total_cost_usd) meta.push(`$${event.total_cost_usd.toFixed(4)}`);
      if (meta.length) {
        entries.push({
          taskId,
          timestamp,
          sessionId,
          type: "info",
          content: `Usage: ${meta.join(" · ")}`,
          metadata: {
            inputTokens,
            outputTokens,
            cost: event.total_cost_usd,
          },
        });
      }
    }
    return { entries, sessionId };
  }

  // Function call (tool use)
  if (event.type === "function_call") {
    const args = parseArgs(event.arguments);
    const formatted = formatCodexToolUse(event.name, args);
    entries.push({
      taskId,
      timestamp,
      sessionId,
      type: "tool_use",
      content: formatted,
      metadata: {
        toolName: event.name,
        toolInput: args,
        toolUseId: event.call_id,
      },
    });
    return { entries, sessionId };
  }

  // Function call output (tool result)
  if (event.type === "function_call_output") {
    const output = typeof event.output === "string" ? event.output : JSON.stringify(event.output);
    const trimmed = output.length > 300 ? output.slice(0, 300) + "…" : output;
    if (trimmed.trim()) {
      entries.push({
        taskId,
        timestamp,
        sessionId,
        type: "tool_result",
        content: trimmed,
        metadata: { toolUseId: event.call_id },
      });
    }
    return { entries, sessionId };
  }

  // Error event
  if (event.type === "error") {
    const msg = event.message ?? event.error ?? JSON.stringify(event);
    entries.push({
      taskId,
      timestamp,
      sessionId,
      type: "error",
      content: msg,
    });
    return { entries, sessionId };
  }

  // Reasoning/thinking event (some Codex models output this)
  if (event.type === "reasoning") {
    const content = typeof event.content === "string" ? event.content : "";
    if (content.trim()) {
      entries.push({
        taskId,
        timestamp,
        sessionId,
        type: "thinking",
        content,
      });
    }
    return { entries, sessionId };
  }

  if (event.type === "thread.started") {
    return { entries, sessionId: event.thread_id ?? sessionId };
  }

  if (event.type === "turn.failed") {
    const msg = event.error?.message ?? JSON.stringify(event.error ?? event);
    entries.push({ taskId, timestamp, sessionId, type: "error", content: msg });
    return { entries, sessionId };
  }

  if ((event.type === "item.started" || event.type === "item.completed") && event.item) {
    entries.push(...parseCodexItem(event.type === "item.completed", event.item, taskId, timestamp));
    return { entries, sessionId };
  }

  // Generic event with usage data (summary)
  if (event.usage || event.response?.usage) {
    const usage = event.usage ?? event.response.usage;
    const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
    const meta: string[] = [];
    if (inputTokens) meta.push(`${inputTokens} input tokens`);
    if (outputTokens) meta.push(`${outputTokens} output tokens`);
    if (event.total_cost_usd) meta.push(`$${event.total_cost_usd.toFixed(4)}`);
    if (meta.length) {
      entries.push({
        taskId,
        timestamp,
        sessionId,
        type: "info",
        content: `Usage: ${meta.join(" · ")}`,
        metadata: {
          inputTokens,
          outputTokens,
          cost: event.total_cost_usd,
        },
      });
    }
    return { entries, sessionId };
  }

  // Unknown JSON event — skip
  return { entries: [], sessionId };
}

function parseCodexItem(
  completed: boolean,
  item: any,
  taskId: string,
  timestamp: string,
): AgentLogEntry[] {
  const entry = (
    type: AgentLogEntry["type"],
    content: string,
    metadata?: Record<string, unknown>,
  ): AgentLogEntry[] => (content.trim() ? [{ taskId, timestamp, type, content, metadata }] : []);

  switch (item.type) {
    case "agent_message":
      return completed ? entry("text", String(item.text ?? "")) : [];
    case "reasoning":
      return completed ? entry("thinking", String(item.text ?? "")) : [];
    case "command_execution": {
      const command = String(item.command ?? "");
      if (!completed) {
        return entry("tool_use", formatCodexToolUse("shell", { command }), {
          toolName: "shell",
          toolInput: { command },
          toolUseId: item.id,
        });
      }
      const output = String(item.aggregated_output ?? "").trim();
      const status = item.exit_code != null && item.exit_code !== 0 ? `exit ${item.exit_code}` : "";
      return entry("tool_result", clip([status, output].filter(Boolean).join("\n") || "done"), {
        toolUseId: item.id,
      });
    }
    case "mcp_tool_call": {
      const name = `${item.server ?? "mcp"}__${item.tool ?? ""}`;
      if (!completed) {
        return entry("tool_use", name, {
          toolName: name,
          toolInput: item.arguments,
          toolUseId: item.id,
        });
      }
      const text = item.error?.message ?? JSON.stringify(item.result?.content ?? item.result ?? "");
      return entry("tool_result", clip(String(text)), { toolUseId: item.id });
    }
    case "file_change": {
      if (!completed) return [];
      const files = (item.changes ?? [])
        .map((c: any) => `${c.kind ?? "edit"} ${c.path ?? ""}`.trim())
        .join(", ");
      return entry("tool_use", `Edit ${files}`, { toolName: "apply_patch", toolUseId: item.id });
    }
    case "web_search":
      return completed
        ? []
        : entry("tool_use", `Search: ${item.query ?? ""}`, { toolUseId: item.id });
    case "error":
      return entry("error", String(item.message ?? ""));
    default:
      return [];
  }
}

function clip(text: string): string {
  return text.length > 300 ? text.slice(0, 300) + "…" : text;
}

/** Parse function call arguments (may be a JSON string or object) */
function parseArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args) return undefined;
  if (typeof args === "object") return args as Record<string, unknown>;
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }
  return undefined;
}

/** Format a Codex tool use into a concise human-readable string */
function formatCodexToolUse(name: string, args: Record<string, unknown> | undefined): string {
  if (!name) return "unknown tool";
  if (!args) return name;

  switch (name) {
    case "shell":
    case "bash":
    case "terminal":
      return `$ ${String(args.command ?? args.cmd ?? "")
        .split("\n")[0]
        .slice(0, 120)}`;
    case "read_file":
    case "readFile":
      return `Read ${args.path ?? args.file_path ?? ""}`;
    case "write_file":
    case "writeFile":
    case "create_file":
      return `Write ${args.path ?? args.file_path ?? ""}`;
    case "edit_file":
    case "editFile":
    case "apply_diff":
      return `Edit ${args.path ?? args.file_path ?? ""}`;
    case "search":
    case "grep":
      return `Search: ${args.query ?? args.pattern ?? ""}`;
    case "list_dir":
    case "listDir":
      return `List ${args.path ?? args.dir ?? "."}`;
    default:
      return name;
  }
}
