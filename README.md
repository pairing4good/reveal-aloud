# reveal-aloud

[![CI](https://github.com/pairing4good/reveal-aloud/actions/workflows/ci.yml/badge.svg)](https://github.com/pairing4good/reveal-aloud/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- Add this back once the package is published to npm; until then it renders as "not found":
[![npm](https://img.shields.io/npm/v/reveal-aloud.svg)](https://www.npmjs.com/package/reveal-aloud)
-->

Reads your [reveal.js](https://revealjs.com) speaker notes out loud while you present.

You drive the slides. It reads the notes for whatever slide you are on, stops the moment you
move, and stays quiet on slides that have no notes. Anything you put in `[square brackets]` is
for you, not the audience — it never gets spoken.

Free voices, no account, no API key, nothing to install on your machine. Works out of the box
on a Mac in Safari and Chrome.

---

## 1. Add it to your deck

Two lines:

```html
<script src="https://cdn.jsdelivr.net/gh/pairing4good/reveal-aloud@v0.1.0/dist/reveal-aloud.js"></script>

<script>
  Reveal.initialize({
    plugins: [ RevealAloud ]
  });
</script>
```

jsDelivr serves that straight from this repository's `v0.1.0` tag, so there is nothing to
install and nothing to sign up for.

**Keep the version pinned.** jsDelivr caches a file effectively forever once it has served it,
and an unpinned URL follows the latest release — so a deck you handed to someone months ago
could quietly start loading different code. `@v0.1.0` is the version you tested against; say so.

> *Pre-release note: the URL above goes live the moment the first version tag is pushed. Until
> then, clone the repo and point at your local `dist/reveal-aloud.js`. Delete this note after
> the first release.*

<details>
<summary>From npm (once published)</summary>

The package is not on npm yet. After the first `npm publish` — see
[Releasing](#releasing) — either of these works:

```html
<!-- jsDelivr mirrors npm automatically; no separate CDN step -->
<script src="https://cdn.jsdelivr.net/npm/reveal-aloud@0.1.0/dist/reveal-aloud.js"></script>
```

```bash
npm install reveal-aloud
```

```js
import Reveal from 'reveal.js';
import RevealAloud from 'reveal-aloud';

Reveal.initialize({ plugins: [RevealAloud] });
```

</details>

## 2. Press <kbd>R</kbd>

That's the whole interaction.

- <kbd>R</kbd> starts narration and reads the slide you are on.
- Arrow keys as usual. Each new slide starts reading; leaving a slide stops it mid-sentence.
- Going **backwards** works exactly the same as going forwards.
- <kbd>R</kbd> again stops.

A small badge in the corner tells you what it's doing. `R` is free in reveal.js — it does not
clash with any built-in shortcut — and it shows up in reveal's own <kbd>?</kbd> help overlay.

## 3. Keep some notes to yourself

Anything in square brackets is skipped:

```html
<aside class="notes">
  Here is the headline number. [click to reveal the chart]
  It went up by forty percent. [pause for effect]
</aside>
```

You hear: *"Here is the headline number. It went up by forty percent."*

- Brackets can span several lines and can be nested.
- A note that is **only** brackets is silent.
- A slide with **no** notes is silent — and narration stays on for the next slide.
- Need to actually say a bracket? Escape it: `\[like this\]`.

## 4. Change the voice or the speed

```js
Reveal.initialize({
  plugins: [ RevealAloud ],
  aloud: {
    voice: 'Samantha',   // any voice installed on your machine
    rate: 1.15           // 1 is normal, 0.5 is half speed, 2 is double
  }
});
```

To see what voices you have, open the browser console on your deck and run:

```js
RevealAloud.listVoices()
```

| Option | Default | What it does |
| --- | --- | --- |
| `engine` | `'webspeech'` | `'webspeech'`, `'kokoro'`, or `'say'` (Mac-only) — see below. |
| `voice` | *system default* | Voice name. Partial names work (`'Sam'` finds `'Samantha'`). |
| `rate` | `1` | Speaking speed, `0.1`–`10`. |
| `pitch` | `1` | Voice pitch, `0`–`2`. |
| `volume` | `1` | Narration volume, `0`–`1`. |
| `lang` | *system default* | e.g. `'en-GB'`. Useful when two voices share a name. |
| `key` | `'R'` | The toggle key. |
| `autoStart` | `false` | Start narrating as soon as the deck loads. |
| `speakCode` | `false` | Read `<code>` and `<pre>` inside notes. |
| `pauseWhenHidden` | `true` | Go quiet while the tab is in the background. |
| `sayServerUrl` | `'http://127.0.0.1:5757'` | Where `bin/say-server.js` is listening. |
| `indicator` | `true` | Show the status badge in the corner. |

## 5. If the built-in voices sound too robotic: Kokoro

Every operating system's built-in voices have a ceiling, and on some machines that ceiling is
low — no downloaded voice fixes it, because none of the good ones are exposed to a browser at
all (see below). When that's where you've landed, there is a real free alternative: **Kokoro**,
an open-weights model that runs entirely inside the browser tab. No account, no server, no
per-use cost, and no cap on how much you use it.

**Open `demo/voices.html`** (`npm run demo`, then the "Not good enough? Try Kokoro" section at
the bottom) and click *Load Kokoro*. That downloads the model once, lists its voices, and lets
you hear each one before committing.

```js
Reveal.initialize({
  plugins: [ RevealAloud ],
  aloud: {
    engine: 'kokoro',
    voice: 'af_heart',   // run RevealAloud.listVoices() after switching to see the rest
    rate: 1.0
  }
});
```

**What this costs, honestly:**

- **A one-time download**, tens of megabytes, cached by the browser afterward. Load it once
  before you present, not for the first time on stage.
- **A short pause before each sentence** while the audio is generated. Narration is still
  spoken sentence by sentence, so only the very first sentence of a slide has a visible gap —
  generation for the next sentence starts as soon as the current one begins playing.
- **The deck must be served**, not opened as a `file://` page — fetching the model needs a real
  origin. `npm run demo` already does this; any static file server works.
- Everything else — <kbd>R</kbd>, brackets, stopping mid-sentence on advance, all of it — works
  identically to the built-in voices, because both sit behind the same internal interface.

`kokoroModuleUrl`, `kokoroModel`, `kokoroDtype` and `kokoroDevice` are further options if you
want to pin a version, self-host the library, or trade download size for quality — see the
comments on `DEFAULTS` in `src/app/plugin.js`.

## 6. Or: your own downloaded voices, via `say`

If you already have voices you like in **System Settings → Accessibility → Spoken Content**
— including a Siri voice — there's a direct way to use exactly those, for free, with nothing to
download twice.

**The catch: no browser can reach a Siri voice on its own, at all.** Confirmed by testing —
`say -v "Siri (Voice 2)"` in Terminal fails with *"Voice not found"*, even though that same
voice is right there in System Settings. Apple simply does not expose Siri voices to
`AVSpeechSynthesizer`, which is what every browser's Web Speech API is built on. There is no
config option or workaround for that from inside a web page — it's an OS-level restriction, not
a bug in this plugin.

What *does* work: the `say` command with no `-v` flag at all uses whatever your **System
Voice** is currently set to — Siri voice included. `bin/say-server.js` is a tiny local helper
that puts that behind an HTTP call, so reveal-aloud can use it like any other engine:

```bash
node bin/say-server.js
```

Leave that running in a terminal while you present, then:

```js
Reveal.initialize({
  plugins: [ RevealAloud ],
  aloud: {
    engine: 'say'
    // no `voice` set at all → uses your current System Voice, Siri included
  }
});
```

Open **`demo/voices.html`** and use the "Already downloaded good voices on your Mac?" section
to confirm the server is running and hear each voice before committing — it lists every voice
`say -v ?` reports, plus your current System Voice as its own entry.

To use one of your other downloaded voices by name instead of the system default:

```js
aloud: { engine: 'say', voice: 'Ava' }   // matches "Ava (Premium)"; partial names work
```

**What this costs, honestly:**

- **It only runs on a Mac**, and only while `bin/say-server.js` is running. If you close that
  terminal, narration stops working until you start it again — the badge on screen says so.
- **It's a separate process from your browser**, listening on `127.0.0.1` only, so nothing
  outside your own machine can ever reach it.
- Speech comes out of **your Mac's speakers directly**, not through the browser tab — so this
  is the one engine where muting the browser tab does not silence it. If you are recording your
  screen, make sure your system audio, not just the tab, is captured.
- Everything else — <kbd>R</kbd>, brackets, stopping mid-sentence, all of it — works exactly the
  same as the other two engines.

## 7. Better system voices (Mac, free, worth it)

The voice that ships turned on by default is not great. Downloading a better one takes a minute
and costs nothing:

**System Settings → Accessibility → Spoken Content → System Voice → Manage Voices…**

Tick any English voice marked *(Enhanced)* or *(Premium)* and let it download. Ava, Zoe, Evan
and Nathan are all good. This is the single biggest improvement you can make.

Then — and this is the step that catches people — get the name from the browser, not from
System Settings. Open **`demo/voices.html`**: it lists every voice this browser will actually
let reveal-aloud use, plays a sample of any of them, and hands you the config to paste.

```bash
npm run demo    # then open http://localhost:8000/demo/voices.html
```

If you would rather stay in the console, `RevealAloud.listVoices()` returns the same list.

**Three things about that dialog that are not obvious:**

- **The *System voice* dropdown has no effect here.** It sets the voice macOS uses for its own
  spoken content. Browsers ignore it. Downloading a voice is what makes it available; selecting
  it as the system voice does nothing for your deck.
- **Siri voices can never be used.** They appear in that dropdown, but Apple reserves them —
  they are not offered through `AVSpeechSynthesizer` and so
  [never reach any browser](https://github.com/HadrienGardeur/web-speech-recommended-voices/issues/22).
  Naming one in your config always falls back to something else.
- **Safari shows fewer voices than Chrome.** If a voice you downloaded is missing from
  `listVoices()` in Safari, try the same deck in Chrome before assuming the download failed.

If the name in your config is not one the browser can use, reveal-aloud says so on screen when
the deck loads and names what it fell back to, so you find out before you are on stage rather
than during.

Tried a Premium voice and it still sounds robotic? That's real — some machines simply don't have
a good one available to a browser, and no amount of downloading changes that. Section 5 above is
the actual fix in that case.

## Try it

```bash
git clone https://github.com/pairing4good/reveal-aloud
cd reveal-aloud
open demo/index.html      # or: npm install && npm run demo
```

The demo deck prints its own speaker notes on every slide, with the silent parts struck through
and a "you should hear" line generated by the plugin itself. Press <kbd>R</kbd> and follow along.

`demo/voices.html` is a second page that answers "which voices do I actually have, and what do
they sound like?" — every voice your browser exposes, with a Speak button on each, plus a way to
load and audition Kokoro (section 5) or a `say-server` (section 6) without editing a config file first.

---

## Handy extras

Everything below is optional.

**Check a slide without listening to it.** Prints exactly what would be spoken:

```js
RevealAloud.preview(Reveal.getCurrentSlide())
```

**Drive it from your own code:**

```js
const aloud = Reveal.getPlugin('aloud');

aloud.toggle();          // same as pressing R
aloud.start();
aloud.stop();
aloud.replay();          // re-read this slide from the top
aloud.isOn();
aloud.setRate(1.5);      // takes effect immediately
aloud.setVoice('Ava');
aloud.listVoices();
```

## Troubleshooting

**Nothing happens when I press <kbd>R</kbd>.** Browsers refuse to make sound until you have
interacted with the page. The keypress itself counts, so try once more. If you used
`autoStart: true`, the badge will say it is waiting for you.

**It says "no notes on this slide".** That slide has no `aside.notes` (or `data-notes`), or its
notes are entirely inside brackets. Both are silent on purpose.

**Half my note went missing.** You probably left a `[` unclosed — everything after it is treated
as a stage direction. The badge warns you when that happens.

**The wrong voice is used.** The name in your config is not one this browser can use, so it fell
back — a warning says so on screen as the deck loads, and again in the console. Run
`RevealAloud.listVoices()` for the exact names available to you. The usual cause on a Mac is
naming a Siri voice: Apple reserves those and never exposes them to browsers. Step 6 is the way to actually use one; step 7 is for every other voice.

**It reads a bit robotically.** Try a Premium voice (step 7). Already have voices you like installed? Route through them directly with `say` (step 6) — the only way to reach a Siri voice. Neither appealing? Kokoro (step 5) needs no installed voices at all.

## Good to know

- Fragments don't restart narration. Revealing a bullet is not a new slide.
- The overview (<kbd>Esc</kbd>), the blackout (<kbd>B</kbd>) and a backgrounded tab all pause
  narration and resume it when you come back.
- PDF export (`?print-pdf`) turns the plugin off entirely.
- Notes are read from `aside.notes` and `data-notes`, exactly like reveal's own speaker view —
  so what you hear matches what the speaker view shows.
- Long notes are split into sentences before being spoken, because Chrome silently truncates
  utterances longer than about fifteen seconds.
- Narration length is not synced to reveal's `autoSlide`; if you use both, they run independently.
- Kokoro (`engine: 'kokoro'`) is not bundled — it loads on demand from a CDN, so choosing the
  default `'webspeech'` engine costs nothing for presenters who never switch.
- `say` (`engine: 'say'`) only works on a Mac with `bin/say-server.js` running alongside the
  deck — see step 6.

## Development

```bash
npm install
npm test           # unit, property, adapter and say-server tests
npm run test:e2e   # the real demo deck, in a real browser
npm run test:soak  # property tests with far more generated cases
npm run verify     # lint + build + everything
npm run build:site # assemble the demo into _site/, as GitHub Pages serves it
npm run say-server  # node bin/say-server.js — needed only when trying the say engine
```

The end-to-end tests need a browser: `npx playwright install chromium`. Without one they skip
with a note rather than failing, so a first `npm test` works on a clean checkout.

The strongest test in the suite is `what actually reaches the speech engine` in
`test/e2e/demo-deck.test.js`. It walks every slide of the demo deck in a real browser, records
every string handed to `speechSynthesis.speak()`, and checks two things independently: that the
engine received exactly the utterances the plugin intends, and that no phrase from any bracketed
span anywhere in the deck appears in any of them. The bracket list is read out of the deck's
HTML rather than from the plugin, so the check still holds if the plugin's own idea of what is
silent were ever wrong.

The code is a [hexagon](https://alistair.cockburn.us/hexagonal-architecture/): `src/core/` is
pure — no DOM, no timers, no speech, no reveal.js — and holds every decision about what gets
spoken. `src/adapters/` holds everything with a side effect. A lint rule fails the build if the
core reaches for the browser — which is exactly what let both `kokoro` and `say` get added as
alternate engines later without touching a line of the decision-making code. `test/server/`
covers `bin/say-server.js` itself with real HTTP calls against a real spawned process, and
`test/e2e/say-engine.test.js` and `kokoro-engine.test.js` drive the real plugin against it (and
against a fixture standing in for Kokoro's model) in a real browser.

## Continuous integration

Every push and pull request runs lint, build, the full test suite on Node 20 and 22, and the
end-to-end suite in a real browser. A separate job re-runs the property tests with far more
generated cases. CI also fails if the committed `dist/` bundle has drifted from `src/`, since
the CDN and the double-click demo both serve it.

Two more workflows are set up but stay out of the way until you want them:

- **Release** (`.github/workflows/release.yml`) publishes to npm when you push a version tag.
  See [Releasing](#releasing) below.
- **Demo** (`.github/workflows/pages.yml`) publishes the demo deck to GitHub Pages. To switch it
  on: Settings → Pages → Source: *GitHub Actions*, then add a repository variable
  `DEPLOY_DEMO = true`. It is gated on that variable so it cannot turn the badge red before
  Pages has been enabled.

## Releasing

```bash
npm version minor && git push --follow-tags
```

That single command is the whole release. It bumps `package.json`, commits, creates a `v*` tag
and pushes both, which makes two things happen:

**The `/gh/` CDN URL starts working immediately.** jsDelivr serves tagged GitHub releases
directly, and `dist/` is committed, so the tag alone is enough:

```
https://cdn.jsdelivr.net/gh/pairing4good/reveal-aloud@v1.2.0/dist/reveal-aloud.js
```

**The tag triggers `release.yml`**, which re-runs lint, build, the dist-drift check, the unit
suite and the end-to-end suite, refuses to continue if the tag and `package.json` version
disagree, then runs `npm publish --provenance`. Once that succeeds the npm CDN path works too:

```
https://cdn.jsdelivr.net/npm/reveal-aloud@1.2.0/dist/reveal-aloud.js
```

Nothing is ever published *to* jsDelivr — it mirrors npm and GitHub on demand, with no account
and no registration. Publishing to npm needs an `NPM_TOKEN` repository secret (an npm
[automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens)); the `/gh/` route
needs no account at all.

Because `dist/` is what both CDNs serve, CI fails if it has drifted from `src/`. A pinned URL is
immutable and jsDelivr caches it forever, so a tag cut over a stale bundle is not something you
can quietly fix later — it would keep serving the wrong code to every deck that pinned it.

## License

MIT
