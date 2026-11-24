import type { AgentLogEntry } from "@optio/shared";

/**
 * Parse a single NDJSON line from the Gemini CLI's --output-format stream-json output.
 *
 * Gemini outputs events as one JSON object per line:
 * - { type: "init", session_id: "...", model: "..." }
 * - { type: "message", role: "assistant"|"system", content: "..." }
 * - { type: "tool_use", name: "...", arguments: {...}, call_id: "..." }
 * - { type: "tool_result", call_id: "...", output: "..." }
 * - { type: "error", message: "..." }
 * - { type: "result", stats: { per-model input_tokens / output_tokens }, turn_count: N }
 *
 * In google-login mode the run is Antigravity CLI (`agy`), whose events carry
 * an `event` key instead of `type` (see parseAntigravityEvent).
 *
 * Returns multiple entries per line when a message contains structured content.
 */
export function parseGeminiEvent(
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
  if (typeof event?.event === "string") return parseAntigravityEvent(event, taskId, timestamp);
  const entries: AgentLogEntry[] = [];

  // Extract session ID from init event
  const sessionId = (event.session_id ?? event.id) as string | undefined;

  // Init event — system info with model
  if (event.type === "init") {
    const parts: string[] = ["Session initialized"];
    if (event.model) parts.push(`model: ${event.model}`);
    entries.push({
      taskId,
      timestamp,
      sessionId,
      type: "system",
      content: parts.join(" · "),
      metadata: event.model ? { model: event.model } : undefined,
    });
    return { entries, sessionId };
  }

  // System message
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
    return { entries, sessionId };
  }

  // Tool use
  if (event.type === "tool_use") {
    const args = parseArgs(event.arguments);
    const formatted = formatGeminiToolUse(event.name, args);
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

  // Tool result
  if (event.type === "tool_result") {
    const output =
      typeof event.output === "string" ? event.output : (JSON.stringify(event.output) ?? "");
    const trimmed = output.length > 300 ? output.slice(0, 300) + "\u2026" : output;
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

  // Result event with stats — final summary
  if (event.type === "result") {
    const meta: string[] = [];
    let totalInput = 0;
    let totalOutput = 0;

    if (event.stats && typeof event.stats === "object") {
      for (const value of Object.values(event.stats)) {
        if (typeof value === "object" && value !== null) {
          const s = value as Record<string, unknown>;
          if (typeof s.input_tokens === "number") totalInput += s.input_tokens;
          if (typeof s.output_tokens === "number") totalOutput += s.output_tokens;
        }
      }
      // Flat stats
      const stats = event.stats as Record<string, unknown>;
      if (typeof stats.input_tokens === "number") totalInput += stats.input_tokens;
      if (typeof stats.output_tokens === "number") totalOutput += stats.output_tokens;
    }

    if (totalInput) meta.push(`${totalInput} input tokens`);
    if (totalOutput) meta.push(`${totalOutput} output tokens`);
    if (event.turn_count) meta.push(`${event.turn_count} turns`);

    if (meta.length) {
      entries.push({
        taskId,
        timestamp,
        sessionId,
        type: "info",
        content: `Result: ${meta.join(" \u00b7 ")}`,
        metadata: {
          inputTokens: totalInput || undefined,
          outputTokens: totalOutput || undefined,
          turnCount: event.turn_count,
        },
      });
    }
    return { entries, sessionId };
  }

  // Unknown JSON event — skip
  return { entries: [], sessionId };
}

/**
 * Antigravity CLI (`agy --output-format stream-json`) events:
 * - { event: "init", conversation_id, init: { cwd, tools, permission_mode, model? } }
 * - { event: "step_update", step_update: { conversation_id, step_type, state, text_delta?, tool_info?, usage? } }
 * - { event: "result", result: { conversation_id, status, response, error?, num_turns, usage } }
 *
 * The conversation id is the session id: without it the task worker reads the
 * run as one that never started.
 */
function parseAntigravityEvent(
  event: any,
  taskId: string,
  timestamp: string,
): { entries: AgentLogEntry[]; sessionId?: string } {
  const body = event[event.event] ?? {};
  const sessionId = (event.conversation_id ?? body.conversation_id) as string | undefined;
  const entry = (
    type: AgentLogEntry["type"],
    content: string,
    metadata?: AgentLogEntry["metadata"],
  ) =>
    ({
      taskId,
      timestamp,
      sessionId,
      type,
      content,
      ...(metadata && { metadata }),
    }) as AgentLogEntry;

  if (event.event === "init") {
    const model = typeof body.model === "string" ? body.model : undefined;
    const content = model ? `Session initialized · model: ${model}` : "Session initialized";
    return { entries: [entry("system", content, model ? { model } : undefined)], sessionId };
  }

  if (event.event === "step_update") {
    const entries: AgentLogEntry[] = [];
    if (typeof body.text_delta === "string" && body.text_delta.trim()) {
      entries.push(entry("text", body.text_delta));
    }
    if (body.tool_info) {
      const info = body.tool_info;
      const name = info.name ?? info.tool_name ?? body.step_type ?? "tool";
      const args = parseArgs(info.arguments ?? info.args ?? info.input);
      const raw = JSON.stringify(info);
      entries.push(
        entry("tool_use", args ? formatGeminiToolUse(name, args) : raw.slice(0, 300), {
          toolName: name,
          toolInput: args,
        }),
      );
    }
    return { entries, sessionId };
  }

  if (event.event === "result") {
    const entries: AgentLogEntry[] = [];
    if (body.status && body.status !== "SUCCESS") {
      entries.push(
        entry("error", body.error || `Antigravity run ended with status ${body.status}`),
      );
    }
    const input = body.usage?.input_tokens;
    const output = body.usage?.output_tokens;
    const meta = [
      typeof input === "number" && `${input} input tokens`,
      typeof output === "number" && `${output} output tokens`,
      body.num_turns && `${body.num_turns} turns`,
    ].filter(Boolean);
    if (meta.length) {
      entries.push(
        entry("info", `Result: ${meta.join(" · ")}`, {
          inputTokens: input,
          outputTokens: output,
          turnCount: body.num_turns,
        }),
      );
    }
    return { entries, sessionId };
  }

  return { entries: [], sessionId };
}

/** Parse tool call arguments (may be a JSON string or object) */
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

/** Format a Gemini tool use into a concise human-readable string */
function formatGeminiToolUse(name: string, args: Record<string, unknown> | undefined): string {
  if (!name) return "unknown tool";
  if (!args) return name;

  switch (name) {
    case "shell":
    case "bash":
    case "terminal":
    case "run_terminal_command":
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
    case "replace_in_file":
      return `Edit ${args.path ?? args.file_path ?? ""}`;
    case "search":
    case "grep":
    case "search_files":
      return `Search: ${args.query ?? args.pattern ?? ""}`;
    case "list_dir":
    case "listDir":
    case "list_directory":
      return `List ${args.path ?? args.dir ?? "."}`;
    default:
      return name;
  }
}
