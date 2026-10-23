import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests', testMatch:'**/*.desktop.ts', timeout:120000, workers:1, reporter:'list' });
