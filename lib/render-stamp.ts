import "server-only";

/**
 * A value that is new on every server render of a page: the server clock in
 * ms, then a random part. RefreshOnRevisit compares it to tell a page the
 * server just rendered from one the router showed again from its cache.
 */
export function renderStamp(): string {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}
