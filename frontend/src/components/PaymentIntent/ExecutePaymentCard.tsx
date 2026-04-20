import { useMemo, useState } from "react";
import {
  buildPaymentIntent,
  createPaymentChallenge,
  createRequestId,
  ensurePaymentTokenApproval,
  executeSignedIntent,
  getConnectedWalletAddress,
  signPaymentIntent,
  ensureArbSepolia,
} from "../../lib/paymentUiClient";

function maskHash(value: string): string {
  if (!value) return "-";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

interface ExecutePaymentCardProps {
  defaultMerchantId?: string;
  defaultTerminalId?: string;
  defaultReceiptId?: string;
  defaultQuoteId?: string;
  defaultMerchantAddress?: string;
  defaultAmount?: string;
  defaultCurrency?: string;
  permitHash?: string;
  sessionId?: string;
  deviceFingerprintHash?: string;
}

export default function ExecutePaymentCard({
  defaultMerchantId = "",
  defaultTerminalId = "",
  defaultReceiptId = "",
  defaultQuoteId = "",
  defaultMerchantAddress = "",
  defaultAmount = "",
  defaultCurrency = "USDC",
  permitHash = "",
  sessionId = "sess_demo_ui",
  deviceFingerprintHash = "dev_demo_hash",
}: ExecutePaymentCardProps) {
  const [merchantId, setMerchantId] = useState(defaultMerchantId);
  const [terminalId, setTerminalId] = useState(defaultTerminalId);
  const [receiptId, setReceiptId] = useState(defaultReceiptId);
  const [quoteId, setQuoteId] = useState(defaultQuoteId);
  const [merchantAddress, setMerchantAddress] = useState(defaultMerchantAddress);
  const [amount, setAmount] = useState(defaultAmount);
  const [currency, setCurrency] = useState(defaultCurrency);

  const [payerAddress, setPayerAddress] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [signature, setSignature] = useState("");
  const [txHash, setTxHash] = useState("");
  const [blockNumber, setBlockNumber] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const canExecute = useMemo(() => {
    return merchantId && terminalId && receiptId && merchantAddress && amount && currency;
  }, [merchantId, terminalId, receiptId, merchantAddress, amount, currency]);

  async function handleExecute() {
    setError("");
    setTxHash("");
    setBlockNumber("");
    setSignature("");

    try {
      if (!canExecute) {
        throw new Error("Lengkapi data payment dulu.");
      }

      setStatus("connecting_wallet");
      const payer = await getConnectedWalletAddress();
      setPayerAddress(payer);

      // Ensure wallet is on Arbitrum Sepolia
      setStatus("switching_network");
      await ensureArbSepolia();

      const nextRequestId = createRequestId();
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

      console.log("Challenge response:", challengeResponse);

      const record = challengeResponse?.record || challengeResponse?.challenge || challengeResponse;
      console.log("Extracted record:", record);
      
      const nextChallengeId = record.challengeId;
      const expiresAtMs = record.expiresAtMs;

      console.log("Challenge ID:", nextChallengeId, "Expires:", expiresAtMs);

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

      setTxHash(executeResponse.txHash || "");
      setBlockNumber(executeResponse.blockNumber || "");
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Payment execution gagal.");
    }
  }

  return (
    <div className="rounded-3xl border border-cyan-500/20 bg-slate-950/60 p-6 shadow-xl">
      <div className="mb-4">
        <div className="text-xs uppercase tracking-[0.25em] text-cyan-400">
          Payment Intent Demo
        </div>
        <h3 className="mt-2 text-2xl font-semibold text-white">
          Execute payment on Arbitrum Sepolia
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          Flow: create challenge → sign EIP-712 intent → execute onchain.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-sm text-slate-300">Merchant ID</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="mb-1 text-sm text-slate-300">Terminal ID</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={terminalId}
            onChange={(e) => setTerminalId(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="mb-1 text-sm text-slate-300">Receipt ID</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={receiptId}
            onChange={(e) => setReceiptId(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="mb-1 text-sm text-slate-300">Quote ID</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={quoteId}
            onChange={(e) => setQuoteId(e.target.value)}
          />
        </label>

        <label className="block md:col-span-2">
          <div className="mb-1 text-sm text-slate-300">Merchant Address</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={merchantAddress}
            onChange={(e) => setMerchantAddress(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="mb-1 text-sm text-slate-300">Amount</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="mb-1 text-sm text-slate-300">Currency</div>
          <input
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleExecute}
          disabled={!canExecute || ["connecting_wallet", "switching_network", "creating_challenge", "signing_intent", "executing_payment"].includes(status)}
          className="rounded-2xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "connecting_wallet" && "Connecting wallet..."}
          {status === "switching_network" && "Switching to Arbitrum Sepolia..."}
          {status === "creating_challenge" && "Creating challenge..."}
          {status === "signing_intent" && "Waiting for signature..."}
          {status === "executing_payment" && "Executing onchain..."}
          {!["connecting_wallet", "switching_network", "creating_challenge", "signing_intent", "executing_payment"].includes(status) && "Execute Payment"}
        </button>

        <div className="rounded-2xl border border-slate-700 px-4 py-3 text-sm text-slate-300">
          Status: <span className="font-medium text-white">{status}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
        <div className="text-slate-300">
          Payer: <span className="text-white">{payerAddress || "-"}</span>
        </div>
        <div className="text-slate-300">
          Request ID: <span className="text-white">{requestId || "-"}</span>
        </div>
        <div className="text-slate-300">
          Challenge ID: <span className="text-white">{challengeId || "-"}</span>
        </div>
        <div className="text-slate-300">
          Signature: <span className="text-white">{signature ? maskHash(signature) : "-"}</span>
        </div>
        <div className="text-slate-300">
          Tx Hash: <span className="text-white">{txHash || "-"}</span>
        </div>
        <div className="text-slate-300">
          Block Number: <span className="text-white">{blockNumber || "-"}</span>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-200">
            {error}
          </div>
        ) : null}

        {status === "success" ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-200">
            Payment executed successfully on Arbitrum Sepolia.
          </div>
        ) : null}
      </div>
    </div>
  );
}
