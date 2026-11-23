// Saves the My Order panel for ONE delivery (R-07 "next delivery only").
//
//   Subscription items → the Build Your Own bundle selection on that charge
//                        (POST/PUT /bundle_selections with charge_id)
//   One-time items     → onetimes on that charge's date + address
//                        (POST / PUT / DELETE /onetimes)
//
// The client only says what it wants (variant, quantity, subscribe?). Everything
// else — ownership, edit cutoff, prices, product ids, collections, existing
// onetimes — is re-derived here from Recharge/Shopify, never trusted from the form.

import {
  createBundleSelection,
  createOnetime,
  deleteOnetime,
  getBundleCollectionsFromShopify,
  getBundleProductInfo,
  getCharge,
  listOnetimes,
  updateBundleSelection,
  updateOnetimeQuantity,
} from "~/lib/recharge.server";
import { getProductsByVariantIds } from "~/lib/shopify.server";
import type { BundleItemPayload } from "~/lib/types";
import { deliveryDateFromCharge, editDeadlineFromDelivery, isPastDeadline } from "./dates";
import { bundleSubscriptionForCharge, contentsFor, discountPctFor, loadPortalContext, subscribePrice } from "./portal.server";

export type DesiredLine = { variantId: string; quantity: number; subscription: boolean };

export type SaveResult = {
  bundleChanged: boolean;
  onetimesAdded: number;
  onetimesUpdated: number;
  onetimesRemoved: number;
};

export class SaveOrderError extends Error {}

function normalise(lines: DesiredLine[]): DesiredLine[] {
  // Merge duplicates per variant + type; drop zero quantities.
  const map = new Map<string, DesiredLine>();
  for (const l of lines) {
    const q = Math.max(0, Math.floor(Number(l.quantity) || 0));
    if (!q || !/^\d+$/.test(String(l.variantId))) continue;
    const key = `${l.subscription ? "s" : "o"}:${l.variantId}`;
    const existing = map.get(key);
    map.set(key, { variantId: String(l.variantId), subscription: !!l.subscription, quantity: (existing?.quantity ?? 0) + q });
  }
  return [...map.values()];
}

export async function saveDeliveryEdits(customerId: string, chargeId: string, rawLines: DesiredLine[]): Promise<SaveResult> {
  const charge = await getCharge(chargeId);
  if (String(charge.customer?.id) !== customerId) throw new SaveOrderError("That delivery isn't on your account.");
  if (charge.status !== "queued") throw new SaveOrderError("This delivery can't be edited because it isn't scheduled.");
  const deadline = editDeadlineFromDelivery(deliveryDateFromCharge(charge.scheduled_at));
  if (isPastDeadline(deadline)) throw new SaveOrderError("The edit window for this delivery has closed.");
  if (charge.address_id == null) throw new SaveOrderError("This delivery has no shipping address.");

  const desired = normalise(rawLines);
  const wantSubs = desired.filter((l) => l.subscription);
  const wantOnce = desired.filter((l) => !l.subscription);

  const ctx = await loadPortalContext(customerId);
  const result: SaveResult = { bundleChanged: false, onetimesAdded: 0, onetimesUpdated: 0, onetimesRemoved: 0 };

  // ── Subscription items → bundle selection on this charge ──────────────────
  const bundleSub = bundleSubscriptionForCharge(ctx, charge);
  if (wantSubs.length && !bundleSub) {
    throw new SaveOrderError("This delivery has no Build Your Own plan to add subscription items to.");
  }
  if (bundleSub) {
    if (!wantSubs.length) {
      throw new SaveOrderError("Keep at least one subscription item in your Build Your Own box, or skip this delivery instead.");
    }
    const bundleProductId = bundleSub.external_product_id?.ecommerce;
    if (!bundleProductId) throw new SaveOrderError("Couldn't find the Build Your Own product.");
    const bundleProduct = ctx.bundleProducts.find((b) => b.external_product_id === bundleProductId);
    const { collectionIds } = await getBundleProductInfo(bundleProductId);
    const collections = await getBundleCollectionsFromShopify(collectionIds);

    // Price every item explicitly from the BUNDLE's selling plan (Build Your
    // Own: list − 10%). With custom prices on, Recharge otherwise prices an
    // item from one of the item product's own selling plans, which can carry a
    // different discount (Rack of Lamb also has a 25% plan → $74.98).
    const pct = discountPctFor(ctx, bundleSub);
    const sendPrices = bundleProduct?.custom_prices !== false;
    const items: BundleItemPayload[] = wantSubs.map((w) => {
      const hit = collections
        .flatMap((col) => col.products.map((p) => ({ col, p })))
        .find(({ p }) => p.variants.some((v) => String(v.id) === w.variantId));
      if (!hit) throw new SaveOrderError("One of the subscription items isn't part of Build Your Own. Untick Subscribe to add it as a one-time pick.");
      const list = Number(hit.p.variants.find((v) => String(v.id) === w.variantId)?.price ?? 0);
      return {
        collection_id: hit.col.id,
        collection_source: "shopify",
        external_product_id: hit.p.external_product_id,
        external_variant_id: w.variantId,
        quantity: w.quantity,
        ...(sendPrices && list > 0 ? { price: subscribePrice(list, pct).toFixed(2) } : {}),
      };
    });

    const current = contentsFor(ctx, charge.id, bundleSub);
    const same =
      current.length === items.length &&
      items.every((it) =>
        current.some(
          (c) =>
            c.variantId === it.external_variant_id &&
            c.quantity === it.quantity &&
            (it.price == null || c.price === Number(it.price))
        )
      );

    if (!same) {
      const existing = ctx.selections.chargeSelections.find(
        (cs) => cs.chargeId === charge.id && cs.selection.purchase_item_id === bundleSub.id
      );
      if (existing) await updateBundleSelection(existing.selection.id, items);
      else await createBundleSelection(charge.id, bundleSub.id, items);
      result.bundleChanged = true;
    }
  }

  // ── One-time items → onetimes on this charge's date + address ─────────────
  const chargeDate = charge.scheduled_at.slice(0, 10);
  const currentOnce = (await listOnetimes(customerId)).filter(
    (o) => o.address_id === charge.address_id && o.next_charge_scheduled_at?.slice(0, 10) === chargeDate
  );
  const byVariant = new Map<string, typeof currentOnce>();
  for (const o of currentOnce) {
    const v = o.external_variant_id?.ecommerce ?? "";
    byVariant.set(v, [...(byVariant.get(v) ?? []), o]);
  }

  const toAdd = wantOnce.filter((w) => !byVariant.has(w.variantId));
  const products = toAdd.length ? await getProductsByVariantIds(toAdd.map((w) => w.variantId)) : new Map();

  for (const w of wantOnce) {
    const [keep, ...extras] = byVariant.get(w.variantId) ?? [];
    if (keep) {
      if (keep.quantity !== w.quantity) {
        await updateOnetimeQuantity(keep.id, w.quantity);
        result.onetimesUpdated++;
      }
      for (const x of extras) {
        await deleteOnetime(x.id);
        result.onetimesRemoved++;
      }
      continue;
    }
    const product = products.get(w.variantId);
    const variant = product?.variants.find((v: { id: number }) => String(v.id) === w.variantId);
    if (!product || !variant) throw new SaveOrderError("One of the one-time picks is no longer available.");
    // One-time picks are charged at list price (no subscribe-and-save).
    await createOnetime({
      address_id: charge.address_id,
      next_charge_scheduled_at: chargeDate,
      product_title: product.title,
      variant_title: variant.title !== "Default Title" ? variant.title : undefined,
      external_product_id: { ecommerce: String(product.id) },
      external_variant_id: { ecommerce: w.variantId },
      quantity: w.quantity,
      price: String(variant.price ?? "0"),
    });
    result.onetimesAdded++;
  }

  const wanted = new Set(wantOnce.map((w) => w.variantId));
  for (const o of currentOnce) {
    if (!wanted.has(o.external_variant_id?.ecommerce ?? "")) {
      await deleteOnetime(o.id);
      result.onetimesRemoved++;
    }
  }

  return result;
}
