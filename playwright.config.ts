import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', timeout: 120000, testMatch: '**/*.spec.ts', workers: 1, use: { baseURL: 'http://127.0.0.1:5173', headless: true, launchOptions: { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] } }, webServer: { command: `SPOOL_DATA_DIR=${path.join(os.tmpdir(), 'spool-ui-test-' + process.pid)} npm run dev`, url: 'http://127.0.0.1:5173', reuseExistingServer: false }, reporter: 'list' });
