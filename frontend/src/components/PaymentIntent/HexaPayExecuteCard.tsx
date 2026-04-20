import { useMemo, useState } from "react";
import {
  buildPaymentIntent,
  createPaymentChallenge,
  createRequestId,
  ensurePaymentTokenApproval,
  executeSignedIntent,
  getArbSepoliaExplorerTxUrl,
  getConnectedWalletAddress,
  signPaymentIntent,
  ensureArbSepolia,
} from "../../lib/paymentUiClient";

function shortHash(value: string): string {
  if (!value) return "-";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    idle: "border-slate-700 text-slate-300",
    connecting_wallet: "border-cyan-500/30 text-cyan-300",
    switching_network: "border-cyan-500/30 text-cyan-300",
    creating_challenge: "border-cyan-500/30 text-cyan-300",
    signing_intent: "border-violet-500/30 text-violet-300",
    executing_payment: "border-amber-500/30 text-amber-300",
    success: "border-emerald-500/30 text-emerald-300",
    error: "border-rose-500/30 text-rose-300",
  };

  return (
    <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${styles[status] || styles.idle}`}>
      {status.split("_").join(" ")}
    </div>
  );
}

interface StepItemProps {
  label: string;
  active: boolean;
  done: boolean;
}

function StepItem({ label, active, done }: StepItemProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold",
          done
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            : active
            ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
            : "border-slate-700 bg-slate-900 text-slate-500",
        ].join(" ")}
      >
        {done ? "✓" : "•"}
      </div>
      <div className={done || active ? "text-white" : "text-slate-500"}>{label}</div>
    </div>
  );
}

interface HexaPayExecuteCardProps {
  permitHash?: string;
  sessionId?: string;
  deviceFingerprintHash?: string;
  defaultMerchantId?: string;
  defaultTerminalId?: string;
  defaultReceiptId?: string;
  defaultQuoteId?: string;
  defaultMerchantAddress?: string;
  defaultAmount?: string;
  defaultCurrency?: string;
}

export default function HexaPayExecuteCard({
  permitHash = "",
  sessionId = "sess_demo_ui",
  deviceFingerprintHash = "dev_demo_hash",
  defaultMerchantId = "",
  defaultTerminalId = "",
  defaultReceiptId = "",
  defaultQuoteId = "",
  defaultMerchantAddress = "",
  defaultAmount = "",
  defaultCurrency = "USDC",
}: HexaPayExecuteCardProps) {
  const [merchantId, setMerchantId] = useState(defaultMerchantId);
  const [terminalId, setTerminalId] = useState(defaultTerminalId);
  const [receiptId, setReceiptId] = useState(defaultReceiptId);
  const [quoteId, setQuoteId] = useState(defaultQuoteId);
  const [merchantAddress, setMerchantAddress] = useState(defaultMerchantAddress);
  const [amount, setAmount] = useState(defaultAmount);
  const [currency, setCurrency] = useState(defaultCurrency);

  const [payerAddress, setPayerAddress] = useState("");
  const [requestId, setRequestId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [signature, setSignature] = useState("");
  const [txHash, setTxHash] = useState("");
  const [blockNumber, setBlockNumber] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const explorerUrl = useMemo(() => getArbSepoliaExplorerTxUrl(txHash), [txHash]);

  async function handleExecute() {
    setError("");
    setSignature("");
    setTxHash("");
    setBlockNumber("");

    try {
      setStatus("connecting_wallet");
      const payer = await getConnectedWalletAddress();
      setPayerAddress(payer);

      setStatus("switching_network");
      await ensureArbSepolia();

      const nextRequestId = createRequestId("req_hexapay");
      setRequestId(nextRequestId);

      setStatus("creating_challenge");
      const challengeResponse = await createPaymentChallenge(
        {
          requestId: nextRequestId,
          receiptId,
          quoteId,
          merchantId,
          terminalId,
          amount,
          currency,
          payer,
          merchant: merchantAddress,
          actorId: payer,
        },
        {
          actorId: payer,
          permitHash,
          sessionId,
          deviceFingerprintHash,
        },
      );

      const record = challengeResponse?.record || challengeResponse?.challenge || challengeResponse;
      const nextChallengeId = record?.challengeId || null;
      const expiresAtMs = record?.expiresAtMs || null;

      if (!nextChallengeId || !expiresAtMs) {
        throw new Error("Challenge response tidak lengkap.");
      }

      setChallengeId(nextChallengeId);

      const intent = buildPaymentIntent({
        challengeId: nextChallengeId,
        requestId: nextRequestId,
        receiptId,
        quoteId,
        merchantId,
        terminalId,
        payer,
        merchant: merchantAddress,
        amount,
        currency,
        permitHash,
        sessionId,
        deviceFingerprintHash,
        expiresAtMs,
      });

      setStatus("signing_intent");
      const signed = await signPaymentIntent(intent, record?.domain || undefined);
      setSignature(signed);

      setStatus("executing_payment");
      await ensurePaymentTokenApproval(amount);
      const executeResponse = await executeSignedIntent(intent, signed);

      setTxHash(executeResponse?.txHash || "");
      setBlockNumber(String(executeResponse?.blockNumber || ""));
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Payment execution gagal.");
    }
  }

  const stepState = {
    wallet: ["creating_challenge", "signing_intent", "executing_payment", "success"].includes(status),
    challenge: ["signing_intent", "executing_payment", "success"].includes(status),
    signing: ["executing_payment", "success"].includes(status),
    execute: ["success"].includes(status),
  };

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-cyan-400/10 bg-[#07111f] p-6 shadow-[0_0_60px_rgba(34,211,238,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(168,85,247,0.10),transparent_35%)]" />

      <div className="relative z-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-cyan-400/15 bg-cyan-400/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-cyan-300">
              HexaPay Payment Rail
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Execute payment on Arbitrum Sepolia
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Secure flow: challenge creation, EIP-712 signature, and onchain execution through the live HexaPay executor.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <div className="rounded-2xl border border-cyan-400/10 bg-cyan-400/5 px-4 py-3 text-right">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Network</div>
              <div className="text-sm font-medium text-white">Arbitrum Sepolia</div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="rounded-[24px] border border-slate-800 bg-black/20 p-5">
            <div className="mb-4 text-sm font-medium text-white">Payment Request</div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Merchant ID</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Terminal ID</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Receipt ID</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={receiptId}
                  onChange={(e) => setReceiptId(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Quote ID</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={quoteId}
                  onChange={(e) => setQuoteId(e.target.value)}
                />
              </label>

              <label className="block md:col-span-2">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Merchant Address</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={merchantAddress}
                  onChange={(e) => setMerchantAddress(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Amount</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Currency</div>
                <input
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-white outline-none"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExecute}
                disabled={["connecting_wallet", "switching_network", "creating_challenge", "signing_intent", "executing_payment"].includes(status)}
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "connecting_wallet" && "Connecting wallet..."}
                {status === "switching_network" && "Switching network..."}
                {status === "creating_challenge" && "Creating challenge..."}
                {status === "signing_intent" && "Waiting for signature..."}
                {status === "executing_payment" && "Executing onchain..."}
                {!["connecting_wallet", "switching_network", "creating_challenge", "signing_intent", "executing_payment"].includes(status) && "Execute Payment"}
              </button>

              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-5 py-3 font-medium text-cyan-300 transition hover:bg-cyan-400/10"
                >
                  View on Arbiscan
                </a>
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[24px] border border-slate-800 bg-black/20 p-5">
              <div className="mb-4 text-sm font-medium text-white">Execution Flow</div>
              <div className="space-y-4">
                <StepItem label="Wallet connected" active={status === "connecting_wallet"} done={stepState.wallet} />
                <StepItem label="Challenge created" active={status === "creating_challenge"} done={stepState.challenge} />
                <StepItem label="Intent signed" active={status === "signing_intent"} done={stepState.signing} />
                <StepItem label="Payment executed" active={status === "executing_payment"} done={stepState.execute} />
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-800 bg-black/20 p-5">
              <div className="mb-4 text-sm font-medium text-white">Execution Details</div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Payer</span>
                  <span className="text-right text-white">{payerAddress ? shortHash(payerAddress) : "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Request ID</span>
                  <span className="text-right text-white">{requestId ? shortHash(requestId) : "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Challenge ID</span>
                  <span className="text-right text-white">{challengeId ? shortHash(challengeId) : "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Signature</span>
                  <span className="text-right text-white">{signature ? shortHash(signature) : "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Tx Hash</span>
                  <span className="text-right text-white">{txHash ? shortHash(txHash) : "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Block Number</span>
                  <span className="text-right text-white">{blockNumber || "-"}</span>
                </div>
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}

              {status === "success" ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  Payment executed successfully on Arbitrum Sepolia.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
