// Shared helpers for the browser checks (docs/11 section 2, docs/20 section 5): one way to start Chromium,
// one base URL, one place for output, and axe-core from the workspace's node_modules.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The web app under test; the API is reached through its /api proxy. */
export const BASE = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Starts headless Chromium. Playwright's own download is used unless CHROME_PATH names a browser
 * (for example the Chromium that Playwright keeps under LOCALAPPDATA on a development machine).
 */
export function launch(options = {}) {
  const executablePath = process.env.CHROME_PATH || undefined;
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...options });
}

/** Where a check writes its JSON and screenshots: an explicit folder, or tools/browser/out/<name>. */
export function outDir(name) {
  const dir = name && (name.includes('/') || name.includes('\\')) ? resolve(name) : join(here, 'out', name ?? 'run');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function axeSource() {
  return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
}

/** The demo accounts every check signs in with (seeded by `pnpm --filter @smartschool/api db:seed`). */
export const PASSWORD = process.env.DEMO_PASSWORD ?? 'SmartSchool!Demo2026';
