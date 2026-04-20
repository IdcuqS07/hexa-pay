import { QuoteStatus, QUOTE_STATUS_LABEL } from "../../lib/privateQuoteTypes";

type Props = {
  status: QuoteStatus | number;
};

export default function QuoteStatusBadge({ status }: Props) {
  const value = Number(status);

  const styleMap: Record<number, string> = {
    0: "bg-slate-700/60 text-slate-200 border border-slate-600",
    1: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    2: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    3: "bg-rose-500/20 text-rose-300 border border-rose-500/30",
    4: "bg-red-500/20 text-red-300 border border-red-500/30",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
        styleMap[value] ?? styleMap[0]
      }`}
    >
      {QUOTE_STATUS_LABEL[value] ?? "Unknown"}
    </span>
  );
}
