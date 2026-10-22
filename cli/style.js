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

export function truncate(text, width) {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return text.slice(0, width - 1) + "…";
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
