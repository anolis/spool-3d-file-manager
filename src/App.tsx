import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Archive, ArrowDownToLine, ArrowLeft, ArrowRight, Box, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Copy, Download, ExternalLink, FileBox, Files, Folder, FolderOpen, Globe2, Grid2X2, HardDrive, Heart, Library, Link2, List, LoaderCircle, Plus, Search, Settings2, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X } from 'lucide-react';
import Viewer from './Viewer';
import { api, fileUrl, sizeLabel, sourceName, type Model, type Provider, type RemoteModel } from './types';

type Page = 'collection' | 'local' | 'discover' | 'favorites' | 'printed' | 'archives';
interface Catalog { items: Model[]; archives: { id: string; name: string; size: number }[] }
interface Info { home: string; dataDirectory: string; providers: Provider[] }
const accept = '.stl,.step,.stp,.gcode,.3mf,.zip';
const formatLabel = (format: string) => format === 'stp' ? 'STEP' : format.toUpperCase();

export default function App() {
  const [page, setPage] = useState<Page>('collection');
  const [catalog, setCatalog] = useState<Catalog>({ items: [], archives: [] });
  const [info, setInfo] = useState<Info>();
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('all');
  const [tag, setTag] = useState('all');
  const [archive, setArchive] = useState('all');
  const [sort, setSort] = useState('newest');
  const [list, setList] = useState(false);
  const [selected, setSelected] = useState<Model>();
  const [importOpen, setImportOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean }>();
  const [directory, setDirectory] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [parent, setParent] = useState('');
  const [localItems, setLocalItems] = useState<Model[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [provider, setProvider] = useState('all');
  const [remoteItems, setRemoteItems] = useState<RemoteModel[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteErrors, setRemoteErrors] = useState<string[]>([]);
  const [searched, setSearched] = useState('');
  const [bookmarks, setBookmarks] = useState<RemoteModel[]>(() => { try { const saved = JSON.parse(localStorage.getItem('spool-bookmarks') || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; } });
  const [showSaved, setShowSaved] = useState(false);
  const browseGeneration = useRef(0);
  const remoteGeneration = useRef(0);
  const restoreInput = useRef<HTMLInputElement>(null);

  const notify = (text: string, error = false) => setToast({ text, error });
  async function refresh() { setCatalog(await api<Catalog>('/api/catalog')); }
  useEffect(() => { Promise.all([api<Info>('/api/info'), api<Catalog>('/api/catalog')]).then(([data, cat]) => { setInfo(data); setPathInput(data.home); setCatalog(cat); }).catch(e => notify(e.message, true)); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(undefined), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { try { localStorage.setItem('spool-bookmarks', JSON.stringify(bookmarks)); } catch { notify('Saved links could not be written to browser storage.', true); } }, [bookmarks]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelected(undefined); setImportOpen(false); setSettingsOpen(false); } };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);

  function navigate(next: Page) { setPage(next); setQuery(''); setFormat('all'); setTag('all'); setArchive('all'); setSelected(undefined); if (next === 'local' && !directory && info) void browse(info.home); }
  async function browse(path: string) {
    const generation = ++browseGeneration.current;
    setLocalLoading(true); setLocalError('');
    try {
      const result = await api<{ path: string; parent: string; items: Model[] }>(`/api/browse?path=${encodeURIComponent(path)}`);
      if (generation !== browseGeneration.current) return;
      setDirectory(result.path); setPathInput(result.path); setParent(result.parent); setLocalItems(result.items); setQuery('');
    } catch (e) { if (generation === browseGeneration.current) setLocalError((e as Error).message); }
    finally { if (generation === browseGeneration.current) setLocalLoading(false); }
  }
  async function update(item: Model, patch: Partial<Model>) {
    try {
      const updated = await api<Model>(`/api/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setCatalog(previous => ({ ...previous, items: previous.items.map(i => i.id === item.id ? updated : i) }));
      setSelected(previous => previous?.id === item.id ? updated : previous);
      return true;
    } catch (e) { notify((e as Error).message, true); return false; }
  }
  async function importFiles(files: File[], source: string) {
    let added = 0, skipped = 0; const errors: string[] = [];
    for (const [index, file] of files.entries()) {
      setBusy(`Adding ${index+1} of ${files.length}: ${file.name}`);
      try {
        const result = await api<{ added: Model[]; skipped: number }>(`/api/import?name=${encodeURIComponent(file.name)}&source=${encodeURIComponent(source)}`, { method: 'POST', body: file });
        added += result.added.length; skipped += result.skipped;
      } catch (e) { errors.push(`${file.name}: ${(e as Error).message}`); }
    }
    try { await refresh(); } catch (e) { errors.push((e as Error).message); }
    setBusy(''); setImportOpen(false);
    notify(`${added} model${added !== 1 ? 's' : ''} added${skipped ? ` · ${skipped} duplicate${skipped > 1 ? 's' : ''} skipped` : ''}${errors.length ? ` · ${errors.join(' · ')}` : ''}`, errors.length > 0);
  }
  async function importLocal(item: Model) {
    setBusy(`Adding ${item.name}…`);
    try { const result = await api<{ added: Model[]; skipped: number }>('/api/import-local', { method: 'POST', body: JSON.stringify({ path: item.path }) }); await refresh(); notify(result.skipped ? 'Already in your collection.' : `${result.added.length} model${result.added.length !== 1 ? 's' : ''} added to collection.`); }
    catch (e) { notify((e as Error).message, true); }
    finally { setBusy(''); }
  }
  async function remove(item: Model) {
    if (!window.confirm(`Remove “${item.title}” from your catalog? Your original file stays in place.`)) return;
    try { await api(`/api/items/${item.id}`, { method: 'DELETE' }); await refresh(); setSelected(undefined); notify('Removed from your catalog.'); } catch (e) { notify((e as Error).message, true); }
  }
  async function searchOnline() {
    if (!query.trim()) return;
    const generation = ++remoteGeneration.current;
    setRemoteBusy(true); setRemoteErrors([]); setSearched(query.trim()); setShowSaved(false);
    try {
      const result = await api<{ items: RemoteModel[]; errors: { provider: string; error: string }[] }>(`/api/discover?q=${encodeURIComponent(query)}&provider=${provider}`);
      if (generation !== remoteGeneration.current) return;
      setRemoteItems(result.items); setRemoteErrors(result.errors.map(e => `${e.provider}: ${e.error}`));
    } catch (e) { if (generation === remoteGeneration.current) setRemoteErrors([(e as Error).message]); }
    finally { if (generation === remoteGeneration.current) setRemoteBusy(false); }
  }
  const allTags = [...new Set(catalog.items.flatMap(i => i.tags))].sort();
  let items = page === 'local' ? localItems : catalog.items;
  if (page === 'favorites') items = items.filter(i => i.favorite);
  if (page === 'printed') items = items.filter(i => i.printed);
  if (page === 'archives') items = items.filter(i => i.archiveId);
  items = items.filter(i => `${i.title} ${i.name} ${i.tags.join(' ')} ${i.archiveName || ''} ${i.notes || ''} ${i.source || ''}`.toLowerCase().includes(query.toLowerCase()) && (format === 'all' || i.directory || (format === 'step' ? ['step','stp'].includes(i.format) : i.format === format)) && (tag === 'all' || i.tags.includes(tag)) && (archive === 'all' || i.archiveId === archive));
  items = [...items].sort((a,b) => Number(!!b.directory)-Number(!!a.directory) || (sort === 'name' ? a.title.localeCompare(b.title) : sort === 'size' ? b.size-a.size : b.added.localeCompare(a.added)));
  const titles: Record<Page, string> = { collection: 'My collection', local: 'Local files', discover: 'Discover models', favorites: 'Favorites', printed: 'Printed models', archives: 'From archives' };
  const descriptions: Record<Page, string> = { collection: 'A little order for your next big idea.', local: 'Explore your folders. Find your next print.', discover: 'Many places to discover. One place to collect.', favorites: 'The models you keep coming back to.', printed: 'From the build plate to the real world.', archives: 'Every part, together with its original download.' };

  return <div className="app" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) { setDroppedFiles(Array.from(e.dataTransfer.files)); setImportOpen(true); } }}>
    <aside className="sidebar">
      <a href="#" className="brand" onClick={e => { e.preventDefault(); navigate('collection'); }}><span className="brand-mark"><Box size={27} strokeWidth={1.7}/></span><span>spool<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav>
        <NavButton icon={<Library size={18}/>} active={page === 'collection'} onClick={() => navigate('collection')} count={catalog.items.length}>My collection</NavButton>
        <NavButton icon={<FolderOpen size={18}/>} active={page === 'local'} onClick={() => navigate('local')}>Local files</NavButton>
        <NavButton icon={<Globe2 size={18}/>} active={page === 'discover'} onClick={() => navigate('discover')}>Discover models<span className="tiny-new">NEW</span></NavButton>
      </nav>
      <div className="sidebar-rule"/>
      <div className="workspace-label">IN YOUR COLLECTION</div>
      <nav>
        <NavButton icon={<Heart size={18}/>} active={page === 'favorites'} onClick={() => navigate('favorites')} count={catalog.items.filter(i => i.favorite).length}>Favorites</NavButton>
        <NavButton icon={<CheckCheck size={18}/>} active={page === 'printed'} onClick={() => navigate('printed')} count={catalog.items.filter(i => i.printed).length}>Printed</NavButton>
        <NavButton icon={<Archive size={18}/>} active={page === 'archives'} onClick={() => navigate('archives')} count={catalog.archives.length}>From archives</NavButton>
      </nav>
      <div className="sidebar-bottom"><div className="local-note"><span className="status-dot"/><div><strong>Made to stay local</strong><p>Your files. Your machine.</p></div><HardDrive size={18}/></div><button className="settings-button" onClick={() => setSettingsOpen(true)}><Settings2 size={17}/> Settings & backup<ChevronRight size={15}/></button></div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={13}/><span>{titles[page]}</span></div><div className="topbar-right"><span><span className="status-dot"/> Local workspace</span><button className="icon-button" aria-label="Help and settings" onClick={() => setSettingsOpen(true)}><CircleHelp size={19}/></button></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">A HOME FOR YOUR NEXT PRINT</div><h1>{titles[page]}</h1><p>{descriptions[page]}</p></div><button className="primary" onClick={() => { setDroppedFiles([]); setImportOpen(true); }}><Plus size={18}/> Add models</button></div>
        {page !== 'discover' && <div className="stats-strip"><div><span className="stat-icon"><Box size={18}/></span><strong>{catalog.items.length}</strong><span>models collected</span></div><div><span className="stat-icon"><Archive size={18}/></span><strong>{catalog.archives.length}</strong><span>original archives</span></div><div><span className="stat-icon"><Link2 size={18}/></span><strong>{catalog.items.filter(i => i.source).length}</strong><span>linked to a source</span></div><div className="stat-end"><span className="status-dot"/> Stored on your computer</div></div>}
        {page === 'local' && <form className="path-bar" onSubmit={e => { e.preventDefault(); void browse(pathInput); }}><button type="button" className="icon-button" title="Parent folder" aria-label="Parent folder" disabled={!directory || directory === parent} onClick={() => void browse(parent)}><ArrowLeft size={17}/></button><Folder size={18}/><input aria-label="Folder path" value={pathInput} onChange={e => setPathInput(e.target.value)} placeholder="Enter an absolute folder path"/><button type="submit" className="small-button">Open folder <ArrowRight size={14}/></button></form>}
        <div className="toolbar"><form className="search-box" onSubmit={e => { e.preventDefault(); if (page === 'discover') void searchOnline(); }}><Search size={18}/><input aria-label="Search models" placeholder={page === 'discover' ? 'Search across model sites…' : page === 'local' ? 'Search this folder…' : 'Search models, tags, or sources…'} value={query} onChange={e => setQuery(e.target.value)}/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}{page === 'discover' && <button className="search-submit" type="submit">Search</button>}</form>
          {page !== 'discover' ? <><label className="select-wrap"><SlidersHorizontal size={15}/><select aria-label="Filter by format" value={format} onChange={e => setFormat(e.target.value)}><option value="all">All formats</option>{['stl','step','3mf','gcode','zip'].map(f => <option key={f} value={f}>{formatLabel(f)}</option>)}</select><ChevronDown size={13}/></label><label className="select-wrap sort-select"><select aria-label="Sort models" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="name">Name A–Z</option><option value="size">Largest first</option></select><ChevronDown size={13}/></label><div className="view-switch"><button aria-label="Grid view" className={!list ? 'active' : ''} onClick={() => setList(false)}><Grid2X2 size={17}/></button><button aria-label="List view" className={list ? 'active' : ''} onClick={() => setList(true)}><List size={18}/></button></div></> : <label className="select-wrap"><Globe2 size={15}/><select aria-label="Model site" value={provider} onChange={e => setProvider(e.target.value)}><option value="all">All sources</option>{info?.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></label>}
        </div>
        {page === 'discover' ? <>
          <div className="discover-tabs"><button className={!showSaved ? 'active' : ''} onClick={() => setShowSaved(false)}>Explore</button><button className={showSaved ? 'active' : ''} onClick={() => setShowSaved(true)}>Saved sources <span>{bookmarks.length}</span></button><button className="connection-settings" onClick={() => setSettingsOpen(true)}><Settings2 size={14}/> Manage connections</button></div>
          {!showSaved && <div className="provider-grid">{info?.providers.filter(p => provider === 'all' || p.id === provider).map(p => <a key={p.id} href={p.search + encodeURIComponent(query)} target="_blank" rel="noreferrer" className="provider-card"><span className="provider-monogram" style={{ background: p.color }}>{p.name.slice(0,1)}</span><div><strong>{p.name}</strong><small>{p.connected ? 'Connected · Included in combined results' : 'Search on website'}</small></div><ExternalLink size={15}/></a>)}</div>}
          {remoteErrors.map(e => <div className="inline-error" key={e}>{e}</div>)}
          {remoteBusy ? <div className="loading-state"><LoaderCircle className="spin"/> Searching connected model sites…</div> : (showSaved ? bookmarks : remoteItems).length ? <div className="remote-grid">{(showSaved ? bookmarks.filter(i => `${i.title} ${i.creator} ${i.provider}`.toLowerCase().includes(query.toLowerCase())) : remoteItems).map(item => <article className="remote-card" key={item.id}><a href={item.source} target="_blank" rel="noreferrer" className="remote-image">{item.image ? <img loading="lazy" src={item.image} alt={item.title}/> : <Box size={58} strokeWidth={1}/>}</a><div className="remote-info"><span className="eyebrow">{item.provider}</span><h3>{item.title}</h3><p>{item.creator || 'View creator on source site'}</p><div><a className="small-button" href={item.source} target="_blank" rel="noreferrer">View model <ExternalLink size={13}/></a><button className={`icon-button ${bookmarks.some(b => b.id === item.id) ? 'hearted' : ''}`} aria-label={`Save ${item.title}`} onClick={() => setBookmarks(previous => previous.some(i => i.id === item.id) ? previous.filter(i => i.id !== item.id) : [...previous, item])}><Heart size={17}/></button></div></div></article>)}</div> : <div className="discover-empty"><span className="empty-symbol"><Globe2 size={33}/></span><h2>{showSaved ? 'Keep a few ideas for later.' : searched ? `Search “${searched}” on your favorite sites` : 'Your next project is out there.'}</h2><p>{showSaved ? 'Save models from connected search results using the heart button.' : info?.providers.some(p => p.connected) ? 'Search above to bring results from connected sites into one view.' : 'Open a site above, or connect Thingiverse and MyMiniFactory to search their catalogs together here.'}</p><button className="text-button" onClick={() => setSettingsOpen(true)}>Set up combined search <ArrowRight size={15}/></button></div>}
          <div className="discover-footnote"><Link2 size={16}/><p>Found something you love? Download the model from its creator, then use <strong>Add models</strong> to collect the files and keep the source link.</p></div>
        </> : <>
          <div className="results-line"><span>{items.length} {page === 'local' ? 'items' : 'models'}{query && ` matching “${query}”`}</span><div>{allTags.length > 0 && page !== 'local' && <select aria-label="Filter by tag" value={tag} onChange={e => setTag(e.target.value)}><option value="all">All tags</option>{allTags.map(t => <option key={t}>{t}</option>)}</select>}{page === 'archives' && <select aria-label="Filter by archive" value={archive} onChange={e => setArchive(e.target.value)}><option value="all">All archives</option>{catalog.archives.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}<span>{page === 'local' ? 'Folders & supported print files' : 'STL · STEP · 3MF · G-CODE'}</span></div></div>
          {localLoading && page === 'local' ? <div className="loading-state"><LoaderCircle className="spin"/> Opening folder…</div> : localError && page === 'local' ? <div className="inline-error">{localError}</div> : items.length ? <div className={list ? 'model-list' : 'model-grid'}>{items.map(item => <ModelCard key={item.id} item={item} list={list} local={page === 'local'} onOpen={() => item.directory ? void browse(item.path!) : setSelected(item)} onFavorite={() => void update(item, { favorite: !item.favorite })} onAdd={() => void importLocal(item)} busy={!!busy}/>)}</div> : (page === 'collection' && !catalog.items.length && !query && format === 'all') ? <div className="onboarding"><div className="onboarding-copy"><span className="pill"><span className="status-dot"/> A FRESH BUILD PLATE</span><h2>Good things start<br/>with a little <em>space.</em></h2><p>Give your 3D files a home. Preview every part,<br className="desktop-break"/> keep your downloads together, and find what<br className="desktop-break"/> you need when inspiration strikes.</p><div className="onboarding-actions"><button className="primary" onClick={() => { setDroppedFiles([]); setImportOpen(true); }}><Plus size={17}/> Add your first models</button><button className="text-button" onClick={() => navigate('local')}>Browse local files <ArrowRight size={15}/></button></div><small>Drop files or a ZIP anywhere to get started</small></div><div className="onboarding-visual" aria-hidden="true"><div className="visual-grid"/><div className="model-sculpture"><div className="sculpture-top"/><div className="sculpture-body"/><div className="sculpture-base"/></div><span className="visual-label"><Box size={13}/> ROOM FOR YOUR IDEAS</span><div className="visual-coordinate">X 0.0 &nbsp; Y 0.0 &nbsp; Z ∞</div></div></div> : <div className="empty-state"><Box size={40} strokeWidth={1.3}/><h2>{page === 'favorites' ? 'Keep your best finds close.' : page === 'printed' ? 'Every print starts with a model.' : page === 'archives' ? 'Keep the whole project together.' : page === 'local' ? 'No print files in this folder.' : 'No models match these filters.'}</h2><p>{page === 'favorites' ? 'Tap the heart on any model to find it here.' : page === 'printed' ? 'Mark a model as printed in its details to track your finished projects.' : page === 'archives' ? 'Add a ZIP archive to catalog its models and preserve the original download.' : page === 'local' ? 'Open a subfolder or enter another path above.' : 'Try a different search, format, or tag.'}</p></div>}
          {page === 'collection' && !catalog.items.length && <div className="feature-grid"><div><span><ScanIcon/></span><h3>See it before you print it</h3><p>Orbit, zoom, and inspect your models in an interactive 3D preview.</p></div><div><span><Archive size={21}/></span><h3>The whole download, together</h3><p>Import ZIPs and preserve every model’s place in the original archive.</p></div><div><span><Link2 size={21}/></span><h3>Never lose the original</h3><p>Keep creator links, notes, and tags right alongside your files.</p></div></div>}
        </>}
        <footer className="page-footer"><span>Less searching. More making.</span><span>spool <span className="footer-dot">/</span> your 3D library</span></footer>
      </div>
    </main>
    {selected && <Detail item={selected} local={!!selected.path} onClose={() => setSelected(undefined)} onUpdate={patch => update(selected, patch)} onRemove={() => void remove(selected)} onAdd={() => void importLocal(selected)} busy={!!busy} onNotify={notify}/>}
    {importOpen && <ImportDialog initialFiles={droppedFiles} busy={busy} onClose={() => !busy && setImportOpen(false)} onImport={(files, source) => void importFiles(files, source)}/>}
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings and backup" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Settings & backup</h2></div><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={20}/></button></div><h3>Local storage</h3><p>Your collection and original ZIPs are copied into this app’s storage folder. Browsing never changes your original files.</p><code className="storage-path">{info?.dataDirectory || 'Loading…'}</code><div className="settings-actions"><a className="small-button" href="/api/backup" download><Download size={16}/> Export collection</a><button className="small-button" disabled={!!busy} onClick={() => restoreInput.current?.click()}><Upload size={16}/> Restore backup</button><input hidden ref={restoreInput} type="file" accept=".zip" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setBusy('Restoring backup…'); try { const result = await api<{ count: number }>('/api/restore', { method: 'POST', body: file }); await refresh(); notify(`Restored ${result.count} models.`); } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); e.target.value = ''; } }}/></div><p className="fine-print">Backups include models, original archives, tags, notes, and source links. Discover’s saved links are kept in this browser separately.</p><div className="settings-divider"/><h3>Connected model sites</h3><p>API connections merge results in Discover. Set these environment variables before starting the app, then restart. Keys stay on your machine.</p>{info?.providers.map(p => <div className="connection-row" key={p.id}><span className="connection-dot" style={{ background: p.color }}/><strong>{p.name}</strong><span className={p.connected ? 'connected' : 'muted'}>{p.connected ? 'Connected' : p.env ? 'API key needed' : 'Website search'}</span>{p.env && <code>{p.env}</code>}</div>)}<p className="fine-print">Printables, MakerWorld, and Cults3D currently open their own search pages. Downloads remain on the source site.</p><div className="settings-divider"/><p className="fine-print">STL and G-code dimensions use file units, typically millimeters. G-code preview shows paths, not printer compatibility or print safety.</p></section></div>}
    {busy && !importOpen && <div className="busy-banner"><LoaderCircle className="spin" size={17}/>{busy}</div>}
    {toast && <div role="status" className={`toast ${toast.error ? 'toast-error' : ''}`}>{toast.error ? <CircleHelp size={18}/> : <Check size={18}/>}<span>{toast.text}</span><button aria-label="Dismiss notification" onClick={() => setToast(undefined)}><X size={15}/></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={45}/><h2>Make room for something new.</h2><p>Drop your models or ZIP archives to add them.</p></div>}
  </div>;
}

function ScanIcon() { return <FileBox size={21}/>; }
function NavButton({ icon, active, onClick, count, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; count?: number; children: React.ReactNode }) { return <button aria-label={typeof children === 'string' ? children : Array.isArray(children) ? children.filter(c => typeof c === 'string').join('') : undefined} className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{children}</span>{count !== undefined && <small>{count}</small>}</button>; }
function ModelCard({ item, list, local, onOpen, onFavorite, onAdd, busy }: { item: Model; list: boolean; local: boolean; onOpen: () => void; onFavorite: () => void; onAdd: () => void; busy: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '80px' }); if (ref.current) observer.observe(ref.current); return () => observer.disconnect(); }, []);
  return <article ref={ref} className={`model-card ${item.directory ? 'folder-card' : ''}`}>
    <button className="model-preview" onClick={onOpen} aria-label={`Open ${item.name}`}>
      {item.directory ? <div className="folder-art"><Folder size={65} strokeWidth={1}/></div> : list ? (item.format === 'zip' ? <Archive size={25}/> : <FileBox size={25}/>) : visible ? <Viewer item={item} compact/> : <div className="thumbnail-placeholder"><Box size={40}/></div>}
      {!list && !item.directory && <><span className={`format-badge format-${item.format}`}>{formatLabel(item.format)}</span>{item.printed && <span className="printed-badge"><Check size={12}/> Printed</span>}<span className="preview-hint">{item.format === 'zip' ? 'Inspect archive' : 'View model'} <ArrowRight size={13}/></span></>}
    </button>
    <div className="model-info"><button onClick={onOpen} className="model-title" title={item.name}>{item.directory ? item.name : item.title}</button><p>{item.directory ? 'Folder' : <>{sizeLabel(item.size)}<span>·</span>{item.archiveName ? <><Archive size={12}/><span className="archive-title">{item.archiveName}</span></> : item.source ? sourceName(item.source) : 'Local file'}</>}</p>{!list && !!item.tags.length && <div className="tag-list">{item.tags.slice(0,3).map(t => <span key={t}>{t}</span>)}</div>}</div>
    {!item.directory && <div className="card-actions">{list && <span className="format-badge">{formatLabel(item.format)}</span>}{local ? <button className="icon-button" title="Add to collection" aria-label={`Add ${item.name} to collection`} onClick={onAdd} disabled={busy}><Plus size={18}/></button> : <button className={`icon-button ${item.favorite ? 'hearted' : ''}`} aria-label={`${item.favorite ? 'Unfavorite' : 'Favorite'} ${item.name}`} onClick={onFavorite}><Heart size={17} fill={item.favorite ? 'currentColor' : 'none'}/></button>}</div>}
  </article>;
}
function ImportDialog({ initialFiles, busy, onClose, onImport }: { initialFiles: File[]; busy: string; onClose: () => void; onImport: (files: File[], source: string) => void }) {
  const [files, setFiles] = useState(initialFiles);
  const [source, setSource] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  function choose(selected: File[]) {
    const supported = selected.filter(f => /\.(stl|stp|step|3mf|gcode|zip)$/i.test(f.name));
    setError(supported.length < selected.length ? 'Some files were skipped. Choose STL, STEP, G-code, 3MF, or ZIP.' : '');
    setFiles(previous => [...previous, ...supported.filter(f => !previous.some(p => p.name === f.name && p.size === f.size))]);
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="modal import-modal" role="dialog" aria-modal="true" aria-label="Add models" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">A NEW ADDITION</span><h2>Add to your collection</h2></div><button className="icon-button" aria-label="Close import" disabled={!!busy} onClick={onClose}><X size={20}/></button></div><p>Bring individual models or an entire ZIP. We’ll keep the original archive and find the print files inside.</p><button className="upload-zone" disabled={!!busy} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); choose(Array.from(e.dataTransfer.files)); }}><span><Upload size={26}/></span><strong>Drop your files here</strong><p>or click to browse your computer</p><small>STL, STEP, 3MF, G-code, ZIP · Up to 300 MB per file</small></button><input ref={input} type="file" aria-label="Choose model files" accept={accept} multiple hidden onChange={e => { choose(Array.from(e.target.files || [])); e.target.value = ''; }}/>{error && <div className="inline-error">{error}</div>}{files.length > 0 && <div className="import-file-list">{files.map((file, index) => <div key={`${file.name}-${index}`}><FileBox size={17}/><span>{file.name}</span><small>{sizeLabel(file.size)}</small><button className="icon-button" aria-label={`Remove ${file.name} from import`} disabled={!!busy} onClick={() => setFiles(files.filter((_,i) => i !== index))}><X size={14}/></button></div>)}</div>}<label className="field-label" htmlFor="import-source">Source link <span>optional</span></label><div className="input-with-icon"><Link2 size={16}/><input id="import-source" type="url" placeholder="https://www.printables.com/model/…" value={source} onChange={e => setSource(e.target.value)}/></div><p className="fine-print">We’ll also look for creator links in the archive’s README and URL files. You can edit the source later.</p><div className="modal-footer"><span>{busy ? <><LoaderCircle className="spin" size={15}/>{busy}</> : `${files.length} file${files.length !== 1 ? 's' : ''} selected`}</span><button className="primary" disabled={!files.length || !!busy} onClick={() => { if (source) { try { const url = new URL(source); if (!['https:','http:'].includes(url.protocol)) throw new Error(); } catch { setError('Enter a valid http or https source link.'); return; } } onImport(files, source); }}><Plus size={17}/> Add to collection</button></div></section></div>;
}
function Detail({ item, local, onClose, onUpdate, onRemove, onAdd, busy, onNotify }: { item: Model; local: boolean; onClose: () => void; onUpdate: (patch: Partial<Model>) => Promise<boolean>; onRemove: () => void; onAdd: () => void; busy: boolean; onNotify: (message: string, error?: boolean) => void }) {
  const [title, setTitle] = useState(item.title);
  const [source, setSource] = useState(item.source || '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  async function save() {
    setSaving(true);
    const ok = await onUpdate({ title: title.trim() || item.title, source, tags: tags.split(',').map(t => t.trim()).filter(Boolean), notes });
    setSaving(false); if (ok) { setDirty(false); onNotify('Model details saved.'); }
  }
  function close() { if (!dirty || window.confirm('Discard your unsaved changes?')) onClose(); }
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); } }; window.addEventListener('keydown', handler, true); return () => window.removeEventListener('keydown', handler, true); });
  return <div className="modal-backdrop detail-backdrop" onClick={close}><section className="detail-modal" role="dialog" aria-modal="true" aria-label={`Model details: ${item.title}`} onClick={e => e.stopPropagation()}><div className="detail-titlebar"><div><span className="format-badge">{formatLabel(item.format)}</span><strong>{item.name}</strong></div><button className="icon-button" aria-label="Close model details" onClick={close}><X size={21}/></button></div><div className="detail-body"><div className="detail-preview"><Viewer item={item}/><div className="preview-file-info"><FileBox size={16}/><span>{sizeLabel(item.size)}</span><span>·</span><span>{formatLabel(item.format)} file</span><a className="text-button" href={fileUrl(item)} download={item.name}><ArrowDownToLine size={15}/> Download file</a></div>{local && <div className="local-file-info"><HardDrive size={16}/><span>{item.path}</span></div>}</div><div className="detail-fields"><div className="detail-section-label">{local ? 'LOCAL FILE' : 'IN YOUR COLLECTION'}</div><h2>{item.title}</h2>{local ? <><p className="detail-description">{item.format === 'zip' ? 'Add this archive to your collection to preview the models inside and preserve the original download.' : 'Add a copy to your collection to organize it with tags, notes, and a link to its creator.'}</p><button className="primary full-width" disabled={busy} onClick={onAdd}><Plus size={17}/> Add to collection</button></> : <><div className="detail-toggles"><button className={item.favorite ? 'enabled' : ''} onClick={() => void onUpdate({ favorite: !item.favorite })}><Heart size={15} fill={item.favorite ? 'currentColor' : 'none'}/>{item.favorite ? 'Favorited' : 'Favorite'}</button><button className={item.printed ? 'enabled' : ''} onClick={() => void onUpdate({ printed: !item.printed })}><CheckCheck size={16}/>{item.printed ? 'Printed' : 'Mark printed'}</button></div><label className="field-label" htmlFor="model-title">Model name</label><input id="model-title" value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }}/><label className="field-label" htmlFor="model-source">Original source {item.source && <a href={item.source} target="_blank" rel="noreferrer">Visit <ExternalLink size={12}/></a>}</label><input id="model-source" type="url" placeholder="https://…" value={source} onChange={e => { setSource(e.target.value); setDirty(true); }}/><label className="field-label" htmlFor="model-tags">Tags <span>comma separated</span></label><input id="model-tags" placeholder="functional, workshop, organizer" value={tags} onChange={e => { setTags(e.target.value); setDirty(true); }}/><label className="field-label" htmlFor="model-notes">Notes</label><textarea id="model-notes" placeholder="Print settings, filament, things to remember…" rows={3} value={notes} onChange={e => { setNotes(e.target.value); setDirty(true); }}/>{item.archiveId && <div className="archive-provenance"><Archive size={18}/><div><strong>Part of {item.archiveName}</strong><small>{item.archivePath}</small><a href={`/api/files/${item.archiveId}`} className="text-button" download>Download original ZIP <Download size={12}/></a></div></div>}<button className="primary full-width" disabled={saving || !dirty} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Save changes</button><button className="remove-button" onClick={onRemove}><Trash2 size={14}/> Remove from catalog</button></>}</div></div></section></div>;
}
