/**
 * Prints each slide's speaker notes onto the slide itself.
 *
 * The "you should hear" line is produced by asking the plugin what it would say, so what you
 * read on screen can never drift from what the narrator actually does. The struck-through grey
 * text is the raw note with its stage directions marked.
 *
 * This file is part of the demo, not the plugin. You do not need it in your own deck.
 */

/* global RevealAloud */

function annotateDeck(deck) {
  for (const slide of deck.getSlides()) annotateSlide(slide);
}

function annotateSlide(slide) {
  const source = rawNotes(slide);
  const panel = document.createElement('div');
  panel.className = 'aloud-panel';

  if (source === null) {
    panel.innerHTML =
      '<div class="aloud-panel__row"><span class="aloud-panel__label">Speaker notes</span>' +
      '<span class="aloud-panel__none">none on this slide</span></div>' +
      '<div class="aloud-panel__row"><span class="aloud-panel__label aloud-panel__label--hear">' +
      'You should hear</span><span class="aloud-panel__silent">nothing at all</span></div>';
    slide.appendChild(panel);
    return;
  }

  const { chunks, unclosedBracket } = RevealAloud.preview(slide);
  const heard =
    chunks.length === 0
      ? '<span class="aloud-panel__silent">nothing at all</span>'
      : chunks.map((chunk) => `<span class="aloud-chunk">${escapeHtml(chunk)}</span>`).join(' ');

  panel.innerHTML =
    '<div class="aloud-panel__row">' +
    '<span class="aloud-panel__label">Speaker notes</span>' +
    `<span class="aloud-panel__notes">${markSilentParts(source)}</span>` +
    '</div>' +
    '<div class="aloud-panel__row">' +
    '<span class="aloud-panel__label aloud-panel__label--hear">You should hear</span>' +
    `<span class="aloud-panel__heard">${heard}</span>` +
    '</div>' +
    (unclosedBracket
      ? '<div class="aloud-panel__warning">⚠️ unclosed “[” — everything after it is silent</div>'
      : '');

  slide.appendChild(panel);
}

/** The note exactly as the author wrote it, or null when there is none. */
function rawNotes(slide) {
  if (slide.hasAttribute('data-notes')) return slide.getAttribute('data-notes');

  const asides = [...slide.querySelectorAll('aside.notes')].filter(
    (aside) => aside.closest('section') === slide
  );
  if (asides.length === 0) return null;

  return asides
    .map((aside) => aside.textContent.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
}

/** Greys out and strikes through the parts that will not be spoken. */
function markSilentParts(text) {
  let html = '';
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\\' && (text[i + 1] === '[' || text[i + 1] === ']')) {
      html += `<span class="aloud-escaped">${escapeHtml(text[i + 1])}</span>`;
      i++;
      continue;
    }
    if (char === '[') {
      if (depth === 0) html += '<span class="aloud-silent">';
      depth++;
      html += '[';
      continue;
    }
    if (char === ']') {
      html += ']';
      if (depth > 0 && --depth === 0) html += '</span>';
      continue;
    }
    html += escapeHtml(char);
  }

  if (depth > 0) html += '</span>'; // an unclosed bracket runs to the end
  return html;
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]
  );
}
