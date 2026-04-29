// @ts-nocheck

const port = Number(process.env.GBRAIN_WRAPPER_PORT || 8788);
const validBearer = "valid-bearer";

type RpcRequest = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}

function rpcResult(id: RpcRequest["id"], result: unknown): Response {
  return json({
    jsonrpc: "2.0",
    id,
    result
  });
}

Bun.serve({
  port,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }

    if (request.headers.get("authorization") !== `Bearer ${validBearer}`) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = (await request.json()) as RpcRequest;

    if (payload.method === "tools/list") {
      return rpcResult(payload.id, {
        tools: [{ name: "search" }, { name: "list_backlinks" }]
      });
    }

    if (payload.method !== "tools/call") {
      return json(
        {
          jsonrpc: "2.0",
          id: payload.id,
          error: {
            message: "unsupported method"
          }
        },
        { status: 400 }
      );
    }

    const name = String(payload.params?.name || "");
    const args = (payload.params?.arguments || {}) as Record<string, unknown>;

    if (name === "search") {
      const query = String(args.query || "").toLowerCase();
      const results =
        query.includes("godel") || query.includes("goedel")
          ? [
              {
                slug: "Logic/Godel",
                title: "Godel",
                excerpt: "Kurt Godel pushed arithmetic beyond formal certainty.",
                categories: ["LOGIC", "FOUNDATIONS"]
              }
            ]
          : query.includes("set")
            ? [
                {
                  slug: "Mathematics/Set-Theory",
                  title: "Set Theory",
                  excerpt: "",
                  categories: ["MATHEMATICS"]
                }
              ]
            : [];

      return rpcResult(payload.id, {
        structuredContent: {
          results
        }
      });
    }

    if (name === "list_backlinks") {
      const slug = String(args.slug || "");
      const backlinks =
        slug === "Logic/Godel"
          ? [
              {
                slug: "Mathematics/Set-Theory",
                title: "Set Theory",
                parent_folder: "MATHEMATICS"
              }
            ]
          : [];

      return rpcResult(payload.id, {
        structuredContent: {
          backlinks
        }
      });
    }

    return json(
      {
        jsonrpc: "2.0",
        id: payload.id,
        error: {
          message: "unknown tool"
        }
      },
      { status: 400 }
    );
  }
});

console.error(`mock-wrapper-listening:${port}`);
