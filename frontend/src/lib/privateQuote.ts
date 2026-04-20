import { ethers } from "ethers";
import type { BrowserProvider, JsonRpcSigner, ContractRunner } from "ethers";
import { QuoteStatus, type QuoteView } from "./privateQuoteTypes";
import PrivateMerchantQuoteABI from "../abi/PrivateMerchantQuote.json";

const CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const ANVIL_CHAIN_ID_HEX = "0x7a69";

export async function ensureCorrectNetwork() {
  if (!(window as any).ethereum) {
    throw new Error("Wallet not found");
  }

  const chainId = await (window as any).ethereum.request({
    method: "eth_chainId",
  });

  if (chainId === ANVIL_CHAIN_ID_HEX) return;

  try {
    await (window as any).ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ANVIL_CHAIN_ID_HEX }],
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await (window as any).ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ANVIL_CHAIN_ID_HEX,
            chainName: "Anvil Local",
            rpcUrls: ["http://127.0.0.1:8545"],
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
  if (runner) {
    return new ethers.Contract(CONTRACT_ADDRESS, PrivateMerchantQuoteABI, runner);
  }

  const provider = await getBrowserProvider();
  return new ethers.Contract(CONTRACT_ADDRESS, PrivateMerchantQuoteABI, provider);
}

export function encryptAmountBootstrap(amount: number): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`enc_amount_${amount}`));
}

export function buildQuoteId(debugFixed = false): string {
  if (debugFixed) {
    return "0x1111111111111111111111111111111111111111111111111111111111111111";
  }

  return ethers.keccak256(
    ethers.toUtf8Bytes(`${Date.now()}_${Math.random()}`)
  );
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

  const tx = await contract.createQuote(
    id,
    params.payer,
    amountCt,
    expiry,
    {
      maxFeePerGas: (feeData.maxFeePerGas ?? 30_000_000n) * 2n,
      maxPriorityFeePerGas:
        (feeData.maxPriorityFeePerGas ?? 1_000_000n) * 2n,
    }
  );

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

  return msg || "Unknown error";
}
