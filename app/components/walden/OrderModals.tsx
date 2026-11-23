import { useEffect, useState } from "react";
import type { AddressVM, UpcomingOrderVM } from "~/lib/walden/types";
import { WALDEN } from "~/lib/walden/config";
import { formatShortDate, formatWeekdayDate } from "~/lib/walden/dates";
import { Modal, formatMoney } from "./ui";

// Each modal reports what the member chose via `onSubmit`; the route turns that
// into a POST with an `intent` (change_date / skip / update_address) so wiring
// the Recharge calls later only touches the route action.

// ─── Change Delivery Date ─────────────────────────────────────────────────────

export function ChangeDateModal({
  order,
  onClose,
  onSkip,
  onSubmit,
}: {
  order: UpcomingOrderVM | null;
  onClose: () => void;
  onSkip: (order: UpcomingOrderVM) => void;
  onSubmit: (order: UpcomingOrderVM, deliveryDate: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  useEffect(() => {
    setSelected(order?.deliveryDate ?? "");
    setStep("pick");
  }, [order]);

  if (!order) return null;
  const option = order.deliveryOptions.find((o) => o.deliveryDate === selected);
  const unchanged = selected === order.deliveryDate;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[432px]"
      labelledBy="change-date-title"
      footer={
        step === "pick" ? (
          <button key="skip" type="button" className="btn-forest-lg" onClick={() => onSkip(order)}>Skip Order</button>
        ) : (
          <>
            <button key="back" type="button" className="btn-carrot" onClick={() => setStep("pick")}>Go Back</button>
            <button type="button" className="btn-forest-lg" onClick={() => onSubmit(order, selected)}>Confirm Date</button>
          </>
        )
      }
    >
      {step === "pick" ? (
        <div className="px-11 pt-[72px] pb-[15px] text-center">
          <h2 id="change-date-title" className="text-[19px] font-bold">Change Delivery Date</h2>
          <select
            className="field select-chevron mt-[22px] text-[15px]"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Delivery date"
          >
            {order.deliveryOptions.map((o) => (
              <option key={o.deliveryDate} value={o.deliveryDate} disabled={o.isCurrent && !o.valid}>
                {formatWeekdayDate(o.deliveryDate)}
                {o.isCurrent ? " (current)" : ""}
                {Math.abs(o.estimatedTotal - order.estimatedTotal) > 0.004 ? ` — ${formatMoney(o.estimatedTotal, order.currency)}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2.5 text-[12px] text-ink/70">
            {!order.zipHasCalendar
              ? `We haven't planned delivery days for ${order.address?.zip ? `zip ${order.address.zip}` : "your zip"} yet.`
              : order.deliveryOptions.some((o) => !o.isCurrent)
                ? `Showing delivery days for ${order.address?.zip ? `zip ${order.address.zip}` : "your zip"}.`
                : `No other delivery days left this month for zip ${order.address?.zip ?? ""}.`}
          </p>
          <button type="button" className="btn-carrot mt-4 px-4 py-2.5 text-[15px]" disabled={unchanged} onClick={() => setStep("confirm")}>
            Continue
          </button>
        </div>
      ) : (
        <div className="px-10 pt-[64px] pb-6">
          <h2 id="change-date-title" className="text-center text-[19px] font-bold">Confirm New Delivery Date</h2>
          <dl className="mt-6 divide-y divide-[#E4E1D4] border-y border-[#E4E1D4] text-[14px]">
            <div className="flex justify-between py-3">
              <dt className="text-ink/70">Delivery date</dt>
              <dd className="text-right">
                <span className="block text-ink/50 line-through">{formatShortDate(order.deliveryDate)}</span>
                <span className="font-semibold">{formatShortDate(selected)}</span>
              </dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-ink/70">Edit deadline</dt>
              <dd className="font-semibold">{option?.editDeadline ? formatShortDate(option.editDeadline) : "No cutoff"}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-ink/70">Estimated total</dt>
              <dd className="text-right">
                <span className="block text-ink/50">was {formatMoney(order.estimatedTotal, order.currency)}</span>
                <span className="font-semibold">{formatMoney(option?.estimatedTotal ?? order.estimatedTotal, order.currency)}</span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-ink/70">
            Prices follow your delivery date, so your total may change if a new price window applies.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ─── Skip ─────────────────────────────────────────────────────────────────────

export function SkipModal({
  order,
  onClose,
  onSubmit,
}: {
  order: UpcomingOrderVM | null;
  onClose: () => void;
  onSubmit: (order: UpcomingOrderVM, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [order]);
  if (!order) return null;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[432px]"
      labelledBy="skip-title"
      footer={
        <>
          <button type="button" className="btn-carrot" onClick={onClose}>Go Back</button>
          <button type="button" className="btn-forest-lg" disabled={!reason} onClick={() => onSubmit(order, reason)}>
            Confirm Skip
          </button>
        </>
      }
    >
      <h2 id="skip-title" className="border-b border-[#E4E1D4] px-7 pt-[72px] pb-4 text-[21px] font-bold">Are You Sure?</h2>
      <div className="px-11 pt-6 pb-[15px] text-center">
        <p className="text-[15.5px] leading-[1.6]">
          We get that things come up! If another delivery day won&apos;t work for you this month, please let us know why you need to skip.
        </p>
        <select
          className="field select-chevron mt-5 rounded-md"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Skip reason"
        >
          <option value="" disabled>Skip reason</option>
          {WALDEN.skipReasons.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

// ─── One-time address change ──────────────────────────────────────────────────

const STATES = [
  "Connecticut", "Maine", "Massachusetts", "New Hampshire", "New Jersey", "New York", "Pennsylvania", "Rhode Island", "Vermont",
];

type AddressForm = Omit<AddressVM, "id" | "oneLine" | "countryCode">;

function emptyForm(a: AddressVM | null): AddressForm {
  return {
    firstName: a?.firstName ?? "",
    lastName: a?.lastName ?? "",
    company: a?.company ?? "",
    phone: a?.phone ?? "",
    address1: a?.address1 ?? "",
    address2: a?.address2 ?? "",
    city: a?.city ?? "",
    province: a?.province ?? "",
    zip: a?.zip ?? "",
    country: a?.country || "United States",
  };
}

export function AddressModal({
  order,
  addresses,
  onClose,
  onSubmit,
  onUpdateAllFuture,
}: {
  order: UpcomingOrderVM | null;
  addresses: AddressVM[];
  onClose: () => void;
  onSubmit: (order: UpcomingOrderVM, form: AddressForm) => void;
  onUpdateAllFuture: () => void;
}) {
  const [form, setForm] = useState<AddressForm>(emptyForm(null));
  useEffect(() => setForm(emptyForm(order?.address ?? null)), [order]);
  if (!order) return null;

  const set = (k: keyof AddressForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const zipChanged = !!order.address?.zip && form.zip.trim() !== "" && form.zip.trim() !== order.address.zip;
  const valid = form.firstName && form.phone && form.address1 && form.city && form.province && form.zip;

  const field = (label: string, key: keyof AddressForm, required = false) => (
    <label className="block">
      <span className="field-label">{label}{required && "*"}</span>
      <input className="field rounded-[3px] border-[#EEEDE6] py-[13px]" value={form[key]} onChange={set(key)} required={required} />
    </label>
  );

  return (
    <Modal open onClose={onClose} width="max-w-[1008px]" labelledBy="address-title">
      <form
        className="px-11 pt-[72px] pb-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(order, form);
        }}
      >
        <h2 id="address-title" className="text-center text-[21px] font-bold">Edit Shipping Address</h2>
        <div className="mt-[11px] rounded-[3px] bg-[#D65A44] px-5 py-[11px] text-center text-[15px] text-white">
          Important - This is a one time address update!{" "}
          <button type="button" className="underline underline-offset-2" onClick={onUpdateAllFuture}>Click here</button>{" "}
          to update for all future orders.
        </div>

        <select
          className="field select-chevron mt-[15px] border-[#EEEDE6]"
          defaultValue=""
          aria-label="Prepopulate from existing address"
          onChange={(e) => {
            const a = addresses.find((x) => String(x.id) === e.target.value);
            if (a) setForm(emptyForm(a));
          }}
        >
          <option value="" disabled>Prepopulate from existing address</option>
          {addresses.map((a) => (
            <option key={a.id} value={a.id}>{a.oneLine}</option>
          ))}
        </select>

        <div className="mt-3 grid grid-cols-[288px_288px] gap-x-[176px] gap-y-6">
          {field("First Name", "firstName", true)}
          {field("Last Name", "lastName")}
          {field("Company", "company")}
          {field("Phone", "phone", true)}
          {field("Address 1", "address1", true)}
          {field("Address 2", "address2")}
          {field("City", "city", true)}
          <div>
            <span className="field-label">Country</span>
            <p className="px-3 py-[13px] text-[16px]">{form.country}</p>
          </div>
          <label className="block">
            <span className="field-label">State*</span>
            <select className="field select-chevron border-[#EEEDE6] py-[13px]" value={form.province} onChange={set("province")}>
              <option value="" disabled>Select a state</option>
              {[...new Set([form.province, ...STATES].filter(Boolean))].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          {field("Zip", "zip", true)}
        </div>

        {zipChanged && (
          <p className="mt-5 rounded-[3px] border border-gold bg-gold/15 px-4 py-3 text-[14px]">
            This zip is in a different delivery zone. After saving you&apos;ll pick a new delivery date for this order.
          </p>
        )}

        <div className="mt-8 flex justify-center">
          <button type="submit" className="btn-forest-lg px-10" disabled={!valid}>Save Address</button>
        </div>
      </form>
    </Modal>
  );
}
