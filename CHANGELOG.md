# Changelog

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
