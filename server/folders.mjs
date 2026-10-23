import fs from 'node:fs/promises';
import path from 'node:path';
import { extension, isModel } from './catalog.mjs';

// Only descend into roots the user added. Symlinks are skipped to avoid loops and
// accidentally crossing into another disk or tree through a linked directory.
export async function scanFolder(root, { limit = 50000, exclude = [] } = {}) {
  const items = [], warnings = [];
  const pending = [root];
  let truncated = false;
  while (pending.length && !truncated) {
    const directory = pending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (directory === root) throw new Error(error.code === 'ENOENT' ? 'This folder is unavailable. Reconnect its drive or choose a new location.' : 'This folder could not be read. Check its permissions.');
      warnings.push(`Could not read ${path.relative(root, directory)}`); continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const filename = path.join(directory, entry.name);
      if (exclude.some(excluded => filename === excluded || filename.startsWith(excluded + path.sep))) continue;
      if (entry.isDirectory()) { pending.push(filename); continue; }
      if (!entry.isFile() || (!isModel(entry.name) && extension(entry.name) !== 'zip')) continue;
      try {
        const stat = await fs.stat(filename);
        items.push({ id: filename, name: entry.name, title: entry.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '), path: filename, relativePath: path.relative(root, filename), format: extension(entry.name), size: stat.size, added: stat.mtime.toISOString(), tags: [] });
      } catch { warnings.push(`Could not read ${path.relative(root, filename)}`); }
      if (items.length >= limit) { truncated = true; break; }
    }
  }
  items.sort((a,b) => a.relativePath.localeCompare(b.relativePath));
  return { items, warnings, truncated, scannedAt: new Date().toISOString() };
}
export function createFolderLibrary(store, dataDirectory) {
  const indexDirectory = path.join(dataDirectory, 'folder-index');
  const scans = new Map();
  async function find(id) {
    const folder = (await store.read()).folders.find(f => f.id === id);
    if (!folder) throw new Error('Folder not found.');
    return folder;
  }
  async function rescan(id) {
    if (scans.has(id)) return scans.get(id);
    const pending = (async () => {
      const folder = await find(id);
      const result = await scanFolder(folder.path, { exclude: [path.resolve(dataDirectory)] });
      await fs.mkdir(indexDirectory, { recursive: true });
      await fs.writeFile(path.join(indexDirectory, id + '.tmp'), JSON.stringify(result));
      await fs.rename(path.join(indexDirectory, id + '.tmp'), path.join(indexDirectory, id + '.json'));
      await store.updateFolder(id, { count: result.items.length, scannedAt: result.scannedAt, warnings: result.warnings.length, truncated: result.truncated });
      return { folder, ...result };
    })();
    scans.set(id, pending);
    try { return await pending; } finally { scans.delete(id); }
  }
  async function files(id) {
    const folder = await find(id);
    try {
      await fs.access(folder.path);
      const index = JSON.parse(await fs.readFile(path.join(indexDirectory, id + '.json'), 'utf8'));
      return { folder, ...index };
    } catch (error) {
      if (error.code === 'ENOENT') {
        try { await fs.access(folder.path); } catch { throw new Error('This folder is unavailable. Reconnect its drive and try again.'); }
        return rescan(id);
      }
      if (error.code === 'EACCES') throw new Error('This folder is unavailable. Check its permissions.');
      throw error;
    }
  }
  async function add(filename) {
    const folder = await store.addFolder(filename);
    return rescan(folder.id);
  }
  return { add, files, rescan };
}
