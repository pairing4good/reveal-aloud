import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const banner = {
  js: `/*! reveal-aloud ${pkg.version} | MIT | ${pkg.homepage} */`
};

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  target: ['es2019'],
  banner,
  logLevel: 'info'
};

await build({
  ...shared,
  format: 'iife',
  globalName: 'RevealAloud',
  outfile: 'dist/reveal-aloud.js',
  // esbuild's IIFE wrapper assigns the module namespace object, so `RevealAloud` would
  // be `{default: plugin}`. Unwrap it so a plain <script> tag yields the plugin itself.
  footer: { js: 'RevealAloud = RevealAloud.default;' }
});

await build({
  ...shared,
  format: 'esm',
  outfile: 'dist/reveal-aloud.esm.js'
});
