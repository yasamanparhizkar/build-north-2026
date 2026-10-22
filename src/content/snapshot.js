// Snapshot registry: maps (snapshotId, elementId) -> live element for a short time.
// Ids are only meaningful together with their snapshotId, and every content-script
// instance uses a random page token, so an id from another page/snapshot can never
// silently resolve to an unrelated control. Pure (WeakRef only); unit tested.

export function randomToken() {
  return Math.random().toString(36).slice(2, 8);
}

export class SnapshotRegistry {
  constructor({ max = 4, pageToken = randomToken() } = {}) {
    this.max = max;
    this.pageToken = pageToken;
    this.version = 0;
    this.snapshots = new Map(); // snapshotId -> Map(id -> entry)
  }

  /** @param {Array<{el: object, role: string, name: string, rect?: object}>} entries */
  create(entries) {
    const snapshotId = `${this.pageToken}-v${++this.version}`;
    const map = new Map();
    const ids = entries.map((e, i) => {
      const id = `el-${i + 1}`;
      map.set(id, { ref: new WeakRef(e.el), role: e.role, name: e.name, rect: e.rect || null });
      return id;
    });
    this.snapshots.set(snapshotId, map);
    while (this.snapshots.size > this.max) this.snapshots.delete(this.snapshots.keys().next().value);
    return { snapshotId, ids };
  }

  has(snapshotId) {
    return this.snapshots.has(snapshotId);
  }

  lookup(snapshotId, id) {
    return this.snapshots.get(snapshotId)?.get(id) || null;
  }

  clear() {
    this.snapshots.clear();
  }
}

/**
 * Pick the element closest to where the original was (used when re-matching
 * by role+name finds several candidates).
 */
export function nearestTo(rect, candidates) {
  if (!rect || !candidates.length) return candidates[0] || null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.rect.left + c.rect.width / 2 - cx, c.rect.top + c.rect.height / 2 - cy);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
