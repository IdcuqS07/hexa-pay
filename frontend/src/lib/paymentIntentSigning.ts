import { BrowserProvider } from "ethers";

const DEFAULT_HEXAPAY_EXECUTOR_CONTRACT =
  "0x7AD0bB5220E664A1057d101069c0309f9302c075";

const domain = {
  name: "HexaPay",
  version: "1",
  chainId: 421614, // Arbitrum Sepolia
  verifyingContract:
    import.meta.env.VITE_HEXAPAY_EXECUTOR_CONTRACT ||
    DEFAULT_HEXAPAY_EXECUTOR_CONTRACT,
};

const types = {
  PaymentIntent: [
    { name: "challengeId", type: "string" },
    { name: "requestId", type: "string" },
    { name: "receiptId", type: "string" },
    { name: "quoteId", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "terminalId", type: "string" },
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "currency", type: "string" },
    { name: "decimals", type: "uint8" },
    { name: "permitHash", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "deviceFingerprintHash", type: "string" },
    { name: "issuedAtMs", type: "uint256" },
    { name: "expiresAtMs", type: "uint256" },
  ],
};

export interface PaymentIntent {
  challengeId: string;
  requestId: string;
  receiptId: string;
  quoteId: string;
  merchantId: string;
  terminalId: string;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  currency: string;
  decimals: string;
  permitHash: string;
  sessionId: string;
  deviceFingerprintHash: string;
  issuedAtMs: string;
  expiresAtMs: string;
}

export async function signPaymentIntent(
  intent: PaymentIntent,
  overrideDomain: Record<string, unknown> = domain,
): Promise<string> {
  if (!window.ethereum) {
    throw new Error("No Ethereum provider found");
  }

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  return signer.signTypedData(overrideDomain, types, intent);
}

export async function createPaymentChallenge(params: {
  requestId: string;
  receiptId: string;
  quoteId?: string;
  merchantId: string;
  terminalId: string;
  amount: string;
  currency: string;
  payer: string;
  merchant: string;
}): Promise<PaymentIntent> {
  const response = await fetch("/api/payments/challenges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error("Failed to create payment challenge");
  }

  const payload = await response.json();
  return payload?.record || payload?.challenge || payload;
}

export async function executeSignedIntent(intent: PaymentIntent, signature: string) {
  const response = await fetch("/api/payments/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent,
      signature,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Payment execution failed");
  }

  return response.json();
}
