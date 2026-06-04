import { spawn } from "node:child_process";

/**
 * Provider/model catalog sourced from the Ante CLI's `ante catalog` command.
 *
 * `ante catalog` prints the merged catalog (built-in presets +
 * `~/.ante/catalog.json`) as JSON in the catalog-file schema. This is the
 * authoritative source for the providers Ante knows about, their auth
 * configuration, and the models each one serves — replacing the static lists
 * the plugin used to hand-maintain.
 *
 * See ante-internal `src/startup/catalog.rs` (the subcommand) and
 * `src/llm/types/{provider,auth}.rs` (the serialized shapes).
 */

export type AnteProviderAuthType = "api-key" | "oauth" | "none";

export interface AnteCatalogProvider {
  id: string;
  /** Display label (catalog `display_name`, optionally overridden by hints). */
  label: string;
  authType: AnteProviderAuthType;
  /** Environment variable Ante reads for this provider's key (api-key only). */
  envKey?: string;
  /**
   * OAuth preset id (oauth only). Doubles as the auth-file basename Ante writes
   * under `~/.ante/auth/<oauthPreset>.json`.
   */
  oauthPreset?: string;
  /** Placeholder hint for the API key input (cosmetic, from PROVIDER_HINTS). */
  keyPlaceholder?: string;
  /** Model ids this provider serves (catalog `preferred_models[].id`). */
  models: string[];
}

export interface AnteCatalog {
  providers: AnteCatalogProvider[];
}

/**
 * Cosmetic per-provider hints the catalog doesn't carry: nicer labels for a few
 * providers whose `display_name` reads awkwardly, and the `sk-...`-style
 * placeholder for API key inputs. Everything else (ids, env keys, models, auth
 * type) comes straight from the catalog.
 */
const PROVIDER_HINTS: Record<string, { label?: string; keyPlaceholder?: string }> = {
  openai: { label: "OpenAI", keyPlaceholder: "sk-..." },
  "openai-compatible": { label: "OpenAI Compatible", keyPlaceholder: "sk-..." },
  gemini: { label: "Gemini", keyPlaceholder: "AIza..." },
  "vertex-gemini": { label: "Vertex Gemini" },
  anthropic: { keyPlaceholder: "sk-ant-..." },
  deepseek: { keyPlaceholder: "sk-..." },
  openrouter: { keyPlaceholder: "sk-or-..." },
  xai: { label: "xAI (Grok)", keyPlaceholder: "xai-..." },
  "ali-coding-plan": { keyPlaceholder: "sk-sp-..." },
  local: { label: "Local" },
};

interface RawAuthBody {
  env_key?: unknown;
  oauth_preset?: unknown;
  name?: unknown;
}

/** AuthConfig is an externally-tagged enum: `{ bearer | header | query: {..} }`. */
const deriveAuth = (
  auth: unknown
): Pick<AnteCatalogProvider, "authType" | "envKey" | "oauthPreset"> => {
  if (!auth || typeof auth !== "object") {
    return { authType: "none" };
  }
  // The single key is the auth style (bearer/header/query); the value flattens
  // a CredentialRef of either { env_key } or { oauth_preset }.
  for (const value of Object.values(auth as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const body = value as RawAuthBody;
    if (typeof body.oauth_preset === "string" && body.oauth_preset.trim()) {
      return { authType: "oauth", oauthPreset: body.oauth_preset.trim() };
    }
    if (typeof body.env_key === "string" && body.env_key.trim()) {
      return { authType: "api-key", envKey: body.env_key.trim() };
    }
  }
  return { authType: "none" };
};

const parseProvider = (id: string, raw: unknown): AnteCatalogProvider | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const providerId = (typeof record.id === "string" && record.id.trim()) || id;
  const displayName = typeof record.display_name === "string" ? record.display_name.trim() : "";
  const hint = PROVIDER_HINTS[providerId] ?? {};

  const rawModels = Array.isArray(record.preferred_models) ? record.preferred_models : [];
  const models = rawModels
    .map((entry) =>
      entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
        ? (entry as { id: string }).id.trim()
        : ""
    )
    .filter(Boolean);

  return {
    id: providerId,
    label: hint.label || displayName || providerId,
    keyPlaceholder: hint.keyPlaceholder,
    models: [...new Set(models)],
    ...deriveAuth(record.auth),
  };
};

/**
 * Parse the JSON emitted by `ante catalog` into a normalized catalog. Provider
 * order is preserved (the catalog object is insertion-ordered). Returns `null`
 * when the document isn't a usable catalog object.
 */
export const parseAnteCatalog = (raw: string): AnteCatalog | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const providersRaw = (parsed as { providers?: unknown }).providers;
  if (!providersRaw || typeof providersRaw !== "object" || Array.isArray(providersRaw)) {
    return null;
  }

  const providers: AnteCatalogProvider[] = [];
  for (const [id, entry] of Object.entries(providersRaw as Record<string, unknown>)) {
    const provider = parseProvider(id, entry);
    if (provider) {
      providers.push(provider);
    }
  }
  return { providers };
};

/**
 * Run `<anteCommand> catalog` and parse its stdout. Resolves to `null` when the
 * command isn't configured, exits non-zero (e.g. an older Ante that lacks the
 * subcommand), or emits output that doesn't parse as a catalog.
 */
export const readAnteCatalog = (
  anteCommand: string,
  env: Record<string, string>
): Promise<AnteCatalog | null> =>
  new Promise((resolve) => {
    const command = anteCommand.trim();
    if (!command) {
      resolve(null);
      return;
    }

    const child = spawn(command, ["catalog"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    // Swallow stderr: catalog warnings are non-fatal and go there by design.
    child.stderr.on("data", () => {});
    child.once("error", () => resolve(null));
    child.once("close", (code) => {
      resolve(code === 0 ? parseAnteCatalog(stdout) : null);
    });
  });

export const __test__ = { deriveAuth, parseProvider, PROVIDER_HINTS };
