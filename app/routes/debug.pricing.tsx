// DEV-ONLY pricing inspector: raw Recharge + Shopify data behind one charge.
// GET /debug/pricing?charge=<id>   (signed-in customer, non-production only)
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireCustomer } from "~/lib/auth.server";
import { rechargeFetch } from "~/lib/recharge.server";
import { getProductsByVariantIds, getSellingPlanDiscounts } from "~/lib/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.NODE_ENV === "production") throw new Response("Not Found", { status: 404 });
  const auth = await requireCustomer(request);
  const chargeId = new URL(request.url).searchParams.get("charge") ?? "";
  const safe = <T,>(p: Promise<T>) => p.catch((e: unknown) => ({ error: String(e) }));

  const charge = (await rechargeFetch<{ charge: Record<string, any> }>(`/charges/${chargeId}`)).charge;
  if (String(charge.customer?.id) !== auth.customerId) throw new Response("Not Found", { status: 404 });
  const purchaseItemIds = [...new Set((charge.line_items ?? []).map((li: any) => li.purchase_item_id))];
  const subs = await safe(rechargeFetch<any>(`/subscriptions?customer_id=${auth.customerId}&limit=50`));
  const bundleProductIds = [...new Set(((subs as any).subscriptions ?? []).map((s: any) => s.external_product_id?.ecommerce))];
  const variantIds = (charge.line_items ?? []).map((li: any) => li.external_variant_id?.ecommerce).filter(Boolean);

  return json({
    charge,
    subscriptions: subs,
    bundle_selections: await safe(rechargeFetch<any>(`/bundle_selections?purchase_item_ids=${purchaseItemIds.join(",")}&limit=250`)),
    bundle_products: await safe(rechargeFetch<any>(`/bundle_products?limit=250`)),
    plans: await safe(Promise.all(bundleProductIds.map((pid) => rechargeFetch<any>(`/plans?external_product_id=${pid}&limit=50`)))),
    recharge_products: await safe(
      rechargeFetch<any>(
        `/products?external_product_ids=${[...bundleProductIds, ...((charge.line_items ?? []).map((li: any) => li.external_product_id?.ecommerce))].join(",")}`
      )
    ),
    discounts_on_charge: charge.discounts,
    customer: await safe(rechargeFetch<any>(`/customers/${auth.customerId}`).then((r) => r.customer)),
    credit_summary: await safe(rechargeFetch<any>(`/customers/${auth.customerId}/credit_summary?include[]=credit_details`)),
    credit_accounts: await safe(rechargeFetch<any>(`/credit_accounts?customer_id=${auth.customerId}&limit=50`)),
    all_charges: await safe(
      rechargeFetch<any>(`/charges?customer_id=${auth.customerId}&status=queued,skipped,error&sort_by=scheduled_at-asc&limit=50`).then((r) =>
        r.charges.map((c: any) => ({
          id: c.id,
          status: c.status,
          scheduled_at: c.scheduled_at,
          total_price: c.total_price,
          items: c.line_items.map((l: any) => `${l.title} x${l.quantity} @${l.unit_price} (${l.purchase_item_type} ${l.purchase_item_id})`),
        }))
      )
    ),
    onetimes: await safe(rechargeFetch<any>(`/onetimes?customer_id=${auth.customerId}&limit=250`)),
    shopify_variants: Object.fromEntries(
      [...(await getProductsByVariantIds(variantIds))].map(([v, p]) => [v, { product: p.title, product_id: p.id, variants: p.variants }])
    ),
    shopify_selling_plans: Object.fromEntries(await getSellingPlanDiscounts([...bundleProductIds as string[], ...((charge.line_items ?? []).map((li: any) => li.external_product_id?.ecommerce))])),
  });
}
