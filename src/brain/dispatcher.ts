import type { SourceFormat } from "../core/types";

import { ArticleSourceHandler } from "./handlers/article";
import { YouTubeSourceHandler } from "./handlers/youtube";
import type { NormalizedSource } from "./types";

export class UrlDispatcher {
  constructor(
    private readonly articleHandler = new ArticleSourceHandler(),
    private readonly youtubeHandler = new YouTubeSourceHandler(),
  ) {}

  detectFormat(url: string): SourceFormat {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname.includes("youtube.com") ||
      hostname.includes("youtu.be")
    ) {
      return "youtube";
    }

    return "article";
  }

  async dispatch(url: string): Promise<NormalizedSource> {
    const format = this.detectFormat(url);
    return format === "youtube"
      ? this.youtubeHandler.fetch(url)
      : this.articleHandler.fetch(url);
  }
}
