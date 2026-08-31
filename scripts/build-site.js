/**
 * Assembles the demo into `_site/` for GitHub Pages.
 *
 * The deck loads the plugin from `../dist/`, so the published site keeps that layout and adds
 * a redirect at the root. Run it locally with `npm run build:site` to see exactly what Pages
 * will serve.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = `${root}_site`;

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

await cp(`${root}demo`, `${site}/demo`, { recursive: true });
await cp(`${root}dist`, `${site}/dist`, { recursive: true });

await writeFile(
  `${site}/index.html`,
  `<!doctype html>
<meta charset="utf-8">
<title>reveal-aloud</title>
<meta http-equiv="refresh" content="0; url=./demo/">
<link rel="canonical" href="./demo/">
<p><a href="./demo/">reveal-aloud demo deck</a></p>
`
);

console.log('  _site is ready — open _site/demo/index.html');
