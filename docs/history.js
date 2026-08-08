// Chat history, kept in localStorage so a reload does not wipe the conversation.
//
// Only real messages are stored. Diagnostics, banners and radio chatter are
// noise on reload, and positions belong to the peer list rather than the log.

export const HISTORY_KEY = 'lora-chat-history';
export const HISTORY_CAP = 300;

// Pure so it can be tested without a DOM or localStorage.
export function appendEntry(list, entry, cap = HISTORY_CAP) {
  const next = Array.isArray(list) ? list.concat([entry]) : [entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// Anything that is not a well-formed entry is dropped rather than crashing the
// log render - localStorage can hold whatever an older version wrote.
export function sanitise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e) =>
      e &&
      typeof e === 'object' &&
      typeof e.text === 'string' &&
      typeof e.mine === 'boolean' &&
      Number.isFinite(e.at)
  );
}

export function load(storage = globalThis.localStorage) {
  try {
    return sanitise(JSON.parse(storage.getItem(HISTORY_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function save(list, storage = globalThis.localStorage) {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch {
    // Quota exhausted, or storage blocked. Losing history is not worth
    // breaking the chat over.
    return false;
  }
}

export function clear(storage = globalThis.localStorage) {
  try {
    storage.removeItem(HISTORY_KEY);
  } catch {}
}

export function formatStamp(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
