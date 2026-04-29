import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as getBacklinks } from "@/pages/api/backlinks/[slug]";
import { GET as getPreview } from "@/pages/api/preview/[...slug]";
import { GET as getSearch } from "@/pages/api/search";

const fixtureVault = new URL("../fixtures/vault", import.meta.url).pathname;

function cookieJar() {
  return {
    get(name: string) {
      if (name === "willipedia_bearer") {
        return { value: "valid-bearer" };
      }

      return undefined;
    }
  };
}

describe("api endpoints", () => {
  beforeEach(() => {
    process.env.GBRAIN_PATH = fixtureVault;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === "tools/list") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [{ name: "search" }, { name: "list_backlinks" }]
              }
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        if (body.method === "tools/call" && body.params.name === "search") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                structuredContent: {
                  results: [
                    {
                      slug: "Mathematics/Set-Theory",
                      title: "Set Theory",
                      excerpt: "",
                      categories: ["MATHEMATICS"]
                    }
                  ]
                }
              }
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        if (body.method === "tools/call" && body.params.name === "list_backlinks") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                structuredContent: {
                  backlinks: [
                    {
                      slug: "Mathematics/Set-Theory",
                      title: "Set Theory",
                      parent_folder: "MATHEMATICS"
                    }
                  ]
                }
              }
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("bad request", { status: 400 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("normalizes search results and falls back to local excerpts", async () => {
    const response = await getSearch({
      request: new Request("http://example.com/wiki/api/search?q=set"),
      cookies: cookieJar()
    } as never);

    const payload = await response.json();
    expect(payload.items[0].slug).toBe("Mathematics/Set-Theory");
    expect(payload.items[0].excerpt).toContain("Set theory gives mathematics");
  });

  test("normalizes backlinks into href-bearing items", async () => {
    const response = await getBacklinks({
      params: { slug: "Logic/Godel" },
      cookies: cookieJar()
    } as never);

    const payload = await response.json();
    expect(payload.items[0]).toMatchObject({
      slug: "Mathematics/Set-Theory",
      href: "/wiki/page/Mathematics/Set-Theory"
    });
  });

  test("returns preview payloads for local files", async () => {
    const response = await getPreview({
      params: { slug: "Logic/Godel" },
      cookies: cookieJar()
    } as never);

    const payload = await response.json();
    expect(payload.title).toBe("Godel");
    expect(payload.broken).toBe(false);
  });
});
