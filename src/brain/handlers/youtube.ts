import { JSDOM } from "jsdom";

import { sha256 } from "../../core/hash";
import { normalizeDomain } from "../quotas";
import type { NormalizedSource } from "../types";

export type YouTubeFetch = typeof fetch;

type YouTubePlayerResponse = {
  videoDetails?: {
    title?: string;
    author?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
      }>;
    };
  };
  microformat?: {
    playerMicroformatRenderer?: {
      publishDate?: string;
    };
  };
};

export class YouTubeSourceHandler {
  constructor(private readonly fetchImpl: YouTubeFetch = fetch) {}

  async fetch(url: string): Promise<NormalizedSource> {
    const watchUrl = buildWatchUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let watchResponse: Response;
    try {
      watchResponse = await this.fetchImpl(watchUrl, {
        headers: {
          "user-agent": "willipedia/0.1 (willipedia compiler)",
          accept: "text/html",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!watchResponse.ok) {
      throw new Error(`YouTube fetch failed: ${watchResponse.status} ${watchResponse.statusText}`);
    }

    const watchHtml = await watchResponse.text();
    const metadata = parseYouTubeWatchHtml(url, watchHtml);
    if (!metadata.transcriptUrl) {
      throw new Error("YouTube transcript unavailable");
    }

    const transcriptController = new AbortController();
    const transcriptTimeout = setTimeout(() => transcriptController.abort(), 30_000);

    let transcriptResponse: Response;
    try {
      transcriptResponse = await this.fetchImpl(metadata.transcriptUrl, {
        headers: {
          accept: "application/xml,text/xml",
        },
        signal: transcriptController.signal,
      });
    } finally {
      clearTimeout(transcriptTimeout);
    }

    if (!transcriptResponse.ok) {
      throw new Error(
        `YouTube transcript fetch failed: ${transcriptResponse.status} ${transcriptResponse.statusText}`,
      );
    }

    const transcriptXml = await transcriptResponse.text();
    const transcriptText = parseYouTubeTranscriptXml(transcriptXml);
    const markdown = [`# ${metadata.title}`, "", transcriptText].join("\n").trim();

    return {
      url,
      canonicalUrl: watchUrl,
      format: "youtube",
      domain: normalizeDomain(new URL(url).hostname),
      title: metadata.title,
      byline: metadata.author,
      publishedAt: metadata.publishedAt,
      excerpt: firstSentence(transcriptText),
      markdown,
      rawText: transcriptText,
      contentHash: sha256(`${watchUrl}\n${metadata.title}\n${transcriptText}`),
    };
  }
}

export function extractYouTubeVideoId(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname.includes("youtu.be")) {
    return parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  }

  if (parsed.pathname === "/watch") {
    return parsed.searchParams.get("v")?.trim() ?? "";
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

export function buildWatchUrl(url: string): string {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: ${url}`);
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function parseYouTubeWatchHtml(
  sourceUrl: string,
  html: string,
): {
  title: string;
  author: string | null;
  publishedAt: string | null;
  transcriptUrl: string | null;
} {
  const dom = new JSDOM(html);
  const title =
    dom.window.document.title.replace(/\s+-\s+YouTube$/i, "").trim() ||
    "YouTube Video";
  const response = extractPlayerResponse(html);
  const transcriptUrl =
    response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0]?.baseUrl ?? null;

  return {
    title: response?.videoDetails?.title?.trim() || title || sourceUrl,
    author: response?.videoDetails?.author?.trim() || null,
    publishedAt:
      response?.microformat?.playerMicroformatRenderer?.publishDate?.trim() || null,
    transcriptUrl,
  };
}

export function parseYouTubeTranscriptXml(xml: string): string {
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  const texts = Array.from<Element>(dom.window.document.querySelectorAll("text"))
    .map((node) => decodeHtmlEntities(node.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return texts.join(" ");
}

function extractPlayerResponse(html: string): YouTubePlayerResponse | null {
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index];
    if (!char) {
      break;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end === -1) {
    return null;
  }

  try {
    return JSON.parse(html.slice(jsonStart, end)) as YouTubePlayerResponse;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function firstSentence(input: string): string | null {
  const sentence = input.match(/(.+?[.!?])(?:\s|$)/)?.[1]?.trim() ?? input.trim();
  return sentence || null;
}

