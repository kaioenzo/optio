import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agyCommand } from "./agy-command.js";

function run(home: string, model = "gemini-4-neon-high") {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "agy"),
    '#!/bin/sh\necho "update=$AGY_CLI_DISABLE_AUTO_UPDATE agy $*"\n',
    {
      mode: 0o755,
    },
  );
  const script = agyCommand({ OPTIO_GEMINI_MODEL: model }).join("\n");
  try {
    const stdout = execFileSync("bash", ["-c", script], {
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, OPTIO_PROMPT: "hi" },
      stdio: "pipe",
    });
    return { code: 0, out: stdout.toString() };
  } catch (err) {
    const e = err as { status: number; stderr: Buffer };
    return { code: e.status, out: e.stderr.toString() };
  }
}

function signedInHome() {
  const home = mkdtempSync(join(tmpdir(), "agy-"));
  mkdirSync(join(home, ".gemini/antigravity-cli"), { recursive: true });
  writeFileSync(join(home, ".gemini/antigravity-cli/antigravity-oauth-token"), "token");
  return home;
}

describe("agyCommand", () => {
  it("stops with a clear message when the pod has no Antigravity sign-in", () => {
    const result = run(mkdtempSync(join(tmpdir(), "agy-")));
    expect(result.code).toBe(1);
    expect(result.out).toContain("no Antigravity sign-in");
  });

  it("runs agy headless on the pod's sign-in with the picked model", () => {
    expect(run(signedInHome())).toEqual({
      code: 0,
      out: "update=1 agy -p hi --output-format stream-json --dangerously-skip-permissions --model gemini-4-neon-high\n",
    });
  });

  it("leaves out a model agy does not know, so agy runs its default", () => {
    expect(run(signedInHome(), "gemini-2.5-pro")).toEqual({
      code: 0,
      out: "update=1 agy -p hi --output-format stream-json --dangerously-skip-permissions\n",
    });
  });
});
