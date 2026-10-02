#!/usr/bin/env node
/**
 * Fetches the H5P player runtime and the content-type libraries the LMS serves (docs/07 slice 6).
 *
 *  public/h5p/frame.bundle.js, main.bundle.js, styles/   from the h5p-standalone package
 *  public/h5p/libraries/<Name-major.minor>/              from the H5P hub (api.h5p.org), editor libraries skipped
 *
 * Library versions must stay in step with apps/api/src/modules/h5p/h5p-libraries.ts.
 * Run with `pnpm --filter @smartschool/web h5p:setup`; the output folder is git-ignored.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'public', 'h5p');
const require = createRequire(import.meta.url);

const HUB = 'https://api.h5p.org/v1/content-types';
const MAIN_LIBRARIES = ['H5P.QuestionSet', 'H5P.Dialogcards'];

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(file));
}

function unzip(file, dir) {
  // tar handles .h5p (zip) on Windows 10+, macOS and most Linux builds; fall back to unzip.
  try {
    execFileSync('tar', ['-xf', file, '-C', dir], { stdio: 'ignore' });
  } catch {
    execFileSync('unzip', ['-qo', file, '-d', dir], { stdio: 'ignore' });
  }
}

async function main() {
  await mkdir(join(out, 'libraries'), { recursive: true });

  // 1. Player runtime from node_modules
  const dist = dirname(require.resolve('h5p-standalone/dist/main.bundle.js'));
  for (const name of ['main.bundle.js', 'frame.bundle.js', 'styles', 'fonts', 'images']) {
    if (existsSync(join(dist, name))) await cp(join(dist, name), join(out, name), { recursive: true });
  }
  console.log('player runtime copied');

  // 2. Libraries from the hub
  const tmp = join(out, '.tmp');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  let copied = 0;
  for (const lib of MAIN_LIBRARIES) {
    const pkg = join(tmp, `${lib}.h5p`);
    const dir = join(tmp, lib);
    await mkdir(dir, { recursive: true });
    console.log(`downloading ${lib} from the H5P hub`);
    await download(`${HUB}/${lib}`, pkg);
    unzip(pkg, dir);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes('-') || entry.name.startsWith('H5PEditor')) continue;
      const target = join(out, 'libraries', entry.name);
      if (existsSync(target)) continue;
      await cp(join(dir, entry.name), target, { recursive: true });
      copied += 1;
    }
  }
  await rm(tmp, { recursive: true, force: true });
  const libraries = (await readdir(join(out, 'libraries'))).sort();
  await writeFile(join(out, 'libraries.json'), JSON.stringify(libraries, null, 2));
  console.log(`${copied} new libraries; ${libraries.length} present: ${libraries.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
