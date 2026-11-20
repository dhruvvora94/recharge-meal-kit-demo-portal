// Delivery-date-first helpers (R-01, R-03). Pure functions, safe on client
// and server. All dates are ISO "YYYY-MM-DD" strings handled in UTC so they
// never drift across time zones.

import { WALDEN } from "./config";

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
export function deliveryDateFromCharge(chargeScheduledAt: string): string {
  return addBusinessDays(chargeScheduledAt, WALDEN.captureBusinessDaysBeforeDelivery);
}

export function chargeDateFromDelivery(deliveryIso: string): string {
  return addBusinessDays(deliveryIso, -WALDEN.captureBusinessDaysBeforeDelivery);
}

export function editDeadlineFromDelivery(deliveryIso: string): string {
  return addBusinessDays(deliveryIso, -WALDEN.editCutoffBusinessDaysBeforeDelivery);
}

export function isPastDeadline(deadlineIso: string, today: Date = new Date()): boolean {
  return toIsoDate(today) > deadlineIso;
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
