/**
 * PURE. Reading the voice list macOS `say -v ?` prints.
 *
 * Shared by the live server and the offline file renderer, which both need to know what is
 * installed before they can honour a `voice` setting.
 */

/**
 * The id a presenter's config means by "use whatever my Mac is currently set to speak with" —
 * the only way to reach a Siri voice, since `say -v` rejects Siri voices by name outright but
 * silently honours one set as the System Voice when no `-v` is given at all.
 */
export const SYSTEM_DEFAULT_VOICE = 'system-default';

/**
 * `say -v ?` prints one voice per line as `Name    lang_TAG   # sample text`. Names may contain
 * spaces, so the language tag — always a bare `xx_YY` token — is what anchors the split.
 *
 * @param {string} output raw stdout from `say -v ?`
 * @returns {{name: string, lang: string}[]} in the order `say` listed them
 */
export function parseVoiceList(output) {
  const voices = [];
  for (const line of String(output).split('\n')) {
    const match = line.match(/^(.+?)\s+([a-z]{2}(?:_|-)[A-Za-z]{2,})\b/);
    if (!match) continue;
    voices.push({ name: match[1].trim(), lang: match[2].replace('_', '-') });
  }
  return voices;
}

/**
 * The voice list as callers should see it: the system default first and marked as such, so an
 * unconfigured `voice` setting resolves there via the same pickVoice() fallback the other
 * engines use — which is exactly the "just use whatever I already picked in System Settings"
 * behaviour a Siri voice needs.
 *
 * @param {string} output raw stdout from `say -v ?`
 * @returns {{name: string, lang: string, default?: boolean}[]}
 */
export function toVoiceCatalog(output) {
  return [{ name: SYSTEM_DEFAULT_VOICE, lang: '', default: true }, ...parseVoiceList(output)];
}

/**
 * Whether this voice name should be passed to `say -v` at all.
 * The system default must be expressed as the *absence* of `-v`, not as a name.
 *
 * @param {string} [voice]
 * @returns {boolean}
 */
export function isNamedVoice(voice) {
  return Boolean(voice) && voice !== SYSTEM_DEFAULT_VOICE;
}
