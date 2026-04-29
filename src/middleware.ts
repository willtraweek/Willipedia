import type { MiddlewareHandler } from "astro";
import { withBase } from "@/lib/base";
import { getBearerFromCookies, getInitialSetupIssues } from "@/lib/config";

const AUTH_PATH = withBase("/auth");
const AUTH_SUBMIT_PATH = withBase("/auth/submit");
const SETUP_PATH = withBase("/_setup");

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { url, cookies, locals, redirect } = context;
  const { pathname, search } = url;

  locals.bearer = getBearerFromCookies(cookies);

  if (pathname.startsWith("/fonts/") || pathname.startsWith("/_astro/")) {
    return next();
  }

  const initialIssues = getInitialSetupIssues();
  if (
    initialIssues.length &&
    pathname !== SETUP_PATH &&
    !pathname.startsWith("/fonts/")
  ) {
    return redirect(withBase("/_setup"));
  }

  if (
    pathname === AUTH_PATH ||
    pathname === AUTH_SUBMIT_PATH ||
    pathname === SETUP_PATH ||
    pathname.startsWith(withBase("/api/"))
  ) {
    return next();
  }

  if (!locals.bearer) {
    const nextPath = `${pathname}${search}`;
    return redirect(`${AUTH_PATH}?next=${encodeURIComponent(nextPath)}`);
  }

  return next();
};
