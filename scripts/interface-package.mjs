#!/usr/bin/env node
// Makes an interface update package: Lumen's interface (the pages, scripts and styles in dist/),
// signed with Lumen's update key, for Settings ▸ Updates ▸ Install from Zip… or a release the
// Update button installs (see src-tauri/src/interface.rs). It needs no app build, so no Mac and no
// GitHub Actions; it works only while the app itself (src-tauri) hasn't changed since the last
// full release, which the package records as the oldest app it runs on.
//
//   LUMEN_SIGNING_KEY=path/to/lumen-updater.key npm run interface-package
//
// Writes release/Lumen-<version>-interface.zip and release/lumen-interface.json (for a release).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// The oldest app this interface runs on: the first full release ("Release X") made after (or with)
// the app's own code last changing. A version bump alone (Cargo.toml, Cargo.lock) isn't a change to the app.
function requires() {
  const changed = git('log', '-1', '--format=%H', '--', 'src-tauri', ':(exclude)src-tauri/Cargo.toml', ':(exclude)src-tauri/Cargo.lock');
  const releases = git('log', '--reverse', '--format=%s', '-E', '--grep=^Release [0-9]', `${changed}^..HEAD`)
    .split('\n')
    .filter(Boolean);
  const first = releases[0]?.match(/^Release (\S+)/)?.[1];
  if (!first) {
    console.error(
      'The app (src-tauri) has changed since the last full release, so this interface needs an app that hasn’t been built yet.\n' +
        'Make a full release first (GitHub Actions, or a Mac).',
    );
    process.exit(1);
  }
  return first;
}

const key = process.env.LUMEN_SIGNING_KEY;
if (!key || !fs.existsSync(key)) {
  console.error('Set LUMEN_SIGNING_KEY to the path of Lumen’s update signing key (the private half of tauri.conf.json’s pubkey).');
  process.exit(1);
}

const manifest = { app: 'Lumen', version, requires: process.env.LUMEN_REQUIRES || requires(), notes: process.env.LUMEN_NOTES || null };
console.log(`Lumen ${version} interface, for Lumen ${manifest.requires} or later`);

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const dist = path.join(root, 'dist');
fs.writeFileSync(path.join(dist, 'lumen-interface.json'), JSON.stringify(manifest, null, 2));

const files = {};
(function add(dir, prefix) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) add(full, `${prefix}${name}/`);
    else files[`${prefix}${name}`] = new Uint8Array(fs.readFileSync(full));
  }
})(dist, '');

const work = fs.mkdtempSync(path.join(root, '.interface-'));
try {
  const inner = path.join(work, 'interface.zip');
  fs.writeFileSync(inner, zipSync(files, { level: 9 }));
  execFileSync('npx', ['tauri', 'signer', 'sign', '-f', key, '-p', process.env.LUMEN_SIGNING_PASSWORD ?? '', inner], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const readme = [
    `Lumen ${version} — interface update`,
    '',
    `For Lumen ${manifest.requires} or later. In Lumen: Settings ▸ Updates ▸ Install from Zip…, choose this zip, then Install.`,
    'Lumen checks its signature, installs it and restarts. Settings ▸ Updates ▸ Go Back puts the previous version back.',
    'Your library, media and settings are not touched.',
    '',
  ].join('\n');
  const outer = zipSync(
    {
      'interface.zip': new Uint8Array(fs.readFileSync(inner)),
      'interface.zip.sig': new Uint8Array(fs.readFileSync(`${inner}.sig`)),
      'README.txt': new TextEncoder().encode(readme),
    },
    { level: 0 },
  );
  const out = path.join(root, 'release');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `Lumen-${version}-interface.zip`), outer);
  fs.writeFileSync(path.join(out, 'lumen-interface.json'), JSON.stringify(manifest, null, 2));
  console.log(`release/Lumen-${version}-interface.zip (${(outer.length / 1e6).toFixed(1)} MB)`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
