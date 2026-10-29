/**
 * Minimal key decoder for a raw-mode TTY.
 *
 * No terminal library is used: the sequences handled here are the ones the TUI
 * actually binds, which keeps the CLI free of native dependencies (important on
 * Termux/Android, where node-pty and similar modules are unavailable).
 */
export type Key =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'enter' }
  | { readonly type: 'backspace' }
  | { readonly type: 'delete' }
  | { readonly type: 'escape' }
  | { readonly type: 'tab' }
  | { readonly type: 'ctrl-c' }
  | { readonly type: 'ctrl-l' }
  | { readonly type: 'ctrl-u' }
  | { readonly type: 'ctrl-d' }
  | { readonly type: 'up' }
  | { readonly type: 'down' }
  | { readonly type: 'pageup' }
  | { readonly type: 'pagedown' };

const CONTROL_KEYS: Record<string, Key> = {
  '\x03': { type: 'ctrl-c' },
  '\x0c': { type: 'ctrl-l' },
  '\x15': { type: 'ctrl-u' },
  '\x04': { type: 'ctrl-d' },
};

/** Decode one chunk of stdin into keys, including bracketed pastes. */
export function decodeKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let index = 0;
  while (index < chunk.length) {
    const char = chunk[index] as string;

    if (char === '\x1b') {
      const rest = chunk.slice(index);
      const pasteEnd = rest.indexOf('\x1b[201~');
      if (rest.startsWith('\x1b[200~') && pasteEnd !== -1) {
        const pasted = rest.slice('\x1b[200~'.length, pasteEnd);
        if (pasted !== '') keys.push({ type: 'text', text: pasted.replace(/\r?\n/g, ' ') });
        index += pasteEnd + '\x1b[201~'.length;
        continue;
      }
      const sequence = ['\x1b[5~', '\x1b[6~', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1b[3~', '\x1b[Z'];
      const match = sequence.find((candidate) => rest.startsWith(candidate));
      if (match !== undefined) {
        index += match.length;
        switch (match) {
          case '\x1b[A':
            keys.push({ type: 'up' });
            break;
          case '\x1b[B':
            keys.push({ type: 'down' });
            break;
          case '\x1b[5~':
            keys.push({ type: 'pageup' });
            break;
          case '\x1b[6~':
            keys.push({ type: 'pagedown' });
            break;
          case '\x1b[3~':
            keys.push({ type: 'delete' });
            break;
          default:
            // Arrow left/right and shift-tab have no binding; ignore them.
            break;
        }
        continue;
      }
      if (rest.startsWith('\x1b[<')) {
        // Mouse reporting; consume until 'M' or 'm'.
        const end = rest.search(/[Mm]/);
        index += end === -1 ? rest.length : end + 1;
        continue;
      }
      index += 1;
      keys.push({ type: 'escape' });
      continue;
    }

    const control = CONTROL_KEYS[char];
    if (control !== undefined) {
      keys.push(control);
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      keys.push({ type: 'enter' });
      index += 1;
      continue;
    }
    if (char === '\x7f' || char === '\b') {
      keys.push({ type: 'backspace' });
      index += 1;
      continue;
    }
    if (char === '\t') {
      keys.push({ type: 'tab' });
      index += 1;
      continue;
    }
    // Printable run: take everything up to the next control character.
    let end = index + 1;
    while (end < chunk.length && !/[\x00-\x1f\x7f]/.test(chunk[end] as string)) end += 1;
    keys.push({ type: 'text', text: chunk.slice(index, end) });
    index = end;
  }
  return keys;
}
