export type ProductRegistrationWatchdogAction = 'ignore' | 'restart' | 'quarantine';

export function productRegistrationWatchdogAction(input: {
  createdAt: string;
  lastHeartbeatAt: string | null;
  now?: number;
  staleAfterMs?: number;
  quarantineAfterMs?: number;
}): ProductRegistrationWatchdogAction {
  const now = input.now ?? Date.now();
  const createdAt = Date.parse(input.createdAt);
  const lastActivity = Date.parse(input.lastHeartbeatAt ?? input.createdAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastActivity)) return 'quarantine';
  const staleAfterMs = input.staleAfterMs ?? 30 * 60_000;
  const quarantineAfterMs = input.quarantineAfterMs ?? 2 * 60 * 60_000;
  if (now - lastActivity < staleAfterMs) return 'ignore';
  return now - createdAt >= quarantineAfterMs ? 'quarantine' : 'restart';
}
