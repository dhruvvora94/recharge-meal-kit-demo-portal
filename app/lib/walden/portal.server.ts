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
  getZipDeliveryDates,
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
import { basePriceOn, subscribePrice as subscribePriceOf, type PriceWindow } from "./pricing";
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
// Valid dates come from the Shopify metaobject `zip_based_delivery_dates`
// (handle = ZIP). A member can move an order to any planned date for their ZIP
// in the same month, as long as that date's edit deadline hasn't passed. The
// order's current date is always listed (flagged if it isn't a planned date).

export type ZipCalendar = { zip: string | null; dates: string[] | null };

export function getDeliveryOptions(
  calendar: ZipCalendar,
  currentDeliveryIso: string,
  settings: DateSettings
): Omit<DeliveryOptionVM, "estimatedTotal">[] {
  const month = currentDeliveryIso.slice(0, 7);
  const today = toIsoDate(new Date());
  const planned = (calendar.dates ?? []).filter((d) => d.slice(0, 7) === month);
  const dates = [...new Set([currentDeliveryIso, ...planned])].sort();
  return dates
    .map((deliveryDate) => ({
      deliveryDate,
      chargeDate: chargeDateFromDelivery(deliveryDate, settings),
      editDeadline: editDeadlineFromDelivery(deliveryDate, settings),
      isCurrent: deliveryDate === currentDeliveryIso,
      valid: planned.includes(deliveryDate),
    }))
    .filter((o) => o.isCurrent || (!isPastDeadline(o.editDeadline) && o.chargeDate > today));
}

/** Zip calendars for every address on the account, fetched once. */
async function loadZipCalendars(addresses: Address[]): Promise<Map<string, ZipCalendar>> {
  const zips = [...new Set(addresses.map((a) => (a.zip ?? "").trim().slice(0, 5)).filter((z) => /^\d{5}$/.test(z)))];
  const entries = await Promise.all(
    zips.map(async (zip) => [zip, { zip, dates: await getZipDeliveryDates(zip).catch(() => null) }] as const)
  );
  return new Map(entries);
}

export function calendarFor(calendars: Map<string, ZipCalendar>, zip: string | null | undefined): ZipCalendar {
  const z = (zip ?? "").trim().slice(0, 5);
  return calendars.get(z) ?? { zip: z || null, dates: null };
}

// ─── Customer context ─────────────────────────────────────────────────────────

export function isBundleSubscription(s: Subscription | undefined, bundleProductIds: Set<string>): boolean {
  const pid = s?.external_product_id?.ecommerce;
  return pid != null && bundleProductIds.has(pid);
}

type Selections = Awaited<ReturnType<typeof listBundleSelectionsByPurchaseItemIds>>;
/** A bundle item; `price` is Recharge's stored per-item price when it has one. */
/**
 * A bundle item. `price` is Recharge's stored per-item price; `source` says
 * where it came from. Only a charge-level selection's price is what that
 * delivery will actually charge — subscription defaults were priced at
 * checkout and don't follow Walden's dated prices.
 */
type Content = { variantId: string; quantity: number; price: number | null; source: "charge" | "default" | "variant" };
const toContent =
  (source: Content["source"]) =>
  (i: { external_variant_id: string; quantity: number; price?: string | null }): Content => ({
    variantId: i.external_variant_id,
    quantity: i.quantity,
    price: i.price != null && i.price !== "" ? money(i.price) : null,
    source,
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
  zipCalendars: Map<string, ZipCalendar>;
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

  const [products, discounts, zipCalendars] = await Promise.all([
    getProductsByVariantIds([...variantIds]).catch(() => new Map<string, ShopifyProduct>()),
    getSellingPlanDiscounts([...productIds]).catch(() => new Map<string, SellingPlanDiscount[]>()),
    loadZipCalendars(addresses),
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
    zipCalendars,
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

export { subscribePriceOf as subscribePrice };

/** Bundle contents for a charge: charge selection → subscription default → variant defaults. */
export function contentsFor(ctx: PortalContext, chargeId: number | null, sub: Subscription): Content[] {
  const chargeSel =
    chargeId != null
      ? ctx.selections.chargeSelections.find((cs) => cs.chargeId === chargeId && cs.selection.purchase_item_id === sub.id)
      : undefined;
  if (chargeSel) return chargeSel.selection.items.map(toContent("charge"));
  const def = ctx.selections.defaultsByPurchaseItem.get(sub.id);
  if (def?.items.length) return def.items.map(toContent("default"));
  return (
    ctx.bundleProducts.flatMap((p) => p.variants).find((v) => v.external_variant_id === sub.external_variant_id?.ecommerce)
      ?.selection_defaults ?? []
  ).map(toContent("variant"));
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

function variantOf(ctx: PortalContext, variantId: string | null | undefined) {
  if (!variantId) return undefined;
  return ctx.products.get(variantId)?.variants.find((x) => String(x.id) === variantId);
}

/** Walden base price for a variant on a delivery date (price windows → Shopify price). */
export function basePriceFor(ctx: PortalContext, variantId: string | null | undefined, deliveryIso: string): number | null {
  const v = variantOf(ctx, variantId);
  if (!v) return null;
  return basePriceOn(v.price_windows as PriceWindow[] | undefined, deliveryIso, money(v.price));
}

/** What an item should cost on a delivery date: one-time = base; subscription = base less plan %. */
function intendedUnit(base: number, subscription: boolean, pct: number): number {
  return subscription ? subscribePriceOf(base, pct) : base;
}

const differs = (a: number, b: number) => Math.abs(a - b) > 0.004;

function finishLine(line: Omit<LineVM, "listUnitPrice" | "pendingUnitPrice">, base: number | null, intended: number | null): LineVM {
  return {
    ...line,
    listUnitPrice: base != null && differs(base, line.unitPrice) && base > line.unitPrice ? base : null,
    pendingUnitPrice: intended != null && differs(intended, line.unitPrice) ? intended : null,
  };
}

/** A real charge line: shows what Recharge will charge; flags it if Walden's dated price differs. */
function chargeLine(ctx: PortalContext, li: ChargeLineItem, deliveryIso: string, pct: number): LineVM {
  const unit = money(li.unit_price);
  const variantId = li.external_variant_id?.ecommerce ?? null;
  const product = variantId ? ctx.products.get(variantId) : undefined;
  const subscription = li.purchase_item_type === "subscription";
  const base = basePriceFor(ctx, variantId, deliveryIso);
  return finishLine(
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
      subscription,
    },
    base,
    base != null ? intendedUnit(base, subscription, pct) : null
  );
}

/** A bundle item. A charge-level selection price is what Recharge will charge; otherwise the dated price. */
function variantLine(ctx: PortalContext, c: Content, pct: number, keyPrefix: string, deliveryIso: string): LineVM | null {
  const product = ctx.products.get(c.variantId);
  const variant = variantOf(ctx, c.variantId);
  if (!product || !variant) return null;
  const base = basePriceFor(ctx, c.variantId, deliveryIso)!;
  const intended = intendedUnit(base, true, pct);
  const unit = c.source === "charge" && c.price != null ? c.price : intended;
  return finishLine(
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
    base,
    intended
  );
}

function subscriptionLine(ctx: PortalContext, s: Subscription, deliveryIso: string): LineVM {
  const variantId = s.external_variant_id?.ecommerce ?? null;
  const base = basePriceFor(ctx, variantId, deliveryIso) ?? money(s.price);
  const unit = subscribePriceOf(base, discountPctFor(ctx, s));
  return finishLine(
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
    base,
    unit
  );
}

function expandBundle(ctx: PortalContext, chargeId: number | null, sub: Subscription, deliveryIso: string): LineVM[] {
  const pct = discountPctFor(ctx, sub);
  return contentsFor(ctx, chargeId, sub)
    .map((c) => variantLine(ctx, c, pct, `bundle-${sub.id}`, deliveryIso))
    .filter((l): l is LineVM => l !== null);
}

const savingsOf = (lines: LineVM[]) =>
  money(lines.reduce((s, l) => s + (l.listUnitPrice != null ? (l.listUnitPrice - l.unitPrice) * l.quantity : 0), 0));

/** Estimated total if the same items were delivered on another date (R-04: show old vs new). */
function totalOn(ctx: PortalContext, lines: LineVM[], deliveryIso: string, pct: number): number {
  return money(
    lines.reduce((sum, l) => {
      const base = basePriceFor(ctx, l.externalVariantId, deliveryIso);
      const unit = base != null ? intendedUnit(base, l.subscription, pct) : l.unitPrice;
      return sum + unit * l.quantity;
    }, 0)
  );
}

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
    const settings = dateSettingsFor(bundleSub);
    const deliveryDate = deliveryDateFromCharge(charge.scheduled_at, settings);
    const firstSub = bundleSub ?? ctx.subById.get(charge.line_items.find((li) => li.purchase_item_type === "subscription")?.purchase_item_id ?? -1);
    const pct = discountPctFor(ctx, firstSub);

    for (const li of charge.line_items) {
      if (li.purchase_item_type === "onetime") {
        oneTimePicks.push(chargeLine(ctx, li, deliveryDate, 0));
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
        if (!expanded.has(sub!.id)) subscriptionLines.push(...expandBundle(ctx, charge.id, sub!, deliveryDate));
        expanded.add(sub!.id);
      } else {
        subscriptionLines.push(chargeLine(ctx, li, deliveryDate, pct));
      }
    }

    if (charge.line_items.length === 0) {
      for (const sub of subscriptionsForDraftCharge(ctx, charge)) {
        if (isBundleSubscription(sub, ctx.bundleProductIds)) subscriptionLines.push(...expandBundle(ctx, charge.id, sub, deliveryDate));
        else subscriptionLines.push(subscriptionLine(ctx, sub, deliveryDate));
      }
    }

    const allLines = [...oneTimePicks, ...subscriptionLines];
    const linesTotal = money(allLines.reduce((sum, l) => sum + l.lineTotal, 0));
    // A real charge's total is Recharge's; a $0 draft is estimated from the lines.
    const estimatedTotal = charge.line_items.length ? money(charge.total_price) || linesTotal : linesTotal;
    const editDeadline = editDeadlineFromDelivery(deliveryDate, settings);
    const address = charge.address_id != null ? ctx.addressById.get(charge.address_id) ?? null : null;

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
      subscribeDiscountPct: pct,
      savings: savingsOf(subscriptionLines),
      pricePending: allLines.some((l) => l.pendingUnitPrice != null),
      needsPricing:
        charge.status === "queued" &&
        charge.line_items.length === 0 &&
        !!bundleSub &&
        !ctx.selections.chargeSelections.some((cs) => cs.chargeId === charge.id && cs.selection.purchase_item_id === bundleSub.id),
      oneTimePicks,
      subscriptions: subscriptionLines,
      address,
      deliveryDateValid: !!calendarFor(ctx.zipCalendars, address?.zip).dates?.includes(deliveryDate),
      zipHasCalendar: calendarFor(ctx.zipCalendars, address?.zip).dates != null,
      deliveryOptions: getDeliveryOptions(calendarFor(ctx.zipCalendars, address?.zip), deliveryDate, settings).map((o) => ({
        ...o,
        estimatedTotal: o.deliveryDate === deliveryDate ? estimatedTotal : totalOn(ctx, allLines, o.deliveryDate, pct),
      })),
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
  // Plans are priced for their next delivery date.
  const nextDeliveryFor = (sub: Subscription): string => {
    const next = ctx.charges.find((c) => c.status === "queued" && (c.address_id === sub.address_id || c.line_items.some((li) => li.purchase_item_id === sub.id)));
    const chargeIso = next?.scheduled_at ?? sub.next_charge_scheduled_at ?? toIsoDate(new Date());
    return deliveryDateFromCharge(chargeIso, dateSettingsFor(sub));
  };
  const planContents = (sub: Subscription): LineVM[] => {
    const next = ctx.charges.find(
      (c) => c.status === "queued" && c.line_items.some((li) => li.purchase_item_id === sub.id)
    );
    const deliveryIso = nextDeliveryFor(sub);
    const lines = (next?.line_items ?? [])
      .filter((li) => li.purchase_item_id === sub.id && li.external_product_id?.ecommerce !== sub.external_product_id?.ecommerce)
      .map((li) => chargeLine(ctx, li, deliveryIso, discountPctFor(ctx, sub)));
    return lines.length ? lines : expandBundle(ctx, next?.id ?? null, sub, deliveryIso);
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
      ...itemSubs.filter((s) => s.address_id === anchor.address_id).map((s) => subscriptionLine(ctx, s, nextDeliveryFor(s))),
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
      addOns: subs.map((s) => subscriptionLine(ctx, s, nextDeliveryFor(s))),
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
        priceWindows: v.price_windows ?? [],
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
