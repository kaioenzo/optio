import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agent-pod-pool.js", () => ({ listPods: vi.fn(), podHandle: vi.fn() }));
vi.mock("./container-service.js", () => ({ getRuntime: vi.fn() }));
vi.mock("../logger.js", () => ({ logger: { warn: vi.fn() } }));

import { clearCodexUsageCache, getCodexUsage, parseCodexUsage } from "./codex-usage-service.js";

const answer = {
  result: {
    rateLimits: {
      primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 1795505072 },
      secondary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1796060882 },
      planType: "plus",
    },
  },
};

describe("parseCodexUsage", () => {
  it("maps the windows by duration, not by position", () => {
    const swapped = {
      result: {
        rateLimits: {
          ...answer.result.rateLimits,
          primary: answer.result.rateLimits.secondary,
          secondary: answer.result.rateLimits.primary,
        },
      },
    };
    expect(parseCodexUsage(JSON.stringify(swapped))).toEqual({
      available: true,
      fiveHour: { utilization: 14, resetsAt: new Date(1795505072 * 1000).toISOString() },
      sevenDay: { utilization: 8, resetsAt: new Date(1796060882 * 1000).toISOString() },
      planType: "plus",
    });
  });

  it("reads the last line and reports probe errors as unavailable", () => {
    expect(parseCodexUsage(`noise\n${JSON.stringify(answer)}\n`).available).toBe(true);
    expect(parseCodexUsage(JSON.stringify({ error: "not logged in" }))).toEqual({
      available: false,
      error: "not logged in",
    });
    expect(parseCodexUsage("garbage").available).toBe(false);
  });
});

describe("getCodexUsage", () => {
  beforeEach(() => clearCodexUsageCache());
  const pod = { state: "ready", workspaceId: null, podName: "optio-repo-x-0" };

  it("probes the repo's ready pod without workspace and caches a good read", async () => {
    const listPods = vi
      .fn()
      .mockResolvedValue([{ ...pod, workspaceId: "ws", podName: "other" }, pod]);
    const probe = vi.fn().mockResolvedValue(JSON.stringify(answer));
    const deps = { listPods, probe } as never;
    expect((await getCodexUsage("https://r", deps)).fiveHour?.utilization).toBe(14);
    await getCodexUsage("https://r", deps);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(pod);
  });

  it("does not cache a failed read and says when no pod is ready", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("exec failed"));
    const deps = { listPods: vi.fn().mockResolvedValue([pod]), probe } as never;
    expect(await getCodexUsage("https://r", deps)).toEqual({
      available: false,
      error: "probe failed",
    });
    await getCodexUsage("https://r", deps);
    expect(probe).toHaveBeenCalledTimes(2);
    const none = { listPods: vi.fn().mockResolvedValue([]), probe } as never;
    expect(await getCodexUsage("https://other", none)).toEqual({
      available: false,
      error: "no ready repo pod",
    });
  });
});
