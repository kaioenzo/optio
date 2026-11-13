import { OPENCODE_PROVIDER_KEYS, PI_PROVIDER_KEYS } from "@optio/agent-adapters";

type SecretLookup = (name: string) => Promise<string | null>;

async function storedKeys(keys: readonly string[], secret: SecretLookup) {
  const found: Record<string, string> = {};
  for (const name of keys) {
    const value = await secret(name);
    if (value) found[name] = value;
  }
  return found;
}

/** Pi takes any one provider key, or the credential explicitly selected for this work. */
export async function piProviderSecrets(
  secret: SecretLookup,
  credential?: { env: Record<string, string> } | null,
): Promise<Record<string, string>> {
  if (credential) return { ...credential.env };
  const found = await storedKeys(PI_PROVIDER_KEYS, secret);
  if (!Object.keys(found).length) {
    throw new Error(`Pi needs one of ${PI_PROVIDER_KEYS.join(", ")} as a secret`);
  }
  return found;
}

/** OpenCode takes any one provider key, or none at all with a custom base URL. */
export async function opencodeProviderSecrets(
  secret: SecretLookup,
  baseUrl: string | null | undefined,
): Promise<Record<string, string>> {
  const found = await storedKeys(OPENCODE_PROVIDER_KEYS, secret);
  if (!Object.keys(found).length && !baseUrl) {
    const keys = [...OPENCODE_PROVIDER_KEYS];
    throw new Error(
      `OpenCode needs one of ${keys.slice(0, -1).join(", ")} or ${keys[keys.length - 1]} as a secret, or a custom base URL (opencodeBaseUrl)`,
    );
  }
  return found;
}
