// Skip / unskip one delivery.
//
// Walden semantics: skip = "no delivery this month". Every item on the order
// is skipped (the Build Your Own subscription AND any one-time picks), so
// nothing ships. Other months' orders are untouched — with future queued
// charges the next order already exists, so nothing needs to move.
//
// Recharge rules: only queued/error charges can be skipped; a skipped charge
// can be unskipped until one day after its date. We also apply the /merchant
// edit lock (R-06) to both, so the portal can't change an order after cutoff.

import { getCharge, listOnetimes, skipCharge, unskipCharge } from "~/lib/recharge.server";
import type { Charge } from "~/lib/types";
import { addDays, deliveryDateFromCharge, editDeadlineFromDelivery, isPastDeadline, toIsoDate } from "./dates";
import {
  bundleSubscriptionForCharge,
  dateSettingsFor,
  loadPortalContext,
  subscriptionsForDraftCharge,
  type PortalContext,
} from "./portal.server";

export class SkipError extends Error {}

/** Every purchase item on the delivery: charge lines, or — for a draft — the subscriptions and one-times due that day. */
async function purchaseItemIdsFor(ctx: PortalContext, customerId: string, charge: Charge): Promise<number[]> {
  const fromLines = charge.line_items.map((li) => li.purchase_item_id);
  if (fromLines.length) return [...new Set(fromLines)];
  const day = charge.scheduled_at.slice(0, 10);
  const onetimes = (await listOnetimes(customerId)).filter(
    (o) => o.address_id === charge.address_id && o.next_charge_scheduled_at?.slice(0, 10) === day
  );
  return [...new Set([...subscriptionsForDraftCharge(ctx, charge).map((s) => s.id), ...onetimes.map((o) => o.id)])];
}

async function loadOwnedCharge(customerId: string, chargeId: string) {
  if (!/^\d+$/.test(chargeId)) throw new SkipError("Missing delivery.");
  const charge = await getCharge(chargeId);
  if (String(charge.customer?.id) !== customerId) throw new SkipError("That delivery isn't on your account.");
  const ctx = await loadPortalContext(customerId);
  const settings = dateSettingsFor(bundleSubscriptionForCharge(ctx, charge));
  const deliveryIso = deliveryDateFromCharge(charge.scheduled_at, settings);
  return { charge, ctx, deliveryIso, deadline: editDeadlineFromDelivery(deliveryIso, settings) };
}

export async function skipDelivery(customerId: string, chargeId: string, reason: string) {
  const { charge, ctx, deliveryIso, deadline } = await loadOwnedCharge(customerId, chargeId);
  if (charge.status === "skipped") throw new SkipError("This delivery is already skipped.");
  if (charge.status !== "queued" && charge.status !== "error") throw new SkipError("This delivery can't be skipped.");
  if (isPastDeadline(deadline)) throw new SkipError("The edit window for this delivery has closed.");

  const ids = await purchaseItemIdsFor(ctx, customerId, charge);
  if (!ids.length) throw new SkipError("There's nothing on this delivery to skip.");
  await skipCharge(chargeId, ids);
  // Recharge has no skip-reason field; log it so it isn't lost (Walden would
  // send it to Core / Klaviyo from here).
  console.info(`[skip] customer=${customerId} charge=${chargeId} delivery=${deliveryIso} reason="${reason.slice(0, 200)}"`);
  return { deliveryDate: deliveryIso };
}

export async function unskipDelivery(customerId: string, chargeId: string) {
  const { charge, ctx, deliveryIso, deadline } = await loadOwnedCharge(customerId, chargeId);
  if (charge.status !== "skipped") throw new SkipError("This delivery isn't skipped.");
  if (charge.scheduled_at.slice(0, 10) < addDays(toIsoDate(new Date()), -1)) {
    throw new SkipError("This delivery's date has passed, so it can't be unskipped.");
  }
  if (isPastDeadline(deadline)) throw new SkipError("The edit window for this delivery has closed.");

  const ids = await purchaseItemIdsFor(ctx, customerId, charge);
  if (!ids.length) throw new SkipError("There's nothing on this delivery to unskip.");
  await unskipCharge(chargeId, ids);
  return { deliveryDate: deliveryIso };
}
