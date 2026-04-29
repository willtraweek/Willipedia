import type { APIRoute } from "astro";
import { encodeSlugPath, withBase } from "@/lib/base";
import { getBearerFromCookies } from "@/lib/config";
import { listBacklinks } from "@/lib/wrapper";

export const GET: APIRoute = async ({ params, cookies }) => {
  const bearer = getBearerFromCookies(cookies);
  if (!bearer) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  const slug = params.slug ?? "";
  try {
    const items = await listBacklinks(slug, bearer);
    return Response.json({
      items: items.map((item) => ({
        ...item,
        href: withBase(`/page/${encodeSlugPath(item.slug)}`)
      }))
    });
  } catch {
    return new Response(JSON.stringify({ items: [] }), {
      status: 503,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
};
