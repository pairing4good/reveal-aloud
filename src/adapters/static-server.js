/**
 * A tiny static file server, shared by `npm run demo` and the narration exporter.
 *
 * The exporter needs it because a deck cannot be read over `file://`: external markdown, module
 * scripts and fetched assets all fail CORS there, which would silently produce a deck with no
 * speaker notes. Serving the deck's own directory over HTTP on an ephemeral port sidesteps that
 * without asking the presenter to start anything.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

/**
 * @param {object} options
 * @param {string} options.root directory to serve
 * @param {number} [options.port] 0 asks the OS for a free one
 * @param {string} [options.index] what `/` resolves to
 * @param {string} [options.host]
 * @returns {Promise<{port: number, origin: string, close: () => Promise<void>}>}
 */
export function createStaticServer({ root, port = 0, index = '/index.html', host = '127.0.0.1' }) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Strip any leading `..` segments so a request cannot escape the root.
    const rel = normalize(path === '/' ? index : path).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(root, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        origin: `http://${host}:${actual}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}
