// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./HexaPayWorkflowWriteDelegate.sol";
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
    address private immutable writeDelegate;

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

    modifier onlyCompanyOperator(address company) {
        if (!core.isCompanyOperator(company, msg.sender)) revert NotCompanyOperator();
        _;
    }

    constructor(address core_) {
        if (core_ == address(0)) revert InvalidCore();
        core = IHexaPayCore(core_);
        writeDelegate = address(new HexaPayWorkflowWriteDelegate(core_));
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
        invoiceId;
        _delegateWriteCall();
    }

    function payInvoice(bytes32 invoiceId, InEuint128 calldata encryptedAmount)
        external
        returns (bytes32 paymentId)
    {
        invoiceId;
        encryptedAmount;
        return abi.decode(_delegateWriteCall(), (bytes32));
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
    ) external {
        company;
        actionType;
        minApprovals;
        approvalTtl;
        active;
        _delegateWriteCall();
    }

    function getPolicyRule(address company, PolicyActionType actionType)
        external
        view
        returns (uint8 minApprovals, uint64 approvalTtl, bool active)
    {
        PolicyRule memory rule = policyRules[company][actionType];
        return (rule.minApprovals, rule.approvalTtl, rule.active);
    }

    function setSignerActionPermission(
        address signer,
        PolicyActionType actionType,
        bool approved
    ) external {
        signer;
        actionType;
        approved;
        _delegateWriteCall();
    }

    function isSignerAuthorizedForAction(
        address company,
        address signer,
        PolicyActionType actionType
    ) public view returns (bool) {
        if (company == address(0) || signer == address(0) || signer == company) {
            return false;
        }

        return
            signerActionPermissions[company][signer][actionType] &&
            core.isCompanyOperator(company, signer);
    }

    function proposeInvoicePayment(
        bytes32 invoiceId,
        InEuint128 calldata encryptedAmount,
        bytes32 metadataHash
    ) external returns (bytes32 actionId) {
        invoiceId;
        encryptedAmount;
        metadataHash;
        return abi.decode(_delegateWriteCall(), (bytes32));
    }

    function proposePayrollExecution(bytes32 scheduleId, bytes32 metadataHash)
        external
        returns (bytes32 actionId)
    {
        scheduleId;
        metadataHash;
        return abi.decode(_delegateWriteCall(), (bytes32));
    }

    function proposeInvoiceCancellation(bytes32 invoiceId, bytes32 metadataHash)
        external
        returns (bytes32 actionId)
    {
        invoiceId;
        metadataHash;
        return abi.decode(_delegateWriteCall(), (bytes32));
    }

    function approvePendingAction(bytes32 actionId) external {
        actionId;
        _delegateWriteCall();
    }

    function revokePendingActionApproval(bytes32 actionId) external {
        actionId;
        _delegateWriteCall();
    }

    function executePendingAction(bytes32 actionId)
        external
        returns (bytes32 resultId)
    {
        actionId;
        return abi.decode(_delegateWriteCall(), (bytes32));
    }

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
        )
    {
        PendingAction storage action = pendingActions[actionId];
        if (!action.exists) revert UnknownAction();
        if (!_canViewPendingAction(actionId, msg.sender)) revert NoActionAccess();

        return (
            action.company,
            action.proposer,
            action.resourceId,
            action.metadataHash,
            action.actionType,
            action.createdAt,
            action.expiresAt,
            action.approvalCount,
            action.executed
        );
    }

    function getPendingActionApprovers(bytes32 actionId) external view returns (address[] memory) {
        if (!pendingActions[actionId].exists) revert UnknownAction();
        if (!_canViewPendingAction(actionId, msg.sender)) revert NoActionAccess();
        return pendingActionApprovers[actionId];
    }

    function getCompanyPendingActions(address company) external view returns (bytes32[] memory) {
        if (!_canViewCompanyPendingActions(company, msg.sender)) revert NoActionAccess();
        return companyPendingActions[company];
    }

    function getSealedPendingActionAmount(bytes32 actionId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!pendingActions[actionId].exists) revert UnknownAction();
        if (!pendingActionHasAmount[actionId]) revert ActionHasNoAmount();
        if (!_canViewPendingAction(actionId, msg.sender)) revert NoActionAccess();
        return euint128.unwrap(pendingActionAmounts[actionId]);
    }

    function createPayrollSchedule(
        address company,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 firstPaymentAt,
        bytes32 metadataHash
    ) external returns (bytes32 scheduleId) {
        company;
        employees;
        encryptedGrossAmounts;
        frequency;
        firstPaymentAt;
        metadataHash;
        return abi.decode(_delegateWriteCall(), (bytes32));
    }

    function updatePayrollSchedule(
        bytes32 scheduleId,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 nextPaymentAt,
        bytes32 metadataHash
    ) external {
        scheduleId;
        employees;
        encryptedGrossAmounts;
        frequency;
        nextPaymentAt;
        metadataHash;
        _delegateWriteCall();
    }

    function executePayroll(bytes32 scheduleId) external {
        scheduleId;
        _delegateWriteCall();
    }

    function cancelPayrollSchedule(bytes32 scheduleId) external {
        scheduleId;
        _delegateWriteCall();
    }

    function getEmployerSchedules(address employer) external view returns (bytes32[] memory) {
        if (
            !core.isCompanyOperator(employer, msg.sender) &&
            !_hasAuditorScope(employer, msg.sender, IHexaPay.ComplianceScope.Payroll)
        ) revert NoPayrollAccess();
        return employerSchedules[employer];
    }

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
        )
    {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (!_canViewPayrollSchedule(scheduleId, msg.sender)) revert NoPayrollAccess();

        return (
            schedule.employer,
            schedule.employees,
            schedule.frequency,
            schedule.nextPaymentAt,
            schedule.metadataHash,
            schedule.active
        );
    }

    function getSealedPayrollAmount(
        bytes32 scheduleId,
        uint256 index,
        bytes32 publicKey
    ) external view returns (uint256) {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        publicKey;
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (index >= schedule.grossAmounts.length) revert IndexOutOfBounds();
        if (!_canViewPayrollAmount(scheduleId, index, msg.sender)) revert NoPayrollAccess();
        return euint128.unwrap(schedule.grossAmounts[index]);
    }

    function _sanitizePositive(euint128 amount) internal returns (euint128) {
        return FHE.select(FHE.gt(amount, euint128.wrap(0)), amount, euint128.wrap(0));
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
            _grantHandle(
                invoiceLineItems[invoiceId][i].amount,
                invoice.issuer,
                invoice.payer,
                invoice.company
            );
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

    function _canViewPendingAction(bytes32 actionId, address viewer) internal view returns (bool) {
        PendingAction storage action = pendingActions[actionId];
        if (!action.exists) {
            return false;
        }

        if (
            viewer == action.proposer ||
            viewer == action.company ||
            core.isCompanyOperator(action.company, viewer)
        ) {
            return true;
        }

        return
            core.hasActiveComplianceGrant(action.company, viewer) ||
            _hasAuditorScope(action.company, viewer, _scopeForAction(action.actionType));
    }

    function _canViewCompanyPendingActions(address company, address viewer)
        internal
        view
        returns (bool)
    {
        return
            core.isCompanyOperator(company, viewer) ||
            core.hasActiveComplianceGrant(company, viewer) ||
            _hasAuditorScope(company, viewer, IHexaPay.ComplianceScope.Invoice) ||
            _hasAuditorScope(company, viewer, IHexaPay.ComplianceScope.Payroll);
    }

    function _canViewPayrollSchedule(bytes32 scheduleId, address viewer) internal view returns (bool) {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) {
            return false;
        }

        if (core.isCompanyOperator(schedule.employer, viewer)) {
            return true;
        }

        for (uint256 i = 0; i < schedule.employees.length; i++) {
            if (viewer == schedule.employees[i]) {
                return true;
            }
        }

        if (_hasAuditorScope(schedule.employer, viewer, IHexaPay.ComplianceScope.Payroll)) {
            return true;
        }

        for (uint256 i = 0; i < schedule.employees.length; i++) {
            if (_hasAuditorScope(schedule.employees[i], viewer, IHexaPay.ComplianceScope.Payroll)) {
                return true;
            }
        }

        return false;
    }

    function _canViewPayrollAmount(
        bytes32 scheduleId,
        uint256 index,
        address viewer
    ) internal view returns (bool) {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId) || index >= schedule.employees.length) {
            return false;
        }

        return
            core.isCompanyOperator(schedule.employer, viewer) ||
            viewer == schedule.employees[index] ||
            _hasAuditorScope(schedule.employer, viewer, IHexaPay.ComplianceScope.Payroll) ||
            _hasAuditorScope(schedule.employees[index], viewer, IHexaPay.ComplianceScope.Payroll);
    }

    function _isInvoiceEditable(InvoiceStatus status) internal pure returns (bool) {
        return status == InvoiceStatus.PendingApproval || status == InvoiceStatus.Approved;
    }

    function _scopeForAction(PolicyActionType actionType)
        internal
        pure
        returns (IHexaPay.ComplianceScope)
    {
        if (actionType == PolicyActionType.PayrollExecution) {
            return IHexaPay.ComplianceScope.Payroll;
        }

        return IHexaPay.ComplianceScope.Invoice;
    }

    function _scheduleExists(bytes32 scheduleId) internal view returns (bool) {
        return payrollSchedules[scheduleId].scheduleId != bytes32(0);
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

    function _delegateWriteCall() internal returns (bytes memory result) {
        (bool success, bytes memory returndata) = writeDelegate.delegatecall(msg.data);
        if (!success) {
            assembly {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }

        return returndata;
    }
}
