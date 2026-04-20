const ReceiptRoles = {
  MERCHANT: "merchant",
  PAYER: "payer",
  AUDITOR: "auditor",
};

const { parseReceiptAccessGrantToken } = require("./mock-receipt-grants.cjs");

const ReceiptProjectionEffects = {
  FULL: "full",
  LIMITED: "limited",
  DENIED: "denied",
};

const ReceiptRecordTypes = {
  CANONICAL: "canonical-receipt",
  PROJECTION: "projected-receipt",
};

const RECEIPT_PROJECTION_SCHEMA_VERSION = 1;

const ReceiptFieldDisclosureClassifications = {
  PUBLIC: "public",
  MASKED: "masked",
  GRANT_REQUIRED: "grant-required",
  PERMIT_REQUIRED: "permit-required",
};

const ReceiptFieldDisclosureStates = {
  VISIBLE: "visible",
  MASKED: "masked",
  WITHHELD: "withheld",
  BOOTSTRAP_FALLBACK: "bootstrap-fallback",
};

function normalizeAccessContext(accessContext) {
  if (!accessContext || typeof accessContext !== "object") {
    return {
      token: "",
      grant: "",
      permitHash: "",
      publicKey: "",
    };
  }

  return {
    token: String(accessContext.token || ""),
    grant: String(accessContext.grant || ""),
    permitHash: String(accessContext.permitHash || ""),
    publicKey: String(accessContext.publicKey || ""),
  };
}

function normalizeParticipantIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeRole(role) {
  switch (String(role || "")) {
    case ReceiptRoles.PAYER:
      return ReceiptRoles.PAYER;
    case ReceiptRoles.AUDITOR:
      return ReceiptRoles.AUDITOR;
    case ReceiptRoles.MERCHANT:
    default:
      return ReceiptRoles.MERCHANT;
  }
}

function parseReceiptAccessToken(token) {
  const normalizedToken = String(token || "").trim();

  if (!normalizedToken) {
    return null;
  }

  const match = normalizedToken.match(/^receipt-viewer:(merchant|payer|auditor):([^:]+):(.+)$/);

  if (!match) {
    return null;
  }

  return {
    kind: "receipt-viewer",
    role: match[1],
    viewer: match[2],
    chainId: match[3],
    raw: normalizedToken,
  };
}

function parseReceiptAccessGrant(grant) {
  return parseReceiptAccessGrantToken(grant);
}

function resolvePermitState(role, normalizedAccessContext) {
  const hasPermitHash = Boolean(normalizedAccessContext.permitHash);
  const hasPublicKey = Boolean(normalizedAccessContext.publicKey);

  if (role === ReceiptRoles.AUDITOR) {
    return "not-required";
  }

  if (hasPermitHash && hasPublicKey) {
    return "attached";
  }

  if (hasPermitHash || hasPublicKey) {
    return "incomplete";
  }

  return "bridge-ready";
}

function normalizeViewerContext(role, accessContext) {
  const normalizedRole = normalizeRole(role);
  const normalizedAccessContext = normalizeAccessContext(accessContext);
  const parsedToken = parseReceiptAccessToken(normalizedAccessContext.token);
  const parsedGrant = parseReceiptAccessGrant(normalizedAccessContext.grant);
  const normalizedViewer = normalizeParticipantIdentifier(parsedToken?.viewer || "");

  return {
    role: normalizedRole,
    accessContext: normalizedAccessContext,
    token: {
      raw: normalizedAccessContext.token,
      parsed: parsedToken,
      valid: Boolean(parsedToken),
      role: parsedToken?.role || "",
      viewer: normalizedViewer,
      chainId: parsedToken?.chainId || "",
      matchesRequestedRole: parsedToken?.role === normalizedRole,
    },
    grant: {
      raw: normalizedAccessContext.grant,
      parsed: parsedGrant,
      valid: Boolean(parsedGrant),
      role: parsedGrant?.role || "",
      viewer: normalizeParticipantIdentifier(parsedGrant?.viewer || ""),
      quoteId: String(parsedGrant?.quoteId || ""),
      chainId: parsedGrant?.chainId || "",
      matchesRequestedRole: parsedGrant?.role === normalizedRole,
      matchesViewerToken:
        Boolean(parsedGrant) &&
        normalizeParticipantIdentifier(parsedGrant?.viewer || "") === normalizedViewer,
      matchesTokenChain:
        Boolean(parsedGrant) && String(parsedGrant?.chainId || "") === String(parsedToken?.chainId || ""),
    },
    permit: {
      hash: normalizedAccessContext.permitHash,
      publicKey: normalizedAccessContext.publicKey,
      state: resolvePermitState(normalizedRole, normalizedAccessContext),
    },
  };
}

function createAllowedDecision(role, effect, code, reason, extra = {}) {
  return {
    status: "allowed",
    role,
    effect,
    code,
    reason,
    requiredContext: [],
    ...extra,
  };
}

function createDeniedDecision(role, code, reason, requiredContext = ["accessToken"], extra = {}) {
  return {
    status: "denied",
    role,
    effect: ReceiptProjectionEffects.DENIED,
    code,
    reason,
    requiredContext,
    ...extra,
  };
}

function evaluateViewerContext(role, accessContext) {
  const viewerContext = normalizeViewerContext(role, accessContext);

  if (!viewerContext.token.raw) {
    return {
      viewerContext,
      decision: createDeniedDecision(
        viewerContext.role,
        "viewer-context-required",
        "Receipt viewer context is required for this projection.",
      ),
    };
  }

  if (!viewerContext.token.valid) {
    return {
      viewerContext,
      decision: createDeniedDecision(
        viewerContext.role,
        "invalid-access-token",
        "Receipt viewer token is malformed.",
      ),
    };
  }

  if (!viewerContext.token.matchesRequestedRole) {
    return {
      viewerContext,
      decision: createDeniedDecision(
        viewerContext.role,
        "viewer-role-mismatch",
        "Receipt viewer token role does not match the requested projection role.",
      ),
    };
  }

  return {
    viewerContext,
    decision: createAllowedDecision(
      viewerContext.role,
      ReceiptProjectionEffects.FULL,
      "viewer-context-accepted",
      "Receipt viewer context is valid.",
    ),
  };
}

function resolveParticipantField(role) {
  switch (role) {
    case ReceiptRoles.MERCHANT:
      return "merchant";
    case ReceiptRoles.PAYER:
      return "payer";
    default:
      return "";
  }
}

function createParticipantBinding(receipt, viewerContext) {
  const participantField = resolveParticipantField(viewerContext.role);
  const viewer = normalizeParticipantIdentifier(viewerContext.token.viewer);

  if (!participantField) {
    return {
      version: 1,
      mode: "role-scoped",
      state: "role-scoped",
      participantField: "",
      required: false,
      matched: true,
      viewer,
      expectedViewer: "",
      reason: "This projection remains role-scoped during bootstrap.",
    };
  }

  const expectedViewer = normalizeParticipantIdentifier(receipt?.[participantField] || "");

  if (!expectedViewer) {
    return {
      version: 1,
      mode: "participant-bound",
      state: "receipt-participant-missing",
      participantField,
      required: true,
      matched: false,
      viewer,
      expectedViewer: "",
      reason: `Receipt is missing the ${participantField} identity required for a participant-bound read.`,
    };
  }

  if (!viewer || viewer === "anonymous") {
    return {
      version: 1,
      mode: "participant-bound",
      state: "viewer-missing",
      participantField,
      required: true,
      matched: false,
      viewer,
      expectedViewer,
      reason: `Connect the ${participantField} wallet that belongs to this receipt before requesting the full projection.`,
    };
  }

  const matched = viewer === expectedViewer;

  return {
    version: 1,
    mode: "participant-bound",
    state: matched ? "matched" : "viewer-mismatch",
    participantField,
    required: true,
    matched,
    viewer,
    expectedViewer,
    reason: matched
      ? `Viewer matches the receipt ${participantField}.`
      : `Viewer does not match the receipt ${participantField}.`,
  };
}

function createReceiptGrantBinding(receipt, viewerContext) {
  const participantField = resolveParticipantField(viewerContext.role);

  if (!participantField) {
    return {
      version: 1,
      mode: "role-scoped",
      state: "role-scoped",
      participantField: "",
      quoteId: String(receipt?.quoteId || ""),
      required: false,
      matched: true,
      reason: "This projection does not require a receipt-scoped grant during bootstrap.",
    };
  }

  if (!viewerContext.grant.raw) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "missing",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Attach a receipt-scoped grant to reveal fields that are bound to this quote.",
    };
  }

  if (viewerContext.grant.parsed?.expired) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "expired",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Receipt grant has expired.",
    };
  }

  if (!viewerContext.grant.valid) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "invalid",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Receipt grant is malformed.",
    };
  }

  if (!viewerContext.grant.matchesRequestedRole) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "role-mismatch",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Receipt grant role does not match the requested projection role.",
    };
  }

  if (!viewerContext.grant.matchesViewerToken) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "viewer-mismatch",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Receipt grant viewer does not match the viewer token.",
    };
  }

  if (!viewerContext.grant.matchesTokenChain) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "chain-mismatch",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Receipt grant chain does not match the viewer token chain.",
    };
  }

  if (String(viewerContext.grant.quoteId || "") !== String(receipt?.quoteId || "")) {
    return {
      version: 1,
      mode: "receipt-scoped",
      state: "quote-mismatch",
      participantField,
      quoteId: String(receipt?.quoteId || ""),
      required: true,
      matched: false,
      reason: "Receipt grant does not belong to this quote.",
    };
  }

  return {
    version: 1,
    mode: "receipt-scoped",
    state: "matched",
    participantField,
    quoteId: String(receipt?.quoteId || ""),
    required: true,
    matched: true,
    reason: "Receipt grant matches the requested quote and viewer.",
  };
}

function evaluateReceiptAccess(receipt, viewerContext) {
  if (!receipt) {
    return createDeniedDecision(
      viewerContext.role,
      "receipt-not-found",
      "Receipt was not found.",
      [],
    );
  }

  const participantBinding = createParticipantBinding(receipt, viewerContext);
  const grantBinding = createReceiptGrantBinding(receipt, viewerContext);

  if (participantBinding.state === "receipt-participant-missing") {
    return createDeniedDecision(
      viewerContext.role,
      "receipt-participant-missing",
      participantBinding.reason,
      [],
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  if (participantBinding.state === "viewer-missing") {
    return createDeniedDecision(
      viewerContext.role,
      "participant-context-required",
      participantBinding.reason,
      ["connectedWallet"],
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  if (participantBinding.state === "viewer-mismatch") {
    return createDeniedDecision(
      viewerContext.role,
      "viewer-participant-mismatch",
      participantBinding.reason,
      ["participantMatch"],
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  if (
    grantBinding.required &&
    grantBinding.state !== "matched" &&
    grantBinding.state !== "missing"
  ) {
    return createDeniedDecision(
      viewerContext.role,
      "receipt-grant-invalid",
      grantBinding.reason,
      ["receiptGrant"],
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  const visibility = String(receipt.access?.[viewerContext.role] || "");

  if (!visibility) {
    return createDeniedDecision(
      viewerContext.role,
      "role-not-authorized",
      "This role does not have access to the receipt projection.",
      [],
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  if (visibility === ReceiptProjectionEffects.FULL) {
    return createAllowedDecision(
      viewerContext.role,
      ReceiptProjectionEffects.FULL,
      "projection-full",
      "Receipt projection is fully visible for this viewer role.",
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  if (visibility === ReceiptProjectionEffects.LIMITED) {
    return createAllowedDecision(
      viewerContext.role,
      ReceiptProjectionEffects.LIMITED,
      "projection-limited",
      "Receipt projection is limited for this viewer role.",
      {
        participantBinding,
        grantBinding,
      },
    );
  }

  return createDeniedDecision(
    viewerContext.role,
    "unsupported-visibility",
    `Unsupported receipt visibility "${visibility}".`,
    [],
    {
      participantBinding,
      grantBinding,
    },
  );
}

function resolveAccessScope(effect) {
  switch (effect) {
    case ReceiptProjectionEffects.LIMITED:
      return "private-quote.receipt.limited";
    case ReceiptProjectionEffects.DENIED:
      return "private-quote.receipt.denied";
    case ReceiptProjectionEffects.FULL:
    default:
      return "private-quote.receipt.full";
  }
}

function createReceiptReadModel(receipt, viewerContext) {
  return {
    recordType: ReceiptRecordTypes.PROJECTION,
    projectionVersion: RECEIPT_PROJECTION_SCHEMA_VERSION,
    role: viewerContext.role,
    transport: "mock-api",
    canonical: {
      recordType: String(receipt.meta?.recordType || ReceiptRecordTypes.CANONICAL),
      schemaVersion: Number(receipt.meta?.schemaVersion || receipt.meta?.version || 0),
      sourceOfTruth: {
        ...(receipt.meta?.sourceOfTruth && typeof receipt.meta.sourceOfTruth === "object"
          ? receipt.meta.sourceOfTruth
          : {}),
      },
      eventRef: {
        ...(receipt.meta?.eventRef && typeof receipt.meta.eventRef === "object"
          ? receipt.meta.eventRef
          : {}),
      },
    },
  };
}

function resolveFieldScope(fieldName) {
  return `private-quote.receipt.field.${fieldName}`;
}

function createFieldDisclosureEntry(
  fieldName,
  classification,
  state,
  {
    requiresPermit = false,
    maskStrategy = "",
    fallbackCode = "",
    fallbackReason = "",
    requiredContext = [],
    target = "inline",
  } = {},
) {
  return {
    classification,
    state,
    scope: resolveFieldScope(fieldName),
    requiresPermit,
    target,
    maskStrategy,
    requiredContext: [...requiredContext],
    fallback: {
      active: Boolean(fallbackCode || fallbackReason),
      code: fallbackCode,
      reason: fallbackReason,
    },
  };
}

function createPublicFieldDisclosure(fieldName) {
  return createFieldDisclosureEntry(
    fieldName,
    ReceiptFieldDisclosureClassifications.PUBLIC,
    ReceiptFieldDisclosureStates.VISIBLE,
    {
      target: "inline",
    },
  );
}

function createMaskedFieldDisclosure(fieldName, maskStrategy = "address-short") {
  return createFieldDisclosureEntry(
    fieldName,
    ReceiptFieldDisclosureClassifications.MASKED,
    ReceiptFieldDisclosureStates.MASKED,
    {
      maskStrategy,
      target: "masked-inline",
    },
  );
}

function createGrantRequiredDisclosure(fieldName, state, options = {}) {
  return createFieldDisclosureEntry(
    fieldName,
    ReceiptFieldDisclosureClassifications.GRANT_REQUIRED,
    state,
    {
      requiredContext: options.requiredContext || ["receiptGrant"],
      target: fieldName === "paymentLink" ? "receipt-route" : "inline",
    },
  );
}

function createPermitRequiredDisclosure(fieldName, state, options = {}) {
  return createFieldDisclosureEntry(
    fieldName,
    ReceiptFieldDisclosureClassifications.PERMIT_REQUIRED,
    state,
    {
      requiresPermit: true,
      fallbackCode: options.fallbackCode || "",
      fallbackReason: options.fallbackReason || "",
      requiredContext: options.requiredContext || ["permitHash", "permitPublicKey"],
      target:
        fieldName === "amount"
          ? "sealed-handle"
          : fieldName === "paymentLink"
            ? "permit-inline"
            : "inline",
    },
  );
}

function createFieldDisclosureMap(decision, viewerContext) {
  const commonFields = {
    quoteId: createPublicFieldDisclosure("quoteId"),
    merchant: createPublicFieldDisclosure("merchant"),
    status: createPublicFieldDisclosure("status"),
    settledAt: createPublicFieldDisclosure("settledAt"),
    txHash: createPublicFieldDisclosure("txHash"),
    currency: createPublicFieldDisclosure("currency"),
  };

  if (decision.effect === ReceiptProjectionEffects.LIMITED) {
    return {
      ...commonFields,
      payer: createMaskedFieldDisclosure("payer"),
      amount: createPermitRequiredDisclosure("amount", ReceiptFieldDisclosureStates.WITHHELD),
      paymentLink: createPermitRequiredDisclosure("paymentLink", ReceiptFieldDisclosureStates.WITHHELD),
    };
  }

  const hasReceiptGrant = decision.grantBinding?.matched === true;
  const hasPermit = viewerContext.permit.state === "attached";

  return {
    ...commonFields,
    payer: createPublicFieldDisclosure("payer"),
    amount: createPermitRequiredDisclosure(
      "amount",
      hasReceiptGrant && hasPermit
        ? ReceiptFieldDisclosureStates.VISIBLE
        : ReceiptFieldDisclosureStates.WITHHELD,
      {
        requiredContext: hasReceiptGrant
          ? ["permitHash", "permitPublicKey"]
          : ["receiptGrant", "permitHash", "permitPublicKey"],
      },
    ),
    paymentLink: createGrantRequiredDisclosure(
      "paymentLink",
      hasReceiptGrant ? ReceiptFieldDisclosureStates.VISIBLE : ReceiptFieldDisclosureStates.WITHHELD,
      {
        requiredContext: ["receiptGrant"],
      },
    ),
  };
}

function summarizeFieldDisclosure(fieldDisclosure) {
  const summary = {
    public: [],
    masked: [],
    grantRequired: [],
    permitRequired: [],
    withheld: [],
    bootstrapFallback: [],
    byField: {},
  };

  Object.entries(fieldDisclosure).forEach(([fieldName, entry]) => {
    summary.byField[fieldName] = entry.scope;

    if (entry.classification === ReceiptFieldDisclosureClassifications.PUBLIC) {
      summary.public.push(fieldName);
    }

    if (entry.classification === ReceiptFieldDisclosureClassifications.MASKED) {
      summary.masked.push(fieldName);
    }

    if (entry.classification === ReceiptFieldDisclosureClassifications.GRANT_REQUIRED) {
      summary.grantRequired.push(fieldName);
    }

    if (entry.classification === ReceiptFieldDisclosureClassifications.PERMIT_REQUIRED) {
      summary.permitRequired.push(fieldName);
    }

    if (entry.state === ReceiptFieldDisclosureStates.WITHHELD) {
      summary.withheld.push(fieldName);
    }

    if (entry.state === ReceiptFieldDisclosureStates.BOOTSTRAP_FALLBACK) {
      summary.bootstrapFallback.push(fieldName);
    }
  });

  return summary;
}

function resolveDisclosureMode(fieldDisclosureSummary) {
  return fieldDisclosureSummary.bootstrapFallback.length > 0
    ? "bootstrap-fallback"
    : "policy-enforced";
}

function resolveAccessTokenSource(viewerContext) {
  return viewerContext.token.raw ? "provided" : "derived";
}

function resolvePermitSource(viewerContext) {
  if (viewerContext.permit.state === "attached") {
    return "provided";
  }

  if (viewerContext.permit.state === "incomplete") {
    return "partial";
  }

  return "none";
}

function resolveGrantSource(viewerContext) {
  if (viewerContext.grant.raw && viewerContext.grant.valid) {
    return "provided";
  }

  if (viewerContext.grant.raw) {
    return "invalid";
  }

  return "none";
}

function createReceiptAccessBridge(receipt, decision, viewerContext, fieldDisclosureSummary) {
  const participantBinding = decision.participantBinding || createParticipantBinding(receipt, viewerContext);
  const grantBinding = decision.grantBinding || createReceiptGrantBinding(receipt, viewerContext);

  return {
    version: 1,
    phase: "bootstrap",
    transport: "mock-api",
    role: viewerContext.role,
    visibility: decision.effect,
    scope: resolveAccessScope(decision.effect),
    accessToken: {
      kind: "receipt-access-token",
      value: viewerContext.token.raw || `receipt-access:${receipt.quoteId}:${viewerContext.role}`,
      source: resolveAccessTokenSource(viewerContext),
    },
    receiptGrant: {
      kind: "receipt-access-grant",
      value: viewerContext.grant.raw || "",
      source: resolveGrantSource(viewerContext),
      quoteId: grantBinding.quoteId || "",
      state: grantBinding.state,
    },
    permit: {
      hash: viewerContext.permit.hash,
      publicKey: viewerContext.permit.publicKey,
      source: resolvePermitSource(viewerContext),
      state: viewerContext.permit.state,
    },
    participantBinding,
    grantBinding,
    scopes: {
      projection: resolveAccessScope(decision.effect),
      fields: {
        public: [...fieldDisclosureSummary.public],
        masked: [...fieldDisclosureSummary.masked],
        grantRequired: [...fieldDisclosureSummary.grantRequired],
        permitRequired: [...fieldDisclosureSummary.permitRequired],
        withheld: [...fieldDisclosureSummary.withheld],
        bootstrapFallback: [...fieldDisclosureSummary.bootstrapFallback],
      },
      byField: {
        ...fieldDisclosureSummary.byField,
      },
    },
    bootstrapFallback: {
      active: fieldDisclosureSummary.bootstrapFallback.length > 0,
      fields: [...fieldDisclosureSummary.bootstrapFallback],
      reason:
        fieldDisclosureSummary.bootstrapFallback.length > 0
          ? "Selective disclosure metadata is ready, but these fields still use bootstrap inline fallbacks."
          : "",
    },
  };
}

function createReceiptAccessPolicy(decision) {
  return {
    version: 1,
    phase: "bootstrap",
    status: decision.status,
    effect: decision.effect,
    code: decision.code,
    reason: decision.reason,
    requiredContext: [...decision.requiredContext],
    participantBinding:
      decision.participantBinding && typeof decision.participantBinding === "object"
        ? {
            ...decision.participantBinding,
          }
        : null,
    grantBinding:
      decision.grantBinding && typeof decision.grantBinding === "object"
        ? {
            ...decision.grantBinding,
          }
        : null,
  };
}

function maskAddress(address) {
  if (!address || address.length < 10) {
    return address || "";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function createFullReceiptProjection(receipt, decision, viewerContext, fieldDisclosure, fieldDisclosureSummary) {
  const hasReceiptGrant = decision.grantBinding?.matched === true;
  const hasPermit = viewerContext.permit.state === "attached";

  return {
    quoteId: receipt.quoteId,
    merchant: receipt.merchant,
    payer: receipt.payer,
    status: receipt.status,
    settledAt: receipt.settledAt,
    txHash: receipt.txHash,
    paymentLink: hasReceiptGrant ? receipt.paymentLink : null,
    amount: hasReceiptGrant && hasPermit ? receipt.amount : null,
    currency: receipt.currency,
    visibility: decision.effect,
    disclosureMode: resolveDisclosureMode(fieldDisclosureSummary),
    fieldDisclosure,
    readModel: createReceiptReadModel(receipt, viewerContext),
    accessBridge: createReceiptAccessBridge(receipt, decision, viewerContext, fieldDisclosureSummary),
    accessPolicy: createReceiptAccessPolicy(decision),
  };
}

function createLimitedReceiptProjection(receipt, decision, viewerContext, fieldDisclosure, fieldDisclosureSummary) {
  return {
    quoteId: receipt.quoteId,
    merchant: receipt.merchant,
    payer: maskAddress(receipt.payer),
    status: receipt.status,
    settledAt: receipt.settledAt,
    txHash: receipt.txHash,
    currency: receipt.currency,
    amount: null,
    paymentLink: null,
    visibility: decision.effect,
    disclosureMode: resolveDisclosureMode(fieldDisclosureSummary),
    fieldDisclosure,
    readModel: createReceiptReadModel(receipt, viewerContext),
    accessBridge: createReceiptAccessBridge(receipt, decision, viewerContext, fieldDisclosureSummary),
    accessPolicy: createReceiptAccessPolicy(decision),
  };
}

function projectReceipt(receipt, viewerContext, decision) {
  if (!receipt || !viewerContext || decision?.status !== "allowed") {
    return null;
  }

  const fieldDisclosure = createFieldDisclosureMap(decision, viewerContext);
  const fieldDisclosureSummary = summarizeFieldDisclosure(fieldDisclosure);

  if (decision.effect === ReceiptProjectionEffects.LIMITED) {
    return createLimitedReceiptProjection(
      receipt,
      decision,
      viewerContext,
      fieldDisclosure,
      fieldDisclosureSummary,
    );
  }

  return createFullReceiptProjection(
    receipt,
    decision,
    viewerContext,
    fieldDisclosure,
    fieldDisclosureSummary,
  );
}

module.exports = {
  ReceiptProjectionEffects,
  ReceiptRoles,
  createReceiptAccessPolicy,
  evaluateReceiptAccess,
  evaluateViewerContext,
  normalizeViewerContext,
  projectReceipt,
};
