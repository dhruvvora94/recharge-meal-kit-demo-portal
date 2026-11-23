// Maps live Recharge (2021-11) + Shopify Storefront data into Walden view
// models. All network calls are server-side; nothing here ships to the browser.
//
// Pricing model (what every surface shows):
//   • Subscription items are charged at the Shopify selling plan price, i.e.
//     list price less the plan's subscribe-and-save % (10% on Build Your Own).
//   • One-time picks are charged at list price.
//   • Real charges use Recharge's own line prices; $0 draft charges (future
//     queued charges) are estimated with the same rule.

import {
  getBundleCollectionsFromShopify,
  getBundleProductInfo,
  listActiveCharges,
  listAddresses,
  listBundleProducts,
  listBundleSelectionsByPurchaseItemIds,
  listSubscriptions,
} from "~/lib/recharge.server";
import {
  getProductsByVariantIds,
  getSellingPlanDiscounts,
  listShopCollections,
  type SellingPlanDiscount,
  type ShopifyProduct,
} from "~/lib/shopify.server";
import { getAddonCollectionIds } from "~/lib/addon-collections.server";
import { getMerchantSettings } from "~/lib/merchant-settings.server";
import type { Address, BundleProduct, Charge, ChargeLineItem, Subscription } from "~/lib/types";
import { WALDEN } from "./config";
import {
  addDays,
  chargeDateFromDelivery,
  deliveryDateFromCharge,
  editDeadlineFromDelivery,
  isPastDeadline,
  toIsoDate,
  type DateSettings,
} from "./dates";
import type {
  AddressVM,
  DeliveryOptionVM,
  LineVM,
  PlanVM,
  ShopCollectionVM,
  ShopProductVM,
  UpcomingOrderVM,
} from "./types";

// ─── Small mappers ────────────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = { US: "United States", CA: "Canada" };

export function toAddressVM(a: Address): AddressVM {
  const parts = [a.address1, a.address2, a.city, a.province, a.zip].filter((p) => p && String(p).trim());
  return {
    id: a.id,
    firstName: a.first_name ?? "",
    lastName: a.last_name ?? "",
    company: a.company ?? "",
    phone: a.phone ?? "",
    address1: a.address1 ?? "",
    address2: a.address2 ?? "",
    city: a.city ?? "",
    province: a.province ?? "",
    zip: a.zip ?? "",
    country: a.country || COUNTRY_NAMES[a.country_code ?? ""] || a.country_code || "",
    countryCode: a.country_code ?? "",
    oneLine: parts.join(", "),
  };
}

function money(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function quantityLabel(quantity: number, variantTitle: string | null | undefined): string {
  const vt = variantTitle && variantTitle !== "Default Title" ? variantTitle : null;
  return vt ? `${quantity} × ${vt}` : String(quantity);
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function frequencyLabel(s: Subscription | undefined): string {
  const n = s?.charge_interval_frequency ?? 1;
  const unit = s?.order_interval_unit ?? "month";
  if (n === 1) return unit === "month" ? "Monthly" : unit === "week" ? "Weekly" : "Daily";
  return `Every ${n} ${unit === "month" ? "Months" : unit === "week" ? "Weeks" : "Days"}`;
}

// ─── Delivery calendar (R-01 / R-02) ─────────────────────────────────────────
// PLACEHOLDER until Walden's zip-zone calendar is wired in (Shopify metaobjects
// synced from Walden Core). For now each zip gets the order's current delivery
// date plus the same weekday ±1 week within that month, i.e. 2–3 dates/month,
// excluding anything whose edit deadline has already passed.

export function getDeliveryOptions(
  _zip: string | null,
  currentDeliveryIso: string,
  settings: DateSettings
): DeliveryOptionVM[] {
  const month = currentDeliveryIso.slice(0, 7);
  const candidates = [-7, 0, 7]
    .map((offset) => addDays(currentDeliveryIso, offset))
    .filter((d) => d.slice(0, 7) === month);
  return candidates
    .map((deliveryDate) => ({
      deliveryDate,
      chargeDate: chargeDateFromDelivery(deliveryDate, settings),
      editDeadline: editDeadlineFromDelivery(deliveryDate, settings),
    }))
    .filter((o) => o.deliveryDate === currentDeliveryIso || !isPastDeadline(o.editDeadline));
}

// ─── Customer context ─────────────────────────────────────────────────────────

export function isBundleSubscription(s: Subscription | undefined, bundleProductIds: Set<string>): boolean {
  const pid = s?.external_product_id?.ecommerce;
  return pid != null && bundleProductIds.has(pid);
}

type Selections = Awaited<ReturnType<typeof listBundleSelectionsByPurchaseItemIds>>;
/** A bundle item; `price` is Recharge's stored per-item price when it has one. */
type Content = { variantId: string; quantity: number; price: number | null };
const toContent = (i: { external_variant_id: string; quantity: number; price?: string | null }): Content => ({
  variantId: i.external_variant_id,
  quantity: i.quantity,
  price: i.price != null && i.price !== "" ? money(i.price) : null,
});

export type PortalContext = {
  subscriptions: Subscription[];
  charges: Charge[];
  addresses: Address[];
  bundleProducts: BundleProduct[];
  bundleProductIds: Set<string>;
  subById: Map<number, Subscription>;
  addressById: Map<number, AddressVM>;
  selections: Selections;
  products: Map<string, ShopifyProduct>;
  discounts: Map<string, SellingPlanDiscount[]>;
};

export async function loadPortalContext(customerId: string): Promise<PortalContext> {
  const [subscriptions, charges, addresses, bundleProducts] = await Promise.all([
    listSubscriptions(customerId),
    listActiveCharges(customerId),
    listAddresses(customerId),
    listBundleProducts().catch(() => [] as BundleProduct[]),
  ]);
  const bundleProductIds = new Set(bundleProducts.map((p) => p.external_product_id));
  const bundleSubs = subscriptions.filter((s) => isBundleSubscription(s, bundleProductIds));

  const noSelections = (): Selections => ({ chargeSelections: [], defaultsByPurchaseItem: new Map() });
  const selections = bundleSubs.length
    ? await listBundleSelectionsByPurchaseItemIds(bundleSubs.map((s) => s.id)).catch(noSelections)
    : noSelections();

  // Every variant we might render: charge lines, bundle contents, subscriptions.
  const variantIds = new Set<string>();
  charges.forEach((c) => c.line_items.forEach((li) => li.external_variant_id?.ecommerce && variantIds.add(li.external_variant_id.ecommerce)));
  selections.chargeSelections.forEach((cs) => cs.selection.items.forEach((i) => variantIds.add(i.external_variant_id)));
  selections.defaultsByPurchaseItem.forEach((d) => d.items.forEach((i) => variantIds.add(i.external_variant_id)));
  bundleProducts.forEach((p) => p.variants.forEach((v) => v.selection_defaults?.forEach((d) => variantIds.add(d.external_variant_id))));
  subscriptions.forEach((s) => s.external_variant_id?.ecommerce && variantIds.add(s.external_variant_id.ecommerce));

  const productIds = new Set<string>();
  subscriptions.forEach((s) => s.external_product_id?.ecommerce && productIds.add(s.external_product_id.ecommerce));

  const [products, discounts] = await Promise.all([
    getProductsByVariantIds([...variantIds]).catch(() => new Map<string, ShopifyProduct>()),
    getSellingPlanDiscounts([...productIds]).catch(() => new Map<string, SellingPlanDiscount[]>()),
  ]);

  return {
    subscriptions,
    charges,
    addresses,
    bundleProducts,
    bundleProductIds,
    subById: new Map(subscriptions.map((s) => [s.id, s])),
    addressById: new Map(addresses.map((a) => [a.id, toAddressVM(a)])),
    selections,
    products,
    discounts,
  };
}

/** Subscribe-and-save % from the subscription product's Shopify selling plan. */
export function discountPctFor(ctx: PortalContext, sub: Subscription | undefined): number {
  if (!sub) return 0;
  const plans = ctx.discounts.get(sub.external_product_id?.ecommerce ?? "") ?? [];
  const freq = `${sub.charge_interval_frequency ?? 1}-${sub.order_interval_unit ?? "month"}`;
  const plan = plans.find((p) => p.frequency === freq) ?? plans[0];
  return plan?.percentage ?? 0;
}

export function subscribePrice(listPrice: number, pct: number): number {
  return money(listPrice * (1 - pct / 100));
}

/** Bundle contents for a charge: charge selection → subscription default → variant defaults. */
export function contentsFor(ctx: PortalContext, chargeId: number | null, sub: Subscription): Content[] {
  const chargeSel =
    chargeId != null
      ? ctx.selections.chargeSelections.find((cs) => cs.chargeId === chargeId && cs.selection.purchase_item_id === sub.id)
      : undefined;
  if (chargeSel) return chargeSel.selection.items.map(toContent);
  const def = ctx.selections.defaultsByPurchaseItem.get(sub.id);
  if (def?.items.length) return def.items.map(toContent);
  return (
    ctx.bundleProducts.flatMap((p) => p.variants).find((v) => v.external_variant_id === sub.external_variant_id?.ecommerce)
      ?.selection_defaults ?? []
  ).map(toContent);
}

/**
 * Future queued charges (multiple-queued-charges beta) arrive as $0 drafts with
 * no line items. They belong to the active subscriptions at the same address
 * whose next charge date is on or before the charge.
 */
export function subscriptionsForDraftCharge(ctx: PortalContext, charge: Charge): Subscription[] {
  return ctx.subscriptions.filter(
    (s) =>
      s.status === "active" &&
      s.address_id === charge.address_id &&
      (!s.next_charge_scheduled_at || s.next_charge_scheduled_at.slice(0, 10) <= charge.scheduled_at.slice(0, 10))
  );
}

/** The Build Your Own subscription a charge belongs to, if any. */
export function bundleSubscriptionForCharge(ctx: PortalContext, charge: Charge): Subscription | null {
  for (const li of charge.line_items) {
    const sub = ctx.subById.get(li.purchase_item_id);
    if (li.purchase_item_type === "subscription" && isBundleSubscription(sub, ctx.bundleProductIds)) return sub!;
  }
  if (charge.line_items.some((li) => li.purchase_item_type === "subscription")) return null;
  return subscriptionsForDraftCharge(ctx, charge).find((s) => isBundleSubscription(s, ctx.bundleProductIds)) ?? null;
}

/** /merchant date settings for the bundle variant (falls back to the active bundle). */
export function dateSettingsFor(bundleSub: Subscription | null | undefined): DateSettings {
  return getMerchantSettings(bundleSub?.external_variant_id?.ecommerce ?? undefined);
}

// ─── Line builders ────────────────────────────────────────────────────────────

function listPriceOf(ctx: PortalContext, variantId: string | null | undefined): number | null {
  if (!variantId) return null;
  const v = ctx.products.get(variantId)?.variants.find((x) => String(x.id) === variantId);
  return v?.price != null ? money(v.price) : null;
}

function withList(line: Omit<LineVM, "listUnitPrice">, list: number | null): LineVM {
  return { ...line, listUnitPrice: list != null && list - line.unitPrice > 0.004 ? list : null };
}

function chargeLine(ctx: PortalContext, li: ChargeLineItem): LineVM {
  const unit = money(li.unit_price);
  const variantId = li.external_variant_id?.ecommerce ?? null;
  const product = variantId ? ctx.products.get(variantId) : undefined;
  return withList(
    {
      key: `${li.purchase_item_type ?? "item"}-${li.purchase_item_id}-${variantId ?? li.title}`,
      title: li.title,
      quantityLabel: quantityLabel(li.quantity, li.variant_title),
      quantity: li.quantity,
      unitPrice: unit,
      lineTotal: money(li.total_price) || money(unit * li.quantity),
      imageUrl: li.images?.small ?? li.images?.medium ?? product?.image?.src ?? null,
      externalVariantId: variantId,
      purchaseItemId: li.purchase_item_id,
      subscription: li.purchase_item_type === "subscription",
    },
    listPriceOf(ctx, variantId)
  );
}

function variantLine(ctx: PortalContext, c: Content, pct: number, keyPrefix: string): LineVM | null {
  const product = ctx.products.get(c.variantId);
  const variant = product?.variants.find((v) => String(v.id) === c.variantId);
  if (!product || !variant) return null;
  const list = money(variant.price);
  // Recharge's stored item price wins; otherwise the bundle plan's price.
  const unit = c.price ?? subscribePrice(list, pct);
  return withList(
    {
      key: `${keyPrefix}-${c.variantId}`,
      title: product.title,
      quantityLabel: quantityLabel(c.quantity, variant.title),
      quantity: c.quantity,
      unitPrice: unit,
      lineTotal: money(unit * c.quantity),
      imageUrl: product.image?.src ?? null,
      externalVariantId: c.variantId,
      purchaseItemId: null,
      subscription: true,
    },
    list
  );
}

function subscriptionLine(ctx: PortalContext, s: Subscription): LineVM {
  const list = money(s.price);
  const unit = subscribePrice(list, discountPctFor(ctx, s));
  const variantId = s.external_variant_id?.ecommerce ?? null;
  return withList(
    {
      key: `subscription-${s.id}`,
      title: s.product_title,
      quantityLabel: quantityLabel(s.quantity, s.variant_title),
      quantity: s.quantity,
      unitPrice: unit,
      lineTotal: money(unit * s.quantity),
      imageUrl: (variantId && ctx.products.get(variantId)?.image?.src) || null,
      externalVariantId: variantId,
      purchaseItemId: s.id,
      subscription: true,
    },
    list
  );
}

function expandBundle(ctx: PortalContext, chargeId: number | null, sub: Subscription): LineVM[] {
  const pct = discountPctFor(ctx, sub);
  return contentsFor(ctx, chargeId, sub)
    .map((c) => variantLine(ctx, c, pct, `bundle-${sub.id}`))
    .filter((l): l is LineVM => l !== null);
}

const savingsOf = (lines: LineVM[]) =>
  money(lines.reduce((s, l) => s + (l.listUnitPrice != null ? (l.listUnitPrice - l.unitPrice) * l.quantity : 0), 0));

// ─── Upcoming orders ──────────────────────────────────────────────────────────

export async function buildUpcomingOrders(customerId: string): Promise<{
  orders: UpcomingOrderVM[];
  addresses: AddressVM[];
}> {
  const ctx = await loadPortalContext(customerId);
  const today = toIsoDate(new Date());
  const upcoming = ctx.charges.filter((c) => c.scheduled_at.slice(0, 10) >= today);

  const orders: UpcomingOrderVM[] = upcoming.map((charge) => {
    const oneTimePicks: LineVM[] = [];
    const subscriptionLines: LineVM[] = [];
    const expanded = new Set<number>();
    const bundleSub = bundleSubscriptionForCharge(ctx, charge);

    for (const li of charge.line_items) {
      if (li.purchase_item_type === "onetime") {
        oneTimePicks.push(chargeLine(ctx, li));
        continue;
      }
      const sub = ctx.subById.get(li.purchase_item_id);
      // Recharge usually expands a bundle into its content lines (each carrying
      // the bundle subscription's purchase_item_id). A single parent bundle line
      // means we expand the contents ourselves.
      const isParentLine =
        isBundleSubscription(sub, ctx.bundleProductIds) &&
        li.external_product_id?.ecommerce === sub!.external_product_id?.ecommerce;
      if (isParentLine) {
        if (!expanded.has(sub!.id)) subscriptionLines.push(...expandBundle(ctx, charge.id, sub!));
        expanded.add(sub!.id);
      } else {
        subscriptionLines.push(chargeLine(ctx, li));
      }
    }

    if (charge.line_items.length === 0) {
      for (const sub of subscriptionsForDraftCharge(ctx, charge)) {
        if (isBundleSubscription(sub, ctx.bundleProductIds)) subscriptionLines.push(...expandBundle(ctx, charge.id, sub));
        else subscriptionLines.push(subscriptionLine(ctx, sub));
      }
    }

    const linesTotal = money([...oneTimePicks, ...subscriptionLines].reduce((sum, l) => sum + l.lineTotal, 0));
    const estimatedTotal = money(charge.total_price) || linesTotal;
    const settings = dateSettingsFor(bundleSub);
    const deliveryDate = deliveryDateFromCharge(charge.scheduled_at, settings);
    const editDeadline = editDeadlineFromDelivery(deliveryDate, settings);
    const address = charge.address_id != null ? ctx.addressById.get(charge.address_id) ?? null : null;
    const firstSub = bundleSub ?? ctx.subById.get(charge.line_items.find((li) => li.purchase_item_type === "subscription")?.purchase_item_id ?? -1);

    return {
      chargeId: charge.id,
      status: charge.status,
      planTitle: bundleSub ? titleCase(bundleSub.product_title) : WALDEN.defaultPlanTitle,
      deliveryDate,
      chargeDate: charge.scheduled_at.slice(0, 10),
      editDeadline,
      locked: isPastDeadline(editDeadline),
      estimatedTotal,
      currency: charge.currency ?? "USD",
      orderMinimum: WALDEN.orderMinimum,
      belowMinimum: charge.status === "queued" && estimatedTotal < WALDEN.orderMinimum,
      subscribeDiscountPct: discountPctFor(ctx, firstSub),
      savings: savingsOf(subscriptionLines),
      oneTimePicks,
      subscriptions: subscriptionLines,
      address,
      deliveryOptions: getDeliveryOptions(address?.zip ?? null, deliveryDate, settings),
    };
  });

  return { orders, addresses: [...ctx.addressById.values()] };
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function buildPlans(customerId: string): Promise<{ plans: PlanVM[]; addresses: AddressVM[] }> {
  const ctx = await loadPortalContext(customerId);
  const active = ctx.subscriptions.filter((s) => s.status === "active");
  const anchors = active.filter((s) => isBundleSubscription(s, ctx.bundleProductIds));
  const itemSubs = active.filter((s) => !isBundleSubscription(s, ctx.bundleProductIds));

  // What a bundle plan ships next: content lines on its next priced charge,
  // else its default contents.
  const planContents = (sub: Subscription): LineVM[] => {
    const next = ctx.charges.find(
      (c) => c.status === "queued" && c.line_items.some((li) => li.purchase_item_id === sub.id)
    );
    const lines = (next?.line_items ?? [])
      .filter((li) => li.purchase_item_id === sub.id && li.external_product_id?.ecommerce !== sub.external_product_id?.ecommerce)
      .map((li) => chargeLine(ctx, li));
    return lines.length ? lines : expandBundle(ctx, next?.id ?? null, sub);
  };

  // A plan is anchored on a bundle subscription; item subscriptions at the same
  // address ride along. With no bundle, item subscriptions per address form one
  // Build Your Own plan.
  const plans: PlanVM[] = anchors.map((anchor) => ({
    subscriptionId: anchor.id,
    title: titleCase(anchor.product_title),
    nickname: anchor.properties?.find((p) => p.name === "_plan_nickname")?.value ?? null,
    frequencyLabel: frequencyLabel(anchor),
    orderMinimum: WALDEN.orderMinimum,
    subscribeDiscountPct: discountPctFor(ctx, anchor),
    address: ctx.addressById.get(anchor.address_id) ?? null,
    addOns: [
      ...planContents(anchor),
      ...itemSubs.filter((s) => s.address_id === anchor.address_id).map((s) => subscriptionLine(ctx, s)),
    ],
    status: anchor.status,
  }));

  const anchored = new Set(anchors.map((a) => a.address_id));
  for (const addressId of [...new Set(itemSubs.map((s) => s.address_id))].filter((id) => !anchored.has(id))) {
    const subs = itemSubs.filter((s) => s.address_id === addressId);
    plans.push({
      subscriptionId: subs[0].id,
      title: WALDEN.defaultPlanTitle,
      nickname: null,
      frequencyLabel: frequencyLabel(subs[0]),
      orderMinimum: WALDEN.orderMinimum,
      subscribeDiscountPct: discountPctFor(ctx, subs[0]),
      address: ctx.addressById.get(addressId) ?? null,
      addOns: subs.map((s) => subscriptionLine(ctx, s)),
      status: "active",
    });
  }

  return { plans, addresses: [...ctx.addressById.values()] };
}

// ─── Shop catalogue for editing a delivery ────────────────────────────────────

const BADGE_TAGS = ["Member Favorite", "Walden Reserve", "New", "Limited"];

export async function buildShopCatalog(bundleExternalProductId: string | null, bundleVariantId: string | null): Promise<{
  collections: ShopCollectionVM[];
  products: ShopProductVM[];
}> {
  const allCollections = await listShopCollections().catch(() => []);
  const titleById = new Map(allCollections.map((c) => [String(c.id), c.title]));

  // Prefer the collections the Build Your Own bundle draws from, plus any
  // merchant-configured add-on collections; fall back to every collection.
  const bundleCollectionIds = bundleExternalProductId
    ? await getBundleProductInfo(bundleExternalProductId).then((i) => i.collectionIds).catch(() => [])
    : [];
  const addonIds = bundleVariantId ? getAddonCollectionIds(bundleVariantId) : [];
  let ids = [...new Set([...bundleCollectionIds, ...addonIds])];
  if (ids.length === 0) ids = allCollections.slice(0, 10).map((c) => String(c.id));

  const collections = await getBundleCollectionsFromShopify(ids, { sorted: true }).catch(() => []);
  const byVariant = new Map<string, ShopProductVM>();
  for (const col of collections) {
    for (const p of col.products) {
      const v = p.variants[0];
      if (!v) continue;
      const key = String(v.id);
      const existing = byVariant.get(key);
      if (existing) {
        existing.collectionIds.push(col.id);
        continue;
      }
      byVariant.set(key, {
        productId: p.external_product_id,
        variantId: key,
        title: p.title,
        variantTitle: v.title !== "Default Title" ? v.title : null,
        price: money(v.price),
        imageUrl: p.image_url ?? null,
        badge: BADGE_TAGS.find((t) => (p.tags ?? []).some((tag) => tag.toLowerCase() === t.toLowerCase())) ?? null,
        available: true,
        collectionIds: [col.id],
      });
    }
  }

  return {
    collections: collections
      .filter((c) => c.products.length > 0)
      .map((c) => ({ id: c.id, title: titleById.get(c.id) ?? c.title })),
    products: [...byVariant.values()],
  };
}

export async function findBundleSubscription(customerId: string): Promise<Subscription | null> {
  const [subscriptions, bundleProducts] = await Promise.all([
    listSubscriptions(customerId),
    listBundleProducts().catch(() => [] as BundleProduct[]),
  ]);
  const ids = new Set(bundleProducts.map((p) => p.external_product_id));
  return subscriptions.find((s) => s.status === "active" && isBundleSubscription(s, ids)) ?? null;
}
