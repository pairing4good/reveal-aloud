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
| `voice` | *system default* | Voice name. Partial names work (`'Sam'` finds `'Samantha'`). |
| `rate` | `1` | Speaking speed, `0.1`–`10`. |
| `pitch` | `1` | Voice pitch, `0`–`2`. |
| `volume` | `1` | Narration volume, `0`–`1`. |
| `lang` | *system default* | e.g. `'en-GB'`. Useful when two voices share a name. |
| `key` | `'R'` | The toggle key. |
| `autoStart` | `false` | Start narrating as soon as the deck loads. |
| `speakCode` | `false` | Read `<code>` and `<pre>` inside notes. |
| `pauseWhenHidden` | `true` | Go quiet while the tab is in the background. |
| `indicator` | `true` | Show the status badge in the corner. |

## 5. Better voices (Mac, free, worth it)

The voice that ships turned on by default is not great. Downloading a better one takes a minute
and costs nothing:

**System Settings → Accessibility → Spoken Content → System Voice → Manage Voices…**

Pick any English voice marked *(Enhanced)* or *(Premium)* and download it. Then put its name in
your config. Ava, Zoe, Evan and Nathan are all good. This is the single biggest improvement you
can make.

## Try it

```bash
git clone https://github.com/pairing4good/reveal-aloud
cd reveal-aloud
open demo/index.html      # or: npm install && npm run demo
```

The demo deck prints its own speaker notes on every slide, with the silent parts struck through
and a "you should hear" line generated by the plugin itself. Press <kbd>R</kbd> and follow along.

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

**The wrong voice is used.** The name in your config isn't installed on this machine; the console
says so and falls back to the default. Run `RevealAloud.listVoices()` to see the real names.

**It reads a bit robotically.** Download an Enhanced or Premium voice — see step 5 above.

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

## Development

```bash
npm install
npm test           # unit, property and adapter tests
npm run test:e2e   # the real demo deck, in a real browser
npm run test:soak  # property tests with far more generated cases
npm run verify     # lint + build + everything
npm run build:site # assemble the demo into _site/, as GitHub Pages serves it
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
core reaches for the browser, so a `say`-command adapter can be dropped in later without
touching a line of the decision-making code.

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
