import type { APIRoute } from "astro";
import { withBase } from "@/lib/base";
import {
  AUTH_COOKIE_NAME,
  getWrapperTimeoutIssue
} from "@/lib/config";
import { WrapperError, validateBearer } from "@/lib/wrapper";

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const formData = await request.formData();
  const bearer = String(formData.get("bearer") || "").trim();
  const nextPath = String(formData.get("next") || withBase("/"));

  if (!bearer) {
    return redirect(`${withBase("/auth")}?next=${encodeURIComponent(nextPath)}&error=invalid`);
  }

  try {
    await validateBearer(bearer);
  } catch (error) {
    if (error instanceof WrapperError && error.kind === "unauthorized") {
      return redirect(`${withBase("/auth")}?next=${encodeURIComponent(nextPath)}&error=invalid`);
    }

    const issue = getWrapperTimeoutIssue(error);
    return redirect(`${withBase("/_setup")}?code=${encodeURIComponent(issue.code)}`);
  }

  cookies.set(AUTH_COOKIE_NAME, bearer, {
    httpOnly: true,
    path: "/wiki",
    sameSite: "lax",
    secure: url.protocol === "https:"
  });

  return redirect(nextPath);
};
