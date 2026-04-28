function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeLowerString(value) {
  return normalizeString(value).toLowerCase();
}

function toTitleCase(value) {
  return normalizeString(value)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatReconciliationReasonLabel(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return "";
  }

  return toTitleCase(normalized);
}

export function getReconciliationSemanticKey(state = "") {
  switch (normalizeLowerString(state)) {
    case "observed":
    case "eligible":
    case "submitted":
      return "observed";
    case "recorded":
      return "recorded";
    case "applied":
      return "applied";
    case "exception":
      return "needs_review";
    default:
      return "";
  }
}

const RECONCILIATION_STATUS_DEFINITIONS = {
  observed: {
    label: "Observed",
    meaning:
      "HexaPay detected the invoice-linked settlement, but workflow recording is not final yet.",
  },
  recorded: {
    label: "Recorded",
    meaning:
      "The external receipt is already recorded on workflow, but invoice accounting has not been applied yet.",
  },
  applied: {
    label: "Applied",
    meaning:
      "The external receipt is already applied to workflow accounting without debiting internal HexaPay balance.",
  },
  needs_review: {
    label: "Needs review",
    meaning:
      "Reconciliation could not advance automatically and now needs a human decision before retry or refund handling.",
  },
};

function isBackendFollowUpReason(reasonCode = "") {
  const normalized = normalizeLowerString(reasonCode);
  return (
    normalized === "provider_error" ||
    normalized === "tx_receipt_missing" ||
    normalized === "executor_read_failed" ||
    normalized === "bridge_record_failed" ||
    normalized === "verification_failed_retryable" ||
    normalized === "invoice_context_failed"
  );
}

export function getReconciliationSemanticLabel(state = "") {
  const key = getReconciliationSemanticKey(state);
  return RECONCILIATION_STATUS_DEFINITIONS[key]?.label || "Waiting";
}

export function getReconciliationSemanticMeaning(state = "") {
  const key = getReconciliationSemanticKey(state);
  return RECONCILIATION_STATUS_DEFINITIONS[key]?.meaning || "Reconciliation state is waiting for backend updates.";
}

export function getReconciliationBackendPhaseLabel(state = "") {
  const normalized = normalizeLowerString(state);
  return normalized ? toTitleCase(normalized) : "Not observed";
}

export function getReconciliationNextOwnerLabel(state = "", reasonCode = "") {
  const semanticKey = getReconciliationSemanticKey(state);

  if (semanticKey === "observed") {
    return "HexaPay backend";
  }

  if (semanticKey === "recorded") {
    return "Company operator";
  }

  if (semanticKey === "applied") {
    return "No action";
  }

  if (semanticKey === "needs_review") {
    return isBackendFollowUpReason(reasonCode) ? "HexaPay backend" : "Merchant ops";
  }

  return "Pending";
}

export function getReconciliationNextStepLabel(state = "", reasonCode = "") {
  const semanticKey = getReconciliationSemanticKey(state);
  const normalizedReason = normalizeLowerString(reasonCode);

  if (semanticKey === "observed") {
    return "Wait for backend verification and receipt recording to finish.";
  }

  if (semanticKey === "recorded") {
    return "Company operator should review the receipt and apply it to workflow accounting.";
  }

  if (semanticKey === "applied") {
    return "No further reconciliation action is required unless the invoice still needs operational review.";
  }

  if (semanticKey === "needs_review") {
    if (normalizedReason === "invoice_amount_exceeds") {
      return "Review overpayment and choose a manual refund or partial apply path.";
    }

    if (normalizedReason === "duplicate_invoice_tx") {
      return "Confirm which settlement is canonical before retrying reconciliation.";
    }

    if (normalizedReason === "invoice_not_payable") {
      return "Check invoice status before trying to record or apply settlement again.";
    }

    if (isBackendFollowUpReason(normalizedReason)) {
      return "Check backend worker logs and retry the reconciliation run after the transport issue is resolved.";
    }

    return "Inspect the reason code, tx hash, and invoice linkage before retrying or refunding.";
  }

  return "Waiting for reconciliation state.";
}

export function getReconciliationSemanticTitle(state = "") {
  switch (getReconciliationSemanticKey(state)) {
    case "observed":
      return "Invoice reconciliation observed";
    case "recorded":
      return "External receipt recorded";
    case "applied":
      return "Invoice reconciliation applied";
    case "needs_review":
      return "Invoice reconciliation needs review";
    default:
      return "Invoice reconciliation update";
  }
}

export function getSettlementSourceLabel(record = {}) {
  if (normalizeString(record.bridgeTxHash)) {
    return "Executor chain -> workflow bridge";
  }

  if (normalizeString(record.sourceTxHash || record.txHash)) {
    return "Executor chain settlement";
  }

  return "Waiting for settlement source";
}

export function getInvoiceLinkageLabel(record = {}) {
  return normalizeString(record.invoiceId)
    ? "receiptId = invoiceId"
    : "Not invoice-linked";
}

export function formatReconciliationAuthorityValue(value = "") {
  return toTitleCase(value);
}

