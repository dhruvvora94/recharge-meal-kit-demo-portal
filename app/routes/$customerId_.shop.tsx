import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { requireCustomerOwnsId } from "~/lib/auth.server";
import { buildShopCatalog, buildUpcomingOrders, findBundleSubscription } from "~/lib/walden/portal.server";
import { SaveOrderError, saveDeliveryEdits, type DesiredLine } from "~/lib/walden/save-order.server";
import { formatDeliveryChip } from "~/lib/walden/dates";
import type { ShopProductVM, UpcomingOrderVM } from "~/lib/walden/types";
import { PageShell } from "~/components/walden/Layout";
import { Toast, formatMoney, type ToastState } from "~/components/walden/ui";

export const meta: MetaFunction = () => [{ title: "Shop All | Walden Local" }];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const customerId = params.customerId!;
  await requireCustomerOwnsId(request, customerId);
  const url = new URL(request.url);
  const chargeParam = url.searchParams.get("charge");

  const [{ orders }, bundleSub] = await Promise.all([
    buildUpcomingOrders(customerId),
    findBundleSubscription(customerId),
  ]);
  const editable = orders.filter((o) => o.status === "queued" && !o.locked);
  const order = editable.find((o) => String(o.chargeId) === chargeParam) ?? editable[0] ?? null;

  const catalog = await buildShopCatalog(
    bundleSub?.external_product_id?.ecommerce ?? null,
    bundleSub?.external_variant_id?.ecommerce ?? null
  );
  return json({ customerId, order, editableOrders: editable, ...catalog });
}

// Save Changes → this delivery only (R-07). See save-order.server.ts.
export async function action({ params, request }: ActionFunctionArgs) {
  const customerId = params.customerId!;
  await requireCustomerOwnsId(request, customerId);
  const form = await request.formData();
  const chargeId = String(form.get("chargeId") ?? "");
  let lines: DesiredLine[] = [];
  try {
    lines = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch {
    return json({ ok: false as const, error: "Couldn't read your order changes." }, { status: 400 });
  }
  if (!/^\d+$/.test(chargeId)) return json({ ok: false as const, error: "Missing delivery." }, { status: 400 });
  try {
    const result = await saveDeliveryEdits(customerId, chargeId, lines);
    return json({ ok: true as const, result });
  } catch (err) {
    const message =
      err instanceof SaveOrderError
        ? err.message
        : `Recharge didn't accept the change: ${err instanceof Error ? err.message.replace(/^Recharge \d+ — [^:]+: /, "").slice(0, 200) : "unknown error"}`;
    if (!(err instanceof SaveOrderError)) console.error("[save_order]", err);
    return json({ ok: false as const, error: message }, { status: 422 });
  }
}

// ─── Cart state ───────────────────────────────────────────────────────────────

type CartLine = {
  variantId: string;
  title: string;
  imageUrl: string | null;
  /** Shopify list price; subscription lines get the selling plan discount off this */
  listPrice: number;
  quantity: number;
  subscription: boolean;
  variantTitle: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const subscribeUnit = (list: number, pct: number) => round2(list * (1 - pct / 100));
const unitPriceOf = (l: CartLine, pct: number) => (l.subscription ? subscribeUnit(l.listPrice, pct) : l.listPrice);

function initialCart(order: UpcomingOrderVM | null): CartLine[] {
  if (!order) return [];
  const toLine = (subscription: boolean) => (l: UpcomingOrderVM["subscriptions"][number]): CartLine => ({
    variantId: l.externalVariantId ?? l.key,
    title: l.title,
    imageUrl: l.imageUrl,
    listPrice: l.listUnitPrice ?? l.unitPrice,
    quantity: l.quantity,
    subscription,
    variantTitle: null,
  });
  return [...order.subscriptions.map(toLine(true)), ...order.oneTimePicks.map(toLine(false))];
}

const cartKey = (lines: CartLine[]) =>
  JSON.stringify(
    lines
      .map((l) => [l.variantId, l.quantity, l.subscription])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );

// ─── Small pieces ─────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9z" />
    </svg>
  );
}

function Stepper({
  quantity,
  onChange,
  size = "lg",
  unit,
}: {
  quantity: number;
  onChange: (q: number) => void;
  size?: "lg" | "sm";
  unit?: string;
}) {
  const h = size === "lg" ? "h-[46px] min-w-[158px]" : "h-[42px] w-[100px]";
  return (
    <div className={`inline-flex ${h} items-center justify-between rounded-full bg-forest-700 px-4 text-white`}>
      <button type="button" aria-label="Decrease" onClick={() => onChange(quantity - 1)} className="text-xl leading-none">
        {size === "lg" && quantity === 1 ? <TrashIcon /> : "−"}
      </button>
      <span className="px-2 text-[17px] font-semibold tabular-nums">
        {quantity}
        {unit ? ` ${unit}` : ""}
      </span>
      <button type="button" aria-label="Increase" onClick={() => onChange(quantity + 1)} className="text-xl leading-none">+</button>
    </div>
  );
}

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-white">
      <img src="/walden-logo.svg" alt="" className="h-12 opacity-20 invert" />
    </div>
  );
}

function ProductCard({
  product,
  line,
  subscribe,
  discountPct,
  onAdd,
  onQty,
  onToggleSubscribe,
}: {
  product: ShopProductVM;
  line: CartLine | undefined;
  /** Subscribe checkbox state: the cart line's, or the pending choice before Add. */
  subscribe: boolean;
  discountPct: number;
  onAdd: () => void;
  onQty: (q: number) => void;
  onToggleSubscribe: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="relative aspect-square overflow-hidden rounded-md bg-white">
        <ProductImage src={product.imageUrl} alt={product.title} />
        {product.badge && (
          <span
            className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[13px] font-medium ${
              product.badge === "Walden Reserve" ? "bg-forest text-white" : "bg-cream-light text-ink"
            }`}
          >
            {product.badge}
          </span>
        )}
      </div>
      <h3 className="mt-3 truncate text-[19px] font-medium text-forest">{product.title}</h3>
      {product.available && (
        <label
          className={`mt-2 flex cursor-pointer items-center gap-2.5 rounded border px-2.5 py-2 text-[13px] font-medium transition-colors ${
            subscribe ? "border-[#C9D4BE] bg-[#E3E9D9]" : "border-line bg-white/60 text-ink/70"
          }`}
        >
          <input type="checkbox" className="h-4 w-4 accent-forest-700" checked={subscribe} onChange={onToggleSubscribe} />
          {discountPct > 0 ? `Subscribe & save ${discountPct}%` : "Subscribe"}
        </label>
      )}
      <p className="mt-auto pt-3 text-[17px]">
        <span className="font-bold text-forest-700">
          {formatMoney(subscribe && product.available ? subscribeUnit(product.price, discountPct) : product.price)}
        </span>
        <span className="text-forest-700"> / ea</span>
        {subscribe && product.available && discountPct > 0 && (
          <span className="ml-2 text-[13px] text-ink/45 line-through">{formatMoney(product.price)}</span>
        )}
        {product.variantTitle && <span className="ml-2 text-[12px] text-ink/50">{product.variantTitle}</span>}
      </p>
      <div className="mt-2.5">
        {!product.available ? (
          <span className="inline-flex h-[46px] items-center rounded-full bg-[#D5D3CB] px-6 text-[17px] text-ink/60">Sold Out</span>
        ) : line ? (
          <Stepper quantity={line.quantity} onChange={onQty} unit="ct" />
        ) : (
          <button type="button" onClick={onAdd} className="inline-flex h-[46px] items-center gap-1.5 rounded-full bg-forest-700 px-6 text-[17px] text-white hover:bg-forest-800">
            <span className="text-xl leading-none">+</span> Add
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SORTS = {
  relevance: "Relevance",
  "price-asc": "Price, low to high",
  "price-desc": "Price, high to low",
  "title-asc": "Alphabetically, A–Z",
} as const;

export default function Shop() {
  const { customerId, order, editableOrders, collections, products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [cart, setCart] = useState<CartLine[]>(() => initialCart(order));
  // Subscribe choice for products not yet in the order. Defaults to subscription;
  // unticking before Add makes the item a one-time pick for this delivery.
  const [pendingSubscribe, setPendingSubscribe] = useState<Record<string, boolean>>({});
  const [activeCollection, setActiveCollection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("relevance");
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => setCart(initialCart(order)), [order]);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      setToast({ message: `Saved — your ${order ? formatDeliveryChip(order.deliveryDate) : ""} delivery is updated.` });
    } else {
      setToast({ message: fetcher.data.error, tone: "error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const byVariant = useMemo(() => new Map(cart.map((l) => [l.variantId, l])), [cart]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter(
      (p) => (activeCollection === "all" || p.collectionIds.includes(activeCollection)) && (!q || p.title.toLowerCase().includes(q))
    );
    const sorted = [...list];
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "title-asc") sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [products, activeCollection, query, sort]);

  const setQty = (variantId: string, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((l) => l.variantId !== variantId) : c.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l))));
  const add = (p: ShopProductVM) =>
    setCart((c) => [
      ...c,
      {
        variantId: p.variantId,
        title: p.title,
        imageUrl: p.imageUrl,
        listPrice: p.price,
        quantity: 1,
        subscription: pendingSubscribe[p.variantId] ?? true,
        variantTitle: p.variantTitle,
      },
    ]);
  const toggleSub = (variantId: string) => {
    if (byVariant.has(variantId)) {
      setCart((c) => c.map((l) => (l.variantId === variantId ? { ...l, subscription: !l.subscription } : l)));
    } else {
      setPendingSubscribe((p) => ({ ...p, [variantId]: !(p[variantId] ?? true) }));
    }
  };

  const pct = order?.subscribeDiscountPct ?? 0;
  const subtotal = round2(cart.reduce((s, l) => s + unitPriceOf(l, pct) * l.quantity, 0));
  const savings = round2(cart.reduce((s, l) => s + (l.listPrice - unitPriceOf(l, pct)) * l.quantity, 0));
  const dirty = cartKey(cart) !== cartKey(initialCart(order));
  const saving = fetcher.state !== "idle";
  const minimum = order?.orderMinimum ?? 0;
  const metMinimum = subtotal >= minimum;
  const activeTitle = activeCollection === "all" ? "Shop All" : collections.find((c) => c.id === activeCollection)?.title ?? "Shop All";

  return (
    <PageShell customerId={customerId} active="shop" tone="cream">
      <div className="mx-auto max-w-[1300px] px-3.5">
        {/* Category bar */}
        <div className="flex items-center gap-8 pt-4">
          <nav className="flex flex-1 gap-[26px] overflow-x-auto border-b border-[#DCD6C2] text-[13px] font-medium text-forest">
            {[{ id: "all", title: "Shop All" }, ...collections].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCollection(c.id)}
                className={`whitespace-nowrap pb-3 pt-2 ${activeCollection === c.id ? "border-b-2 border-forest font-bold" : ""}`}
              >
                {c.title}
              </button>
            ))}
          </nav>
          <label className="relative w-[315px] shrink-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are you looking for?"
              className="h-[46px] w-full rounded-full border border-ink/70 bg-transparent pl-4 pr-11 text-[13px] outline-none placeholder:text-ink/40"
            />
            <svg className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" strokeLinecap="round" />
            </svg>
          </label>
        </div>

        <div className="grid grid-cols-[1fr_395px] gap-[22px] pt-12">
          {/* Catalogue */}
          <div>
            <p className="text-[12px] text-forest">
              <Link to={`/${customerId}`} className="hover:underline">Home</Link> <span className="mx-1.5">/</span>
              Shop <span className="mx-1.5">/</span> <span className="text-forest/60">{activeTitle}</span>
            </p>
            <h1 className="mt-5 font-serif text-[64px] font-medium leading-none tracking-[-0.01em] text-forest">{activeTitle}</h1>
            <div className="mt-10 flex items-center justify-between text-[13px]">
              <span className="font-medium">{visible.length} Products</span>
              <label className="flex items-center gap-2.5 text-[15px] font-medium text-forest">
                Sort By
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}
                  className="select-chevron h-[34px] w-[200px] rounded border border-line bg-white px-2.5 text-[15px]"
                >
                  {Object.entries(SORTS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-x-[13px] gap-y-10">
              {visible.map((p) => (
                <ProductCard
                  key={p.variantId}
                  product={p}
                  line={byVariant.get(p.variantId)}
                  subscribe={byVariant.get(p.variantId)?.subscription ?? pendingSubscribe[p.variantId] ?? true}
                  discountPct={pct}
                  onAdd={() => add(p)}
                  onQty={(q) => setQty(p.variantId, q)}
                  onToggleSubscribe={() => toggleSub(p.variantId)}
                />
              ))}
              {visible.length === 0 && <p className="col-span-4 py-16 text-center text-[15px] text-ink/60">No products match.</p>}
            </div>
          </div>

          {/* My Order */}
          <aside className="sticky top-4 self-start">
            <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl bg-white shadow-card">
              <div className="px-5 pt-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-serif text-[30px] font-medium text-ink">My Order</h2>
                  {order && editableOrders.length > 1 ? (
                    <select
                      aria-label="Choose delivery"
                      value={order.chargeId}
                      onChange={(e) => (window.location.search = `?charge=${e.target.value}`)}
                      className="select-chevron rounded bg-[#F4EFD8] py-1.5 pl-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-forest-700 underline"
                    >
                      {editableOrders.map((o) => (
                        <option key={o.chargeId} value={o.chargeId}>{formatDeliveryChip(o.deliveryDate)} Delivery</option>
                      ))}
                    </select>
                  ) : order ? (
                    <span className="rounded bg-[#F4EFD8] px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-forest-700 underline">
                      {formatDeliveryChip(order.deliveryDate)} Delivery
                    </span>
                  ) : null}
                </div>
                {order ? (
                  <>
                    <p className="mt-8 text-center text-[12px] font-medium">
                      {metMinimum
                        ? "Congrats! You've met the order minimum."
                        : `Add ${formatMoney(minimum - subtotal)} more to meet the ${formatMoney(minimum)} minimum.`}
                    </p>
                    <div className="mx-1 mt-3 h-[6px] rounded-full bg-[#EFEBDA]">
                      <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${Math.min(100, (subtotal / (minimum || 1)) * 100)}%` }} />
                    </div>
                    <div className="mt-8 rounded bg-cream-light px-5 py-6">
                      <p className="eyebrow text-[11px]">Base Plan</p>
                      <p className="mt-3 text-[21px] font-medium text-forest">{order.planTitle}</p>
                    </div>
                  </>
                ) : (
                  <p className="mt-6 pb-6 text-[14px] text-ink/70">You don&apos;t have an editable delivery right now.</p>
                )}
              </div>

              {order && (
                <>
                  <ul className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
                    {cart.length === 0 && <li className="py-8 text-center text-[13px] text-ink/60">Your order is empty.</li>}
                    {cart.map((l) => (
                      <li key={l.variantId} className="grid grid-cols-[40px_1fr_auto] items-start gap-3 border-b border-line py-4">
                        <div className="h-10 w-10 overflow-hidden rounded bg-cream">
                          <ProductImage src={l.imageUrl} alt={l.title} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium leading-tight text-forest">{l.title}</p>
                          <p className="mt-1 text-[11px]">
                            {l.subscription && unitPriceOf(l, pct) < l.listPrice && (
                              <span className="mr-1 text-ink/45 line-through">{formatMoney(l.listPrice)}</span>
                            )}
                            {formatMoney(unitPriceOf(l, pct))} / ea
                          </p>
                          <span className="mt-1.5 inline-block rounded bg-[#F2F0E8] px-1.5 py-0.5 text-[11px] font-medium">
                            {l.subscription ? "Subscription" : "One-time"}
                          </span>
                        </div>
                        <div className="flex flex-col items-center">
                          <Stepper size="sm" quantity={l.quantity} onChange={(q) => setQty(l.variantId, q)} />
                          <span className="mt-1.5 text-[11px] font-medium">{formatMoney(unitPriceOf(l, pct) * l.quantity)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-line bg-cream-light px-5 py-4">
                    {savings > 0 && (
                      <div className="mb-1.5 flex items-center justify-between text-[13px] text-forest-700">
                        <span>Subscriber savings ({pct}%)</span>
                        <span>−{formatMoney(savings)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[15px] font-medium">
                      <span>Estimated subtotal</span>
                      <span>{formatMoney(subtotal)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-forest-lg mt-3 w-full rounded-full"
                      disabled={!dirty || saving}
                      onClick={() =>
                        fetcher.submit(
                          {
                            intent: "save_order",
                            chargeId: String(order.chargeId),
                            lines: JSON.stringify(
                              cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity, subscription: l.subscription }))
                            ),
                          },
                          { method: "post" }
                        )
                      }
                    >
                      {saving ? "Saving…" : dirty ? "Save Changes" : "No changes to save"}
                    </button>
                    <p className="mt-2 text-center text-[11px] text-ink/60">
                      Changes apply to your {formatDeliveryChip(order.deliveryDate)} delivery only.
                    </p>
                    <Link to={`/${customerId}`} className="mt-2 block text-center text-[12px] text-forest-700 underline">Back to upcoming orders</Link>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
      <Toast toast={toast} onDone={clearToast} />
    </PageShell>
  );
}
