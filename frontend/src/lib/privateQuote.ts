import { ethers } from "ethers";
import type { BrowserProvider, JsonRpcSigner, ContractRunner } from "ethers";
import { QuoteStatus, type QuoteView } from "./privateQuoteTypes";
import PrivateMerchantQuoteABI from "../abi/PrivateMerchantQuote.json";

const DEFAULT_ARB_SEPOLIA_CHAIN_ID = 421614;
const DEFAULT_ARB_SEPOLIA_CHAIN_ID_HEX = "0x66eee";
const DEFAULT_ARB_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";

type PrivateQuoteRuntimeConfig = {
  address: string;
  chainId: number;
  chainIdHex: string;
  chainName: string;
  rpcUrls: string[];
};

let runtimeConfigPromise: Promise<PrivateQuoteRuntimeConfig> | null = null;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function toChainHex(chainId: number): string {
  return `0x${Number(chainId).toString(16)}`;
}

function resolveChainName(chainId: number): string {
  if (chainId === DEFAULT_ARB_SEPOLIA_CHAIN_ID) {
    return "Arbitrum Sepolia";
  }

  if (chainId === 31337) {
    return "Anvil Local";
  }

  return `Chain ${chainId}`;
}

function resolveRpcUrls(chainId: number): string[] {
  const envRpc = String(import.meta.env.VITE_PRIVATE_QUOTE_RPC_URL || "").trim();

  if (envRpc) {
    return [envRpc];
  }

  if (chainId === DEFAULT_ARB_SEPOLIA_CHAIN_ID) {
    return [DEFAULT_ARB_SEPOLIA_RPC_URL];
  }

  if (chainId === 31337) {
    return ["http://127.0.0.1:8545"];
  }

  return [DEFAULT_ARB_SEPOLIA_RPC_URL];
}

function createRuntimeConfig(address: string, chainId: number): PrivateQuoteRuntimeConfig {
  return {
    address,
    chainId,
    chainIdHex: toChainHex(chainId),
    chainName: resolveChainName(chainId),
    rpcUrls: resolveRpcUrls(chainId),
  };
}

async function loadPrivateQuoteRuntimeConfig({
  refresh = false,
}: {
  refresh?: boolean;
} = {}): Promise<PrivateQuoteRuntimeConfig> {
  if (!runtimeConfigPromise || refresh) {
    runtimeConfigPromise = (async () => {
      const envAddress = String(import.meta.env.VITE_PRIVATE_QUOTE_CONTRACT || "").trim();
      const envChainId = normalizePositiveInteger(
        import.meta.env.VITE_PRIVATE_QUOTE_CHAIN_ID,
        DEFAULT_ARB_SEPOLIA_CHAIN_ID,
      );

      try {
        const response = await fetch(`/deployment-private-quote.json?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (response.ok) {
          const payload = await response.json();
          const rawAddress = String(
            payload?.contracts?.PrivateMerchantQuote ||
              payload?.ui?.addresses?.privateQuote ||
              payload?.privateQuote ||
              payload?.address ||
              envAddress,
          ).trim();

          if (rawAddress) {
            return createRuntimeConfig(
              ethers.getAddress(rawAddress),
              normalizePositiveInteger(payload?.chainId, envChainId),
            );
          }
        }
      } catch (error) {
        error;
      }

      if (envAddress) {
        return createRuntimeConfig(ethers.getAddress(envAddress), envChainId);
      }

      throw new Error(
        "Private quote deployment manifest is not available. Set VITE_PRIVATE_QUOTE_CONTRACT or publish deployment-private-quote.json first.",
      );
    })();
  }

  return runtimeConfigPromise;
}

export async function ensureCorrectNetwork() {
  if (!(window as any).ethereum) {
    throw new Error("Wallet not found");
  }

  const config = await loadPrivateQuoteRuntimeConfig();
  const chainId = await (window as any).ethereum.request({
    method: "eth_chainId",
  });

  if (String(chainId).toLowerCase() === config.chainIdHex.toLowerCase()) {
    return;
  }

  try {
    await (window as any).ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.chainIdHex }],
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await (window as any).ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: config.chainIdHex,
            chainName: config.chainName,
            rpcUrls: config.rpcUrls,
            nativeCurrency: {
              name: "ETH",
              symbol: "ETH",
              decimals: 18,
            },
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

export async function getBrowserProvider(): Promise<BrowserProvider> {
  if (!(window as any).ethereum) {
    throw new Error("Wallet not found");
  }

  return new ethers.BrowserProvider((window as any).ethereum);
}

export async function getSigner(): Promise<JsonRpcSigner> {
  const provider = await getBrowserProvider();
  return provider.getSigner();
}

export async function getPrivateQuoteContract(runner?: ContractRunner) {
  const config = await loadPrivateQuoteRuntimeConfig();

  if (runner) {
    return new ethers.Contract(config.address, PrivateMerchantQuoteABI, runner);
  }

  const provider = await getBrowserProvider();
  return new ethers.Contract(config.address, PrivateMerchantQuoteABI, provider);
}

export function encryptAmountBootstrap(amount: number): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`enc_amount_${amount}`));
}

export function buildQuoteId(debugFixed = false): string {
  if (debugFixed) {
    return "0x1111111111111111111111111111111111111111111111111111111111111111";
  }

  return ethers.keccak256(ethers.toUtf8Bytes(`${Date.now()}_${Math.random()}`));
}

export async function createPrivateQuote(params: {
  amount: number;
  payer: string;
  shortExpiry?: boolean;
  fixedQuoteId?: boolean;
}) {
  await ensureCorrectNetwork();

  const signer = await getSigner();
  const provider = await getBrowserProvider();
  const contract = await getPrivateQuoteContract(signer);

  const id = buildQuoteId(!!params.fixedQuoteId);
  const amountCt = encryptAmountBootstrap(params.amount);

  const expiry = params.shortExpiry
    ? Math.floor(Date.now() / 1000) + 10
    : Math.floor(Date.now() / 1000) + 3600;

  const feeData = await provider.getFeeData();

  const tx = await contract.createQuote(id, params.payer, amountCt, expiry, {
    maxFeePerGas: (feeData.maxFeePerGas ?? 30_000_000n) * 2n,
    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000n) * 2n,
  });

  await tx.wait();

  return {
    id,
    amountCt,
    expiry,
    paymentLink: `${window.location.origin}/pay/${id}`,
    txHash: tx.hash,
  };
}

export async function getPrivateQuote(id: string): Promise<QuoteView> {
  const contract = await getPrivateQuoteContract();
  const result = await contract.getQuote(id);

  return {
    merchant: result[0],
    payer: result[1],
    expiresAt: Number(result[2]),
    status: Number(result[3]) as QuoteStatus,
    accessGranted: Boolean(result[4]),
  };
}

export async function settlePrivateQuote(id: string, skipPreview = true) {
  await ensureCorrectNetwork();

  const signer = await getSigner();
  const provider = await getBrowserProvider();
  const contract = await getPrivateQuoteContract(signer);

  const feeData = await provider.getFeeData();

  const tx = await contract.settleQuote(id, skipPreview, {
    maxFeePerGas: (feeData.maxFeePerGas ?? 30_000_000n) * 2n,
    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000n) * 2n,
  });

  await tx.wait();

  return {
    txHash: tx.hash,
  };
}

export async function grantPrivateQuoteAccess(id: string, payer: string) {
  await ensureCorrectNetwork();

  const signer = await getSigner();
  const provider = await getBrowserProvider();
  const contract = await getPrivateQuoteContract(signer);

  const feeData = await provider.getFeeData();

  const tx = await contract.grantAccess(id, payer, {
    maxFeePerGas: (feeData.maxFeePerGas ?? 30_000_000n) * 2n,
    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000n) * 2n,
  });

  await tx.wait();

  return {
    txHash: tx.hash,
  };
}

export function formatQuoteExpiry(unixTs: number) {
  return new Date(unixTs * 1000).toLocaleString();
}

export function isExpired(unixTs: number) {
  return Math.floor(Date.now() / 1000) > unixTs;
}

export function getReadableError(err: any) {
  const msg = String(err?.message || err || "");

  if (msg.includes("execution reverted")) {
    if (msg.includes("estimateGas")) {
      return "Transaction reverted. Possible causes: duplicate quote ID, invalid payer, or invalid state.";
    }
    return "Transaction reverted by contract.";
  }

  if (msg.includes("user rejected")) {
    return "Transaction was rejected in wallet.";
  }

  if (msg.includes("Wallet not found")) {
    return "Please install or unlock your wallet.";
  }

  if (msg.includes("deployment manifest is not available")) {
    return "Private quote deployment is not configured yet for this environment.";
  }

  return msg || "Unknown error";
}
