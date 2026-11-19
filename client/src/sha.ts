/**
 * The part of a stored commit sha that the UI shows and that commit links use.
 *
 * Demo rows store `demo:studybuddy:<token>` so the value cannot collide with a
 * real GitHub sha. The token is the text after the last colon. A real sha is
 * 40 hex characters and contains no colon, so it is returned unchanged.
 */
export function commitShaToken(sha: string): string {
  const cut = sha.lastIndexOf(':');
  return cut === -1 ? sha : sha.slice(cut + 1);
}

/**
 * First 7 characters of `commitShaToken`. A 40-hex GitHub sha keeps the same
 * 7-character prefix `github_sha.slice(0, 7)` used to show.
 * Null and undefined stay empty so a manual entry renders no sha.
 */
export function shortCommitSha(sha: string | null | undefined): string | undefined {
  if (sha == null) return undefined;
  return commitShaToken(sha).slice(0, 7);
}
