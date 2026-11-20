/**
 * In-memory guards for team create and sync.
 * One process, one fixed window. No shared store: a restart clears the counts.
 */

export const requestLimits = {
  windowMs: 60_000,
  createPerIp: 60,
  syncPerIp: 60,
  syncPerTeam: 30,
};

interface Bucket {
  start: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
const syncing = new Set<number>();

export function resetRequestLimits(): void {
  buckets.clear();
  syncing.clear();
}

/** True when this key is over its limit for the current window. */
export function overLimit(key: string, limit: number, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= requestLimits.windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string | null } }): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** False when this team already has a sync in flight. */
export function beginSync(teamId: number): boolean {
  if (syncing.has(teamId)) return false;
  syncing.add(teamId);
  return true;
}

export function endSync(teamId: number): void {
  syncing.delete(teamId);
}
