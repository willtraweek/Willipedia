export const APP_BASE = "/wiki";

export function withBase(pathname: string): string {
  if (pathname.startsWith(APP_BASE)) {
    return pathname;
  }

  if (!pathname.startsWith("/")) {
    return `${APP_BASE}/${pathname}`;
  }

  return `${APP_BASE}${pathname}`;
}

export function encodeSlugPath(slug: string): string {
  return slug
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
