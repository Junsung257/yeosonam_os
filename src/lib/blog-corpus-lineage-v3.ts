type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nestedString(record: UnknownRecord | null, parent: string, key: string): string | null {
  const value = asRecord(record?.[parent])?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A canonical refresh can leave earlier, private shadow drafts for audit.
 * Those rows remain valuable history, but they must not compete with a retry
 * that is replacing the same published creative.
 */
export function readBlogReplacementTargetCreativeId(meta: unknown): string | null {
  const record = asRecord(meta);
  return nestedString(record, 'automated_published_replacement', 'target_creative_id')
    ?? nestedString(record, 'reviewed_published_replacement', 'target_creative_id')
    ?? nestedString(record, 'private_regeneration', 'replaced_creative_id');
}

export function belongsToBlogReplacementLineage(input: {
  id?: string | null;
  meta?: unknown;
  replacementTargetCreativeId?: string | null;
}): boolean {
  const target = input.replacementTargetCreativeId?.trim();
  if (!target) return false;
  return input.id === target || readBlogReplacementTargetCreativeId(input.meta) === target;
}
