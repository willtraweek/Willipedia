import fs from "node:fs/promises";
import type { APIRoute } from "astro";
import mime from "mime-types";
import { resolveAssetPath } from "@/lib/vault";

export const GET: APIRoute = async ({ params }) => {
  try {
    const asset = params.asset ?? "";
    const realPath = await resolveAssetPath(asset);
    const mimeType = mime.lookup(realPath);

    if (!mimeType || (!mimeType.startsWith("image/") && mimeType !== "application/pdf")) {
      return new Response("Not found", { status: 404 });
    }

    const file = await fs.readFile(realPath);
    return new Response(file, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": mimeType
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not found";
    const status = message.includes("Invalid") || message.includes("escapes") ? 400 : 404;
    return new Response("Not found", { status });
  }
};
