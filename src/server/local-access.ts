/** Opt-in for a loopback-only preview; never enable this on a public listener. */
export function isLocalPasswordlessRequest(request: Request): boolean {
  const configured = process.env.SANTA_OPS_LOCAL_PASSWORDLESS_ORIGIN;
  if (!configured) return false;

  let local: URL;
  let actual: URL;
  try {
    local = new URL(configured);
    actual = new URL(request.url);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(local.protocol)) return false;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) return false;
  // Requiring the canonical origin also excludes userinfo, paths, queries and fragments.
  if (configured !== local.origin || actual.origin !== configured) return false;
  if (request.headers.get('host')?.toLowerCase() !== local.host) return false;

  for (const name of request.headers.keys()) {
    if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-real-ip') return false;
  }
  if (request.headers.has('origin') && request.headers.get('origin') !== configured) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}
