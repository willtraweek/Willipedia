import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { parseArticleHtml } from "../src/brain/handlers/article";
import {
  buildWatchUrl,
  extractYouTubeVideoId,
  parseYouTubeTranscriptXml,
  parseYouTubeWatchHtml,
} from "../src/brain/handlers/youtube";

describe("brain handlers", () => {
  test("parses article HTML into normalized source content", async () => {
    const html = await fs.readFile(
      path.resolve(process.cwd(), "test/fixtures/html/adversarial-article.html"),
      "utf8",
    );

    const parsed = parseArticleHtml("https://example.com/distillery", html);
    expect(parsed.format).toBe("article");
    expect(parsed.title).toBe("Knowledge Distillery Patterns");
    expect(parsed.byline).toBe("Field Researcher");
    expect(parsed.publishedAt).toBe("2026-04-10");
    expect(parsed.rawText).toContain("Good personal wikis distill raw material");
    expect(parsed.rawText).toContain("Keep sources attached");
  });

  test("parses youtube fixtures into transcript-ready metadata", async () => {
    const watchHtml = await fs.readFile(
      path.resolve(process.cwd(), "test/fixtures/youtube/watch-page.html"),
      "utf8",
    );
    const transcriptXml = await fs.readFile(
      path.resolve(process.cwd(), "test/fixtures/youtube/transcript.xml"),
      "utf8",
    );

    expect(extractYouTubeVideoId("https://youtu.be/abc123")).toBe("abc123");
    expect(buildWatchUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );

    const metadata = parseYouTubeWatchHtml("https://youtu.be/abc123", watchHtml);
    expect(metadata.title).toBe("Transcript Driven Wikis");
    expect(metadata.author).toBe("Knowledge Channel");
    expect(metadata.transcriptUrl).toBe("https://example.com/transcript.xml");

    expect(parseYouTubeTranscriptXml(transcriptXml)).toContain(
      "Transcripts make ingestion deterministic.",
    );
  });
});
