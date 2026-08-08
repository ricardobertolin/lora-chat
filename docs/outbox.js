// Messages waiting to go out.
//
// Anything typed while disconnected, or that was never acknowledged, is held
// here and flushed when there is a board and somebody to hear it. Persisted, so
// closing the tab in a dead spot does not lose what you wrote.

export const OUTBOX_KEY = 'lora-chat-outbox';
export const OUTBOX_CAP = 50;

export function createItem(text, at = Date.now()) {
  return { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, text, at, tries: 0 };
}

export function enqueue(list, item, cap = OUTBOX_CAP) {
  const next = (Array.isArray(list) ? list : []).concat([item]);
  // Drop the oldest rather than refusing new ones: what you just typed matters
  // more than something from an hour ago that still has not gone.
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function remove(list, id) {
  return (Array.isArray(list) ? list : []).filter((i) => i.id !== id);
}

export function sanitise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (i) =>
      i &&
      typeof i === 'object' &&
      typeof i.id === 'string' &&
      typeof i.text === 'string' &&
      i.text.length > 0 &&
      Number.isFinite(i.at)
  );
}

export function load(storage = globalThis.localStorage) {
  try {
    return sanitise(JSON.parse(storage.getItem(OUTBOX_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function save(list, storage = globalThis.localStorage) {
  try {
    storage.setItem(OUTBOX_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function clear(storage = globalThis.localStorage) {
  try {
    storage.removeItem(OUTBOX_KEY);
  } catch {}
}

export function describe(list) {
  const n = Array.isArray(list) ? list.length : 0;
  if (!n) return 'empty';
  return `${n} message${n === 1 ? '' : 's'} waiting`;
}
