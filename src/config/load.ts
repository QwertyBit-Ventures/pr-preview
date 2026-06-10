import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { configSchema, type Config } from "./schema.js";

const CONFIG_FILES = [
  "pr-preview.config.ts",
  "pr-preview.config.mts",
  "pr-preview.config.js",
  "pr-preview.config.mjs",
  "pr-preview.config.json",
];

export class ConfigError extends Error {}

/** Find and validate pr-preview.config.* in the given repo root. */
export async function loadConfig(root: string): Promise<{ config: Config; file: string }> {
  const file = CONFIG_FILES.map((f) => path.join(root, f)).find(existsSync);
  if (!file) {
    throw new ConfigError(
      `No pr-preview config found in ${root}. Run \`pr-preview init\` to create one.`,
    );
  }

  let raw: unknown;
  if (file.endsWith(".json")) {
    raw = JSON.parse(await readFile(file, "utf8"));
  } else {
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    raw = await jiti.import(file, { default: true });
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config in ${path.basename(file)}:\n${issues}`);
  }
  return { config: parsed.data, file };
}
