import { expect, it, vi } from "vitest";
import { opencodeProviderSecrets, piProviderSecrets } from "./provider-secrets.js";

it("accepts each supported provider on its own", async () => {
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
    expect(await piProviderSecrets(async (key) => (key === name ? "value" : null))).toEqual({
      [name]: "value",
    });
  }
});
it("uses only the explicit credential when one is selected", async () => {
  const lookup = vi.fn(async () => "ambient");
  expect(await piProviderSecrets(lookup, { env: { OPENAI_API_KEY: "chosen" } })).toEqual({
    OPENAI_API_KEY: "chosen",
  });
  expect(lookup).not.toHaveBeenCalled();
});
it("reports missing keys clearly", async () => {
  await expect(piProviderSecrets(async () => null)).rejects.toThrow("Pi needs one of");
});
it("OpenCode signs in with only the OpenCode Zen / Go key", async () => {
  expect(
    await opencodeProviderSecrets(async (key) => (key === "OPENCODE_API_KEY" ? "go" : null), null),
  ).toEqual({ OPENCODE_API_KEY: "go" });
});
it("OpenCode with a custom base URL needs no key but still passes a stored one", async () => {
  expect(await opencodeProviderSecrets(async () => null, "http://llm.internal/v1")).toEqual({});
  expect(
    await opencodeProviderSecrets(
      async (key) => (key === "OPENAI_API_KEY" ? "real" : null),
      "http://llm.internal/v1",
    ),
  ).toEqual({ OPENAI_API_KEY: "real" });
});
it("OpenCode without a key or base URL names every accepted key", async () => {
  await expect(opencodeProviderSecrets(async () => null, undefined)).rejects.toThrow(
    /ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY or OPENCODE_API_KEY/,
  );
});
