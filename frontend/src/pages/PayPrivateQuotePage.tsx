import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import QuoteStatusBadge from "../components/PrivateQuotes/QuoteStatusBadge";
import {
  getPrivateQuote,
  settlePrivateQuote,
  formatQuoteExpiry,
  getReadableError,
  isExpired,
} from "../lib/privateQuote";
import { QuoteStatus, type QuoteView } from "../lib/privateQuoteTypes";

export default function PayPrivateQuotePage() {
  const { id } = useParams();
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [txHash, setTxHash] = useState("");

  async function loadQuote() {
    if (!id) {
      setError("Missing quote ID");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const data = await getPrivateQuote(id);
      setQuote(data);
    } catch (err: any) {
      setError(getReadableError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePay() {
    if (!id || !quote) return;

    try {
      setPaying(true);
      setError("");
      setSuccess("");
      setTxHash("");

      const result = await settlePrivateQuote(id, true);

      setTxHash(result.txHash);
      setSuccess("Payment processed successfully.");

      await loadQuote();
    } catch (err: any) {
      setError(getReadableError(err));
    } finally {
      setPaying(false);
    }
  }

  useEffect(() => {
    loadQuote();
  }, [id]);

  const expired = useMemo(() => {
    if (!quote) return false;
    return isExpired(quote.expiresAt);
  }, [quote]);

  const canPay = useMemo(() => {
    if (!quote) return false;
    if (quote.status !== QuoteStatus.Pending) return false;
    if (expired) return false;
    return true;
  }, [quote, expired]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="text-sm uppercase tracking-widest text-cyan-400">
          Private Quote Payment
        </div>
        <h1 className="text-3xl font-semibold text-white">
          Pay Private Quote
        </h1>
        <p className="mt-2 text-slate-400">
          Complete the payment without exposing amount details publicly.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
        {loading && (
          <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-slate-300">
            Loading quote...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <div className="font-semibold">Error</div>
            <div className="mt-1 text-sm break-words">{error}</div>
          </div>
        )}

        {!loading && quote && (
          <>
            {success && (
              <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100">
                <div className="font-semibold text-emerald-300">
                  Payment Successful
                </div>
                <div className="mt-1 text-sm">{success}</div>

                {txHash && (
                  <div className="mt-3">
                    <div className="mb-1 text-sm text-slate-300">
                      Transaction Hash
                    </div>
                    <div className="break-all rounded-lg bg-slate-950/60 p-3 text-sm text-white">
                      {txHash}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5">
              <div className="mb-4 text-xl font-semibold text-white">
                Quote Details
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-sm text-slate-400">Merchant</div>
                  <div className="break-all text-white">{quote.merchant}</div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Payer</div>
                  <div className="break-all text-white">{quote.payer}</div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Status</div>
                  <div className="mt-1">
                    <QuoteStatusBadge status={quote.status} />
                  </div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Expires</div>
                  <div className="text-white">
                    {formatQuoteExpiry(quote.expiresAt)}
                    {expired && (
                      <span className="ml-2 text-red-300">(Expired)</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Access Granted</div>
                  <div className="text-white">
                    {quote.accessGranted ? "Yes" : "No"}
                  </div>
                </div>
              </div>
            </div>

            {!canPay && (
              <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
                <div className="font-semibold">Cannot Pay</div>
                <div className="mt-1 text-sm">
                  {quote.status !== QuoteStatus.Pending
                    ? "Quote is not in pending status."
                    : expired
                    ? "Quote has expired."
                    : "Payment is not available for this quote."}
                </div>
              </div>
            )}

            {canPay && (
              <>
                <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
                  <div className="font-semibold text-amber-300">
                    Bootstrap Mode
                  </div>
                  <div className="mt-1 text-sm">
                    Amount is currently protected with hash-based mock
                    encryption. Payment is processed as blind payment for local
                    validation.
                  </div>
                </div>

                <div className="mt-6">
                  <button
                    onClick={handlePay}
                    disabled={paying}
                    className="w-full rounded-xl bg-emerald-500 px-5 py-4 text-lg font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {paying ? "Processing Payment..." : "Pay Now"}
                  </button>
                </div>
              </>
            )}

            <div className="mt-6 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-cyan-100">
              <div className="font-semibold text-cyan-300">
                Privacy Guarantee
              </div>
              <div className="mt-1 text-sm">
                The payment amount is not exposed in public UI flow. Native FHE
                preview and permit-based reveal can be added in the next phase.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
