import fs from "node:fs/promises";
import path from "node:path";

import type { BrainCategoryDefinition } from "./types";

const DEFAULT_CATEGORIES = [
  {
    category: "people",
    instructions: "Biographical pages for named people and operators.",
  },
  {
    category: "concepts",
    instructions: "Ideas, frameworks, methods, and thematic notes.",
  },
  {
    category: "sources",
    instructions: "Per-source provenance pages for ingested URLs.",
  },
] as const;

export async function loadBrainSchema(
  compiledRoot: string,
): Promise<BrainCategoryDefinition[]> {
  const discovered: BrainCategoryDefinition[] = [];

  try {
    const entries = await fs.readdir(compiledRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const readmePath = path.join(compiledRoot, entry.name, "README.md");
      const instructions = await readInstructions(readmePath);
      if (!instructions) {
        continue;
      }

      discovered.push({
        category: entry.name,
        directoryName: entry.name,
        readmePath,
        instructions,
      });
    }
  } catch {
    return fallbackSchema(compiledRoot);
  }

  if (discovered.length === 0) {
    return fallbackSchema(compiledRoot);
  }

  const byCategory = new Map(discovered.map((item) => [item.category, item]));
  for (const fallback of fallbackSchema(compiledRoot)) {
    if (!byCategory.has(fallback.category)) {
      discovered.push(fallback);
    }
  }

  return discovered.sort((left, right) => left.category.localeCompare(right.category));
}

export function getCategoryDirectory(
  compiledRoot: string,
  category: string,
  categories: BrainCategoryDefinition[],
): string {
  const match = categories.find((entry) => entry.category === category);
  return path.join(compiledRoot, match?.directoryName ?? category);
}

export function renderBrainSchema(
  compiledRoot: string,
  categories: BrainCategoryDefinition[],
): string {
  return [
    `compiled_root=${compiledRoot}`,
    ...categories.map(
      (category) =>
        `${category.category}: ${category.instructions.replace(/\s+/g, " ").trim()}`,
    ),
  ].join("\n");
}

async function readInstructions(readmePath: string): Promise<string | null> {
  try {
    return (await fs.readFile(readmePath, "utf8")).trim();
  } catch {
    return null;
  }
}

function fallbackSchema(compiledRoot: string): BrainCategoryDefinition[] {
  return DEFAULT_CATEGORIES.map((category) => ({
    category: category.category,
    directoryName: category.category,
    readmePath: path.join(compiledRoot, category.category, "README.md"),
    instructions: category.instructions,
  }));
}
