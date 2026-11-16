import { describe, expect, it } from "vitest";
import { watchesHeartbeat } from "./reconcile-snapshot.js";

describe("watchesHeartbeat", () => {
  const cluster = { runTarget: "cluster" };

  it("watches a running agent and one still working after its PR opened", () => {
    expect(watchesHeartbeat({ ...cluster, state: "running", execState: "started" })).toBe(true);
    expect(watchesHeartbeat({ ...cluster, state: "pr_opened", execState: "started" })).toBe(true);
  });

  it("ignores a PR waiting on CI or people, and local runs", () => {
    expect(watchesHeartbeat({ ...cluster, state: "pr_opened", execState: "exited" })).toBe(false);
    expect(watchesHeartbeat({ ...cluster, state: "pr_opened", execState: null })).toBe(false);
    expect(watchesHeartbeat({ runTarget: "local", state: "running", execState: "started" })).toBe(
      false,
    );
  });
});
