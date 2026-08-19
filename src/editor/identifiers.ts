const AUTHOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function isAuthorId(id: string): boolean {
  return AUTHOR_ID_PATTERN.test(id);
}

export function suggestId(label: string, fallback: string): string {
  const normalized = label
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || fallback;
}

export function uniqueId(base: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
