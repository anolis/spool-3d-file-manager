import { Readable } from 'node:stream';
import { createService } from './service.mjs';

// Development/test adapter. The installed desktop app never creates an HTTP server.
export function createApi(options = {}) {
  const service = createService(options);
  return async (req, res, next = () => { res.statusCode = 404; res.end(); }) => {
    if (!new URL(req.url, 'http://localhost').pathname.startsWith('/api/')) return next();
    const host = req.headers.host || '';
    if (req.headers['sec-fetch-site'] === 'cross-site' || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the local app can access these files.' })); return;
    }
    try {
      const options = { method: req.method, headers: req.headers };
      if (!['GET','HEAD'].includes(req.method)) { options.body = Readable.toWeb(req); options.duplex = 'half'; }
      const response = await service(new Request(`http://${host}${req.url}`, options));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res); else res.end();
    } catch (error) { if (!res.headersSent) { res.writeHead(500); res.end('Local request failed.'); } else res.destroy(); }
  };
}
