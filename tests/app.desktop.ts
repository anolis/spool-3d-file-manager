import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
const require = createRequire(import.meta.url);

test('desktop: add native folder, recursive previews and camera controls, persistence, new files and safe folder removal', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spool-desktop-'));
  const models = path.join(temporary, 'Printer models');
  await fs.mkdir(path.join(models,'Nested parts'), { recursive:true });
  const stl = new STLExporter().parse(new THREE.Mesh(new THREE.TorusKnotGeometry(18,5,100,12))) as string;
  await fs.writeFile(path.join(models,'Nested parts','knot.stl'), stl);
  await fs.writeFile(path.join(models,'readme.txt'), 'Not a model');
  const env = { ...process.env, SPOOL_USER_DATA:path.join(temporary,'profile'), SPOOL_DATA_DIR:path.join(temporary,'library') };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  async function launch() {
    app = await electron.launch({ executablePath:process.env.SPOOL_TEST_EXECUTABLE || require('electron'), args:[...(process.env.SPOOL_TEST_EXECUTABLE ? [] : ['.']), ...(process.env.SPOOL_TEST_NO_SANDBOX ? ['--no-sandbox'] : []), '--enable-unsafe-swiftshader'], env });
    return app.firstWindow();
  }
  try {
    const page = await launch();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    expect(page.url()).toBe('spool://app/');
    await expect(page.getByRole('heading',{name:'Model folders',exact:true})).toBeVisible();
    await app!.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[selected] }); }, models);
    await page.getByRole('button',{name:'Add your first folder',exact:true}).click();
    await page.getByRole('button',{name:'Choose a folder',exact:false}).click();
    await expect(page.getByRole('button',{name:'Open knot.stl',exact:true})).toBeVisible();
    await expect(page.locator('.rendered-thumbnail')).toBeVisible();
    await page.getByRole('button',{name:'Open knot.stl',exact:true}).click();
    await expect(page.getByRole('toolbar',{name:'3D model controls'})).toBeVisible();
    const canvas = page.locator('.detail-preview canvas');
    const initial = await canvas.screenshot();
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await expect.poll(async () => (await canvas.screenshot()).equals(initial)).toBe(false);
    await page.getByRole('button',{name:'Zoom out',exact:true}).click();
    await page.getByRole('button',{name:'Pan model',exact:true}).click();
    await expect(page.getByRole('button',{name:'Pan model',exact:true})).toHaveAttribute('aria-pressed','true');
    const bounds = (await canvas.boundingBox())!;
    const beforePan = await canvas.screenshot();
    await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);
    await page.mouse.down(); await page.mouse.move(bounds.x+bounds.width*.65,bounds.y+bounds.height*.55,{steps:8}); await page.mouse.up();
    await expect.poll(async () => (await canvas.screenshot()).equals(beforePan)).toBe(false);
    await page.getByRole('button',{name:'Orbit and tilt model',exact:true}).click();
    const beforeOrbit = await canvas.screenshot();
    await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5); await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.57,bounds.y+bounds.height*.65,{steps:8}); await page.mouse.up();
    await expect.poll(async () => (await canvas.screenshot()).equals(beforeOrbit)).toBe(false);
    await page.getByRole('button',{name:'Reset view',exact:true}).click();
    await page.screenshot({path:'/tmp/spool-native-preview.png'});
    await page.getByRole('button',{name:'Add to collection',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('added to collection');
    await page.getByRole('button',{name:'Close model details'}).click();
    await page.screenshot({path:'/tmp/spool-native-folders.png'});
    const backupPath = path.join(temporary,'export.zip');
    await app!.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled:false, filePath:selected }); }, backupPath);
    await page.getByRole('button',{name:'Settings & backup'}).click();
    await page.getByRole('link',{name:'Export collection'}).click();
    await expect.poll(async () => fs.stat(backupPath).then(s=>s.size).catch(()=>0)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Close settings'}).click();
    // No local TCP server should have been created by the Electron main process.
    const handles = await app!.evaluate(() => (process as unknown as { _getActiveHandles(): { constructor:{name:string} }[] })._getActiveHandles().map(h=>h.constructor.name));
    expect(handles).not.toContain('Server');
    if (process.env.SPOOL_LIVE_TEST) {
      await page.getByRole('button',{name:'Discover models',exact:true}).click();
      await page.getByRole('textbox',{name:'Search models',exact:true}).fill('benchy');
      await page.getByRole('button',{name:'Search',exact:true}).click();
      await expect(page.locator('.remote-card').first()).toBeVisible({timeout:45000});
      await expect(page.getByRole('heading',{name:'3D BENCHY',exact:true})).toBeVisible();
      expect(await page.locator('.provider-grid a').count()).toBe(0);
      await expect.poll(() => page.locator('.remote-image img').first().evaluate(image => (image as HTMLImageElement).naturalWidth), { timeout:20000 }).toBeGreaterThan(0);
      await page.screenshot({path:'/tmp/spool-native-discover.png'});
    }
    expect(errors).toEqual([]);
    await app!.close(); app = undefined;
    await fs.writeFile(path.join(models,'new-part.stl'),stl);
    const second = await launch();
    await expect(second.getByRole('button',{name:'Open knot.stl',exact:true})).toBeVisible();
    await second.getByRole('button',{name:'Rescan folders',exact:true}).click();
    await expect(second.getByRole('button',{name:'Open new-part.stl',exact:true})).toBeVisible();
    second.on('dialog',d=>d.accept());
    await second.getByRole('button',{name:'Remove folder Printer models',exact:true}).click();
    await expect(second.getByRole('heading',{name:'Start with your 3D file folders.'})).toBeVisible();
    expect(await fs.readFile(path.join(models,'Nested parts','knot.stl'),'utf8')).toBe(stl);
    await second.getByRole('button',{name:'My collection',exact:true}).click();
    await expect(second.getByRole('button',{name:'Open knot.stl',exact:true})).toBeVisible();
    // All existing preview loaders must also work through the private scheme.
    const step = path.resolve('node_modules/occt-import-js/test/testfiles/rounded-cube/rounded-cube.step');
    await second.evaluate(async filename => { await fetch('/api/import-local',{method:'POST',body:JSON.stringify({path:filename})}); },step);
    await second.reload();
    await second.getByRole('button',{name:'My collection',exact:true}).click();
    await second.getByRole('button',{name:'Open rounded-cube.step',exact:true}).click();
    await expect.poll(async () => (await second.getByRole('toolbar',{name:'3D model controls'}).count()) || (await second.locator('.detail-preview .preview-error').count()), {timeout:60000}).toBeGreaterThan(0);
    expect(await second.locator('.detail-preview .preview-error').allTextContents()).toEqual([]);
    await expect(second.getByRole('toolbar',{name:'3D model controls'})).toBeVisible();
  } finally { await app?.close(); await fs.rm(temporary,{recursive:true,force:true}); }
});
