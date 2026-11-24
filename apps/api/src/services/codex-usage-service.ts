import { listPods, podHandle, type AgentPod } from "./agent-pod-pool.js";
import { getRuntime } from "./container-service.js";
import { logger } from "../logger.js";

const CACHE_MS = 5 * 60 * 1000;
const FIVE_HOURS_MINS = 300;
const SEVEN_DAYS_MINS = 10080;

/**
 * Reads the ChatGPT login's Codex rate limits through `codex app-server`
 * (`account/rateLimits/read`), which asks the account backend and runs no model.
 * Passed to `node -e`; prints one JSON line.
 */
const CODEX_USAGE_PROBE = `
const { spawn } = require("node:child_process");
const p = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
const done = (out) => { console.log(JSON.stringify(out)); p.kill(); process.exit(0); };
setTimeout(() => done({ error: "codex app-server did not answer in 20s" }), 20000);
let buf = "";
p.on("error", (e) => done({ error: e.message }));
p.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 1) { send({ method: "initialized" }); send({ id: 2, method: "account/rateLimits/read" }); }
    if (m.id === 2) done(m.error ? { error: m.error.message ?? "rate limit read failed" } : { result: m.result });
  }
});
const send = (m) => p.stdin.write(JSON.stringify(m) + "\\n");
send({ id: 1, method: "initialize", params: { clientInfo: { name: "optio-usage", version: "1" } } });
`;

interface UsageBucket {
  utilization: number | null;
  resetsAt: string | null;
}

export interface CodexUsageResult {
  available: boolean;
  fiveHour?: UsageBucket;
  sevenDay?: UsageBucket;
  planType?: string | null;
  error?: string;
}

interface RateLimitWindow {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number | null;
}

const bucket = (w: RateLimitWindow | undefined): UsageBucket | undefined =>
  w
    ? {
        utilization: typeof w.usedPercent === "number" ? w.usedPercent : null,
        resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null,
      }
    : undefined;

export function parseCodexUsage(stdout: string): CodexUsageResult {
  let out: { result?: { rateLimits?: Record<string, unknown> }; error?: string };
  try {
    out = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    return { available: false, error: "unreadable probe output" };
  }
  if (out.error || !out.result?.rateLimits)
    return { available: false, error: out.error ?? "no rate limits" };
  const limits = out.result.rateLimits;
  const windows = [limits.primary, limits.secondary].filter(Boolean) as RateLimitWindow[];
  return {
    available: true,
    fiveHour: bucket(windows.find((w) => w.windowDurationMins === FIVE_HOURS_MINS)),
    sevenDay: bucket(windows.find((w) => w.windowDurationMins === SEVEN_DAYS_MINS)),
    planType: typeof limits.planType === "string" ? limits.planType : null,
  };
}

async function probe(pod: AgentPod): Promise<string> {
  const command = [
    "sh",
    "-c",
    'CODEX_HOME="$HOME/.codex-chatgpt" exec node -e "$0"',
    CODEX_USAGE_PROBE,
  ];
  const session = await getRuntime().exec(podHandle(pod), command, { tty: false });
  let output = "";
  for await (const chunk of session.stdout as AsyncIterable<Buffer>) output += chunk.toString();
  session.close();
  return output;
}

const cache = new Map<string, { at: number; value: CodexUsageResult }>();

export async function getCodexUsage(
  repoUrl: string,
  deps = { listPods, probe },
): Promise<CodexUsageResult> {
  const hit = cache.get(repoUrl);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const pod = (await deps.listPods("repo", repoUrl)).find(
    (p) => p.state === "ready" && !p.workspaceId && p.podName,
  );
  if (!pod) return { available: false, error: "no ready repo pod" };
  let value: CodexUsageResult;
  try {
    value = parseCodexUsage(await deps.probe(pod));
  } catch (err) {
    logger.warn({ err, repoUrl }, "Failed to read Codex usage");
    value = { available: false, error: "probe failed" };
  }
  if (value.available) cache.set(repoUrl, { at: Date.now(), value });
  return value;
}

export function clearCodexUsageCache(): void {
  cache.clear();
}
