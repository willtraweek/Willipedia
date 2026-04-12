import path from "node:path";

import { z } from "zod";

import type { AppConfig } from "./types";

const optionalEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  COMPILED_PATH: z.string().trim().min(1).optional(),
  RAW_PATH: z.string().trim().min(1).optional(),
  ENABLE_QUERY_EXPANSION: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") {
        return value;
      }

      if (value === undefined) {
        return true;
      }

      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "yes";
    }),
  PIPELINE_VERSION: z.string().trim().min(1).optional(),
  EMBEDDING_MODEL: z.string().trim().min(1).optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).optional(),
});

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): AppConfig {
  const missing = ["DATABASE_URL", "OPENAI_API_KEY"].filter((key) => {
    const value = env[key];
    return value === undefined || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  const parsed = optionalEnvSchema.parse(env);

  return {
    projectRoot,
    databaseUrl: env.DATABASE_URL!.trim(),
    openAiApiKey: env.OPENAI_API_KEY!.trim(),
    ...(parsed.ANTHROPIC_API_KEY
      ? { anthropicApiKey: parsed.ANTHROPIC_API_KEY }
      : {}),
    compiledPath: resolveFromRoot(projectRoot, parsed.COMPILED_PATH ?? "../compiled"),
    rawPath: resolveFromRoot(projectRoot, parsed.RAW_PATH ?? "../raw"),
    enableQueryExpansion: parsed.ENABLE_QUERY_EXPANSION,
    pipelineVersion: parsed.PIPELINE_VERSION ?? "v1-3large-1536-haiku",
    embeddingModel: parsed.EMBEDDING_MODEL ?? "text-embedding-3-large",
    embeddingDimensions: 1536,
    anthropicModel: parsed.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
  };
}

function resolveFromRoot(projectRoot: string, inputPath: string): string {
  return path.resolve(projectRoot, inputPath);
}
