type JsonRecord = Record<string, unknown>;

export function getAdOsRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

export function formatAdOsNumber(value: unknown): string {
  return Number(value || 0).toLocaleString('ko-KR');
}

export function formatAdOsBlockers(value: unknown): string {
  if (!Array.isArray(value)) return 'none';
  return value.length > 0 ? value.map(String).join(', ') : 'none';
}

export function buildGuardedApplyMessage(json: JsonRecord): string {
  const summary = getAdOsRecord(json.summary);
  return [
    'Guarded apply complete:',
    `applied ${formatAdOsNumber(summary.applied_count)}`,
    `test candidates ${formatAdOsNumber(summary.start_test_candidates)}`,
    `blocked ${formatAdOsNumber(summary.blocked_by_guardrail)}`,
  ].join(' ');
}

export function buildPilotSetupMessage(json: JsonRecord): string {
  const summary = getAdOsRecord(json.summary);
  return [
    'Pilot setup complete:',
    `budget channels ${formatAdOsNumber(summary.budget_channels_configured)}`,
    `naver keywords ${formatAdOsNumber(summary.naver_keywords_approved)}`,
    `campaigns ${formatAdOsNumber(summary.internal_campaigns_created)}`,
    `creatives ${formatAdOsNumber(summary.internal_creatives_created)}`,
    'external spend 0',
  ].join(' ');
}

export function buildPublishDraftsMessage(json: JsonRecord): string {
  const summary = getAdOsRecord(json.summary);
  return [
    'Publish drafts complete:',
    `created campaigns ${formatAdOsNumber(summary.created_campaigns)}`,
    `created creatives ${formatAdOsNumber(summary.created_creatives)}`,
    `linked keywords ${formatAdOsNumber(summary.linked_keywords)}`,
    `blocked groups ${formatAdOsNumber(summary.blocked_groups)}`,
  ].join(' ');
}
