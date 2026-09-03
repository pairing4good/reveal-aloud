/** Tiny static server so `npm run demo` works without any extra dependency. */
import { createStaticServer } from '../src/adapters/static-server.js';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.env.PORT || 8000);

const server = await createStaticServer({ root, port, index: '/demo/index.html', host: '0.0.0.0' });
console.log(`\n  reveal-aloud demo → http://localhost:${server.port}/\n`);
