import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { requireCustomerOwnsId } from "~/lib/auth.server";
import { buildPlans } from "~/lib/walden/portal.server";
import type { PlanVM } from "~/lib/walden/types";
import { PageShell } from "~/components/walden/Layout";
import { Modal, Toast, formatMoney, type ToastState } from "~/components/walden/ui";

export const meta: MetaFunction = () => [{ title: "Your Plans | Walden Local" }];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const customerId = params.customerId!;
  await requireCustomerOwnsId(request, customerId);
  const { plans } = await buildPlans(customerId);
  return json({ customerId, plans });
}

// UX pass: echo only. Wiring: nickname → subscription property `_plan_nickname`.
export async function action({ params, request }: ActionFunctionArgs) {
  await requireCustomerOwnsId(request, params.customerId!);
  const form = await request.formData();
  return json({ ok: true, intent: String(form.get("intent")), wired: false });
}

function PlanCard({ plan, customerId, onEditNickname }: { plan: PlanVM; customerId: string; onEditNickname: () => void }) {
  const a = plan.address;
  return (
    <div className="border border-line">
      <div className="grid grid-cols-[258px_1fr_1fr_1fr]">
        <div className="flex flex-col items-center bg-[#F6F7F9] px-6 pt-8 pb-10 text-center">
          <h2 className="text-[19px] font-bold leading-[1.45]">
            {plan.nickname ?? `Your ${plan.title} Plan`}
          </h2>
          <button type="button" className="link-carrot mt-0.5 text-[15px]" onClick={onEditNickname}>Edit Nickname</button>
        </div>
        <div className="px-7 pt-[18px] pb-8">
          <h3 className="text-[19px] font-bold">
            Delivered <span className="font-medium text-carrot">{plan.frequencyLabel}</span>
          </h3>
          <p className="mt-5 text-[15px] leading-[1.45]">
            {a ? [`${a.firstName} ${a.lastName}`.trim(), a.oneLine, a.country].filter(Boolean).join(", ") : "No address on file"}
          </p>
          <Link to={`/${customerId}/account`} className="link-carrot mt-2 inline-block text-[15px]">Change Address</Link>
        </div>
        <div className="px-1 pt-[18px] pb-8">
          <h3 className="text-[19px] font-bold">Plan</h3>
          <p className="mt-5 text-[15px]">Order Minimum: {formatMoney(plan.orderMinimum)}</p>
        </div>
        <div className="pr-6 pt-[18px] pb-8">
          <h3 className="text-[19px] font-bold">Add Ons</h3>
          {plan.addOns.length === 0 ? (
            <p className="mt-5 text-[15px]">None yet</p>
          ) : (
            <ul className="mt-5 space-y-0 text-[15px] leading-[1.45]">
              {plan.addOns.map((l) => (
                <li key={l.key}>
                  {l.title} - {l.quantityLabel} ({formatMoney(l.unitPrice)}/ea)
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex justify-end border-t border-line px-3 pt-4 pb-14">
        <Link to={`/${customerId}/shop`} className="link-carrot text-[15px]">Manage Specials</Link>
      </div>
    </div>
  );
}

export default function Plans() {
  const { customerId, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [nicknamePlan, setNicknamePlan] = useState<PlanVM | null>(null);
  const [nickname, setNickname] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setToast({ message: "Nickname captured — UI preview, not saved to Recharge yet." });
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <PageShell customerId={customerId}>
      <div className="mx-auto max-w-[1068px] px-4 pt-[34px] pb-10">
        <h1 className="mb-[26px] text-center text-[19px] font-bold uppercase">Your Plans</h1>
        <div className="space-y-6">
          {plans.length === 0 ? (
            <p className="border border-line px-6 py-12 text-center text-[15px]">You don&apos;t have an active plan yet.</p>
          ) : (
            plans.map((p) => (
              <PlanCard
                key={p.subscriptionId}
                plan={p}
                customerId={customerId}
                onEditNickname={() => {
                  setNickname(p.nickname ?? "");
                  setNicknamePlan(p);
                }}
              />
            ))
          )}
        </div>
        <div className="mt-[30px] flex justify-center gap-1">
          <Link to={`/${customerId}/shop`} className="btn-carrot px-3.5 py-2 text-[17px]">Add a plan +</Link>
          <Link to={`/${customerId}`} className="btn-carrot px-3.5 py-2 text-[17px]">View Orders</Link>
        </div>
      </div>

      <Modal
        open={!!nicknamePlan}
        onClose={() => setNicknamePlan(null)}
        footer={
          <button
            type="button"
            className="btn-forest-lg"
            onClick={() => {
              fetcher.submit({ intent: "nickname", subscriptionId: String(nicknamePlan!.subscriptionId), nickname }, { method: "post" });
              setNicknamePlan(null);
            }}
          >
            Save
          </button>
        }
      >
        <div className="px-10 pt-[72px] pb-6 text-center">
          <h2 className="text-[19px] font-bold">Edit Nickname</h2>
          <input
            className="field mt-5"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={nicknamePlan ? `Your ${nicknamePlan.title} Plan` : ""}
            aria-label="Plan nickname"
          />
        </div>
      </Modal>
      <Toast toast={toast} onDone={clearToast} />
    </PageShell>
  );
}
