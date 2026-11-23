import { Link } from "@remix-run/react";
import type { LineVM, UpcomingOrderVM } from "~/lib/walden/types";
import { formatLongDate, formatShortDate } from "~/lib/walden/dates";
import { formatMoney } from "./ui";

function LineItem({ line, currency }: { line: LineVM; currency: string }) {
  return (
    <li className="mb-[11px]">
      <p className="text-[13px] font-medium leading-snug">{line.title}</p>
      <div className="mt-[3px] flex items-baseline justify-between gap-3 text-[11px]">
        <span className="whitespace-nowrap">{line.quantityLabel}</span>
        <span className="whitespace-nowrap font-bold">
          {line.listUnitPrice != null && (
            <span className="mr-1 font-medium text-ink/45 line-through">
              {formatMoney(line.listUnitPrice * line.quantity, currency)}
            </span>
          )}
          {formatMoney(line.lineTotal, currency)} ({formatMoney(line.unitPrice, currency)}/ea)
        </span>
      </div>
    </li>
  );
}

function Column({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-[9px] flex items-center gap-2 text-[15px] font-bold">
        {title}
        {badge && (
          <span className="rounded-full bg-gold/40 px-2 py-[1px] text-[10px] font-bold uppercase tracking-wide text-forest">{badge}</span>
        )}
      </h3>
      {children}
    </div>
  );
}

export type OrderCardActions = {
  onChangeDate: (order: UpcomingOrderVM) => void;
  onChangeAddress: (order: UpcomingOrderVM) => void;
  onUnskip: (order: UpcomingOrderVM) => void;
  editHref: (order: UpcomingOrderVM) => string;
  planHref: string;
};

export function OrderCard({ order, actions }: { order: UpcomingOrderVM; actions: OrderCardActions }) {
  const skipped = order.status === "skipped";
  const readOnly = order.locked || skipped;
  const editHref = actions.editHref(order);

  return (
    <section className="mb-7">
      <h2 className="mb-[10px] text-[21px] font-semibold tracking-[-0.01em]">{order.planTitle}</h2>
      <div className={`grid grid-cols-[232px_1fr] border border-line shadow-card ${skipped ? "opacity-[0.72]" : ""}`}>
        {/* Delivery panel */}
        <div className="flex flex-col items-center bg-cream px-4 pt-7 pb-6 text-center">
          <p className="eyebrow text-[10px]">Estimated Delivery Date</p>
          <p className={`mt-1 text-[17px] font-medium ${skipped ? "line-through decoration-1" : ""}`}>
            {formatLongDate(order.deliveryDate)}
          </p>
          {skipped ? (
            <>
              <span className="mt-2 rounded-full bg-ink/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Skipped</span>
              <button type="button" className="btn-forest mt-3" onClick={() => actions.onUnskip(order)}>
                Unskip Order
              </button>
            </>
          ) : order.locked ? (
            <span className="mt-2 rounded bg-forest/10 px-2.5 py-1.5 text-[11px] font-semibold text-forest">
              Locked for delivery
            </span>
          ) : (
            <button type="button" className="btn-forest mt-2" onClick={() => actions.onChangeDate(order)}>
              Change Delivery Date
            </button>
          )}
          {!skipped && order.editDeadline && (
            <p className="mt-2.5 text-[11px] text-ink/70">
              {order.locked ? "Edits closed " : "Edit by "}
              <span className="font-semibold text-ink">{formatShortDate(order.editDeadline)}</span>
            </p>
          )}

          <div className="mt-auto pt-16">
            <p className="eyebrow text-[10px]">Estimated Total*</p>
            <p className="mt-1 text-[17px] font-semibold">{formatMoney(order.estimatedTotal, order.currency)}</p>
            {order.savings > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-forest-700">
                You save {formatMoney(order.savings, order.currency)} with Subscribe &amp; Save
              </p>
            )}
          </div>
          <p className="mt-auto pt-20 text-[9.5px] font-medium">*Includes cost of plan and all specials</p>
        </div>

        {/* Details */}
        <div className="px-[26px] pt-[19px] pb-3">
          <div className="grid grid-cols-[1fr_1fr_1.1fr] gap-x-[28px]">
            <Column title="Order Details">
              <p className="text-[13px] font-medium">Order Minimum: {formatMoney(order.orderMinimum, order.currency)}</p>
              <Link to={actions.planHref} className="link-forest mt-1 inline-block text-[13px]">Manage Plan</Link>
            </Column>

            <Column title="One-time Picks">
              {order.oneTimePicks.length === 0 ? (
                <p className="mb-[3px] text-[13px] font-medium">None</p>
              ) : (
                <ul>{order.oneTimePicks.map((l) => <LineItem key={l.key} line={l} currency={order.currency} />)}</ul>
              )}
              {!readOnly && <Link to={editHref} className="link-forest text-[13px]">Edit</Link>}
            </Column>

            <Column title="Subscriptions" badge={order.subscribeDiscountPct > 0 ? `Save ${order.subscribeDiscountPct}%` : undefined}>
              {order.subscriptions.length === 0 ? (
                <p className="mb-[3px] text-[13px] font-medium">None</p>
              ) : (
                <ul>{order.subscriptions.map((l) => <LineItem key={l.key} line={l} currency={order.currency} />)}</ul>
              )}
              {!readOnly && <Link to={editHref} className="link-forest text-[13px]">Edit</Link>}
            </Column>
          </div>

          <div className="mt-6 max-w-[200px]">
            <h3 className="text-[15px] font-bold">Delivering to:</h3>
            <p className="mt-1.5 text-[13px] font-medium leading-[1.75]">{order.address?.oneLine ?? "No address on file"}</p>
            {!readOnly && (
              <button type="button" className="link-forest mt-1 text-[13px]" onClick={() => actions.onChangeAddress(order)}>
                Change Address
              </button>
            )}
          </div>

          {order.belowMinimum && (
            <div className="mt-5 mb-1.5 bg-alert px-5 py-[18px] text-center text-[12.5px] font-semibold leading-[1.75] text-white">
              The items in this order do not meet the minimum order value of {formatMoney(order.orderMinimum, order.currency)}. Please{" "}
              <Link to={editHref} className="text-ink underline underline-offset-2">update your order</Link> to make sure you receive this order as planned!
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
