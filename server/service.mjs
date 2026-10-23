import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createCatalog, MAX_FILE, isModel, extension } from './catalog.mjs';
import { createFolderLibrary } from './folders.mjs';
import { providerStatus, searchProviders } from './providers.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function body(request, limit = MAX_FILE) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('File is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
// This service does not listen on a port. The desktop app calls it through its
// private protocol; only the optional development adapter uses HTTP.
export function createService({ dataDirectory = process.env.SPOOL_DATA_DIR || path.resolve('.local-data'), home = os.homedir() } = {}) {
  const store = createCatalog(dataDirectory);
  const folders = createFolderLibrary(store, dataDirectory);
  return async request => {
    const url = new URL(request.url), route = url.pathname, method = request.method;
    try {
      if (route === '/api/info' && method === 'GET') return json({ home, dataDirectory, providers: providerStatus() });
      if (route === '/api/catalog' && method === 'GET') return json(await store.read());
      if (route === '/api/folders' && method === 'GET') return json((await store.read()).folders);
      if (route === '/api/folders' && method === 'POST') {
        const { path: filename } = JSON.parse(await body(request, 10000));
        return json(await folders.add(filename));
      }
      const folderRoute = route.match(/^\/api\/folders\/([a-f0-9-]{36})(?:\/(files|rescan))?$/);
      if (folderRoute) {
        const [, id, action] = folderRoute;
        if (action === 'files' && method === 'GET') return json(await folders.files(id));
        if (action === 'rescan' && method === 'POST') return json(await folders.rescan(id));
        if (!action && method === 'DELETE') { await store.removeFolder(id); return json({ ok: true }); }
      }
      if (route === '/api/local-file' && method === 'GET') {
        const filename = path.resolve(url.searchParams.get('path') || '');
        if (!isModel(filename) && extension(filename) !== 'zip') throw new Error('Unsupported preview format.');
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Preview is limited to files smaller than 300 MB.');
        return new Response(Readable.toWeb(createReadStream(filename)), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(stat.size), 'Cache-Control': 'no-store' } });
      }
      if (route.startsWith('/api/files/') && method === 'GET') {
        const id = route.split('/').pop();
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid file ID.');
        const catalog = await store.read();
        const item = [...catalog.items, ...catalog.archives].find(i => i.id === id);
        if (!item) return json({ error: 'File not found.' }, 404);
        const bytes = await fs.readFile(path.join(store.assets, id));
        return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}` } });
      }
      if (route === '/api/import' && method === 'POST') return json(await store.add(await body(request), path.basename(url.searchParams.get('name') || 'model.stl'), { source: url.searchParams.get('source') || '' }));
      if (route === '/api/import-local' && method === 'POST') {
        const { path: filename, source } = JSON.parse(await body(request, 10000));
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Choose a file smaller than 300 MB.');
        return json(await store.add(await fs.readFile(filename), path.basename(filename), { source, originalPath: filename }));
      }
      if (route.startsWith('/api/items/')) {
        const id = route.split('/').pop();
        if (method === 'PATCH') return json(await store.update(id, JSON.parse(await body(request, 100000))));
        if (method === 'DELETE') { await store.remove(id); return json({ ok: true }); }
      }
      if (route === '/api/backup' && method === 'GET') return new Response(await store.backup(), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="spool-backup.zip"' } });
      if (route === '/api/restore' && method === 'POST') return json(await store.restore(await body(request)));
      if (route === '/api/discover' && method === 'GET') {
        const query = (url.searchParams.get('q') || '').slice(0, 200).trim();
        return json(query ? await searchProviders(query, url.searchParams.get('provider') || 'all', { offset:Math.max(0,Math.min(2400,Number(url.searchParams.get('offset'))||0)) }) : { items: [], errors: [], connected: 0 });
      }
      return json({ error: 'Unknown endpoint.' }, 404);
    } catch (error) { return json({ error: error.code === 'ENOENT' ? 'This file or folder could not be found.' : error.code === 'EACCES' ? 'You do not have permission to open this folder.' : error.message }, 400); }
  };
}
