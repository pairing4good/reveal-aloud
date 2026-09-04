#!/usr/bin/env node
/**
 * A tiny local helper that lets reveal-aloud speak with a voice you have installed on your Mac
 * — including a Siri voice, which is not exposed to any browser at all (see the README). It
 * hands text to the macOS `say` command and reports back when each utterance finishes.
 *
 * Run it once before you present:
 *
 *   node bin/say-server.js
 *
 * then point your deck at it:
 *
 *   aloud: { engine: 'say' }
 *
 * It only ever listens on 127.0.0.1 — nothing outside your own machine can reach it.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

import { toWordsPerMinute } from '../src/core/say-format.js';
import {
  SYSTEM_DEFAULT_VOICE,
  isNamedVoice,
  parseVoiceList,
  toVoiceCatalog
} from '../src/core/say-voices.js';

const PORT = Number(process.env.PORT || 5757);
const SAY_BIN = process.env.SAY_BIN || 'say';

let current = null;

function listVoices() {
  return new Promise((resolve, reject) => {
    const child = spawn(SAY_BIN, ['-v', '?']);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `say -v ? exited with code ${code}`));
      resolve(toVoiceCatalog(out));
    });
  });
}

function speak(text, voice, rate) {
  return new Promise((resolve, reject) => {
    if (current) current.kill(); // never let two utterances overlap, even across requests

    const args = ['-r', String(toWordsPerMinute(rate))];
    if (isNamedVoice(voice)) args.push('-v', voice);
    args.push(text);

    const child = spawn(SAY_BIN, args);
    current = child;
    let err = '';
    child.stderr.on('data', (chunk) => (err += chunk));

    child.on('error', (error) => {
      if (current === child) current = null;
      reject(
        error.code === 'ENOENT'
          ? new Error(`Could not run "${SAY_BIN}". This server only works on macOS.`)
          : error
      );
    });

    child.on('close', (code, signal) => {
      if (current === child) current = null;
      if (signal) return resolve({ stopped: true }); // killed on purpose — not a failure
      if (code !== 0) return reject(new Error(err.trim() || `say exited with code ${code}`));
      resolve({ stopped: false });
    });
  });
}

function stop() {
  if (!current) return false;
  current.kill();
  current = null;
  return true;
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/voices') {
      return sendJson(res, 200, await listVoices());
    }

    if (req.method === 'POST' && req.url === '/speak') {
      const { text, voice, rate } = await readJson(req);
      if (typeof text !== 'string' || text.trim() === '') {
        return sendJson(res, 400, { error: 'text is required' });
      }
      const result = await speak(text, voice, rate);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/stop') {
      return sendJson(res, 200, { stopped: stop() });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address(); // PORT=0 asks the OS for a free port; this is the real one
  console.log(`\n  reveal-aloud say-server → http://127.0.0.1:${port}`);
  console.log('  Leave this running, then in your deck:\n');
  console.log("    aloud: { engine: 'say' }\n");
  console.log('  Ctrl+C to stop.\n');
});

process.on('SIGINT', () => {
  stop();
  server.close(() => process.exit(0));
});

// Re-exported from their canonical home in src/core/say-voices.js, which the offline file
// renderer shares. Note parseVoiceList() no longer prepends the system default — toVoiceCatalog()
// does that, and it is what the /voices endpoint returns.
export { parseVoiceList, SYSTEM_DEFAULT_VOICE, toVoiceCatalog };
