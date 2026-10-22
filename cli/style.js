// ANSI colors (off when piped, NO_COLOR is set, or TERM=dumb) and text helpers.

const CODES = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], cyan: [36, 39] };

export function useColor(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

// colors(process.stdout).bold("x") -> "\x1b[1mx\x1b[22m" on a terminal, "x" otherwise
export function colors(stream) {
  const on = useColor(stream);
  const out = {};
  for (const [name, [open, close]] of Object.entries(CODES)) {
    out[name] = (text) => (on ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
  }
  return out;
}

// Terminal width; COLUMNS lets piped output and tests choose one.
export function terminalWidth() {
  return process.stdout.columns || Number(process.env.COLUMNS) || 120;
}

// C0/C1 control characters (except tab and newline): API text such as DMs and bios
// could otherwise restyle the terminal, set its title or write to the clipboard.
export function stripControl(text) {
  return String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

const ZERO_WIDTH = /[\p{Mn}\p{Me}\u200b-\u200f\ufe00-\ufe0f]/u;
const DOUBLE_WIDTH = /[\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;

function charWidth(char) {
  if (ZERO_WIDTH.test(char)) return 0;
  return DOUBLE_WIDTH.test(char) ? 2 : 1;
}

// Columns the text takes up in a terminal: emoji and CJK count as 2.
export function displayWidth(text) {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

export function padEnd(text, width) {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

// Cuts by whole characters (never half an emoji) to fit width columns.
export function truncate(text, width) {
  if (displayWidth(text) <= width) return text;
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const char of text) {
    const w = charWidth(char);
    if (used + w > width - 1) break;
    out += char;
    used += w;
  }
  return out + "…";
}

// Word-wraps text to width, prefixing every line with indent.
export function wrap(text, width, indent = "") {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}
