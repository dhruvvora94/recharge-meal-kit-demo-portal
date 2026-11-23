// Walden market pricing (R-04). Pure functions, safe on client and server.
//
// Each variant can carry dated base prices in the Shopify variant metafield
// `walden.price_windows` (JSON):
//   [{ "starts_on": "2026-01-01", "price": "99.98" }, { "starts_on": "2027-01-01", "price": "104.99" }]
//
// An order's base price is the latest entry whose starts_on is on or before the
// order's DELIVERY date; with no matching entry, the Shopify variant price.
//   one-time pick     = base price
//   subscription item = base price less the subscription plan's discount

export type PriceWindow = { starts_on: string; price: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parse the metafield value; tolerates null/invalid JSON and bad entries. */
export function parsePriceWindows(raw: unknown): PriceWindow[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (w): w is PriceWindow =>
        w != null &&
        typeof w.starts_on === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(w.starts_on) &&
        w.price != null &&
        Number.isFinite(Number(w.price))
    )
    .map((w) => ({ starts_on: w.starts_on, price: String(w.price) }))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

/** Base price on a delivery date; falls back to the Shopify price. */
export function basePriceOn(windows: PriceWindow[] | null | undefined, deliveryIso: string, fallback: number): number {
  const day = deliveryIso.slice(0, 10);
  let hit: PriceWindow | undefined;
  for (const w of windows ?? []) if (w.starts_on <= day) hit = w;
  return hit ? round2(Number(hit.price)) : round2(fallback);
}

/** The window a delivery falls in (for labels like "Price from Jan 1, 2027"). */
export function windowOn(windows: PriceWindow[] | null | undefined, deliveryIso: string): PriceWindow | null {
  const day = deliveryIso.slice(0, 10);
  let hit: PriceWindow | null = null;
  for (const w of windows ?? []) if (w.starts_on <= day) hit = w;
  return hit;
}

export function subscribePrice(base: number, pct: number): number {
  return round2(base * (1 - pct / 100));
}
