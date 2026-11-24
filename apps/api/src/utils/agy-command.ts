import { isAntigravityModel, shellQuote } from "@optio/shared";

/**
 * Where Antigravity CLI keeps a Google sign-in when the pod has no D-Bus
 * keyring. It is made once by running `agy` in the pod's terminal and lives
 * on the persistent home, so every run reuses it and its refreshes.
 */
const AGY_TOKEN_FILE = "$HOME/.gemini/antigravity-cli/antigravity-oauth-token";

/** Gemini's google-login mode: Antigravity CLI on the pod's Google sign-in. */
export function agyCommand(env: Record<string, string>): string[] {
  // A Gemini CLI id (the repo default is one) would make agy fail the run; agy's own default runs instead.
  const model = env.OPTIO_GEMINI_MODEL;
  const modelFlag = model && isAntigravityModel(model) ? ` --model ${shellQuote(model)}` : "";
  return [
    `if [ ! -s "${AGY_TOKEN_FILE}" ]; then echo "[optio] Gemini google-login mode: no Antigravity sign-in at ${AGY_TOKEN_FILE}; run agy once in the pod's terminal" >&2; exit 1; fi`,
    // The pod is the sandbox. Without a TTY a missing sign-in would wait 60s
    // for a pasted code, so stdin is closed.
    `AGY_CLI_DISABLE_AUTO_UPDATE=1 agy -p "$OPTIO_PROMPT" --output-format stream-json --dangerously-skip-permissions${modelFlag} </dev/null`,
  ];
}
