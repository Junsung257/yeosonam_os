export type SettlementExceptionStatus = 'open' | 'resolved' | 'waived';

export function buildSettlementExceptionUpdate(
  input: Record<string, unknown>,
  actor: string,
  resolvedAt = new Date().toISOString(),
): Record<string, unknown> {
  const status: SettlementExceptionStatus = input.status === 'resolved' || input.status === 'waived'
    ? input.status
    : 'open';
  const update: Record<string, unknown> = { status };

  if (Object.prototype.hasOwnProperty.call(input, 'assignedTo')) {
    update.assigned_to = typeof input.assignedTo === 'string' ? input.assignedTo.trim() || null : null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'reason')) {
    update.reason = typeof input.reason === 'string' ? input.reason.trim() || null : null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) {
    update.due_date = typeof input.dueDate === 'string' && input.dueDate ? input.dueDate : null;
  }
  if (status !== 'open') {
    update.resolved_at = resolvedAt;
    update.resolved_by = actor;
  }

  return update;
}
