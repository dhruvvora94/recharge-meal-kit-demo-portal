// Delivery-date-first helpers (R-01, R-03). Pure functions, safe on client
// and server. All dates are ISO "YYYY-MM-DD" strings handled in UTC so they
// never drift across time zones.

/**
 * Date rules from /merchant, per bundle variant:
 *   deliveryDateOffset      delivery = charge date + N days
 *   modificationWindowDays  edits lock N days before delivery (0 = never lock)
 */
export type DateSettings = { deliveryDateOffset: number; modificationWindowDays: number };

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(iso: string): Date {
  return new Date(iso.slice(0, 10) + "T00:00:00Z");
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Move `days` business days (Mon–Fri) forward (+) or back (−). */
export function addBusinessDays(iso: string, days: number): string {
  const d = parseIso(iso);
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (!isWeekend(d)) remaining--;
  }
  return toIsoDate(d);
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Recharge stores the charge date; Walden's member-facing date is delivery. */
export function deliveryDateFromCharge(chargeScheduledAt: string, settings: DateSettings): string {
  return addDays(chargeScheduledAt, settings.deliveryDateOffset);
}

export function chargeDateFromDelivery(deliveryIso: string, settings: DateSettings): string {
  return addDays(deliveryIso, -settings.deliveryDateOffset);
}

/**
 * Last day the member can still edit (the day before the lock starts), or null
 * when the modification window is off. Matches /merchant's isChargeLocked: the
 * order is locked from (delivery − window) onwards.
 */
export function editDeadlineFromDelivery(deliveryIso: string, settings: DateSettings): string | null {
  if (settings.modificationWindowDays <= 0) return null;
  return addDays(deliveryIso, -settings.modificationWindowDays - 1);
}

export function isPastDeadline(deadlineIso: string | null, today: Date = new Date()): boolean {
  return deadlineIso != null && toIsoDate(today) > deadlineIso;
}

export function formatLongDate(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatWeekdayDate(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatShortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "NOV 22ND" style label used on the My Order panel. */
export function formatDeliveryChip(iso: string): string {
  const d = parseIso(iso);
  const day = d.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${day}${suffix}`;
}
