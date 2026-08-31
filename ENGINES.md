# Switching engines

reveal-aloud can speak with three different engines. Which one you get is a single config
key — `engine` — and nothing else about your deck changes: <kbd>R</kbd>, brackets staying
silent, stopping mid-sentence on advance, all of it behaves identically no matter which engine
you pick.

This page is the side-by-side version. Each engine also has its own full section in the
[README](README.md#4-change-the-voice-or-the-speed), linked below, if you want the details.

## The three options

| | `webspeech` (default) | `kokoro` | `say` |
|---|---|---|---|
| **Setup** | None | None — first use downloads the model | `node bin/say-server.js` running |
| **Platform** | Any browser | Any browser | Mac only |
| **One-time cost** | None | ~90 MB download, cached after | None |
| **Per-sentence delay** | None | Brief, while audio generates | None |
| **Voice quality** | Whatever your OS ships | Consistently good | Whatever you've installed |
| **Reaches a Siri voice** | No — impossible from a browser | No | **Yes**, if that's your System Voice |
| **Works offline** | Yes | Yes, after the first load | Yes |

If you haven't looked at any of this yet, start with **`demo/voices.html`**
(`npm run demo`, then open it) — it lets you hear all three before you decide, with a
ready-to-paste config for whichever you pick.

## How to switch

Change one key. Everything else in your `aloud` config stays as it is.

```js
Reveal.initialize({
  plugins: [ RevealAloud ],
  aloud: {
    engine: 'webspeech'   // or 'kokoro', or 'say'
  }
});
```

Leaving `engine` out at all is the same as `'webspeech'` — that's the default, and it's what
`demo/index.html` currently ships with.

### `webspeech` — the default

No setup. Uses whatever voices your browser reports.

```js
aloud: { voice: 'Samantha', rate: 1.0 }
```

- `voice` names are whatever `RevealAloud.listVoices()` reports — **not** what System Settings
  shows. See [README §7](README.md#7-better-system-voices-mac-free-worth-it) for why those two
  lists disagree, and for downloading better free system voices.
- Siri voices can never be reached this way — see `say` below.

### `kokoro` — free, high quality, runs in the browser

No setup, but the first use downloads an ~90 MB model (cached afterward).

```js
aloud: { engine: 'kokoro', voice: 'af_heart', rate: 1.0 }
```

- Voice names are Kokoro's own ids (`af_heart`, `am_adam`, `bf_emma`, …), not your OS's.
- The deck must be **served**, not opened as a `file://` page, since fetching the model needs a
  real origin. `npm run demo` already does this.
- Full details: [README §5](README.md#5-if-the-built-in-voices-sound-too-robotic-kokoro).

### `say` — your own downloaded voices, Siri included

**Setup required:** a local helper must be running before you press <kbd>R</kbd>.

```bash
node bin/say-server.js
```

Leave that running in its own terminal for the whole time you're presenting. Then:

```js
aloud: { engine: 'say' }   // no `voice` set → uses your current System Voice, Siri included
```

To use a specific installed voice instead of your System Voice default:

```js
aloud: { engine: 'say', voice: 'Ava' }   // matches "Ava (Premium)"; partial names work
```

- **Mac only.** The helper shells out to the macOS `say` command; it has nothing to run on
  Windows or Linux.
- If you forget to start the helper, the on-screen badge says so — `speak()` fails clearly
  rather than hanging silently.
- Full details, including exactly why Siri voices need this and can't be reached any other
  way: [README §6](README.md#6-or-your-own-downloaded-voices-via-say).

## Setup checklist before you present

Whichever engine you pick, do this once beforehand, not for the first time on stage:

- [ ] **`webspeech`** — nothing to check. If the voice sounds wrong, the on-screen badge will
      say so the moment the deck loads.
- [ ] **`kokoro`** — open the deck once ahead of time so the model finishes downloading and gets
      cached. Confirm the deck is being served (`npm run demo` or any static file server), not
      opened directly as a file.
- [ ] **`say`** — start `node bin/say-server.js` in a terminal you can leave running, and
      confirm the voice you want is really the one that plays (`demo/voices.html`'s "say"
      section is the fastest way to check). Remember: audio comes out your Mac's speakers
      directly, not through the browser tab — capture system audio if you're screen recording.

## Still deciding?

- Voices sound robotic and you have nothing special installed → **`kokoro`**.
- You already downloaded voices you like, especially a Siri voice → **`say`**.
- You just want it to work with zero setup and don't mind the default quality → **`webspeech`**.
