const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeLowerString(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeAddress(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return "";
  }

  try {
    return ethers.getAddress(raw);
  } catch {
    return "";
  }
}

function normalizePositiveInteger(value, fallback = 0) {
  return Math.max(0, Number.parseInt(String(value || fallback), 10) || 0);
}

function isInvoiceAccessRestrictedError(error) {
  if (!error) {
    return false;
  }

  const code = normalizeLowerString(error.code);
  const details = [
    error.shortMessage,
    error.message,
    error.reason,
    error.errorName,
    error.revert?.name,
    error.info?.error?.message,
    error.data?.message,
  ]
    .map((value) => normalizeLowerString(value))
    .join(" ");

  return (
    code === "call_exception" &&
    (details.includes("noinvoiceaccess") || details.includes("no invoice access"))
  );
}

function loadDeploymentManifest({
  manifest = null,
  manifestPath = "",
  cwd = process.cwd(),
} = {}) {
  if (manifest && typeof manifest === "object") {
    return {
      manifest,
      manifestPath: normalizeString(manifestPath),
    };
  }

  const candidatePaths = [
    manifestPath,
    path.resolve(cwd, "deployment.json"),
    path.resolve(cwd, "public", "deployment.json"),
  ]
    .map((value) => normalizeString(value))
    .filter(Boolean);

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      const parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
      if (parsed && typeof parsed === "object") {
        return {
          manifest: parsed,
          manifestPath: candidatePath,
        };
      }
    } catch {
      // Ignore malformed local manifests and continue to the next candidate.
    }
  }

  return {
    manifest: null,
    manifestPath: "",
  };
}

function describeWorkflowInvoiceStatus(status) {
  switch (Number(status)) {
    case 0:
      return "PendingApproval";
    case 1:
      return "Approved";
    case 2:
      return "Rejected";
    case 3:
      return "PartiallyPaid";
    case 4:
      return "Paid";
    case 5:
      return "Cancelled";
    default:
      return "Unknown";
  }
}

function isWorkflowInvoicePayable(status) {
  const normalizedStatus = Number(status);
  return normalizedStatus === 1 || normalizedStatus === 3;
}

function resolveWorkflowContextConfig(options = {}) {
  const { manifest, manifestPath } = loadDeploymentManifest(options);
  const workflowAddress =
    normalizeAddress(options.workflowAddress) ||
    normalizeAddress(process.env.HEXAPAY_WORKFLOW_MODULE_ADDRESS) ||
    normalizeAddress(process.env.VITE_HEXAPAY_WORKFLOW_MODULE) ||
    normalizeAddress(manifest?.workflowModule) ||
    normalizeAddress(manifest?.ui?.addresses?.workflow) ||
    "";
  const coreAddress =
    normalizeAddress(options.coreAddress) ||
    normalizeAddress(process.env.HEXAPAY_ADDRESS) ||
    normalizeAddress(process.env.HEXAPAY_CORE_ADDRESS) ||
    normalizeAddress(process.env.VITE_HEXAPAY_CORE) ||
    normalizeAddress(manifest?.core) ||
    normalizeAddress(manifest?.hexaPay) ||
    normalizeAddress(manifest?.ui?.addresses?.core) ||
    "";

  return {
    manifest,
    manifestPath,
    workflowAddress,
    coreAddress,
  };
}

function createWorkflowInvoiceContextResolver(options = {}) {
  const workflowAbi = options.workflowAbi || [
    "function getInvoice(bytes32 invoiceId) view returns (address issuer, address payer, address company, uint64 createdAt, uint64 dueAt, bytes32 metadataHash, uint8 status, uint32 paymentCount)",
  ];
  const coreAbi = options.coreAbi || [
    "function isCompanyOperator(address company, address operator) view returns (bool)",
  ];
  const config = resolveWorkflowContextConfig(options);

  if (!config.workflowAddress || !config.coreAddress) {
    return null;
  }

  const provider =
    options.provider ||
    (options.rpcUrl || process.env.HEXAPAY_RECONCILIATION_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL
      ? new ethers.JsonRpcProvider(
          options.rpcUrl ||
            process.env.HEXAPAY_RECONCILIATION_RPC_URL ||
            process.env.ARB_SEPOLIA_RPC_URL,
        )
      : null);
  const signer =
    options.signer ||
    (provider &&
    (options.privateKey ||
      process.env.HEXAPAY_RECONCILIATION_PRIVATE_KEY ||
      process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY ||
      process.env.PRIVATE_KEY)
      ? new ethers.Wallet(
          options.privateKey ||
            process.env.HEXAPAY_RECONCILIATION_PRIVATE_KEY ||
            process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY ||
            process.env.PRIVATE_KEY,
          provider,
        )
      : null);
  const workflowRunner = signer || provider;

  if (!workflowRunner || !provider) {
    return null;
  }

  const workflow = new ethers.Contract(config.workflowAddress, workflowAbi, workflowRunner);
  const core = new ethers.Contract(config.coreAddress, coreAbi, provider);

  return async function resolveInvoiceContext(candidate = {}) {
    const invoiceId = normalizeString(candidate.invoiceId);
    if (!invoiceId) {
      return null;
    }

    let invoice = null;

    try {
      invoice = await workflow.getInvoice(invoiceId);
    } catch (error) {
      if (isInvoiceAccessRestrictedError(error)) {
        return null;
      }

      throw error;
    }

    const payer = normalizeAddress(invoice.payer);
    const company = normalizeAddress(invoice.company);
    const status = normalizePositiveInteger(invoice.status, 0);
    const paymentCount = normalizePositiveInteger(invoice.paymentCount, 0);
    const createdAt = normalizePositiveInteger(invoice.createdAt, 0);
    const dueAt = normalizePositiveInteger(invoice.dueAt, 0);
    const candidatePayer = normalizeAddress(candidate.payer);
    const allowedPayers = [];

    if (
      payer &&
      candidatePayer &&
      normalizeLowerString(payer) !== normalizeLowerString(candidatePayer)
    ) {
      const operatorMatch = await Promise.resolve(
        core.isCompanyOperator(payer, candidatePayer),
      ).catch(() => false);

      if (operatorMatch) {
        allowedPayers.push(candidatePayer);
      }
    }

    return {
      invoiceId,
      payer,
      company,
      merchant: company,
      allowedPayers,
      status,
      statusLabel: describeWorkflowInvoiceStatus(status),
      payable: isWorkflowInvoicePayable(status),
      paymentCount,
      createdAt,
      dueAt,
      source: "workflow_contract",
      manifestPath: config.manifestPath,
      workflowAddress: config.workflowAddress,
      coreAddress: config.coreAddress,
      readerAddress: signer ? await signer.getAddress() : "",
    };
  };
}

module.exports = {
  createWorkflowInvoiceContextResolver,
  describeWorkflowInvoiceStatus,
  isInvoiceAccessRestrictedError,
  isWorkflowInvoicePayable,
  loadDeploymentManifest,
  resolveWorkflowContextConfig,
};
