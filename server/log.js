// Colorful event-style terminal logging (pure ASCII source; emoji via escapes).
// Colors are ANSI codes; they degrade gracefully when stdout is not a TTY.
const RESET = '\x1b[0m';
const CODES = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function paint(s, color) {
  const code = CODES[color];
  if (!code || !process.stdout || !process.stdout.isTTY) return s;
  return code + s + RESET;
}

// Icons referenced by name so callers never embed emoji directly in source.
export const ic = {
  check: '\u2705', // ??
  cross: '\u274c', // ??
  spark: '\u2728', // ??
  search: '\u{1f50d}', // ??
  radio: '\u{1f4e2}', // ??
  gear: '\u2699\ufe0f', // ????
  eye: '\u{1f441}\ufe0f', // ????
  clock: '\u23f1\ufe0f', // ????
  dot: '\u25cf', // ●
  star: '\u2b50', // ??
};

export function logEvent(icon, color, tag, msg) {
  console.log(`${icon} ${paint(`[${tag}]`, color)} ${msg}`);
}

export function logErr(tag, msg) {
  console.error(`${ic.cross} ${paint(`[${tag}]`, 'red')} ${msg}`);
}

export function logStart(tag, msg) {
  logEvent(ic.search, 'cyan', tag, msg);
}

export function logDone(tag, msg) {
  logEvent(ic.check, 'green', tag, msg);
}

export function logWarn(tag, msg) {
  logEvent(ic.spark, 'yellow', tag, msg);
}

export function logBoot(tag, msg) {
  logEvent(ic.gear, 'cyan', tag, msg);
}
