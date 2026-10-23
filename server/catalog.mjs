import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';

export const formats = new Set(['stl', 'step', 'stp', 'gcode', '3mf']);
export const extension = name => name.split('.').pop().toLowerCase();
export const isModel = name => formats.has(extension(name));
export const MAX_FILE = 300 * 1024 * 1024;
export function sourceInText(text) {
  const urls = text.match(/https?:\/\/[^\s<>"'\]\[)]+/gi) || [];
  return urls.find(u => /(?:printables\.com\/model\/|thingiverse\.com\/thing:|makerworld\.com\/.+models\/|myminifactory\.com\/object\/|cults3d\.com\/.+3d-model\/)/i.test(u)) || '';
}
export function validSource(value) {
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http or https source link.');
  return url.href;
}
export function archiveContents(bytes) {
  let expanded = 0;
  return unzipSync(bytes, { filter(file) {
    expanded += file.originalSize;
    if (expanded > 600 * 1024 * 1024 || file.originalSize > MAX_FILE) throw new Error('Archive expands beyond the 600 MB safety limit.');
    return isModel(file.name) || /\.(txt|md|url|html)$/i.test(file.name);
  } });
}
export function createCatalog(directory) {
  const assets = path.join(directory, 'files');
  const manifest = path.join(directory, 'catalog.json');
  let queue = Promise.resolve();
  async function read() {
    try { const catalog = JSON.parse(await fs.readFile(manifest, 'utf8')); catalog.folders ||= []; return catalog; }
    catch (err) { if (err.code === 'ENOENT') return { version: 1, items: [], archives: [], folders: [] }; throw err; }
  }
  async function transaction(fn) {
    const pending = queue.then(async () => {
      await fs.mkdir(assets, { recursive: true });
      const catalog = await read();
      const result = await fn(catalog);
      await fs.writeFile(manifest + '.tmp', JSON.stringify(catalog, null, 2));
      await fs.rename(manifest + '.tmp', manifest);
      return result;
    });
    queue = pending.catch(() => {});
    return pending;
  }
  async function add(bytes, name, options = {}) {
    if (bytes.byteLength > MAX_FILE) throw new Error('Files must be smaller than 300 MB.');
    const source = validSource(options.source || '');
    return transaction(async catalog => {
      const added = []; let skipped = 0;
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (catalog.items.some(i => i.hash === hash) || catalog.archives.some(i => i.hash === hash)) return { added, skipped: 1 };
      const archive = extension(name) === 'zip';
      if (!archive && !isModel(name)) throw new Error('Choose STL, STEP, G-code, 3MF, or ZIP files.');
      const contents = archive ? archiveContents(bytes) : { [name]: bytes };
      const entries = Object.entries(contents).filter(([filename]) => isModel(filename));
      if (!entries.length) throw new Error('No supported 3D files were found in this archive.');
      let detected = source;
      if (!detected && archive) {
        for (const [filename, data] of Object.entries(contents)) {
          if (/\.(txt|md|url|html)$/i.test(filename) && data.length < 1024 * 1024) detected ||= sourceInText(strFromU8(data));
        }
      }
      const archiveId = archive ? randomUUID() : undefined;
      if (archive) {
        await fs.writeFile(path.join(assets, archiveId), bytes);
        catalog.archives.push({ id: archiveId, name, source: detected, hash, size: bytes.length });
      }
      for (const [filename, data] of entries) {
        const fileHash = createHash('sha256').update(data).digest('hex');
        if (catalog.items.some(i => i.hash === fileHash && i.archiveId === archiveId)) { skipped++; continue; }
        const id = randomUUID();
        // Imported bytes are copied to owned storage; browsed originals are never modified.
        await fs.writeFile(path.join(assets, id), data);
        const item = { id, name: path.basename(filename), title: path.basename(filename).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), format: extension(filename), size: data.length, hash: fileHash, added: new Date().toISOString(), source: detected, tags: [], notes: '', favorite: false, printed: false, archiveId, archiveName: archive ? name : undefined, archivePath: archive ? filename : undefined, originalPath: options.originalPath };
        catalog.items.push(item); added.push(item);
      }
      return { added, skipped };
    });
  }
  async function update(id, patch) {
    return transaction(catalog => {
      const item = catalog.items.find(i => i.id === id);
      if (!item) throw new Error('Model not found.');
      for (const key of ['title', 'notes']) if (typeof patch[key] === 'string') item[key] = patch[key].slice(0, 10000);
      if ('source' in patch) item.source = validSource(patch.source);
      if (Array.isArray(patch.tags)) item.tags = [...new Set(patch.tags.map(String).map(t => t.trim()).filter(Boolean))].slice(0, 30);
      for (const key of ['favorite', 'printed']) if (typeof patch[key] === 'boolean') item[key] = patch[key];
      return item;
    });
  }
  async function remove(id) {
    return transaction(catalog => { catalog.items = catalog.items.filter(i => i.id !== id); });
  }
  async function addFolder(filename) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('Choose an absolute folder path.');
    const canonical = await fs.realpath(filename);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Choose a folder, not a file.');
    return transaction(catalog => {
      const existing = catalog.folders.find(folder => folder.path === canonical);
      if (existing) return existing;
      if (catalog.folders.some(folder => canonical.startsWith(folder.path + path.sep) || folder.path.startsWith(canonical + path.sep))) throw new Error('This location overlaps a folder already in your library. Remove the overlapping folder first.');
      const folder = { id: randomUUID(), name: path.basename(canonical) || canonical, path: canonical, added: new Date().toISOString(), count: 0 };
      catalog.folders.push(folder); return folder;
    });
  }
  async function updateFolder(id, patch) {
    return transaction(catalog => {
      const folder = catalog.folders.find(f => f.id === id);
      if (folder) Object.assign(folder, patch);
    });
  }
  async function removeFolder(id) {
    return transaction(catalog => { catalog.folders = catalog.folders.filter(f => f.id !== id); });
  }
  async function backup() {
    const catalog = await read();
    const files = { 'spool-catalog.json': strToU8(JSON.stringify(catalog)) };
    for (const entry of [...catalog.items, ...catalog.archives]) files[`files/${entry.id}`] = new Uint8Array(await fs.readFile(path.join(assets, entry.id)));
    return zipSync(files, { level: 0 });
  }
  async function restore(bytes) {
    let expanded = 0;
    const files = unzipSync(bytes, { filter(f) { expanded += f.originalSize; if (expanded > 1024 * 1024 * 1024) throw new Error('Backup exceeds 1 GB.'); return true; } });
    if (!files['spool-catalog.json']) throw new Error('This is not a Spool backup.');
    const data = JSON.parse(strFromU8(files['spool-catalog.json']));
    if (data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.archives)) throw new Error('Unsupported backup format.');
    for (const entry of [...data.items, ...data.archives]) {
      if (!/^[a-f0-9-]{36}$/.test(entry.id) || !files[`files/${entry.id}`]) throw new Error('Backup contains missing or invalid files.');
      if (typeof entry.name !== 'string' || typeof entry.size !== 'number' || entry.size < 0) throw new Error('Backup contains invalid file metadata.');
      if (entry.source) validSource(entry.source);
      if (data.items.includes(entry) && (typeof entry.title !== 'string' || typeof entry.added !== 'string' || !formats.has(entry.format) || !Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string'))) throw new Error('Backup contains invalid model metadata.');
    }
    return transaction(async catalog => {
      let count = 0;
      for (const entry of [...data.archives, ...data.items]) {
        const list = data.archives.includes(entry) ? catalog.archives : catalog.items;
        if (list.some(i => i.id === entry.id)) continue;
        await fs.writeFile(path.join(assets, entry.id), files[`files/${entry.id}`]);
        list.push(entry); if (list === catalog.items) count++;
      }
      for (const folder of data.folders || []) {
        if (typeof folder.path !== 'string' || !path.isAbsolute(folder.path) || typeof folder.name !== 'string' || !/^[a-f0-9-]{36}$/.test(folder.id)) throw new Error('Backup contains invalid folder metadata.');
        if (!catalog.folders.some(f => f.path === folder.path || f.id === folder.id)) catalog.folders.push({ ...folder, count: 0, scannedAt: undefined });
      }
      return { count };
    });
  }
  return { read, add, update, remove, backup, restore, addFolder, updateFolder, removeFolder, assets };
}
