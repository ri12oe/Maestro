const DAY = 86_400_000;
const shortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** "Nov 20" from an ISO date or date-time. Date-only strings are read as UTC so they don't shift a day. */
export function shortDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return shortFmt.format(d);
}

/** "today", "yesterday", "5 days ago". */
export function daysAgo(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "due in 3 days", "due today", "2 days overdue". */
export function dueLabel(dueIso: string, now = new Date()): { text: string; urgent: boolean } {
  const due = new Date(dueIso.length === 10 ? `${dueIso}T23:59:59Z` : dueIso);
  const days = Math.ceil((due.getTime() - now.getTime()) / DAY) - (dueIso.length === 10 ? 1 : 0);
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, urgent: true };
  if (days === 0) return { text: 'due today', urgent: true };
  return { text: `due in ${days} day${days === 1 ? '' : 's'}`, urgent: days <= 7 };
}

/** "just now", "5 min ago", "3 hours ago", "Nov 12". */
export function timeAgo(iso: string, now = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return shortDate(iso);
}
