import { describe, it, expect } from "vitest";
import {
  determineCheckStatus,
  determineReviewStatus,
  isPrWorthWatching,
} from "./pr-watcher-worker.js";

describe("determineCheckStatus", () => {
  it("returns none for empty check runs", () => {
    expect(determineCheckStatus([])).toBe("none");
  });

  it("returns pending when some checks are still running", () => {
    expect(
      determineCheckStatus([
        { status: "completed", conclusion: "success" },
        { status: "in_progress", conclusion: null },
      ]),
    ).toBe("pending");
  });

  it("returns passing when all checks succeed", () => {
    expect(
      determineCheckStatus([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "success" },
      ]),
    ).toBe("passing");
  });

  it("treats skipped as passing", () => {
    expect(
      determineCheckStatus([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "skipped" },
      ]),
    ).toBe("passing");
  });

  it("returns failing when any check fails", () => {
    expect(
      determineCheckStatus([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ]),
    ).toBe("failing");
  });
});

describe("determineReviewStatus", () => {
  it("returns none for no reviews", () => {
    expect(determineReviewStatus([])).toEqual({ status: "none", comments: "" });
  });

  it("returns approved for APPROVED review", () => {
    expect(determineReviewStatus([{ state: "APPROVED", body: "LGTM" }])).toEqual({
      status: "approved",
      comments: "",
    });
  });

  it("returns changes_requested with body", () => {
    expect(determineReviewStatus([{ state: "CHANGES_REQUESTED", body: "Fix the tests" }])).toEqual({
      status: "changes_requested",
      comments: "Fix the tests",
    });
  });

  it("ignores COMMENTED and DISMISSED reviews for status", () => {
    expect(
      determineReviewStatus([{ state: "COMMENTED", body: "Nice work" }, { state: "DISMISSED" }]),
    ).toEqual({ status: "pending", comments: "" });
  });

  it("uses latest substantive review", () => {
    expect(
      determineReviewStatus([
        { state: "CHANGES_REQUESTED", body: "Fix X" },
        { state: "APPROVED", body: "Fixed" },
      ]),
    ).toEqual({ status: "approved", comments: "" });
  });
});

describe("isPrWorthWatching", () => {
  it("keeps watching an open PR, whatever the task state", () => {
    expect(isPrWorthWatching({ state: "pr_opened", prState: "open" })).toBe(true);
    expect(isPrWorthWatching({ state: "failed", prState: "open" })).toBe(true);
  });

  it("keeps watching a PR whose state was never read", () => {
    expect(isPrWorthWatching({ state: "pr_opened", prState: null })).toBe(true);
    expect(isPrWorthWatching({ state: "failed", prState: null })).toBe(true);
  });

  it("watches a pr_opened task once more after its PR settles, so the task can transition", () => {
    expect(isPrWorthWatching({ state: "pr_opened", prState: "closed" })).toBe(true);
    expect(isPrWorthWatching({ state: "pr_opened", prState: "merged" })).toBe(true);
  });

  it("stops watching a failed task whose PR is closed or merged", () => {
    expect(isPrWorthWatching({ state: "failed", prState: "closed" })).toBe(false);
    expect(isPrWorthWatching({ state: "failed", prState: "merged" })).toBe(false);
  });
});
