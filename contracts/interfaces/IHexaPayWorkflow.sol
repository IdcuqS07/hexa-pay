// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title IHexaPayWorkflow
 * @notice Workflow module interface for confidential invoice, policy, and payroll flows.
 */
interface IHexaPayWorkflow {
    enum InvoiceStatus {
        PendingApproval,
        Approved,
        Rejected,
        PartiallyPaid,
        Paid,
        Cancelled
    }

    enum PolicyActionType {
        InvoicePayment,
        PayrollExecution,
        InvoiceCancellation
    }

    struct ExternalSettlementReceipt {
        bytes32 settlementId;
        bytes32 invoiceId;
        bytes32 intentHash;
        bytes32 requestIdHash;
        bytes32 txHash;
        address payerWallet;
        address merchant;
        address token;
        uint128 observedAmount;
        uint128 appliedAmount;
        uint64 recordedAt;
        uint64 appliedAt;
        bool applied;
        bool exists;
    }

    event InvoiceCreated(
        bytes32 indexed invoiceId,
        address indexed company,
        address indexed payer,
        address issuer,
        uint64 dueAt
    );
    event InvoiceApproved(bytes32 indexed invoiceId, address indexed payer);
    event InvoiceRejected(bytes32 indexed invoiceId, address indexed payer, bytes32 reasonHash);
    event InvoiceCancelled(bytes32 indexed invoiceId);
    event InvoiceLineItemsAdded(bytes32 indexed invoiceId, uint256 itemCount);
    event InvoicePaymentApplied(bytes32 indexed invoiceId, bytes32 indexed paymentId, uint32 paymentCount);
    event ExternalSettlementBridgeUpdated(
        address indexed previousBridge,
        address indexed nextBridge
    );
    event InvoiceExternalSettlementReceiptRecorded(
        bytes32 indexed invoiceId,
        bytes32 indexed settlementId,
        bytes32 indexed intentHash,
        bytes32 requestIdHash,
        bytes32 txHash,
        address payerWallet,
        uint256 observedAmount
    );
    event InvoiceExternalSettlementApplied(
        bytes32 indexed invoiceId,
        bytes32 indexed settlementId,
        uint256 appliedAmount,
        address indexed operator
    );
    event PolicyRuleUpdated(
        address indexed company,
        PolicyActionType actionType,
        uint8 minApprovals,
        uint64 approvalTtl,
        bool active
    );
    event SignerActionPermissionUpdated(
        address indexed company,
        address indexed signer,
        PolicyActionType actionType,
        bool approved
    );
    event PendingActionProposed(
        bytes32 indexed actionId,
        address indexed company,
        PolicyActionType actionType,
        bytes32 resourceId,
        address proposer,
        uint64 expiresAt
    );
    event PendingActionApproved(bytes32 indexed actionId, address indexed approver, uint32 approvalCount);
    event PendingActionApprovalRevoked(bytes32 indexed actionId, address indexed approver, uint32 approvalCount);
    event PendingActionExecuted(bytes32 indexed actionId, address indexed executor, bytes32 resultId);
    event PayrollScheduleCreated(bytes32 indexed scheduleId, address indexed employer, uint256 employeeCount);
    event PayrollScheduleUpdated(bytes32 indexed scheduleId);
    event PayrollExecuted(bytes32 indexed scheduleId, uint256 timestamp, uint256 paymentsCreated);
    event PayrollScheduleCancelled(bytes32 indexed scheduleId);

    function core() external view returns (address);

    function createInvoice(
        address company,
        address payer,
        InEuint128 calldata encryptedTotalAmount,
        bytes32 metadataHash,
        uint64 dueAt
    ) external returns (bytes32);

    function addInvoiceLineItems(
        bytes32 invoiceId,
        InEuint128[] calldata encryptedAmounts,
        bytes32[] calldata labelHashes
    ) external;

    function approveInvoice(bytes32 invoiceId) external;

    function rejectInvoice(bytes32 invoiceId, bytes32 reasonHash) external;

    function cancelInvoice(bytes32 invoiceId) external;

    function payInvoice(bytes32 invoiceId, InEuint128 calldata encryptedAmount) external returns (bytes32);

    function externalSettlementBridge() external view returns (address);

    function setExternalSettlementBridge(address bridge) external;

    function recordExternalSettlementReceipt(
        bytes32 invoiceId,
        bytes32 settlementId,
        bytes32 intentHash,
        bytes32 requestIdHash,
        bytes32 txHash,
        address payerWallet,
        address merchant,
        address token,
        uint128 observedAmount
    ) external;

    function applyExternalSettlementReceipt(bytes32 settlementId, uint128 clearAmount)
        external
        returns (bytes32 invoiceId);

    function getInvoice(bytes32 invoiceId)
        external
        view
        returns (
            address issuer,
            address payer,
            address company,
            uint64 createdAt,
            uint64 dueAt,
            bytes32 metadataHash,
            InvoiceStatus status,
            uint32 paymentCount
        );

    function getInvoicePayments(bytes32 invoiceId) external view returns (bytes32[] memory);

    function getInvoiceExternalSettlementIds(bytes32 invoiceId)
        external
        view
        returns (bytes32[] memory);

    function getExternalSettlementReceipt(bytes32 settlementId)
        external
        view
        returns (ExternalSettlementReceipt memory receipt);

    function getCompanyInvoices(address company) external view returns (bytes32[] memory);

    function getPayerInvoices(address payer) external view returns (bytes32[] memory);

    function getInvoiceLineItemCount(bytes32 invoiceId) external view returns (uint256);

    function getInvoiceLineItemLabelHash(bytes32 invoiceId, uint256 index) external view returns (bytes32);

    function getSealedInvoiceAmount(bytes32 invoiceId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedInvoiceOutstanding(bytes32 invoiceId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedInvoiceLineItemAmount(bytes32 invoiceId, uint256 index, bytes32 publicKey)
        external
        view
        returns (uint256);

    function isInvoiceOverdue(bytes32 invoiceId) external view returns (bool);

    function setPolicyRule(
        address company,
        PolicyActionType actionType,
        uint8 minApprovals,
        uint64 approvalTtl,
        bool active
    ) external;

    function getPolicyRule(address company, PolicyActionType actionType)
        external
        view
        returns (uint8 minApprovals, uint64 approvalTtl, bool active);

    function setSignerActionPermission(
        address signer,
        PolicyActionType actionType,
        bool approved
    ) external;

    function isSignerAuthorizedForAction(
        address company,
        address signer,
        PolicyActionType actionType
    ) external view returns (bool);

    function proposeInvoicePayment(
        bytes32 invoiceId,
        InEuint128 calldata encryptedAmount,
        bytes32 metadataHash
    ) external returns (bytes32);

    function proposePayrollExecution(bytes32 scheduleId, bytes32 metadataHash) external returns (bytes32);

    function proposeInvoiceCancellation(bytes32 invoiceId, bytes32 metadataHash)
        external
        returns (bytes32);

    function approvePendingAction(bytes32 actionId) external;

    function revokePendingActionApproval(bytes32 actionId) external;

    function executePendingAction(bytes32 actionId) external returns (bytes32);

    function getPendingAction(bytes32 actionId)
        external
        view
        returns (
            address company,
            address proposer,
            bytes32 resourceId,
            bytes32 metadataHash,
            PolicyActionType actionType,
            uint64 createdAt,
            uint64 expiresAt,
            uint32 approvalCount,
            bool executed
        );

    function getPendingActionApprovers(bytes32 actionId) external view returns (address[] memory);

    function getCompanyPendingActions(address company) external view returns (bytes32[] memory);

    function getSealedPendingActionAmount(bytes32 actionId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function createPayrollSchedule(
        address company,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 firstPaymentAt,
        bytes32 metadataHash
    ) external returns (bytes32);

    function updatePayrollSchedule(
        bytes32 scheduleId,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 nextPaymentAt,
        bytes32 metadataHash
    ) external;

    function executePayroll(bytes32 scheduleId) external;

    function cancelPayrollSchedule(bytes32 scheduleId) external;

    function getEmployerSchedules(address employer) external view returns (bytes32[] memory);

    function getPayrollSchedule(bytes32 scheduleId)
        external
        view
        returns (
            address employer,
            address[] memory employees,
            uint64 frequency,
            uint64 nextPaymentAt,
            bytes32 metadataHash,
            bool active
        );

    function getSealedPayrollAmount(
        bytes32 scheduleId,
        uint256 index,
        bytes32 publicKey
    ) external view returns (uint256);
}
