// Change Delivery Date (R-01 / R-02 / R-03).
//
// The member picks a DELIVERY date; Recharge stores the CHARGE date, which is
// always delivery − the /merchant offset, however the date is moved. Only dates
// planned for the address ZIP (Shopify metaobject) in the same month are
// accepted, and both the current and the new date must still be editable.
// Everything is re-derived server-side; the form only says which date.

import { getCharge, rescheduleCharge } from "~/lib/recharge.server";
import { chargeDateFromDelivery, deliveryDateFromCharge, editDeadlineFromDelivery, isPastDeadline, toIsoDate } from "./dates";
import {
  bundleSubscriptionForCharge,
  calendarFor,
  dateSettingsFor,
  getDeliveryOptions,
  loadPortalContext,
} from "./portal.server";

export class RescheduleError extends Error {}

export async function rescheduleDelivery(
  customerId: string,
  chargeId: string,
  newDeliveryIso: string
): Promise<{ deliveryDate: string; chargeDate: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDeliveryIso)) throw new RescheduleError("Please pick a delivery date.");

  const charge = await getCharge(chargeId);
  if (String(charge.customer?.id) !== customerId) throw new RescheduleError("That delivery isn't on your account.");
  if (charge.status !== "queued") throw new RescheduleError("Only scheduled deliveries can be moved.");

  const ctx = await loadPortalContext(customerId);
  const settings = dateSettingsFor(bundleSubscriptionForCharge(ctx, charge));
  const currentDelivery = deliveryDateFromCharge(charge.scheduled_at, settings);
  if (isPastDeadline(editDeadlineFromDelivery(currentDelivery, settings))) {
    throw new RescheduleError("The edit window for this delivery has closed.");
  }
  if (newDeliveryIso === currentDelivery) throw new RescheduleError("That's already your delivery date.");

  const address = charge.address_id != null ? ctx.addressById.get(charge.address_id) : undefined;
  const calendar = calendarFor(ctx.zipCalendars, address?.zip);
  if (!calendar.dates) throw new RescheduleError(`We don't have delivery days planned for zip ${calendar.zip ?? "on file"} yet.`);

  const option = getDeliveryOptions(calendar, currentDelivery, settings).find(
    (o) => o.deliveryDate === newDeliveryIso && o.valid && !o.isCurrent
  );
  if (!option) throw new RescheduleError("That date isn't available for your zip code.");
  if (option.chargeDate <= toIsoDate(new Date())) throw new RescheduleError("That date is too soon to schedule.");

  const nextChargeDate = chargeDateFromDelivery(newDeliveryIso, settings);
  await rescheduleCharge(chargeId, nextChargeDate);
  return { deliveryDate: newDeliveryIso, chargeDate: nextChargeDate };
}
