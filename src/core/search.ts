import Anthropic from "@anthropic-ai/sdk";

import type {
  AppConfig,
  EmbeddingProvider,
  QueryExpansionProvider,
  SearchCandidate,
  SearchOptions,
  SearchResult,
  SearchStore,
} from "./types";

const RRF_K = 60;

export class SearchEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly store: SearchStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly queryExpansionProvider: QueryExpansionProvider,
  ) {}

  async hybridSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Query must not be empty");
    }

    const limit = options.limit ?? 10;
    const expandedQueries =
      (options.enableExpansion ?? this.config.enableQueryExpansion) &&
      normalizedQuery.split(/\s+/).length >= 3
        ? await this.queryExpansionProvider.expand(normalizedQuery)
        : [];

    const allQueries = uniqueStrings([normalizedQuery, ...expandedQueries]).slice(0, 3);
    const resultSets = await Promise.all(
      allQueries.map((item) => this.searchSingleQuery(item, limit * 4)),
    );

    return mergeAcrossQueries(resultSets.flat(), limit);
  }

  private async searchSingleQuery(
    query: string,
    candidateLimit: number,
  ): Promise<SearchResult[]> {
    const keywordPromise = this.store.searchKeyword(query, candidateLimit);
    const vectorPromise = this.embedQuery(query)
      .then((embedding) => this.store.searchVector(embedding, candidateLimit))
      .catch(() => []);

    const [keywordHits, vectorHits] = await Promise.all([keywordPromise, vectorPromise]);
    const fused = rrfFuse(keywordHits, vectorHits, RRF_K);
    return collapseToPages(fused, query);
  }

  private async embedQuery(query: string): Promise<number[]> {
    const [embedding] = await this.embeddingProvider.embed([query]);
    if (!embedding) {
      throw new Error("No embedding returned for query");
    }

    return embedding;
  }
}

export class AnthropicQueryExpansionProvider implements QueryExpansionProvider {
  private readonly client: Anthropic | undefined;

  constructor(private readonly config: AppConfig, client?: Anthropic) {
    this.client =
      client ??
      (config.anthropicApiKey
        ? new Anthropic({ apiKey: config.anthropicApiKey })
        : undefined);
  }

  async expand(query: string): Promise<string[]> {
    if (!this.client || query.trim().split(/\s+/).length < 3) {
      return [];
    }

    try {
      const message = await this.client.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 256,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Generate exactly two alternative search queries for a markdown wiki.",
                  "Keep each alternative concise and semantically related to the original question.",
                  "Return strict JSON: an array of two strings and nothing else.",
                  `Original query: ${query}`,
                ].join("\n"),
              },
            ],
          },
        ],
      });

      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return parseJsonStringArray(text)
        .map((item) => item.trim())
        .filter((item) => item && item !== query)
        .slice(0, 2);
    } catch {
      return [];
    }
  }
}

type FusedCandidate = Omit<SearchCandidate, "matchedBy"> & {
  score: number;
  matchedModes: Array<"keyword" | "vector">;
};

export function rrfFuse(
  keywordHits: SearchCandidate[],
  vectorHits: SearchCandidate[],
  k = RRF_K,
): FusedCandidate[] {
  const byChunkId = new Map<number, FusedCandidate>();

  addRankedCandidates(byChunkId, keywordHits, "keyword", k);
  addRankedCandidates(byChunkId, vectorHits, "vector", k);

  return Array.from(byChunkId.values()).sort((left, right) => right.score - left.score);
}

function addRankedCandidates(
  destination: Map<number, FusedCandidate>,
  candidates: SearchCandidate[],
  matchedBy: "keyword" | "vector",
  k: number,
): void {
  candidates.forEach((candidate, index) => {
    const score = 1 / (k + index + 1);
    const existing = destination.get(candidate.chunkId);

    if (existing) {
      existing.score += score;
      if (!existing.matchedModes.includes(matchedBy)) {
        existing.matchedModes.push(matchedBy);
      }
      return;
    }

    destination.set(candidate.chunkId, {
      ...candidate,
      matchedModes: [matchedBy],
      score,
    });
  });
}

function collapseToPages(candidates: FusedCandidate[], sourceQuery: string): SearchResult[] {
  const bySlug = new Map<string, SearchResult>();

  for (const candidate of candidates) {
    const snippet = summarizeSnippet(candidate.content);
    const existing = bySlug.get(candidate.slug);

    if (existing) {
      existing.score += candidate.score;
      existing.sourceQueries = uniqueStrings([...existing.sourceQueries, sourceQuery]);
      existing.matchedBy = uniqueModes([...existing.matchedBy, ...candidate.matchedModes]);
      continue;
    }

    bySlug.set(candidate.slug, {
      slug: candidate.slug,
      title: candidate.title,
      snippet,
      score: candidate.score,
      chunkIndex: candidate.chunkIndex,
      matchedBy: [...candidate.matchedModes],
      sourceQueries: [sourceQuery],
    });
  }

  return Array.from(bySlug.values()).sort((left, right) => right.score - left.score);
}

function mergeAcrossQueries(results: SearchResult[], limit: number): SearchResult[] {
  const bySlug = new Map<string, SearchResult>();

  for (const result of results) {
    const existing = bySlug.get(result.slug);
    if (existing) {
      const priorScore = existing.score;
      existing.score += result.score;
      existing.sourceQueries = uniqueStrings([...existing.sourceQueries, ...result.sourceQueries]);
      existing.matchedBy = uniqueModes([...existing.matchedBy, ...result.matchedBy]);

      if (result.score > priorScore) {
        existing.snippet = result.snippet;
        existing.chunkIndex = result.chunkIndex;
      }
      continue;
    }

    bySlug.set(result.slug, { ...result });
  }

  return Array.from(bySlug.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function summarizeSnippet(content: string, maxLength = 240): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength - 1).trimEnd()}...`;
}

function parseJsonStringArray(input: string): string[] {
  const match = input.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function uniqueModes(
  values: Array<"keyword" | "vector">,
): Array<"keyword" | "vector"> {
  return Array.from(new Set(values));
}
