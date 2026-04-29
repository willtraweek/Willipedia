import type { APIRoute } from "astro";
import { getBearerFromCookies } from "@/lib/config";
import { createMissingPreviewPayload, createPreviewPayload } from "@/lib/ui";
import { resolveSlug } from "@/lib/vault";

export const GET: APIRoute = async ({ params, cookies }) => {
  if (!getBearerFromCookies(cookies)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  const slug = params.slug ?? "";
  const entry = await resolveSlug(slug).catch(() => null);

  if (!entry) {
    return new Response(JSON.stringify(createMissingPreviewPayload(slug)), {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  return Response.json(createPreviewPayload(entry));
};
