import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReadStream } from 'node:fs';
import { createCatalog, extension, isModel, MAX_FILE } from './catalog.mjs';
import { providerStatus, searchProviders } from './providers.mjs';

async function body(req, limit = MAX_FILE) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Upload is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function createApi({ dataDirectory = process.env.SPOOL_DATA_DIR || path.resolve('.local-data'), home = os.homedir() } = {}) {
  const store = createCatalog(dataDirectory);
  const send = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  return async (req, res, next = () => { res.statusCode = 404; res.end(); }) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    // Local filesystem endpoints must only be reachable from this app on loopback.
    const host = req.headers.host || '';
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, { error: 'Only the local app can access these files.' }, 403);
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return send(res, { error: 'Only the local app can access these files.' }, 403);
    try {
      const route = url.pathname;
      if (route === '/api/info') return send(res, { home, dataDirectory, providers: providerStatus() });
      if (route === '/api/catalog' && req.method === 'GET') return send(res, await store.read());
      if (route === '/api/browse' && req.method === 'GET') {
        const directory = path.resolve(url.searchParams.get('path') || home);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const visible = entries.filter(e => !e.name.startsWith('.') && (e.isDirectory() || isModel(e.name) || extension(e.name) === 'zip'));
        const items = await Promise.all(visible.map(async entry => {
          const absolutePath = path.join(directory, entry.name);
          let stat; try { stat = await fs.stat(absolutePath); } catch { return null; }
          return { id: absolutePath, name: entry.name, title: entry.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '), path: absolutePath, directory: entry.isDirectory(), format: extension(entry.name), size: stat.size, added: stat.mtime.toISOString(), tags: [] };
        }));
        return send(res, { path: directory, parent: path.dirname(directory), items: items.filter(Boolean).sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name)) });
      }
      if (route === '/api/local-file' && req.method === 'GET') {
        const filename = path.resolve(url.searchParams.get('path') || '');
        if (!isModel(filename) && extension(filename) !== 'zip') throw new Error('Unsupported preview format.');
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Preview is limited to files smaller than 300 MB.');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
        createReadStream(filename).on('error', () => res.destroy()).pipe(res); return;
      }
      if (route.startsWith('/api/files/') && req.method === 'GET') {
        const id = route.split('/').pop();
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid file ID.');
        const catalog = await store.read();
        const item = [...catalog.items, ...catalog.archives].find(i => i.id === id);
        if (!item) return send(res, { error: 'File not found.' }, 404);
        const bytes = await fs.readFile(path.join(store.assets, id));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}` }); res.end(bytes); return;
      }
      if (route === '/api/import' && req.method === 'POST') {
        const bytes = await body(req);
        return send(res, await store.add(bytes, path.basename(url.searchParams.get('name') || 'model.stl'), { source: url.searchParams.get('source') || '' }));
      }
      if (route === '/api/import-local' && req.method === 'POST') {
        const { path: filename, source } = JSON.parse(await body(req, 10000));
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Choose a file smaller than 300 MB.');
        return send(res, await store.add(await fs.readFile(filename), path.basename(filename), { source, originalPath: filename }));
      }
      if (route.startsWith('/api/items/')) {
        const id = route.split('/').pop();
        if (req.method === 'PATCH') return send(res, await store.update(id, JSON.parse(await body(req, 100000))));
        if (req.method === 'DELETE') { await store.remove(id); return send(res, { ok: true }); }
      }
      if (route === '/api/backup' && req.method === 'GET') {
        const bytes = await store.backup();
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="spool-backup.zip"' }); res.end(bytes); return;
      }
      if (route === '/api/restore' && req.method === 'POST') return send(res, await store.restore(await body(req)));
      if (route === '/api/discover' && req.method === 'GET') {
        const query = (url.searchParams.get('q') || '').slice(0, 200).trim();
        return send(res, query ? await searchProviders(query, url.searchParams.get('provider')) : { items: [], errors: [], connected: 0 });
      }
      send(res, { error: 'Unknown endpoint.' }, 404);
    } catch (error) { if (!res.headersSent) send(res, { error: error.code === 'ENOENT' ? 'This file or folder could not be found.' : error.code === 'EACCES' ? 'You do not have permission to open this folder.' : error.message }, 400); else res.destroy(); }
  };
}
