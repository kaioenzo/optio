import type { ProviderCatalog } from "./types.js";

export const GEMINI_CATALOG: ProviderCatalog = {
  provider: "gemini",
  label: "Google Gemini",
  modelField: "geminiModel",
  models: [
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      family: "gemini-flash",
      source: "baseline",
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      family: "gemini-flash",
      source: "baseline",
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      family: "gemini-pro",
      source: "baseline",
    },
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash (Preview)",
      family: "gemini-flash",
      preview: true,
      source: "baseline",
    },
    {
      id: "gemini-3-pro",
      label: "Gemini 3 Pro",
      family: "gemini-pro",
      latest: true,
      source: "baseline",
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      label: "Gemini 3.1 Flash Lite (Preview)",
      family: "gemini-flash-lite",
      latest: true,
      preview: true,
      source: "baseline",
    },
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro (Preview)",
      family: "gemini-pro",
      preview: true,
      source: "baseline",
    },
  ],
  aliases: {
    "gemini-pro": "gemini-3-pro",
    "gemini-flash": "gemini-2.5-flash",
  },
  options: [
    {
      key: "geminiApprovalMode",
      label: "Approval Mode",
      kind: "select",
      default: "yolo",
      choices: [
        { value: "default", label: "Default" },
        { value: "auto_edit", label: "Auto Edit" },
        { value: "yolo", label: "Yolo (skip all approvals)" },
      ],
    },
  ],
  liveRefreshSupported: true,
};

const EFFORT_LABELS = { low: "Low", medium: "Medium", high: "High", xhigh: "XHigh" };
type Effort = keyof typeof EFFORT_LABELS;

function antigravityModels(id: string, label: string, family: string, efforts: Effort[]) {
  return efforts.map((e) => ({
    id: `${id}-${e}`,
    label: `${label} (${EFFORT_LABELS[e]})`,
    family,
    source: "baseline" as const,
  }));
}

const LMH: Effort[] = ["low", "medium", "high"];

/**
 * The models Antigravity CLI (`agy models`) offers a Google sign-in, for
 * Gemini's google-login mode. Its ids carry the reasoning effort, and the
 * Gemini CLI ids above are unknown to it.
 */
export const GEMINI_ANTIGRAVITY_CATALOG: ProviderCatalog = {
  provider: "gemini",
  label: "Google Gemini (Antigravity)",
  modelField: "geminiModel",
  models: [
    ...antigravityModels("gemini-4-neon", "Gemini 4 Neon", "gemini-4-neon", [...LMH, "xhigh"]),
    ...antigravityModels("gemini-4-hydrogen", "Gemini 4 Hydrogen", "gemini-4-hydrogen", [
      ...LMH,
      "xhigh",
    ]),
    ...antigravityModels("gemini-4-carbon", "Gemini 4 Carbon", "gemini-4-carbon", LMH),
    ...antigravityModels("gemini-4-argon", "Gemini 4 Argon", "gemini-4-argon", LMH),
    ...antigravityModels("gemini-3.8-flash", "Gemini 3.8 Flash", "gemini-3.8-flash", LMH),
    ...[
      ["gemini-pro-orchestrator-neon", "Orchestrator (Neon)"],
      ["gemini-pro-orchestrator", "Orchestrator (Carbon)"],
      ["gemini-pro-orchestrator-argon", "Orchestrator (Argon)"],
    ].map(([id, label]) => ({ id, label, family: "orchestrator", source: "baseline" as const })),
    ...antigravityModels("claude-opus-5-5", "Claude Opus 5.5", "claude-opus", LMH),
    ...antigravityModels("claude-sonnet-5-5", "Claude Sonnet 5.5", "claude-sonnet", LMH),
    ...antigravityModels("gpt-oss-120b", "GPT-OSS 120B", "gpt-oss", ["medium"]),
  ],
  aliases: {},
  options: [],
  liveRefreshSupported: false,
};

export function isAntigravityModel(id: string): boolean {
  return GEMINI_ANTIGRAVITY_CATALOG.models.some((m) => m.id === id);
}
