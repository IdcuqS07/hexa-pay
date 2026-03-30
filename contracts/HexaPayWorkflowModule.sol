// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IHexaPay.sol";
import "./interfaces/IHexaPayAnalytics.sol";
import "./interfaces/IHexaPayCore.sol";

/**
 * @title HexaPayWorkflowModule
 * @notice Invoice, policy, and payroll workflow module for a HexaPay core instance.
 */
contract HexaPayWorkflowModule {
    error ActionAlreadyExecuted();
    error AlreadyApproved();
    error ActionExpired();
    error ActionHasNoAmount();
    error ApprovalNotFound();
    error CompanyNotRegistered();
    error IndexOutOfBounds();
    error InsufficientApprovals();
    error InvalidApprovals();
    error InvalidCore();
    error InvalidDueDate();
    error InvalidFrequency();
    error InvalidEmployee();
    error InvalidPayer();
    error InvalidSigner();
    error InvoiceAlreadyFunded();
    error InvoiceNotCancellable();
    error InvoiceNotEditable();
    error InvoiceNotPayable();
    error InvoiceNotPending();
    error LengthMismatch();
    error NoActionAccess();
    error NoEmployees();
    error NoInvoiceAccess();
    error NoLineItems();
    error NoPayrollAccess();
    error NotCompanyOperator();
    error NotCompanyOwner();
    error NotInvoiceOperator();
    error NotInvoicePayer();
    error NotPolicySigner();
    error NotTimeYet();
    error PayerCompanyNotRegistered();
    error PolicyApprovalRequired();
    error PolicyNotActive();
    error ReentrancyBlocked();
    error ScheduleNotActive();
    error SignerNotApproved();
    error UnknownAction();
    error UnknownInvoice();
    error UnknownSchedule();
    error UnsupportedAction();

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

    struct Invoice {
        bytes32 invoiceId;
        address issuer;
        address payer;
        address company;
        uint64 createdAt;
        uint64 dueAt;
        bytes32 metadataHash;
        InvoiceStatus status;
        uint32 paymentCount;
        bool exists;
    }

    struct InvoiceLineItem {
        bytes32 labelHash;
        euint128 amount;
    }

    struct PolicyRule {
        uint8 minApprovals;
        uint64 approvalTtl;
        bool active;
    }

    struct PendingAction {
        bytes32 actionId;
        address company;
        address proposer;
        bytes32 resourceId;
        bytes32 metadataHash;
        PolicyActionType actionType;
        uint64 createdAt;
        uint64 expiresAt;
        uint32 approvalCount;
        bool executed;
        bool exists;
    }

    struct PayrollSchedule {
        bytes32 scheduleId;
        address employer;
        address[] employees;
        euint128[] grossAmounts;
        uint64 frequency;
        uint64 nextPaymentAt;
        bytes32 metadataHash;
        bool active;
    }

    IHexaPayCore public immutable core;

    mapping(bytes32 => Invoice) private invoices;
    mapping(bytes32 => euint128) private invoiceTotals;
    mapping(bytes32 => euint128) private invoiceOutstanding;
    mapping(bytes32 => InvoiceLineItem[]) private invoiceLineItems;
    mapping(bytes32 => bytes32[]) private invoicePayments;
    mapping(address => bytes32[]) private companyInvoices;
    mapping(address => bytes32[]) private payerInvoices;

    mapping(address => mapping(PolicyActionType => PolicyRule)) private policyRules;
    mapping(address => mapping(address => mapping(PolicyActionType => bool))) private signerActionPermissions;
    mapping(bytes32 => PendingAction) private pendingActions;
    mapping(bytes32 => mapping(address => bool)) private pendingActionApprovals;
    mapping(bytes32 => address[]) private pendingActionApprovers;
    mapping(bytes32 => euint128) private pendingActionAmounts;
    mapping(bytes32 => bool) private pendingActionHasAmount;
    mapping(address => bytes32[]) private companyPendingActions;

    mapping(bytes32 => PayrollSchedule) private payrollSchedules;
    mapping(address => bytes32[]) private employerSchedules;

    uint256 private scheduleNonce;
    uint256 private invoiceNonce;
    uint256 private pendingActionNonce;
    bool private entered;

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

    modifier onlyCompanyOwner(address company) {
        if (msg.sender != company) revert NotCompanyOwner();
        _;
    }

    modifier onlyCompanyOperator(address company) {
        if (!core.isCompanyOperator(company, msg.sender)) revert NotCompanyOperator();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrancyBlocked();
        entered = true;
        _;
        entered = false;
    }

    constructor(address core_) {
        if (core_ == address(0)) revert InvalidCore();
        core = IHexaPayCore(core_);
    }

    function createInvoice(
        address company,
        address payer,
        InEuint128 calldata encryptedTotalAmount,
        bytes32 metadataHash,
        uint64 dueAt
    ) external onlyCompanyOperator(company) returns (bytes32) {
        if (!core.isCompanyRegistered(company)) revert CompanyNotRegistered();
        if (payer == address(0) || payer == company) revert InvalidPayer();
        if (dueAt != 0 && dueAt <= uint64(block.timestamp)) revert InvalidDueDate();

        euint128 totalAmount = _sanitizePositive(FHE.asEuint128(encryptedTotalAmount));

        bytes32 invoiceId = _nextInvoiceId(company, payer, metadataHash);
        invoices[invoiceId] = Invoice({
            invoiceId: invoiceId,
            issuer: msg.sender,
            payer: payer,
            company: company,
            createdAt: uint64(block.timestamp),
            dueAt: dueAt,
            metadataHash: metadataHash,
            status: InvoiceStatus.PendingApproval,
            paymentCount: 0,
            exists: true
        });

        invoiceTotals[invoiceId] = totalAmount;
        invoiceOutstanding[invoiceId] = totalAmount;
        companyInvoices[company].push(invoiceId);
        payerInvoices[payer].push(invoiceId);
        _refreshInvoiceHandles(invoiceId);
        _allowAnalyticsHandle(totalAmount);
        IHexaPayAnalytics(core.analyticsModule()).increaseInvoiceExposure(company, totalAmount);

        emit InvoiceCreated(invoiceId, company, payer, msg.sender, dueAt);
        return invoiceId;
    }

    function addInvoiceLineItems(
        bytes32 invoiceId,
        InEuint128[] calldata encryptedAmounts,
        bytes32[] calldata labelHashes
    ) external {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (!_canManageInvoice(invoiceId, msg.sender)) revert NotInvoiceOperator();
        if (encryptedAmounts.length != labelHashes.length) revert LengthMismatch();
        if (encryptedAmounts.length == 0) revert NoLineItems();
        if (invoice.paymentCount != 0) revert InvoiceAlreadyFunded();
        if (!_isInvoiceEditable(invoice.status)) revert InvoiceNotEditable();

        for (uint256 i = 0; i < encryptedAmounts.length; i++) {
            euint128 amount = _sanitizePositive(FHE.asEuint128(encryptedAmounts[i]));

            invoiceLineItems[invoiceId].push(
                InvoiceLineItem({labelHash: labelHashes[i], amount: amount})
            );
        }

        _refreshInvoiceHandles(invoiceId);

        emit InvoiceLineItemsAdded(invoiceId, encryptedAmounts.length);
    }

    function approveInvoice(bytes32 invoiceId) external {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (!_canActForInvoicePayer(invoice.payer, msg.sender)) revert NotInvoicePayer();
        if (invoice.status != InvoiceStatus.PendingApproval) revert InvoiceNotPending();

        invoice.status = InvoiceStatus.Approved;
        emit InvoiceApproved(invoiceId, msg.sender);
    }

    function rejectInvoice(bytes32 invoiceId, bytes32 reasonHash) external {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (!_canActForInvoicePayer(invoice.payer, msg.sender)) revert NotInvoicePayer();
        if (invoice.status != InvoiceStatus.PendingApproval) revert InvoiceNotPending();

        invoice.status = InvoiceStatus.Rejected;
        _allowAnalyticsHandle(invoiceOutstanding[invoiceId]);
        IHexaPayAnalytics(core.analyticsModule()).decreaseInvoiceExposure(
            invoice.company,
            invoiceOutstanding[invoiceId]
        );
        emit InvoiceRejected(invoiceId, msg.sender, reasonHash);
    }

    function cancelInvoice(bytes32 invoiceId) external {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (!_canManageInvoice(invoiceId, msg.sender)) revert NotInvoiceOperator();
        if (_isPolicyActive(invoice.company, PolicyActionType.InvoiceCancellation)) {
            revert PolicyApprovalRequired();
        }

        _cancelInvoiceRecord(invoiceId);
    }

    function payInvoice(bytes32 invoiceId, InEuint128 calldata encryptedAmount)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (!_canActForInvoicePayer(invoice.payer, msg.sender)) revert NotInvoicePayer();
        if (_isPolicyActive(invoice.payer, PolicyActionType.InvoicePayment)) {
            revert PolicyApprovalRequired();
        }

        euint128 amount = FHE.asEuint128(encryptedAmount);
        paymentId = _settleInvoicePayment(invoiceId, amount);
    }

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
        )
    {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();

        return (
            invoice.issuer,
            invoice.payer,
            invoice.company,
            invoice.createdAt,
            invoice.dueAt,
            invoice.metadataHash,
            invoice.status,
            invoice.paymentCount
        );
    }

    function getInvoicePayments(bytes32 invoiceId) external view returns (bytes32[] memory) {
        if (!invoices[invoiceId].exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();
        return invoicePayments[invoiceId];
    }

    function getCompanyInvoices(address company) external view returns (bytes32[] memory) {
        if (
            !core.isCompanyOperator(company, msg.sender) &&
            !_hasAuditorScope(company, msg.sender, IHexaPay.ComplianceScope.Invoice)
        ) revert NoInvoiceAccess();
        return companyInvoices[company];
    }

    function getPayerInvoices(address payer) external view returns (bytes32[] memory) {
        if (
            msg.sender != payer &&
            !core.isCompanyOperator(payer, msg.sender) &&
            !_hasAuditorScope(payer, msg.sender, IHexaPay.ComplianceScope.Invoice)
        ) revert NoInvoiceAccess();
        return payerInvoices[payer];
    }

    function getInvoiceLineItemCount(bytes32 invoiceId) external view returns (uint256) {
        if (!invoices[invoiceId].exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();
        return invoiceLineItems[invoiceId].length;
    }

    function getInvoiceLineItemLabelHash(bytes32 invoiceId, uint256 index)
        external
        view
        returns (bytes32)
    {
        if (!invoices[invoiceId].exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();
        if (index >= invoiceLineItems[invoiceId].length) revert IndexOutOfBounds();
        return invoiceLineItems[invoiceId][index].labelHash;
    }

    function getSealedInvoiceAmount(bytes32 invoiceId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!invoices[invoiceId].exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();
        return euint128.unwrap(invoiceTotals[invoiceId]);
    }

    function getSealedInvoiceOutstanding(bytes32 invoiceId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!invoices[invoiceId].exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();
        return euint128.unwrap(invoiceOutstanding[invoiceId]);
    }

    function getSealedInvoiceLineItemAmount(bytes32 invoiceId, uint256 index, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!invoices[invoiceId].exists) revert UnknownInvoice();
        if (!_canViewInvoice(invoiceId, msg.sender)) revert NoInvoiceAccess();
        if (index >= invoiceLineItems[invoiceId].length) revert IndexOutOfBounds();
        return euint128.unwrap(invoiceLineItems[invoiceId][index].amount);
    }

    function isInvoiceOverdue(bytes32 invoiceId) external view returns (bool) {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) revert UnknownInvoice();

        return
            invoice.dueAt != 0 &&
            invoice.dueAt < uint64(block.timestamp) &&
            invoice.status != InvoiceStatus.Paid &&
            invoice.status != InvoiceStatus.Cancelled &&
            invoice.status != InvoiceStatus.Rejected;
    }

    function setPolicyRule(
        address company,
        PolicyActionType actionType,
        uint8 minApprovals,
        uint64 approvalTtl,
        bool active
    ) external onlyCompanyOwner(company) {
        if (!core.isCompanyRegistered(company)) revert CompanyNotRegistered();

        if (active) {
            if (minApprovals == 0) revert InvalidApprovals();
            if (approvalTtl == 0) revert InvalidApprovals();
        }

        policyRules[company][actionType] = PolicyRule({
            minApprovals: minApprovals,
            approvalTtl: approvalTtl,
            active: active
        });

        emit PolicyRuleUpdated(company, actionType, minApprovals, approvalTtl, active);
    }

    function getPolicyRule(address company, PolicyActionType actionType)
        external
        view
        returns (uint8 minApprovals, uint64 approvalTtl, bool active)
    {
        PolicyRule memory rule = policyRules[company][actionType];
        return (rule.minApprovals, rule.approvalTtl, rule.active);
    }

    function _settleInvoicePayment(bytes32 invoiceId, euint128 amount)
        internal
        returns (bytes32 paymentId)
    {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (
            invoice.status != InvoiceStatus.Approved &&
            invoice.status != InvoiceStatus.PartiallyPaid
        ) revert InvoiceNotPayable();

        euint128 payerBalance = euint128.wrap(core.getAccountBalanceHandle(invoice.payer));
        euint128 safeAmount = FHE.min(_sanitizePositive(amount), invoiceOutstanding[invoiceId]);
        safeAmount = FHE.min(safeAmount, payerBalance);

        bytes32 referenceHash = keccak256(
            abi.encodePacked(invoiceId, invoice.paymentCount + 1, invoice.metadataHash)
        );

        _allowCoreHandle(safeAmount);
        paymentId = core.createManagedPayment(
            invoice.payer,
            invoice.company,
            safeAmount,
            referenceHash,
            IHexaPay.PaymentKind.Invoice
        );

        invoiceOutstanding[invoiceId] = FHE.sub(invoiceOutstanding[invoiceId], safeAmount);
        invoice.paymentCount += 1;
        invoicePayments[invoiceId].push(paymentId);
        _refreshInvoiceHandles(invoiceId);
        _allowAnalyticsHandle(safeAmount);
        IHexaPayAnalytics(core.analyticsModule()).decreaseInvoiceExposure(invoice.company, safeAmount);
        invoice.status = InvoiceStatus.PartiallyPaid;

        emit InvoicePaymentApplied(invoiceId, paymentId, invoice.paymentCount);
    }

    function _cancelInvoiceRecord(bytes32 invoiceId) internal {
        Invoice storage invoice = invoices[invoiceId];

        if (!invoice.exists) revert UnknownInvoice();
        if (invoice.paymentCount != 0) revert InvoiceAlreadyFunded();
        if (!_isInvoiceEditable(invoice.status)) revert InvoiceNotCancellable();

        _allowAnalyticsHandle(invoiceOutstanding[invoiceId]);
        IHexaPayAnalytics(core.analyticsModule()).decreaseInvoiceExposure(
            invoice.company,
            invoiceOutstanding[invoiceId]
        );
        invoice.status = InvoiceStatus.Cancelled;
        emit InvoiceCancelled(invoiceId);
    }

    function _sanitizePositive(euint128 amount) internal returns (euint128) {
        return FHE.select(FHE.gt(amount, euint128.wrap(0)), amount, euint128.wrap(0));
    }

    function _allowCoreHandle(euint128 handle) internal {
        if (euint128.unwrap(handle) == 0) {
            return;
        }

        FHE.allow(handle, address(core));
    }

    function _allowAnalyticsHandle(euint128 handle) internal {
        address analytics = core.analyticsModule();

        if (analytics == address(0) || euint128.unwrap(handle) == 0) {
            return;
        }

        FHE.allow(handle, analytics);
    }

    function _refreshInvoiceHandles(bytes32 invoiceId) internal {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) {
            return;
        }

        _grantHandle(invoiceTotals[invoiceId], invoice.issuer, invoice.payer, invoice.company);
        _grantHandle(invoiceOutstanding[invoiceId], invoice.issuer, invoice.payer, invoice.company);

        for (uint256 i = 0; i < invoiceLineItems[invoiceId].length; i++) {
            _grantHandle(invoiceLineItems[invoiceId][i].amount, invoice.issuer, invoice.payer, invoice.company);
        }
    }

    function _grantHandle(
        euint128 handle,
        address primary,
        address secondary,
        address tertiary
    ) internal {
        if (euint128.unwrap(handle) == 0) {
            return;
        }

        FHE.allowThis(handle);
        if (primary != address(0)) {
            FHE.allow(handle, primary);
        }
        if (secondary != address(0) && secondary != primary) {
            FHE.allow(handle, secondary);
        }
        if (tertiary != address(0) && tertiary != primary && tertiary != secondary) {
            FHE.allow(handle, tertiary);
        }
    }

    function _isPolicyActive(address company, PolicyActionType actionType) internal view returns (bool) {
        return core.isCompanyRegistered(company) && policyRules[company][actionType].active;
    }

    function _hasAuditorScope(
        address subject,
        address viewer,
        IHexaPay.ComplianceScope scope
    ) internal view returns (bool) {
        return core.canAuditorViewScope(subject, viewer, scope);
    }

    function _canActForInvoicePayer(address payer, address actor) internal view returns (bool) {
        return actor == payer || core.isCompanyOperator(payer, actor);
    }

    function _canManageInvoice(bytes32 invoiceId, address operator) internal view returns (bool) {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) {
            return false;
        }

        return operator == invoice.issuer || core.isCompanyOperator(invoice.company, operator);
    }

    function _canViewInvoice(bytes32 invoiceId, address viewer) internal view returns (bool) {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) {
            return false;
        }

        if (
            viewer == invoice.issuer ||
            viewer == invoice.payer ||
            core.isCompanyOperator(invoice.payer, viewer) ||
            core.isCompanyOperator(invoice.company, viewer)
        ) {
            return true;
        }

        return
            _hasAuditorScope(invoice.company, viewer, IHexaPay.ComplianceScope.Invoice) ||
            _hasAuditorScope(invoice.payer, viewer, IHexaPay.ComplianceScope.Invoice) ||
            _hasAuditorScope(invoice.issuer, viewer, IHexaPay.ComplianceScope.Invoice);
    }

    function _isInvoiceEditable(InvoiceStatus status) internal pure returns (bool) {
        return status == InvoiceStatus.PendingApproval || status == InvoiceStatus.Approved;
    }

    function _nextInvoiceId(
        address company,
        address payer,
        bytes32 metadataHash
    ) internal returns (bytes32) {
        invoiceNonce += 1;
        return keccak256(
            abi.encodePacked(address(core), company, payer, metadataHash, invoiceNonce)
        );
    }

}
