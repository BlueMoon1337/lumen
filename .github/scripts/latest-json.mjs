// Writes latest.json for a draft release (what Lumen's Update button reads), from the update files
// and signatures the builds attached, then attaches it and publishes the release.
//
// With immutable releases on, nothing can be added to a release once it's published, so the
// builds go into a draft and this runs last.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, RELEASE_ID, TAG.

const { GITHUB_TOKEN, GITHUB_REPOSITORY: repo, RELEASE_ID: id, TAG: tag } = process.env;
const api = `https://api.github.com/repos/${repo}`;
const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'lumen-release' };

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

const release = await (await call(`${api}/releases/${id}`)).json();
const assets = release.assets;
const signature = async (name) => {
  const sig = assets.find((a) => a.name === `${name}.sig`);
  if (!sig) throw new Error(`No signature for ${name}`);
  return (await call(sig.url, { headers: { Accept: 'application/octet-stream' } })).text();
};
const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;

// Which update file each platform (and kind of install) takes.
const kinds = [
  { test: (n) => n.endsWith('.app.tar.gz'), platforms: ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app'] },
  { test: (n) => n.endsWith('-setup.exe'), platforms: ['windows-x86_64', 'windows-x86_64-nsis'] },
  { test: (n) => n.endsWith('.msi'), platforms: ['windows-x86_64-msi'] },
];
const platforms = {};
for (const kind of kinds) {
  const asset = assets.find((a) => kind.test(a.name));
  if (!asset) continue;
  const entry = { signature: await signature(asset.name), url: url(asset.name) };
  for (const p of kind.platforms) platforms[p] = entry;
}
for (const needed of ['darwin-aarch64', 'windows-x86_64']) {
  if (!platforms[needed]) throw new Error(`The release has no update for ${needed}. Assets: ${assets.map((a) => a.name).join(', ')}`);
}

const manifest = { version: tag.replace(/^v/, ''), notes: release.body ?? '', pub_date: new Date().toISOString(), platforms };
const old = assets.find((a) => a.name === 'latest.json');
if (old) await call(`${api}/releases/assets/${old.id}`, { method: 'DELETE' });
await call(`https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=latest.json`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(manifest, null, 2),
});
await call(`${api}/releases/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ draft: false, make_latest: 'true' }),
});
console.log(`Published ${tag} with updates for ${Object.keys(platforms).join(', ')}.`);
