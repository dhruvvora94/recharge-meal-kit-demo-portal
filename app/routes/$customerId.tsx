import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { requireCustomerOwnsId } from "~/lib/auth.server";
import { buildUpcomingOrders } from "~/lib/walden/portal.server";
import { RescheduleError, rescheduleDelivery } from "~/lib/walden/reschedule.server";
import { formatShortDate } from "~/lib/walden/dates";
import type { UpcomingOrderVM } from "~/lib/walden/types";
import { PageShell } from "~/components/walden/Layout";
import { OrderCard } from "~/components/walden/OrderCard";
import { AddressModal, ChangeDateModal, SkipModal } from "~/components/walden/OrderModals";
import { Toast, type ToastState } from "~/components/walden/ui";

export const meta: MetaFunction = () => [{ title: "Upcoming Orders | Walden Local" }];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const customerId = params.customerId!;
  if (!/^\d+$/.test(customerId)) throw new Response("Not Found", { status: 404 });
  await requireCustomerOwnsId(request, customerId);
  const { orders, addresses } = await buildUpcomingOrders(customerId);
  return json({ customerId, orders, addresses });
}

type Intent = "change_date" | "skip" | "unskip" | "update_address_once";

//   change_date         → WIRED: reschedule the charge to delivery − /merchant offset,
//                          only to dates planned for the address ZIP (R-01..R-03)
//   skip / unskip       → preview only (POST /charges/:id/skip|unskip next)
//   update_address_once → preview only (charge-level address override next)
type ActionData =
  | { ok: true; intent: Intent; wired: boolean; deliveryDate?: string }
  | { ok: false; intent: Intent; error: string };

export async function action({ params, request }: ActionFunctionArgs) {
  const customerId = params.customerId!;
  await requireCustomerOwnsId(request, customerId);
  const form = await request.formData();
  const intent = String(form.get("intent")) as Intent;

  if (intent === "change_date") {
    try {
      const { deliveryDate } = await rescheduleDelivery(
        customerId,
        String(form.get("chargeId") ?? ""),
        String(form.get("deliveryDate") ?? "")
      );
      return json<ActionData>({ ok: true, intent, wired: true, deliveryDate });
    } catch (err) {
      if (!(err instanceof RescheduleError)) console.error("[change_date]", err);
      const error =
        err instanceof RescheduleError
          ? err.message
          : `Recharge didn't accept the new date: ${err instanceof Error ? err.message.replace(/^Recharge \d+ — [^:]+: /, "").slice(0, 200) : "unknown error"}`;
      return json<ActionData>({ ok: false, intent, error }, { status: 422 });
    }
  }

  return json<ActionData>({ ok: true, intent, wired: false });
}

export default function UpcomingOrders() {
  const { customerId, orders, addresses } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [dateOrder, setDateOrder] = useState<UpcomingOrderVM | null>(null);
  const [skipOrder, setSkipOrder] = useState<UpcomingOrderVM | null>(null);
  const [addressOrder, setAddressOrder] = useState<UpcomingOrderVM | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const submit = (intent: Intent, fields: Record<string, string>) =>
    fetcher.submit({ intent, ...fields }, { method: "post" });

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (!fetcher.data.ok) {
      setToast({ message: fetcher.data.error, tone: "error" });
      return;
    }
    if (fetcher.data.wired && fetcher.data.deliveryDate) {
      setToast({ message: `Delivery moved to ${formatShortDate(fetcher.data.deliveryDate)}.` });
      return;
    }
    if (!fetcher.data.wired) {
      const labels: Record<string, string> = {
        change_date: "Delivery date change",
        skip: "Skip",
        unskip: "Unskip",
        update_address_once: "One-time address update",
      };
      setToast({ message: `${labels[fetcher.data.intent] ?? "Change"} captured — UI preview, not saved to Recharge yet.` });
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <PageShell customerId={customerId}>
      <div className="mx-auto max-w-[920px] px-4 pt-11 pb-6">
        <div className="mb-[34px] flex items-baseline gap-3.5">
          <h1 className="text-[42px] font-[900] uppercase leading-none tracking-[-0.03em]">Upcoming Orders</h1>
          <Link to={`/${customerId}/orders`} className="link-forest text-[13px]">View Order History</Link>
        </div>

        {orders.length === 0 ? (
          <div className="border border-line bg-cream px-8 py-14 text-center">
            <h2 className="text-[21px] font-semibold">No upcoming orders</h2>
            <p className="mt-2 text-[14px] text-ink/70">Once your next delivery is scheduled, it&apos;ll show up here.</p>
            <Link to={`/${customerId}/plans`} className="btn-carrot mt-6">View Your Plans</Link>
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.chargeId}
              order={order}
              actions={{
                onChangeDate: setDateOrder,
                onChangeAddress: setAddressOrder,
                onUnskip: (o) => submit("unskip", { chargeId: String(o.chargeId) }),
                editHref: (o) => `/${customerId}/shop?charge=${o.chargeId}`,
                planHref: `/${customerId}/plans`,
              }}
            />
          ))
        )}
      </div>

      <ChangeDateModal
        order={dateOrder}
        onClose={() => setDateOrder(null)}
        onSkip={(o) => {
          setDateOrder(null);
          setSkipOrder(o);
        }}
        onSubmit={(o, deliveryDate) => {
          submit("change_date", { chargeId: String(o.chargeId), deliveryDate });
          setDateOrder(null);
        }}
      />
      <SkipModal
        order={skipOrder}
        onClose={() => setSkipOrder(null)}
        onSubmit={(o, reason) => {
          submit("skip", { chargeId: String(o.chargeId), reason });
          setSkipOrder(null);
        }}
      />
      <AddressModal
        order={addressOrder}
        addresses={addresses}
        onClose={() => setAddressOrder(null)}
        onUpdateAllFuture={() => navigate(`/${customerId}/account`)}
        onSubmit={(o, form) => {
          submit("update_address_once", { chargeId: String(o.chargeId), ...form });
          setAddressOrder(null);
        }}
      />
      <Toast toast={toast} onDone={clearToast} />
    </PageShell>
  );
}
