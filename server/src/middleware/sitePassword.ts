import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Optional password gate for a hosted deploy.
 *
 * When SITE_PASSWORD is set, pages and API routes need HTTP Basic auth.
 * The browser shows its own sign-in prompt. The username is SITE_USER
 * (default "maestro"). The one exception is the path `/api/health`: Railway
 * probes it with no credentials. The middleware is mounted on the app, so
 * `req.path` is the full path and the comparison is exact. When
 * SITE_PASSWORD is unset, the gate does nothing, so local development is
 * unchanged.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against itself so the timing doesn't reveal the length mismatch.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function sitePassword(
  password = process.env.SITE_PASSWORD,
  user = process.env.SITE_USER || 'maestro',
): RequestHandler {
  if (!password) return (_req, _res, next) => next();

  return (req, res, next) => {
    if (req.path === '/api/health') return next();

    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep !== -1) {
        const okUser = safeEqual(decoded.slice(0, sep), user);
        const okPass = safeEqual(decoded.slice(sep + 1), password);
        if (okUser && okPass) return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Maestro", charset="UTF-8"');
    res.status(401).send('Sign in required.');
  };
}
