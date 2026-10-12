/**
 * Text-editing keys that differ by computer. Playwright on a Mac uses the Mac's own keys, where
 * Home and End go to the start and end of the whole text and Ctrl+A goes to the start of the line,
 * so tests that move around a text box use these instead of naming the keys.
 */
const mac = process.platform === "darwin";

export const keys = {
  lineStart: mac ? "Meta+ArrowLeft" : "Home",
  lineEnd: mac ? "Meta+ArrowRight" : "End",
  /** From the end of a line, selects back to its start. */
  selectToLineStart: mac ? "Shift+Meta+ArrowLeft" : "Shift+Home",
  textStart: mac ? "Meta+ArrowUp" : "Control+Home",
  textEnd: mac ? "Meta+ArrowDown" : "Control+End",
  selectAll: mac ? "Meta+a" : "Control+a",
};
