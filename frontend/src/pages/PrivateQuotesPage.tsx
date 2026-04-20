import { useMemo, useState } from "react";
import {
  createPrivateQuote,
  getReadableError,
} from "../lib/privateQuote";

export default function PrivateQuotesPage() {
  const [amount, setAmount] = useState("1");
  const [payer, setPayer] = useState("");
  const [loading, setLoading] = useState(false);

  const [quoteId, setQuoteId] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");

  // debug flags for local testing only
  const [shortExpiry, setShortExpiry] = useState(false);
  const [fixedQuoteId, setFixedQuoteId] = useState(false);

  const canSubmit = useMemo(() => {
    return Number(amount) > 0 && payer.trim().length > 0 && !loading;
  }, [amount, payer, loading]);

  async function handleCreateQuote() {
    try {
      setLoading(true);
      setError("");
      setQuoteId("");
      setPaymentLink("");
      setTxHash("");

      const result = await createPrivateQuote({
        amount: Number(amount),
        payer,
        shortExpiry,
        fixedQuoteId,
      });

      setQuoteId(result.id);
      setPaymentLink(result.paymentLink);
      setTxHash(result.txHash);
    } catch (err: any) {
      setError(getReadableError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyLink() {
    if (!paymentLink) return;
    await navigator.clipboard.writeText(paymentLink);
    alert("Payment link copied");
  }

  function resetForm() {
    setQuoteId("");
    setPaymentLink("");
    setTxHash("");
    setError("");
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="text-sm uppercase tracking-widest text-cyan-400">
          Private Quotes
        </div>
        <h1 className="text-3xl font-semibold text-white">
          Create Private Quote
        </h1>
        <p className="mt-2 text-slate-400">
          Create a private payment request without changing the existing HexaPay
          flows.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <div className="mb-2 text-sm text-slate-300">Amount</div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none"
              placeholder="Enter amount"
            />
          </label>

          <label className="block">
            <div className="mb-2 text-sm text-slate-300">Payer Address</div>
            <input
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none"
              placeholder="0x..."
            />
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="font-medium text-amber-300">Bootstrap Mode</div>
          <div className="mt-2 text-sm text-slate-300">
            Amount is still using hash-based mock encryption. Native FHE upgrade
            comes next.
          </div>

          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={shortExpiry}
                onChange={(e) => setShortExpiry(e.target.checked)}
              />
              Debug short expiry
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={fixedQuoteId}
                onChange={(e) => setFixedQuoteId(e.target.checked)}
              />
              Debug fixed quote ID
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={handleCreateQuote}
            disabled={!canSubmit}
            className="rounded-xl bg-cyan-500 px-5 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Quote"}
          </button>

          <button
            onClick={resetForm}
            className="rounded-xl border border-slate-700 px-5 py-3 font-medium text-slate-200"
          >
            Reset
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <div className="font-semibold">Error</div>
            <div className="mt-1 text-sm break-words">{error}</div>
          </div>
        )}

        {quoteId && (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100">
            <div className="font-semibold text-emerald-300">
              Quote created successfully
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <div className="mb-1 text-slate-300">Quote ID</div>
                <div className="break-all rounded-lg bg-slate-950/60 p-3 text-white">
                  {quoteId}
                </div>
              </div>

              <div>
                <div className="mb-1 text-slate-300">Payment Link</div>
                <div className="break-all rounded-lg bg-slate-950/60 p-3 text-white">
                  {paymentLink}
                </div>
              </div>

              <div>
                <div className="mb-1 text-slate-300">Transaction Hash</div>
                <div className="break-all rounded-lg bg-slate-950/60 p-3 text-white">
                  {txHash}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={handleCopyLink}
                className="rounded-xl bg-emerald-500 px-4 py-2 font-medium text-slate-950"
              >
                Copy Payment Link
              </button>

              <a
                href={paymentLink}
                className="rounded-xl border border-emerald-400/30 px-4 py-2 font-medium text-emerald-200"
              >
                Open Payment Page
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
