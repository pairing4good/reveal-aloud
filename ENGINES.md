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
| **[Export to audio files](README.md#8-export-the-narration-as-audio-files)** | **No** — browsers expose no way to capture speech to a file | Yes, on any platform | Yes, on macOS |

If you haven't looked at any of this yet, start with **`demo/voices.html`**
(`npm run demo`, then open it) — it lets you hear all three before you decide, with a
ready-to-paste config for whichever you pick.

## How to switch

Open your deck's HTML file and find the `Reveal.initialize(...)` call. In `demo/index.html` that
is near the bottom of the file. Change the `engine` key (and optionally `voice`) inside the
`aloud` block:

```js
Reveal.initialize({
  plugins: [ RevealAloud ],
  aloud: {
    engine: 'webspeech',   // ← change this to 'kokoro' or 'say'
    voice: 'Samantha',
    rate: 1.0
  }
});
```

The `demo/index.html` file ships with all three engines shown as commented examples — uncomment
the one you want and comment out the others. Leaving `engine` out entirely defaults to
`'webspeech'`.

### `webspeech` — the default

No setup. Uses whatever voices your browser can see.

```js
aloud: { engine: 'webspeech', voice: 'Samantha', rate: 1.0 }
```

**Finding available voices:**
- Open **`demo/voices.html`** (`npm run demo`, then click the link) — it plays every voice
  your browser reports and shows the exact name to paste in.
- Or run `RevealAloud.listVoices()` in the browser console and copy a name from the list.
- The names that work here are **not** the same as what System Settings shows — `listVoices()`
  is the only list that counts.
- Siri voices appear in System Settings but are reserved by Apple and cannot be reached from
  a browser. Use `say` (below) to reach them.

### `kokoro` — free, high quality, runs in the browser

No setup, but the first use downloads an ~90 MB model (cached afterward).

```js
aloud: { engine: 'kokoro', voice: 'af_heart', rate: 1.0 }
```

**Available voices.** All 28 are English, and they are graded by the model's own authors. The
grades are not a formality — the gap between `af_heart` and `am_adam` is the difference between
"this is fine" and "nobody will listen to this". Name the id exactly as shown.

| Grade | Voice IDs |
|---|---|
| **A** | `af_heart` ★ |
| **A-** | `af_bella` |
| **B-** | `af_nicole` `bf_emma` |
| C+ | `af_aoede` `af_kore` `af_sarah` · `am_fenrir` `am_michael` `am_puck` |
| C | `af_alloy` `af_nova` `bf_isabella` · `bm_fable` `bm_george` |
| C- / D+ | `af_sky` · `bm_lewis` |
| D | `af_jessica` `af_river` `am_echo` `am_eric` `am_liam` `am_onyx` `bf_alice` `bf_lily` `bm_daniel` |
| D- / F+ | `am_santa` · `am_adam` |

★ = default when no `voice` is set.

In practice: use **`af_heart`** unless you have a reason not to, then `af_bella`. If you need a
male voice, `am_fenrir`/`am_michael`/`am_puck` at C+ are the ceiling — there is nothing better.
British: `bf_emma` is the only one above C.

The HuggingFace repo also contains Japanese, Chinese, Spanish, Hindi, Italian, Portuguese and
French voice files, but **`kokoro-js` cannot load any of them** — it validates against the 28
above and throws on anything else. `jf_alpha` and friends will not work.

Open **`demo/voices.html`** → kokoro tab to hear all of them before you decide, or list them with
grades from the terminal:

```bash
npx reveal-aloud-export --list-voices kokoro
```

The deck must be **served**, not opened as a `file://` page, since fetching the model needs a
real origin. `npm run demo` already does this.

Full details: [README §5](README.md#5-if-the-built-in-voices-sound-too-robotic-kokoro).

### `say` — your own downloaded voices, Siri included

**Setup required:** start the helper server before you press <kbd>R</kbd>.

```bash
node bin/say-server.js
```

Leave that running in its own terminal for the whole time you're presenting. Then:

```js
// Uses your current System Voice (Siri included):
aloud: { engine: 'say', rate: 1.0 }

// Uses a specific installed voice:
aloud: { engine: 'say', voice: 'Ava', rate: 1.0 }   // partial names work
```

**Finding available voices:**
- Run `say -v '?'` in Terminal — it lists every voice installed on your Mac with its locale.
- Or open **`demo/voices.html`** → say tab to hear them through the helper.
- Omit `voice` entirely to use whatever is set as your System Voice in
  **System Settings → Accessibility → Spoken Content**.

**Mac only.** The helper shells out to the macOS `say` command; it has nothing to run on
Windows or Linux.

If you forget to start the helper, the on-screen badge says so — narration fails clearly rather
than hanging silently.

Full details, including why Siri voices need this path: [README §6](README.md#6-or-your-own-downloaded-voices-via-say).

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
      directly, not through the browser tab — capture system audio if you're screen recording,
      or [export the narration to files](README.md#8-export-the-narration-as-audio-files) and
      skip recording it at all.

## Still deciding?

- Voices sound robotic and you have nothing special installed → **`kokoro`**.
- You already downloaded voices you like, especially a Siri voice → **`say`**.
- You just want it to work with zero setup and don't mind the default quality → **`webspeech`**.
