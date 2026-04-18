export const CONTRACT_ORDER = [
  "core",
  "workflow",
  "escrow",
  "compliance",
  "analytics",
];

export const CONTRACT_METADATA = {
  core: {
    label: "HexaPay Core",
    shortLabel: "Core",
    envKey: "VITE_HEXAPAY_ADDRESS",
    description: "Confidential balance rail, registry, fees, and module discovery.",
  },
  workflow: {
    label: "Workflow Module",
    shortLabel: "Workflow",
    envKey: "VITE_HEXAPAY_WORKFLOW_ADDRESS",
    description: "Invoices, policy approvals, and payroll orchestration.",
  },
  escrow: {
    label: "Escrow Module",
    shortLabel: "Escrow",
    envKey: "VITE_HEXAPAY_ESCROW_ADDRESS",
    description: "Milestone escrow, funding, release, and dispute resolution.",
  },
  compliance: {
    label: "Compliance Module",
    shortLabel: "Compliance",
    envKey: "VITE_HEXAPAY_COMPLIANCE_ADDRESS",
    description: "Scoped audit rooms and compliance artifacts.",
  },
  analytics: {
    label: "Analytics Module",
    shortLabel: "Analytics",
    envKey: "VITE_HEXAPAY_ANALYTICS_ADDRESS",
    description: "Privacy-preserving finance checkpoints and sealed metrics.",
  },
};

export const CONTRACT_ABIS = {
  core: [
    "function owner() view returns (address)",
    "function feeCollector() view returns (address)",
    "function settlementToken() view returns (address)",
    "function vault() view returns (address)",
    "function workflowModule() view returns (address)",
    "function escrowModule() view returns (address)",
    "function complianceModule() view returns (address)",
    "function analyticsModule() view returns (address)",
    "function platformFeeBps() view returns (uint16)",
    "function getBackingBalance() view returns (uint256)",
    "function registerCompany(string companyName, string ensName, bytes32 companyId)",
    "function wrap(uint128 amount) returns (bytes32 depositId)",
    "function unwrap((uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encryptedAmount) returns (bytes32 withdrawalId)",
    "function completeUnwrap(bytes32 withdrawalId) returns (bytes32 completedWithdrawalId)",
    "function getWithdrawal(bytes32 withdrawalId) view returns (address requester, uint64 requestedAt, uint64 completedAt, bool ready, bool completed)",
    "function createPayment(address recipient, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encryptedAmount, bytes32 referenceHash) returns (bytes32 paymentId)",
    "function authorizeAuditor(address auditor)",
    "function grantComplianceAccess(address subject, address auditor, uint64 duration, bytes32 policyHash)",
    "function getBalance((bytes32 publicKey,bytes signature) permission) view returns (uint256)",
    "function getCompany(address company) view returns (string companyName, string ensName, bytes32 companyId, bool verified, address[] signers)",
    "function getPaymentDetails(bytes32 paymentId, (bytes32 publicKey,bytes signature) permission) view returns (uint256 amount, uint256 fee)",
    "function getPaymentMetadata(bytes32 paymentId) view returns ((address sender, address recipient, uint64 timestamp, bytes32 paymentId, bytes32 referenceHash, uint8 kind, bool completed) payment)",
    "function getSealedBalance(bytes32 publicKey) view returns (uint256)",
    "function getSealedPaymentAmount(bytes32 paymentId, bytes32 publicKey) view returns (uint256)",
    "function getSealedPaymentFee(bytes32 paymentId, bytes32 publicKey) view returns (uint256)",
    "event WithdrawalRequested(address indexed user, bytes32 indexed withdrawalId, uint256 timestamp)",
    "event Withdrawal(address indexed user, bytes32 indexed withdrawalId, uint256 timestamp)",
  ],
  workflow: [
    "function core() view returns (address)",
    "function createInvoice(address company, address payer, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encryptedTotalAmount, bytes32 metadataHash, uint64 dueAt) returns (bytes32 invoiceId)",
    "function approveInvoice(bytes32 invoiceId)",
    "function payInvoice(bytes32 invoiceId, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encryptedAmount) returns (bytes32 paymentId)",
    "function setPolicyRule(address company, uint8 actionType, uint8 minApprovals, uint64 approvalTtl, bool active)",
    "function getInvoice(bytes32 invoiceId) view returns (address issuer, address payer, address company, uint64 createdAt, uint64 dueAt, bytes32 metadataHash, uint8 status, uint32 paymentCount)",
    "function getPolicyRule(address company, uint8 actionType) view returns (uint8 minApprovals, uint64 approvalTtl, bool active)",
    "function getSealedInvoiceAmount(bytes32 invoiceId, bytes32 publicKey) view returns (uint256)",
    "function getSealedInvoiceOutstanding(bytes32 invoiceId, bytes32 publicKey) view returns (uint256)",
    "event InvoiceCreated(bytes32 indexed invoiceId, address indexed company, address indexed payer, address issuer, uint64 dueAt)",
    "event InvoiceApproved(bytes32 indexed invoiceId, address indexed payer)",
    "event InvoiceRejected(bytes32 indexed invoiceId, address indexed payer, bytes32 reasonHash)",
    "event InvoiceCancelled(bytes32 indexed invoiceId)",
    "event InvoicePaymentApplied(bytes32 indexed invoiceId, bytes32 indexed paymentId, uint32 paymentCount)",
    "event PolicyRuleUpdated(address indexed company, uint8 actionType, uint8 minApprovals, uint64 approvalTtl, bool active)",
  ],
  escrow: [
    "function core() view returns (address)",
    "function createEscrow(address seller, address arbiter, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encryptedTotalAmount, bytes32 metadataHash, uint64 expiresAt) returns (bytes32 escrowId)",
    "function getEscrow(bytes32 escrowId) view returns (address buyer, address seller, address arbiter, uint64 createdAt, uint64 expiresAt, bytes32 metadataHash, bytes32 disputeReasonHash, bytes32 rulingHash, uint8 status, uint32 fundingCount, uint32 releaseCount, bool fullyFunded)",
    "function getSealedEscrowRemaining(bytes32 escrowId, bytes32 publicKey) view returns (uint256)",
    "event EscrowCreated(bytes32 indexed escrowId, address indexed buyer, address indexed seller, address arbiter, uint64 expiresAt)",
  ],
  compliance: [
    "function core() view returns (address)",
    "function createComplianceRoom(address subject, address auditor, uint8[] scopes, uint64 duration, bytes32 policyHash) returns (bytes32 roomId)",
    "function getComplianceRoom(bytes32 roomId) view returns ((bytes32 roomId, address subject, address auditor, uint64 createdAt, uint64 expiresAt, bytes32 policyHash, bool active, bool exists) room)",
    "function getRoomScopes(bytes32 roomId) view returns (uint8[] memory)",
    "event ComplianceRoomCreated(bytes32 indexed roomId, address indexed subject, address indexed auditor, uint64 expiresAt, bytes32 policyHash)",
  ],
  analytics: [
    "function core() view returns (address)",
    "function getSealedInvoiceExposure(address company, bytes32 publicKey) view returns (uint256)",
    "function getSealedEscrowExposure(address company, bytes32 publicKey) view returns (uint256)",
    "function checkpointAnalytics(address company, bytes32 snapshotHash) returns (bytes32 checkpointId)",
    "function getAnalyticsCheckpoint(bytes32 checkpointId) view returns ((bytes32 checkpointId, address company, bytes32 snapshotHash, uint64 timestamp) checkpoint)",
    "event AnalyticsCheckpointCreated(bytes32 indexed checkpointId, address indexed company, bytes32 snapshotHash, uint64 timestamp)",
  ],
  token: [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ],
};

export const POLICY_ACTION_LABELS = [
  "Invoice Payment",
  "Payroll Execution",
  "Invoice Cancellation",
];

export const INVOICE_STATUS_LABELS = [
  "Pending Approval",
  "Approved",
  "Rejected",
  "Partially Paid",
  "Paid",
  "Cancelled",
];

export const ESCROW_STATUS_LABELS = [
  "Open",
  "Disputed",
  "Released",
  "Refunded",
  "Resolved",
  "Expired",
];

export const COMPLIANCE_SCOPE_LABELS = [
  "Balance",
  "Payment",
  "Invoice",
  "Payroll",
  "Escrow",
  "Analytics",
];
