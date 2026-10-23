# Changelog

## 0.1.0

Initial release.

- Sticky row at the top of the fullscreen transcript showing the first line of the message at the top of the viewport.
- Left click aligns to the current message start, then walks to previous messages; right click jumps to the next message.
- The row hides when parked on a message start and reappears on scroll.
- Implemented as a layout row instead of an overlay, so scrollbar dragging, text selection, and wheel scrolling are unaffected, and no transcript line is covered.
- Configurable background brightness, right-side hint, and left indent, persisted to `<agent-dir>/sticky-message.json`.
- `/sticky-message debug` diagnostics with a log file and a static test overlay.
