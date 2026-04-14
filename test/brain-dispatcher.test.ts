import { describe, expect, test } from "bun:test";

import { UrlDispatcher } from "../src/brain/dispatcher";

describe("UrlDispatcher", () => {
  const dispatcher = new UrlDispatcher();

  test("detects youtube URLs", () => {
    expect(dispatcher.detectFormat("https://www.youtube.com/watch?v=abc123")).toBe(
      "youtube",
    );
    expect(dispatcher.detectFormat("https://youtu.be/abc123")).toBe("youtube");
  });

  test("defaults non-youtube URLs to article", () => {
    expect(dispatcher.detectFormat("https://example.com/article")).toBe("article");
  });
});
