import { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createService } from '../server/service.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'spool://app';
protocol.registerSchemesAsPrivileged([{ scheme: 'spool', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('Spool');
if (process.platform === 'linux') app.setDesktopName('io.github.anolis.spool.desktop');
if (process.env.SPOOL_USER_DATA) app.setPath('userData', process.env.SPOOL_USER_DATA);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  let window;
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  const dataDirectory = process.env.SPOOL_DATA_DIR || path.join(app.getPath('userData'), 'library');
  const service = createService({ dataDirectory });
  const trusted = event => event.senderFrame?.url.startsWith(origin + '/');
  const external = async url => {
    try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol)) await shell.openExternal(parsed.href); } catch { /* Ignore invalid external links. */ }
  };
  void app.whenReady().then(async () => {
    // Move the first browser prototype's collection once, without changing its source.
    if (!process.env.SPOOL_DATA_DIR && !app.isPackaged) {
      try {
        await fs.access(path.join(dataDirectory, 'catalog.json'));
      } catch {
        try {
          await fs.access(path.join(project, '.local-data/catalog.json'));
          await fs.mkdir(path.dirname(dataDirectory), { recursive: true });
          await fs.cp(path.join(project, '.local-data'), dataDirectory, { recursive: true, force: false, errorOnExist: true });
        } catch { /* A fresh install has no legacy collection. */ }
      }
    }
    protocol.handle('spool', async request => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      if (url.pathname.startsWith('/api/')) {
        const referrer = request.referrer;
        if (referrer && !referrer.startsWith(origin + '/')) return new Response('Forbidden', { status: 403 });
        return service(request);
      }
      let relative;
      try { relative = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status:400 }); }
      const root = path.join(project, 'dist');
      const filename = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
      if (!filename.startsWith(root + path.sep)) return new Response('Forbidden', { status:403 });
      try {
        const response = await net.fetch(pathToFileURL(filename).href);
        const headers = new Headers(response.headers);
        // OpenCascade's embind glue generates invokers at runtime, only inside this worker.
        const workerEval = relative === '/step-worker.js' ? " 'unsafe-eval'" : '';
        headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'"+workerEval+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'");
        return new Response(response.body, { status:response.status, headers });
      } catch { return new Response('File not found', { status:404 }); }
    });
    ipcMain.handle('spool:choose-folder', async event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      const result = await dialog.showOpenDialog(window, { title:'Add a 3D file folder', properties:['openDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('spool:show-storage', async event => {
      if (!trusted(event)) throw new Error('Untrusted window.');
      await fs.mkdir(dataDirectory, { recursive: true }); return shell.openPath(dataDirectory);
    });
    ipcMain.handle('spool:save-file', async (event, resource, name) => {
      if (!trusted(event) || typeof resource !== 'string' || typeof name !== 'string') throw new Error('Invalid download.');
      const url = new URL(resource, origin);
      if (url.hostname !== 'app' || url.protocol !== 'spool:' || !(/^\/api\/files\/[a-f0-9-]{36}$/.test(url.pathname) || url.pathname === '/api/backup' || url.pathname === '/api/local-file')) throw new Error('Invalid download.');
      const destination = await dialog.showSaveDialog(window, { title:'Save file', defaultPath:path.join(app.getPath('downloads'), path.basename(name) || 'spool-backup.zip') });
      if (destination.canceled || !destination.filePath) return false;
      const response = await service(new Request(url));
      if (!response.ok) throw new Error((await response.json()).error || 'The file could not be saved.');
      await fs.writeFile(destination.filePath, new Uint8Array(await response.arrayBuffer()));
      return true;
    });
    function createWindow() {
      window = new BrowserWindow({ width:1400, height:930, minWidth:900, minHeight:650, title:'Spool', backgroundColor:'#f8f9f6', icon:path.join(project,'assets/spool.png'), show:false, autoHideMenuBar:true,
        webPreferences:{ preload:path.join(project,'desktop/preload.cjs'), contextIsolation:true, sandbox:true, nodeIntegration:false } });
      window.once('ready-to-show', () => window.show());
      window.webContents.setWindowOpenHandler(({ url }) => { void external(url); return { action:'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) { event.preventDefault(); void external(url); } });
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.on('closed', () => { window = undefined; });
      void window.loadURL(origin + '/');
      return window;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role:'appMenu' }] : []),
      { label:'File', submenu:[{ label:'Add folder…', accelerator:'CmdOrCtrl+Shift+O', click:() => window?.webContents.send('spool:add-folder') }, { role:'close' }, { role:'quit' }] },
      { role:'editMenu' }, { role:'viewMenu' },
      { label:'Help', submenu:[{ label:'Spool on GitHub', click:() => void external('https://github.com/anolis/spool-3d-file-manager') }] },
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  }).catch(error => { console.error(error); app.quit(); });
}
