// Maps live Recharge (2021-11) + Shopify Admin data into Walden view models.
// All network calls are server-side; nothing here ships to the browser.

import {
  getBundleCollectionsFromShopify,
  getBundleProductInfo,
  listActiveCharges,
  listAddresses,
  listBundleProducts,
  listBundleSelectionsByPurchaseItemIds,
  listSubscriptions,
} from "~/lib/recharge.server";
import { getProductsByVariantIds, listShopCollections, type ShopifyProduct } from "~/lib/shopify.server";
import { getAddonCollectionIds } from "~/lib/addon-collections.server";
import type { Address, BundleProduct, Charge, ChargeLineItem, Subscription } from "~/lib/types";
import { WALDEN } from "./config";
import {
  addDays,
  chargeDateFromDelivery,
  deliveryDateFromCharge,
  editDeadlineFromDelivery,
  isPastDeadline,
  toIsoDate,
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

function lineFromChargeItem(li: ChargeLineItem): LineVM {
  const unit = money(li.unit_price);
  return {
    key: `${li.purchase_item_type ?? "item"}-${li.purchase_item_id}-${li.external_variant_id?.ecommerce ?? li.title}`,
    title: li.title,
    quantityLabel: quantityLabel(li.quantity, li.variant_title),
    quantity: li.quantity,
    unitPrice: unit,
    lineTotal: money(li.total_price) || money(unit * li.quantity),
    imageUrl: li.images?.small ?? li.images?.medium ?? null,
    externalVariantId: li.external_variant_id?.ecommerce ?? null,
    purchaseItemId: li.purchase_item_id,
  };
}

function lineFromSubscription(s: Subscription): LineVM {
  const unit = money(s.price);
  return {
    key: `subscription-${s.id}`,
    title: s.product_title,
    quantityLabel: quantityLabel(s.quantity, s.variant_title),
    quantity: s.quantity,
    unitPrice: unit,
    lineTotal: money(unit * s.quantity),
    imageUrl: null,
    externalVariantId: s.external_variant_id?.ecommerce ?? null,
    purchaseItemId: s.id,
  };
}

function lineFromVariant(
  variantId: string,
  quantity: number,
  product: ShopifyProduct | undefined,
  keyPrefix: string
): LineVM | null {
  const variant = product?.variants.find((v) => String(v.id) === variantId);
  if (!product || !variant) return null;
  const unit = money(variant.price);
  return {
    key: `${keyPrefix}-${variantId}`,
    title: product.title,
    quantityLabel: quantityLabel(quantity, variant.title),
    quantity,
    unitPrice: unit,
    lineTotal: money(unit * quantity),
    imageUrl: product.image?.src ?? null,
    externalVariantId: variantId,
    purchaseItemId: null,
  };
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

export function getDeliveryOptions(_zip: string | null, currentDeliveryIso: string): DeliveryOptionVM[] {
  const month = currentDeliveryIso.slice(0, 7);
  const candidates = [-7, 0, 7]
    .map((offset) => addDays(currentDeliveryIso, offset))
    .filter((d) => d.slice(0, 7) === month);
  return candidates
    .map((deliveryDate) => ({
      deliveryDate,
      chargeDate: chargeDateFromDelivery(deliveryDate),
      editDeadline: editDeadlineFromDelivery(deliveryDate),
    }))
    .filter((o) => o.deliveryDate === currentDeliveryIso || !isPastDeadline(o.editDeadline));
}

// ─── Upcoming orders ──────────────────────────────────────────────────────────

type CustomerData = {
  subscriptions: Subscription[];
  charges: Charge[];
  addresses: Address[];
  bundleProducts: BundleProduct[];
};

async function loadCustomerData(customerId: string): Promise<CustomerData> {
  const [subscriptions, charges, addresses, bundleProducts] = await Promise.all([
    listSubscriptions(customerId),
    listActiveCharges(customerId),
    listAddresses(customerId),
    listBundleProducts().catch(() => [] as BundleProduct[]),
  ]);
  return { subscriptions, charges, addresses, bundleProducts };
}

function isBundleSubscription(s: Subscription | undefined, bundleProductIds: Set<string>): boolean {
  const pid = s?.external_product_id?.ecommerce;
  return pid != null && bundleProductIds.has(pid);
}

export async function buildUpcomingOrders(customerId: string): Promise<{
  orders: UpcomingOrderVM[];
  addresses: AddressVM[];
}> {
  const { subscriptions, charges, addresses, bundleProducts } = await loadCustomerData(customerId);
  const subById = new Map(subscriptions.map((s) => [s.id, s]));
  const addressById = new Map(addresses.map((a) => [a.id, toAddressVM(a)]));
  const bundleProductIds = new Set(bundleProducts.map((p) => p.external_product_id));

  const today = toIsoDate(new Date());
  const upcoming = charges.filter((c) => c.scheduled_at.slice(0, 10) >= today);

  // Bundle contents: charge-specific selection, else the subscription default,
  // else the bundle variant's selection_defaults.
  const bundleSubIds = subscriptions.filter((s) => isBundleSubscription(s, bundleProductIds)).map((s) => s.id);
  type Selections = Awaited<ReturnType<typeof listBundleSelectionsByPurchaseItemIds>>;
  const noSelections = (): Selections => ({ chargeSelections: [], defaultsByPurchaseItem: new Map() });
  const selections: Selections = bundleSubIds.length
    ? await listBundleSelectionsByPurchaseItemIds(bundleSubIds).catch(noSelections)
    : noSelections();

  const contentsFor = (chargeId: number, sub: Subscription): Array<{ variantId: string; quantity: number }> => {
    const chargeSel = selections.chargeSelections.find(
      (cs) => cs.chargeId === chargeId && cs.selection.purchase_item_id === sub.id
    );
    if (chargeSel) return chargeSel.selection.items.map((i) => ({ variantId: i.external_variant_id, quantity: i.quantity }));
    const def = selections.defaultsByPurchaseItem.get(sub.id);
    if (def?.items.length) return def.items.map((i) => ({ variantId: i.external_variant_id, quantity: i.quantity }));
    const variantDefaults =
      bundleProducts.flatMap((p) => p.variants).find((v) => v.external_variant_id === sub.external_variant_id?.ecommerce)
        ?.selection_defaults ?? [];
    return variantDefaults.map((d) => ({ variantId: d.external_variant_id, quantity: d.quantity }));
  };

  // Resolve every bundle content variant against Shopify in one pass.
  const contentVariantIds = new Set<string>();
  for (const charge of upcoming) {
    for (const li of charge.line_items) {
      const sub = subById.get(li.purchase_item_id);
      if (
        li.purchase_item_type === "subscription" &&
        isBundleSubscription(sub, bundleProductIds) &&
        li.external_product_id?.ecommerce === sub!.external_product_id?.ecommerce
      ) {
        contentsFor(charge.id, sub!).forEach((c) => contentVariantIds.add(c.variantId));
      }
    }
  }
  const productsByVariant = contentVariantIds.size
    ? await getProductsByVariantIds([...contentVariantIds]).catch(() => new Map<string, ShopifyProduct>())
    : new Map<string, ShopifyProduct>();

  const orders: UpcomingOrderVM[] = upcoming.map((charge) => {
    const oneTimePicks: LineVM[] = [];
    const subscriptionLines: LineVM[] = [];
    const expandedBundles = new Set<number>();
    let planTitle: string | null = null;

    for (const li of charge.line_items) {
      if (li.purchase_item_type === "onetime") {
        oneTimePicks.push(lineFromChargeItem(li));
        continue;
      }
      const sub = subById.get(li.purchase_item_id);
      if (isBundleSubscription(sub, bundleProductIds)) {
        planTitle ??= titleCase(sub!.product_title);
        // Recharge normally expands a bundle into its content line items on the
        // charge (each carrying the bundle subscription's purchase_item_id), at
        // the price that will actually be charged. Only when the charge holds a
        // single parent bundle line do we expand contents ourselves.
        const isParentLine = li.external_product_id?.ecommerce === sub!.external_product_id?.ecommerce;
        if (isParentLine) {
          if (expandedBundles.has(li.purchase_item_id)) continue;
          expandedBundles.add(li.purchase_item_id);
          for (const c of contentsFor(charge.id, sub!)) {
            const line = lineFromVariant(c.variantId, c.quantity, productsByVariant.get(c.variantId), `bundle-${li.purchase_item_id}`);
            if (line) subscriptionLines.push(line);
          }
        } else {
          subscriptionLines.push(lineFromChargeItem(li));
        }
      } else {
        subscriptionLines.push(lineFromChargeItem(li));
      }
    }

    // Freshly generated future charges can arrive without line items; show the
    // subscriptions at that address so the card isn't empty.
    if (charge.line_items.length === 0) {
      subscriptions
        .filter((s) => s.status === "active" && s.address_id === charge.address_id && !isBundleSubscription(s, bundleProductIds))
        .forEach((s) => subscriptionLines.push(lineFromSubscription(s)));
    }

    const linesTotal = [...oneTimePicks, ...subscriptionLines].reduce((sum, l) => sum + l.lineTotal, 0);
    const estimatedTotal = money(charge.total_price) || money(linesTotal);
    const deliveryDate = deliveryDateFromCharge(charge.scheduled_at);
    const editDeadline = editDeadlineFromDelivery(deliveryDate);
    const address = charge.address_id != null ? addressById.get(charge.address_id) ?? null : null;

    return {
      chargeId: charge.id,
      status: charge.status,
      planTitle: planTitle ?? WALDEN.defaultPlanTitle,
      deliveryDate,
      chargeDate: charge.scheduled_at.slice(0, 10),
      editDeadline,
      locked: isPastDeadline(editDeadline),
      estimatedTotal,
      currency: charge.currency ?? "USD",
      orderMinimum: WALDEN.orderMinimum,
      belowMinimum: charge.status === "queued" && estimatedTotal < WALDEN.orderMinimum,
      oneTimePicks,
      subscriptions: subscriptionLines,
      address,
      deliveryOptions: getDeliveryOptions(address?.zip ?? null, deliveryDate),
    };
  });

  return { orders, addresses: [...addressById.values()] };
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function buildPlans(customerId: string): Promise<{ plans: PlanVM[]; addresses: AddressVM[] }> {
  const { subscriptions, charges, addresses, bundleProducts } = await loadCustomerData(customerId);
  const addressById = new Map(addresses.map((a) => [a.id, toAddressVM(a)]));

  // What a bundle plan ships: its content lines on the next queued charge.
  const bundleContents = (sub: Subscription): LineVM[] => {
    const next = charges.find(
      (c) => c.status === "queued" && c.line_items.some((li) => li.purchase_item_id === sub.id)
    );
    return (next?.line_items ?? [])
      .filter(
        (li) =>
          li.purchase_item_id === sub.id &&
          li.external_product_id?.ecommerce !== sub.external_product_id?.ecommerce
      )
      .map(lineFromChargeItem);
  };
  const bundleProductIds = new Set(bundleProducts.map((p) => p.external_product_id));
  const active = subscriptions.filter((s) => s.status === "active");

  const anchors = active.filter((s) => isBundleSubscription(s, bundleProductIds));
  const addOnsAll = active.filter((s) => !isBundleSubscription(s, bundleProductIds));

  // A plan is anchored on a bundle subscription; add-ons are the item
  // subscriptions at the same address. With no bundle, the item subscriptions
  // at each address form one Build Your Own plan.
  const plans: PlanVM[] = anchors.map((anchor) => ({
    subscriptionId: anchor.id,
    title: titleCase(anchor.product_title),
    nickname: anchor.properties?.find((p) => p.name === "_plan_nickname")?.value ?? null,
    frequencyLabel: frequencyLabel(anchor),
    orderMinimum: WALDEN.orderMinimum,
    address: addressById.get(anchor.address_id) ?? null,
    addOns: [
      ...bundleContents(anchor),
      ...addOnsAll.filter((s) => s.address_id === anchor.address_id).map(lineFromSubscription),
    ],
    status: anchor.status,
  }));

  const anchoredAddresses = new Set(anchors.map((a) => a.address_id));
  const orphanAddresses = [...new Set(addOnsAll.map((s) => s.address_id))].filter((id) => !anchoredAddresses.has(id));
  for (const addressId of orphanAddresses) {
    const subs = addOnsAll.filter((s) => s.address_id === addressId);
    plans.push({
      subscriptionId: subs[0].id,
      title: WALDEN.defaultPlanTitle,
      nickname: null,
      frequencyLabel: frequencyLabel(subs[0]),
      orderMinimum: WALDEN.orderMinimum,
      address: addressById.get(addressId) ?? null,
      addOns: subs.map(lineFromSubscription),
      status: "active",
    });
  }

  return { plans, addresses: [...addressById.values()] };
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
  const { subscriptions, bundleProducts } = await loadCustomerData(customerId);
  const ids = new Set(bundleProducts.map((p) => p.external_product_id));
  return subscriptions.find((s) => s.status === "active" && isBundleSubscription(s, ids)) ?? null;
}
