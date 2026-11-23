// View models the Walden UI renders. Loaders map live Recharge + Shopify data
// into these shapes, so components stay presentational.

export type LineVM = {
  key: string;
  title: string;
  /** e.g. "2 Jars", "4 Dozen", "1" */
  quantityLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl: string | null;
  externalVariantId: string | null;
  /** subscription / onetime purchase item id, when there is one */
  purchaseItemId: number | null;
  /** Shopify list price per unit, when it differs from what's charged (subscribe & save) */
  listUnitPrice: number | null;
  /** Walden's dated price for this delivery when Recharge currently has a different one stored */
  pendingUnitPrice: number | null;
  subscription: boolean;
};

export type AddressVM = {
  id: number;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  countryCode: string;
  /** "123 Main St., White plains, New York, 10601" */
  oneLine: string;
};

export type DeliveryOptionVM = {
  deliveryDate: string; // ISO
  chargeDate: string; // ISO
  editDeadline: string | null; // ISO, null when edits never lock
  /** Estimated total if the order were delivered on this date (dated prices) */
  estimatedTotal: number;
  /** The order's current date (always listed so the picker can show it) */
  isCurrent: boolean;
  /** A planned delivery date for the member's ZIP */
  valid: boolean;
};

export type UpcomingOrderVM = {
  chargeId: number;
  status: "queued" | "skipped" | string;
  planTitle: string;
  deliveryDate: string; // ISO
  chargeDate: string; // ISO
  editDeadline: string | null; // ISO, null when edits never lock
  locked: boolean;
  estimatedTotal: number;
  currency: string;
  orderMinimum: number;
  belowMinimum: boolean;
  /** Selling plan subscribe-and-save %, e.g. 10 */
  subscribeDiscountPct: number;
  /** List price minus charged price across subscription lines */
  savings: number;
  /** Some lines are stored in Recharge at a different price than the dated price for this delivery */
  pricePending: boolean;
  /**
   * Recharge hasn't stored this delivery's own contents and prices yet (a $0
   * draft future charge with no charge-level bundle selection). It would fall
   * back to the box defaults priced at checkout; saving locks them in.
   */
  needsPricing: boolean;
  oneTimePicks: LineVM[];
  subscriptions: LineVM[];
  address: AddressVM | null;
  /** Dates this member can move to (zip-constrained, R-02). */
  deliveryOptions: DeliveryOptionVM[];
  /** Current delivery date is a planned date for the address ZIP */
  deliveryDateValid: boolean;
  /** The address ZIP has a delivery calendar at all */
  zipHasCalendar: boolean;
};

export type PlanVM = {
  subscriptionId: number;
  title: string;
  nickname: string | null;
  frequencyLabel: string; // "Monthly", "Every 2 Months"
  orderMinimum: number;
  subscribeDiscountPct: number;
  address: AddressVM | null;
  addOns: LineVM[];
  status: string;
};

export type ShopProductVM = {
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string | null;
  price: number;
  /** walden.price_windows; the shop loader prices products for the order's delivery date */
  priceWindows: { starts_on: string; price: string }[];
  imageUrl: string | null;
  badge: string | null;
  available: boolean;
  collectionIds: string[];
};

export type ShopCollectionVM = { id: string; title: string };
