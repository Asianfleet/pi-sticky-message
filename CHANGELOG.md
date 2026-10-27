# Changelog

## 0.1.3

- Fix the ellipsis appearing at some widths but not others. The bar used the message's first **visual** line as its label, and transcript text is word-wrapped, so that line is always narrower than the message by a word's leftover (0–10 columns). Whenever the leftover happened to make the line fit, `truncateToWidth` decided nothing needed cutting, so a message that clearly continued rendered as an abrupt cutoff with no ellipsis. The label is now the message's wrapped lines joined into one line (up to the bar width), so the ellipsis appears whenever the message does not fit.
- Chinese README (`README.zh-CN.md`) with a language switcher, and a paragraph stating what sets the row apart.

## 0.1.2

- Fix the row background not covering the ellipsis, the right-hand hint, and the trailing padding. `truncateToWidth` emits a full `\x1b[0m` reset around the ellipsis, which cancelled the background for the rest of the line; escapes are now stripped before styling and the background is re-asserted after every internal reset.
- Add render-level regression tests that check, for widths 12–140 and several label shapes, that the row is exactly as wide as requested, that every cell is covered, that truncation always shows the ellipsis, and that no escape sequence leaks into the text.

## 0.1.1

- Add a README preview image (generated from `assets/preview.html`) and the `pi.image` gallery field.

## 0.1.0

Initial release.

- Sticky row at the top of the fullscreen transcript showing the first line of the message at the top of the viewport.
- Left click aligns to the current message start, then walks to previous messages; right click jumps to the next message.
- The row hides when parked on a message start and reappears on scroll.
- Implemented as a layout row instead of an overlay, so scrollbar dragging, text selection, and wheel scrolling are unaffected, and no transcript line is covered.
- Configurable background brightness, right-side hint, and left indent, persisted to `<agent-dir>/sticky-message.json`.
- `/sticky-message debug` diagnostics with a log file and a static test overlay.
