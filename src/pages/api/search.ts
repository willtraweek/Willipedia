import type { APIRoute } from "astro";
import { getBearerFromCookies } from "@/lib/config";
import { getExcerptForSlug } from "@/lib/vault";
import { WrapperError, searchArchive } from "@/lib/wrapper";

export const GET: APIRoute = async ({ request, cookies }) => {
  const bearer = getBearerFromCookies(cookies);
  if (!bearer) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return Response.json({ items: [] });
  }

  try {
    const results = await searchArchive(query, bearer);
    const normalized = await Promise.all(
      results.map(async (result) => ({
        ...result,
        excerpt: result.excerpt || (await getExcerptForSlug(result.slug))
      }))
    );
    return Response.json({ items: normalized });
  } catch (error) {
    const status = error instanceof WrapperError && error.kind === "unauthorized" ? 401 : 503;
    return new Response(JSON.stringify({ error: "search_unavailable" }), {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
};
