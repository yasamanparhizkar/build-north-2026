// Resolve a (snapshotId, elementId) from the background into a live, still-correct
// element. Guards against the page changing between scan, Gemini call and render.
import { namesMatch } from './describe.js';
import { accessibleName, computeRole } from './accname.js';
import { isDisplayed, scanPage } from './elements.js';
import { nearestTo } from './snapshot.js';

/**
 * @param {import('./snapshot.js').SnapshotRegistry} registry
 * @param {string} snapshotId
 * @param {{id: string, name: string, role: string}} target  as sent by the background
 * @returns {{el: Element, rematched: boolean}|{el: null, reason: string}}
 */
export function resolveTarget(registry, snapshotId, target) {
  const entry = registry.lookup(snapshotId, target.id);

  // The background must echo the name it saw; a mismatch means a mixed-up id.
  if (entry && !namesMatch(entry.name, target.name)) return { el: null, reason: 'id-name-mismatch' };

  if (entry) {
    const el = entry.ref.deref();
    if (el && el.isConnected && isDisplayed(el) && namesMatch(accessibleName(el, computeRole(el)), entry.name)) {
      return { el, rematched: false };
    }
  }

  // Element was re-rendered, hidden, or the snapshot expired: re-match by role + name.
  const role = entry?.role || target.role;
  const name = entry?.name || target.name;
  if (!name) return { el: null, reason: 'unknown-target' };
  const same = scanPage({ limit: false }).filter((c) => c.role === role && namesMatch(c.name, name));
  if (!same.length) return { el: null, reason: 'target-gone' };
  if (same.length === 1) return { el: same[0].el, rematched: true };
  if (entry?.rect) return { el: nearestTo(entry.rect, same).el, rematched: true };
  return { el: null, reason: 'ambiguous-after-change' };
}

