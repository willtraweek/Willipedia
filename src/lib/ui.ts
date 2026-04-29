import { formatRelativeDays } from "@/lib/date";
import type { NudgeCardModel, NudgeMode, PreviewPayload, VaultEntry } from "@/lib/types";

function titleFromSlug(slug: string): string {
  return slug
    .split("/")
    .at(-1)
    ?.replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase()) ?? slug;
}

export function createPreviewPayload(entry: VaultEntry): PreviewPayload {
  return {
    slug: entry.slug,
    title: entry.title,
    dek: entry.deck,
    updatedAt: entry.updatedAt.toISOString(),
    updatedLabel: formatRelativeDays(entry.updatedAt),
    broken: false
  };
}

export function createMissingPreviewPayload(slug: string): PreviewPayload {
  return {
    slug,
    title: titleFromSlug(slug),
    dek: "",
    updatedAt: "",
    updatedLabel: "",
    broken: true
  };
}

export function getBrokenPreviewText(): string {
  return "No page yet. Click to propose one for research.";
}

export function getNudgeCardModel(mode: NudgeMode, slug?: string): NudgeCardModel {
  const title = slug ? titleFromSlug(slug) : "this topic";

  if (mode === "broken-wikilink") {
    return {
      mode,
      kicker: "FROM THE ARCHIVE",
      headline: "Not yet in the archive.",
      deck: `You reached for ${title}, but the drawer is still empty.`,
      prompt: slug ? `Willipedia has no page for ${title} yet.` : null,
      ctaLabel: "RESEARCH THIS TOPIC AND DRAFT A PAGE",
      disabledLabel: "[QUEUED FOR v0.2]"
    };
  }

  if (mode === "stub") {
    return {
      mode,
      kicker: "THIS PAGE IS A STUB",
      headline: "The entry exists, but the article does not.",
      deck: `The title for ${title} has been set, but the body copy has not been written yet.`,
      prompt: slug ? `Return when ${title} has more than a heading.` : null,
      ctaLabel: "RESEARCH THIS TOPIC AND DRAFT A PAGE",
      disabledLabel: "[QUEUED FOR v0.2]"
    };
  }

  return {
    mode,
    kicker: "FROM THE ARCHIVE",
    headline: "Nothing turned up.",
    deck: "The archive could not match this path to a printed page.",
    prompt: null,
    ctaLabel: "RESEARCH THIS TOPIC AND DRAFT A PAGE",
    disabledLabel: "[QUEUED FOR v0.2]"
  };
}
