import { BrowserProvider, Contract, parseUnits } from "ethers";

const DEFAULT_HEXAPAY_EXECUTOR_CONTRACT =
  "0x7AD0bB5220E664A1057d101069c0309f9302c075";
const DEFAULT_PAYMENT_ASSET = {
  symbol: "USDC",
  decimals: 6,
  token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
};

const HEXAPAY_DOMAIN = {
  name: "HexaPay",
  version: "1",
  chainId: Number(import.meta.env.VITE_HEXAPAY_CHAIN_ID || 421614),
  verifyingContract:
    import.meta.env.VITE_HEXAPAY_EXECUTOR_CONTRACT ||
    DEFAULT_HEXAPAY_EXECUTOR_CONTRACT,
};

const PAYMENT_ASSET = {
  symbol:
    import.meta.env.VITE_HEXAPAY_PAYMENT_TOKEN_SYMBOL ||
    DEFAULT_PAYMENT_ASSET.symbol,
  decimals: Number(
    import.meta.env.VITE_HEXAPAY_PAYMENT_TOKEN_DECIMALS ||
      DEFAULT_PAYMENT_ASSET.decimals,
  ),
  token:
    import.meta.env.VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS ||
    import.meta.env.VITE_SETTLEMENT_TOKEN_ADDRESS ||
    DEFAULT_PAYMENT_ASSET.token,
};

const ERC20_ABI = [
  "function approve(address spender, uint256 value) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const PAYMENT_INTENT_TYPES = {
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

interface PaymentIntent {
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

interface ChallengeContext {
  actorId?: string;
  permitHash?: string;
  sessionId?: string;
  deviceFingerprintHash?: string;
}

interface ChallengeInput {
  requestId: string;
  receiptId: string;
  quoteId: string;
  merchantId: string;
  terminalId: string;
  amount: string;
  currency: string;
  payer: string;
  merchant: string;
  actorId?: string;
}

function getJsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function switchToArbSepolia(): Promise<void> {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x66eee" }], // 421614 in hex
    });
  } catch (switchError: any) {
    // This error code indicates that the chain has not been added to MetaMask
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x66eee",
              chainName: "Arbitrum Sepolia",
              nativeCurrency: {
                name: "ETH",
                symbol: "ETH",
                decimals: 18,
              },
              rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
              blockExplorerUrls: ["https://sepolia.arbiscan.io"],
            },
          ],
        });
      } catch (addError) {
        throw new Error("Failed to add Arbitrum Sepolia network to MetaMask");
      }
    } else {
      throw new Error("Please switch MetaMask to Arbitrum Sepolia");
    }
  }
}

export async function ensureArbSepolia(): Promise<void> {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }

  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== 421614) {
    await switchToArbSepolia();
  }
}

export function getArbSepoliaExplorerTxUrl(txHash: string): string {
  if (!txHash) return "";
  return `https://sepolia.arbiscan.io/tx/${txHash}`;
}

export function getPaymentIntentExecutorAddress(): string {
  return String(HEXAPAY_DOMAIN.verifyingContract || "");
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: getJsonHeaders(headers),
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`) as any;
    error.code = data.code || "request_failed";
    error.details = data.details || null;
    throw error;
  }

  return data;
}

export async function getConnectedWalletAddress(): Promise<string> {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return signer.getAddress();
}

export async function signPaymentIntent(intent: PaymentIntent, domain: Record<string, unknown> = HEXAPAY_DOMAIN): Promise<string> {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return signer.signTypedData(domain, PAYMENT_INTENT_TYPES, intent);
}

export async function ensurePaymentTokenApproval(humanAmount: string): Promise<any> {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }

  const executorAddress = getPaymentIntentExecutorAddress();
  if (!executorAddress) {
    throw new Error("Executor address is not configured");
  }

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const owner = await signer.getAddress();
  const token = new Contract(PAYMENT_ASSET.token, ERC20_ABI, signer);
  const amount = parseUnits(String(humanAmount), PAYMENT_ASSET.decimals);

  const allowance = await token.allowance(owner, executorAddress);
  if (allowance >= amount) {
    return { approved: true, skipped: true };
  }

  const tx = await token.approve(executorAddress, amount);
  await tx.wait();

  return { approved: true, skipped: false, txHash: tx.hash };
}

export async function createPaymentChallenge(input: ChallengeInput, context: ChallengeContext = {}): Promise<any> {
  return postJson(
    "/api/payments/challenges",
    input,
    {
      ...(context.permitHash ? { "x-receipt-permit-hash": context.permitHash } : {}),
      ...(context.sessionId ? { "x-session-id": context.sessionId } : {}),
      ...(context.deviceFingerprintHash
        ? { "x-device-fingerprint-hash": context.deviceFingerprintHash }
        : {}),
      ...(context.actorId ? { "x-actor-id": context.actorId } : {}),
    },
  );
}

export async function executeSignedIntent(intent: PaymentIntent, signature: string): Promise<any> {
  return postJson("/api/payments/execute", {
    intent,
    signature,
  });
}

export function buildPaymentIntent({
  challengeId,
  requestId,
  receiptId,
  quoteId,
  merchantId,
  terminalId,
  payer,
  merchant,
  amount,
  currency,
  permitHash = "",
  sessionId = "",
  deviceFingerprintHash = "",
  expiresAtMs,
}: {
  challengeId: string;
  requestId: string;
  receiptId: string;
  quoteId: string;
  merchantId: string;
  terminalId: string;
  payer: string;
  merchant: string;
  amount: string;
  currency: string;
  permitHash?: string;
  sessionId?: string;
  deviceFingerprintHash?: string;
  expiresAtMs: number;
}): PaymentIntent {
  const issuedAtMs = Date.now();

  return {
    challengeId: String(challengeId),
    requestId: String(requestId),
    receiptId: String(receiptId || ""),
    quoteId: String(quoteId || ""),
    merchantId: String(merchantId),
    terminalId: String(terminalId),
    payer,
    merchant,
    token: String(PAYMENT_ASSET.token),
    amount: String(parseUnits(String(amount), PAYMENT_ASSET.decimals)),
    currency: String(currency || PAYMENT_ASSET.symbol),
    decimals: String(PAYMENT_ASSET.decimals),
    permitHash: String(permitHash || ""),
    sessionId: String(sessionId || ""),
    deviceFingerprintHash: String(deviceFingerprintHash || ""),
    issuedAtMs: String(issuedAtMs),
    expiresAtMs: String(expiresAtMs),
  };
}

export function createRequestId(prefix = "req_ui"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
