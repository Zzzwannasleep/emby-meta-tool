export function getThrottle(env: any) {
  const concurrency = clampInt(env.FETCH_CONCURRENCY, 2, 1, 6);
  const delayMs = clampInt(env.FETCH_DELAY_MS, 250, 0, 2000);
  return { concurrency, delayMs };
}

function clampInt(v: any, def: number, min: number, max: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function throttleMap<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let next = 0;

  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      if (delayMs > 0) await sleep(delayMs);
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
