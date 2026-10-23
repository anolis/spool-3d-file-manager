#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'linux') throw new Error('This launcher installer currently supports Linux.');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(project, 'release/linux-unpacked');
await fs.access(path.join(source,'spool')).catch(() => { throw new Error('Build the desktop app first with npm run desktop:dir.'); });
const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local/share');
const destination = path.join(dataHome,'spool-desktop/app');
// The app's profile and model library live in Electron userData, outside this folder.
await fs.mkdir(destination,{recursive:true});
await fs.cp(source,destination,{recursive:true,force:true});
const executable = path.join(destination,'spool');
await fs.chmod(executable,0o755);
const launcherDirectory = path.join(dataHome,'applications');
const iconDirectory = path.join(dataHome,'icons/hicolor/512x512/apps');
await fs.mkdir(launcherDirectory,{recursive:true}); await fs.mkdir(iconDirectory,{recursive:true});
await fs.copyFile(path.join(project,'assets/spool.png'),path.join(iconDirectory,'io.github.anolis.spool.png'));
const quoted = value => '"'+value.replace(/(["\\`$])/g,'\\$1').replace(/%/g,'%%')+'"';
await fs.writeFile(path.join(launcherDirectory,'io.github.anolis.spool.desktop'), `[Desktop Entry]\nType=Application\nName=Spool\nComment=Browse and catalog 3D printing files\nExec=${quoted(executable)}\nIcon=io.github.anolis.spool\nTerminal=false\nCategories=Graphics;3DGraphics;Utility;\nStartupNotify=true\nStartupWMClass=io.github.anolis.spool\n`);
try { execFileSync('update-desktop-database',[launcherDirectory],{stdio:'ignore'}); } catch { /* Not all desktops provide this optional cache tool. */ }
console.log('Installed Spool in '+destination+'\nOpen Spool from your applications menu.');
