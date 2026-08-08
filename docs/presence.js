// Who else is on the channel.
//
// There is no association step in raw LoRa - anyone on the same frequency and
// sync word simply hears you. So presence is inferred: a node announces itself
// when it connects, any traffic at all counts as a sign of life, and going
// quiet for long enough is treated as having left.

export const PRESENCE_TIMEOUT_MS = 5 * 60 * 1000;

export function createNode(name, at) {
  return { name, firstSeen: at, lastSeen: at, rssi: null, snr: null, pos: null, stale: false };
}

// Returns 'joined' the first time a name is seen, 'returned' when a node that
// had gone quiet speaks again, and 'seen' otherwise.
export function touchNode(nodes, name, at, { rssi = null, snr = null } = {}) {
  let node = nodes.get(name);
  let event = 'seen';

  if (!node) {
    node = createNode(name, at);
    nodes.set(name, node);
    event = 'joined';
  } else if (node.stale) {
    event = 'returned';
  }

  node.lastSeen = at;
  node.stale = false;
  if (rssi !== null) node.rssi = rssi;
  if (snr !== null) node.snr = snr;
  return event;
}

export function setPosition(nodes, name, pos, at) {
  touchNode(nodes, name, at);
  nodes.get(name).pos = pos;
}

export function dropNode(nodes, name) {
  return nodes.delete(name);
}

// Marks anything past the timeout as stale and returns the names that changed,
// so a caller can announce them exactly once.
export function sweep(nodes, now, timeout = PRESENCE_TIMEOUT_MS) {
  const gone = [];
  for (const node of nodes.values()) {
    if (!node.stale && now - node.lastSeen > timeout) {
      node.stale = true;
      gone.push(node.name);
    }
  }
  return gone;
}

export function roster(nodes) {
  return [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function activeCount(nodes) {
  let n = 0;
  for (const node of nodes.values()) if (!node.stale) n++;
  return n;
}

export function formatSeen(node, now) {
  const secs = Math.round((now - node.lastSeen) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
}
