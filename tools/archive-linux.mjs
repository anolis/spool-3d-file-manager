import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// A fast gzip level keeps local release builds practical; the runtime is already large.
const archive = path.resolve(`release/spool-3d-library-${version}.tar.gz`);
execFileSync('tar', ['-I', 'gzip -1', '-cf', archive, '-C', path.resolve('release'), 'linux-unpacked'], { stdio:'inherit' });
console.log('Created '+archive);
