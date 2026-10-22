import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApi } from './api.mjs';
const port = Number(process.env.PORT || 5173);
const api = createApi();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png' };
const root = path.resolve('dist');
http.createServer((req, res) => api(req, res, () => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let filename = path.resolve(root, '.' + pathname);
  if (!filename.startsWith(root + path.sep) && filename !== root) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
  fs.createReadStream(filename).on('error', () => { res.statusCode = 404; res.end('Build the app first: npm run build'); }).pipe(res);
})).listen(port, '127.0.0.1', () => console.log(`Spool is ready at http://localhost:${port}`));
