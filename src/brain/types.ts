import { z } from "zod";

import type { Frontmatter, SourceFormat } from "../core/types";

export type EntityKind =
  | "person"
  | "concept"
  | "organization"
  | "work"
  | "source"
  | "unknown";

export interface BrainCategoryDefinition {
  category: string;
  directoryName: string;
  readmePath: string;
  instructions: string;
}

export interface NormalizedSource {
  url: string;
  canonicalUrl: string;
  format: SourceFormat;
  domain: string;
  title: string;
  byline: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  markdown: string;
  rawText: string;
  contentHash: string;
}

export const extractedEntitySchema = z.object({
  name: z.string().trim().min(1),
  kind: z
    .enum(["person", "concept", "organization", "work", "source", "unknown"])
    .default("unknown"),
  summary: z.string().trim().min(1).optional(),
});

export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

export const entityExtractionResultSchema = z.object({
  entities: z.array(extractedEntitySchema).max(16).default([]),
});

export type EntityExtractionResult = z.infer<typeof entityExtractionResultSchema>;

export interface ReconciledEntity extends ExtractedEntity {
  slug: string;
  title: string;
  existing: boolean;
  matchType: "exact" | "title" | "vector" | "new";
  score: number | null;
}

export const meceRouteSchema = z.object({
  category: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type MECERoute = z.infer<typeof meceRouteSchema>;

export const compiledPageSchema = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1),
  frontmatter: z.record(z.string(), z.unknown()).default({}),
  relatedSlugs: z.array(z.string().trim().min(1)).default([]),
});

export type CompiledPageDraft = z.infer<typeof compiledPageSchema>;

export interface PipelineResult {
  primaryPage: CompiledPageDraft | null;
  sourcePage: CompiledPageDraft;
  route: MECERoute;
  entities: ReconciledEntity[];
  fallback: boolean;
}

export interface IngestOptions {
  dryRun?: boolean;
  refresh?: boolean;
  queueId?: number;
  now?: Date;
}

export interface IngestResult {
  status: "created" | "updated" | "skipped" | "queued" | "dry-run" | "fallback";
  url: string;
  format: SourceFormat;
  pageSlugs: string[];
  reason?: string;
  sourceHash?: string;
  queuedId?: number;
}

export interface ExtractEntitiesInput {
  source: NormalizedSource;
}

export interface ClassifyRouteInput {
  source: NormalizedSource;
  categories: BrainCategoryDefinition[];
  entities: ReconciledEntity[];
}

export interface CompilePageInput {
  source: NormalizedSource;
  route: MECERoute;
  categories: BrainCategoryDefinition[];
  primaryEntity: ReconciledEntity | null;
  entities: ReconciledEntity[];
}

export interface BrainLlmProvider {
  extractEntities(input: ExtractEntitiesInput): Promise<unknown>;
  classifyRoute(input: ClassifyRouteInput): Promise<unknown>;
  compilePage(input: CompilePageInput): Promise<unknown>;
}

export interface PersistedPageDraft {
  path: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  frontmatter: Frontmatter;
  operation: "created" | "updated";
}
