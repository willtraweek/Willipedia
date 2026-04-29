import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/pages/auth/submit";

function makeRedirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url
    }
  });
}

describe("auth submit", () => {
  beforeEach(() => {
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
                tools: [{ name: "search" }]
              }
            }),
            {
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        return new Response("bad request", { status: 400 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("sets the auth cookie and redirects on valid bearer", async () => {
    const cookies = {
      set: vi.fn()
    };

    const request = new Request("https://example.com/wiki/auth/submit", {
      method: "POST",
      body: new URLSearchParams({
        bearer: "valid-bearer",
        next: "/wiki/"
      })
    });

    const response = await POST({
      request,
      cookies,
      redirect: makeRedirect,
      url: new URL(request.url)
    } as never);

    expect(response.headers.get("Location")).toBe("/wiki/");
    expect(cookies.set).toHaveBeenCalledWith(
      "willipedia_bearer",
      "valid-bearer",
      expect.objectContaining({
        httpOnly: true,
        path: "/wiki",
        sameSite: "lax",
        secure: true
      })
    );
  });
});
