/**
 * Personal bests, per browser profile. Best effort: storage may be blocked
 * (private window, policy) and the game must not care.
 *
 * OWNER: game (src/game/**).
 */
const KEY = 'killhouse:records';

export function loadRecords() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return r && typeof r === 'object' ? r : {};
  } catch { return {}; }
}

/**
 * Merge one result into the records. Returns true when it set a new best time.
 * @param {object} records  mutated in place
 * @param {string} mode
 * @param {{time?:number, rating?:string, kills?:number, win?:boolean}} result
 */
export function saveRecord(records, mode, result) {
  const r = records[mode] ?? (records[mode] = {});
  let best = false;
  if (Number.isFinite(result.time) && (!Number.isFinite(r.time) || result.time < r.time)) {
    r.time = Math.round(result.time * 10) / 10;
    r.rating = result.rating ?? r.rating;
    best = true;
  }
  if (Number.isFinite(result.kills)) r.kills = Math.max(r.kills ?? 0, result.kills);
  if (result.win) r.wins = (r.wins ?? 0) + 1;
  r.played = (r.played ?? 0) + 1;
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* noop */ }
  return best;
}
