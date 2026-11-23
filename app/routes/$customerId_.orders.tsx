import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { listSuccessCharges } from "~/lib/recharge.server";
import { requireCustomerOwnsId } from "~/lib/auth.server";
import { deliveryDateFromCharge, formatLongDate } from "~/lib/walden/dates";
import { getMerchantSettings } from "~/lib/merchant-settings.server";
import { PageShell } from "~/components/walden/Layout";
import { formatMoney } from "~/components/walden/ui";

export const meta: MetaFunction = () => [{ title: "Order History | Walden Local" }];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const customerId = params.customerId!;
  await requireCustomerOwnsId(request, customerId);
  const charges = await listSuccessCharges(customerId);
  return json({ customerId, charges, dateSettings: getMerchantSettings() });
}

export default function OrderHistory() {
  const { customerId, charges, dateSettings } = useLoaderData<typeof loader>();
  return (
    <PageShell customerId={customerId}>
      <div className="mx-auto max-w-[920px] px-4 pt-11 pb-6">
        <div className="mb-[34px] flex items-baseline gap-3.5">
          <h1 className="text-[42px] font-[900] uppercase leading-none tracking-[-0.03em]">Order History</h1>
          <Link to={`/${customerId}`} className="link-forest text-[13px]">View Upcoming Orders</Link>
        </div>

        {charges.length === 0 ? (
          <p className="border border-line bg-cream px-8 py-14 text-center text-[15px]">No past orders yet.</p>
        ) : (
          <div className="divide-y divide-line border border-line">
            {charges.map((c) => {
              const delivered = deliveryDateFromCharge((c.processed_at ?? c.scheduled_at).slice(0, 10), dateSettings);
              return (
                <div key={c.id} className="grid grid-cols-[232px_1fr]">
                  <div className="bg-cream px-6 py-6 text-center">
                    <p className="eyebrow text-[10px]">Delivered</p>
                    <p className="mt-1 text-[17px] font-medium">{formatLongDate(delivered)}</p>
                    <p className="eyebrow mt-5 text-[10px]">Total</p>
                    <p className="mt-1 text-[17px] font-semibold">{formatMoney(parseFloat(c.total_price), c.currency ?? "USD")}</p>
                    <p className="mt-3 text-[11px] text-ink/60">Order #{c.id}</p>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-10 px-[26px] py-5">
                    {c.line_items.map((li, i) => (
                      <li key={`${li.purchase_item_id}-${i}`} className="mb-3">
                        <p className="text-[13px] font-medium">{li.title}</p>
                        <div className="mt-[3px] flex justify-between text-[11px]">
                          <span>
                            {li.quantity}
                            {li.variant_title && li.variant_title !== "Default Title" ? ` × ${li.variant_title}` : ""}
                            {li.purchase_item_type === "onetime" ? " · One-time" : ""}
                          </span>
                          <span className="font-bold">{formatMoney(parseFloat(li.total_price))}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
