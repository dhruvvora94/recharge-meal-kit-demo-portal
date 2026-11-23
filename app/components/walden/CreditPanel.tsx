import type { CreditVM } from "~/lib/walden/types";
import { formatLongDate } from "~/lib/walden/dates";
import { formatMoney } from "./ui";

/** R-13: subscription credit balance + automatic redemption toggle. */
export function CreditPanel({
  credit,
  busy,
  onToggle,
}: {
  credit: CreditVM;
  busy: boolean;
  onToggle: (apply: boolean) => void;
}) {
  if (credit.balance <= 0) return null;
  return (
    <div className="mb-8 flex items-center justify-between gap-6 border border-line bg-cream px-6 py-4">
      <div>
        <p className="eyebrow text-[10px]">Subscription Credit</p>
        <p className="mt-1 text-[22px] font-semibold">
          {formatMoney(credit.balance, credit.currency)} <span className="text-[13px] font-medium text-ink/60">available</span>
        </p>
        <p className="mt-0.5 text-[12px] text-ink/60">
          {credit.accounts
            .map((a) => `${a.name} ${formatMoney(a.balance, credit.currency)}${a.expiresAt ? ` (expires ${formatLongDate(a.expiresAt)})` : ""}`)
            .join(" · ")}
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-3 text-[13px] font-medium">
        <span className="max-w-[230px] text-right leading-snug">
          {credit.autoApply
            ? "Applied automatically to your upcoming orders before your card is charged"
            : "Use my credit on upcoming orders"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={credit.autoApply}
          disabled={busy}
          onClick={() => onToggle(!credit.autoApply)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${credit.autoApply ? "bg-forest-700" : "bg-ink/25"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${credit.autoApply ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </label>
    </div>
  );
}
