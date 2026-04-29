const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "2-digit",
  year: "numeric"
});

export function getIssueNumber(now = new Date()): number {
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

export function formatMastheadDate(now = new Date()): string {
  return DATE_FORMATTER.format(now).toUpperCase().replace(",", " ·");
}

export function formatTimestamp(now = new Date()): string {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);

  return `${time} · PID ${process.pid}`;
}

export function formatRelativeDays(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.max(0, Math.round(diffMs / 86_400_000));

  if (diffDays <= 0) {
    return "UPDATED · TODAY";
  }

  if (diffDays === 1) {
    return "UPDATED · 1 DAY AGO";
  }

  return `UPDATED · ${diffDays} DAYS AGO`;
}
