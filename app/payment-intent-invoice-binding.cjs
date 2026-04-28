function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeCanonicalInvoiceId(value) {
  const rawValue = normalizeString(value);

  if (!rawValue) {
    return "";
  }

  const normalized = rawValue.startsWith("0x") || rawValue.startsWith("0X")
    ? `0x${rawValue.slice(2)}`
    : `0x${rawValue}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return "";
  }

  return `0x${normalized.slice(2).toLowerCase()}`;
}

function describeInvoiceIntentBinding({ receiptId = "", invoiceId = "" } = {}) {
  const rawReceiptId = normalizeString(receiptId);
  const rawInvoiceId = normalizeString(invoiceId);
  const normalizedReceiptInvoiceId = normalizeCanonicalInvoiceId(rawReceiptId);
  const normalizedInvoiceId = normalizeCanonicalInvoiceId(rawInvoiceId);
  const invalidInvoiceId = Boolean(rawInvoiceId) && !normalizedInvoiceId;
  const mismatch =
    Boolean(normalizedInvoiceId) &&
    Boolean(rawReceiptId) &&
    normalizedReceiptInvoiceId !== normalizedInvoiceId;
  const resolvedInvoiceId = normalizedInvoiceId || normalizedReceiptInvoiceId || "";
  const resolvedReceiptId = resolvedInvoiceId || rawReceiptId;

  return {
    receiptId: resolvedReceiptId,
    invoiceId: resolvedInvoiceId,
    invoiceLinked: Boolean(resolvedInvoiceId),
    bindingSource: normalizedInvoiceId ? "invoiceId" : normalizedReceiptInvoiceId ? "receiptId" : "",
    invalidInvoiceId,
    mismatch,
  };
}

function assertInvoiceIntentBinding(input = {}) {
  const binding = describeInvoiceIntentBinding(input);

  if (binding.invalidInvoiceId) {
    const error = new Error("Invoice-linked payments require a canonical bytes32 invoiceId.");
    error.code = "invoice_id_invalid";
    error.details = {
      invoiceId: normalizeString(input.invoiceId),
    };
    throw error;
  }

  if (binding.mismatch) {
    const error = new Error("Invoice-linked payments must use receiptId equal to invoiceId.");
    error.code = "invoice_receipt_mismatch";
    error.details = {
      invoiceId: normalizeCanonicalInvoiceId(input.invoiceId),
      receiptId: normalizeString(input.receiptId),
    };
    throw error;
  }

  return binding;
}

function describeInvoiceReconciliationCandidate(record = {}) {
  const binding = describeInvoiceIntentBinding(record);
  const status = normalizeString(record.status).toLowerCase();
  const reconciliationStatus = normalizeString(record.reconciliationStatus).toLowerCase();
  let eligible = false;
  let reason = "not_invoice_linked";

  if (binding.invalidInvoiceId) {
    reason = "invalid_invoice_id";
  } else if (binding.mismatch) {
    reason = "invoice_receipt_mismatch";
  } else if (!binding.invoiceLinked) {
    reason = "not_invoice_linked";
  } else if (status !== "settled") {
    reason = status ? `payment_status_${status}` : "payment_status_unknown";
  } else if (!normalizeString(record.intentHash)) {
    reason = "missing_intent_hash";
  } else if (!normalizeString(record.requestIdHash)) {
    reason = "missing_request_id_hash";
  } else if (!normalizeString(record.txHash)) {
    reason = "missing_tx_hash";
  } else if (!normalizeString(record.token)) {
    reason = "missing_token";
  } else if (!normalizeString(record.payer)) {
    reason = "missing_payer";
  } else if (!normalizeString(record.merchant)) {
    reason = "missing_merchant";
  } else if (reconciliationStatus === "recorded" || reconciliationStatus === "applied") {
    reason = reconciliationStatus === "applied" ? "already_applied" : "already_recorded";
  } else {
    eligible = true;
    reason = "eligible";
  }

  return {
    ...binding,
    eligible,
    reason,
  };
}

module.exports = {
  assertInvoiceIntentBinding,
  describeInvoiceIntentBinding,
  describeInvoiceReconciliationCandidate,
  normalizeCanonicalInvoiceId,
};
