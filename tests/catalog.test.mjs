import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { createCatalog, sourceInText } from '../server/catalog.mjs';
import { createApi } from '../server/api.mjs';
const model = strToU8('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test');
async function fixture(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spool-test-')); t.after(() => fs.rm(dir, { recursive:true, force:true })); return dir; }

test('ZIP import preserves archive, relative paths and creator link; persists across reload', async t => {
  const directory = await fixture(t); const store = createCatalog(directory);
  const archive = zipSync({ 'models/widget.stl': model, 'README.md': strToU8('Original: https://www.printables.com/model/123-widget'), 'photo.jpg': new Uint8Array(3) });
  const result = await store.add(archive, 'widget.zip');
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].source, 'https://www.printables.com/model/123-widget');
  assert.equal(result.added[0].archivePath, 'models/widget.stl');
  const catalog = await createCatalog(directory).read();
  assert.equal(catalog.archives.length, 1);
  assert.deepEqual(await fs.readFile(path.join(store.assets, catalog.archives[0].id)), Buffer.from(archive));
  assert.equal((await store.add(archive, 'renamed.zip')).skipped, 1);
});

test('simultaneous imports and metadata updates do not overwrite each other', async t => {
  const store = createCatalog(await fixture(t));
  await Promise.all(Array.from({ length: 8 }, (_,i) => store.add(strToU8(`solid ${i}`), `${i}.stl`)));
  const { items } = await store.read(); assert.equal(items.length, 8);
  await Promise.all(items.map(item => store.update(item.id, { tags: ['test', 'test', ' workshop '], favorite: true })));
  assert.equal((await store.read()).items.filter(i => i.favorite).length, 8);
  assert.deepEqual((await store.read()).items[0].tags, ['test', 'workshop']);
});

test('backup roundtrip retains model bytes, annotations and original ZIP; restore merges', async t => {
  const store = createCatalog(await fixture(t));
  const added = (await store.add(zipSync({ 'widget.stl': model }), 'widget.zip')).added[0];
  await store.update(added.id, { title: 'Custom widget', tags: ['functional'], printed: true, notes: 'PLA 0.2', source: 'https://example.com/model' });
  const backup = await store.backup(); const restored = createCatalog(await fixture(t));
  assert.equal((await restored.restore(backup)).count, 1);
  assert.equal((await restored.restore(backup)).count, 0);
  const catalog = await restored.read(); assert.equal(catalog.items[0].notes, 'PLA 0.2');
  assert.deepEqual(await fs.readFile(path.join(restored.assets, added.id)), Buffer.from(model));
  assert.equal(catalog.archives.length, 1);
});

test('unsafe source links and malformed archives fail without mutating the catalog', async t => {
  const store = createCatalog(await fixture(t));
  await assert.rejects(store.add(model, 'a.stl', { source: 'javascript:alert(1)' }));
  await assert.rejects(store.add(new Uint8Array([1,2]), 'bad.zip'));
  await assert.rejects(store.add(zipSync({ 'photo.png': model }), 'empty.zip'));
  assert.equal((await store.read()).items.length, 0);
  assert.equal(sourceInText('https://thingiverse.com/thing:123'), 'https://thingiverse.com/thing:123');
});

test('local API blocks foreign origins and nonlocal hosts, browses folders without adding files', async t => {
  const dir = await fixture(t); await fs.writeFile(path.join(dir, 'model.stl'), model); await fs.writeFile(path.join(dir, 'secret.txt'), 'hidden');
  const server = http.createServer(createApi({ dataDirectory: path.join(dir, 'data'), home: dir }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(root+'/api/info', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => { http.get(root+'/api/info', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
  assert.equal(foreignHostStatus, 403);
  const listing = await (await fetch(root+'/api/browse')).json();
  assert.equal(listing.items.length, 1); assert.equal(listing.items[0].name, 'model.stl');
  assert.equal((await (await fetch(root+'/api/catalog')).json()).items.length, 0);
  assert.equal((await fetch(root+'/api/local-file?path='+encodeURIComponent(path.join(dir,'secret.txt')))).status, 400);
  const imported = await (await fetch(root+'/api/import-local', { method:'POST', body:JSON.stringify({ path:path.join(dir,'model.stl') }) })).json();
  const id = imported.added[0].id;
  await fetch(root+'/api/items/'+id, { method:'DELETE' });
  assert.deepEqual(await fs.readFile(path.join(dir,'model.stl')), Buffer.from(model));
});
