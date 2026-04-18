// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IHexaPay.sol";
import "./interfaces/IHexaPayAnalytics.sol";
import "./interfaces/IHexaPayCore.sol";

/**
 * @title HexaPayWorkflowWriteDelegate
 * @notice Delegatecall target that hosts workflow write-path logic to keep the main module deployable.
 */
contract HexaPayWorkflowWriteDelegate {
    uint16 private constant BPS_DENOMINATOR = 10_000;

    error ActionAlreadyExecuted();
    error AlreadyApproved();
    error ActionExpired();
    error ActionHasNoAmount();
    error ApprovalNotFound();
    error CompanyNotRegistered();
    error InsufficientApprovals();
    error InvalidApprovals();
    error InvalidCore();
    error InvalidDueDate();
    error InvalidFrequency();
    error InvalidEmployee();
    error InvalidSigner();
    error InvoiceAlreadyFunded();
    error InvoiceNotCancellable();
    error InvoiceNotEditable();
    error InvoiceNotPayable();
    error LengthMismatch();
    error NoEmployees();
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

    event InvoiceCancelled(bytes32 indexed invoiceId);
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
        if (
            core.isCompanyRegistered(invoice.payer) &&
            _isPolicyActive(invoice.payer, PolicyActionType.InvoicePayment)
        ) revert PolicyApprovalRequired();

        paymentId = _settleInvoicePayment(invoiceId, FHE.asEuint128(encryptedAmount));
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

    function setSignerActionPermission(
        address signer,
        PolicyActionType actionType,
        bool approved
    ) external {
        if (!core.isCompanyRegistered(msg.sender)) revert CompanyNotRegistered();
        if (signer == address(0)) revert InvalidSigner();
        if (signer != msg.sender && !core.isCompanyOperator(msg.sender, signer)) {
            revert InvalidSigner();
        }

        signerActionPermissions[msg.sender][signer][actionType] = approved;

        emit SignerActionPermissionUpdated(msg.sender, signer, actionType, approved);
    }

    function proposeInvoicePayment(
        bytes32 invoiceId,
        InEuint128 calldata encryptedAmount,
        bytes32 metadataHash
    ) external returns (bytes32 actionId) {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) revert UnknownInvoice();
        if (!core.isCompanyRegistered(invoice.payer)) revert PayerCompanyNotRegistered();
        if (!_isPolicyActive(invoice.payer, PolicyActionType.InvoicePayment)) revert PolicyNotActive();
        if (!_canActOnPolicyAction(invoice.payer, msg.sender, PolicyActionType.InvoicePayment)) {
            revert NotPolicySigner();
        }

        actionId = _createPendingAction(
            invoice.payer,
            invoiceId,
            metadataHash,
            PolicyActionType.InvoicePayment,
            _sanitizePositive(FHE.asEuint128(encryptedAmount)),
            true
        );
    }

    function proposePayrollExecution(bytes32 scheduleId, bytes32 metadataHash)
        external
        returns (bytes32 actionId)
    {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (!schedule.active) revert ScheduleNotActive();
        if (!_isPolicyActive(schedule.employer, PolicyActionType.PayrollExecution)) {
            revert PolicyNotActive();
        }
        if (
            !_canActOnPolicyAction(schedule.employer, msg.sender, PolicyActionType.PayrollExecution)
        ) revert NotPolicySigner();

        actionId = _createPendingAction(
            schedule.employer,
            scheduleId,
            metadataHash,
            PolicyActionType.PayrollExecution,
            euint128.wrap(0),
            false
        );
    }

    function proposeInvoiceCancellation(bytes32 invoiceId, bytes32 metadataHash)
        external
        returns (bytes32 actionId)
    {
        Invoice storage invoice = invoices[invoiceId];
        if (!invoice.exists) revert UnknownInvoice();
        if (!_isPolicyActive(invoice.company, PolicyActionType.InvoiceCancellation)) {
            revert PolicyNotActive();
        }
        if (
            !_canActOnPolicyAction(invoice.company, msg.sender, PolicyActionType.InvoiceCancellation)
        ) revert NotPolicySigner();

        actionId = _createPendingAction(
            invoice.company,
            invoiceId,
            metadataHash,
            PolicyActionType.InvoiceCancellation,
            euint128.wrap(0),
            false
        );
    }

    function approvePendingAction(bytes32 actionId) external {
        PendingAction storage action = pendingActions[actionId];
        if (!action.exists) revert UnknownAction();
        if (!_canActOnPolicyAction(action.company, msg.sender, action.actionType)) {
            revert NotPolicySigner();
        }
        if (action.executed) revert ActionAlreadyExecuted();
        if (_isPendingActionExpired(action)) revert ActionExpired();

        _approvePendingAction(actionId, msg.sender);
        emit PendingActionApproved(actionId, msg.sender, action.approvalCount);
    }

    function revokePendingActionApproval(bytes32 actionId) external {
        PendingAction storage action = pendingActions[actionId];
        if (!action.exists) revert UnknownAction();
        if (!_canActOnPolicyAction(action.company, msg.sender, action.actionType)) {
            revert NotPolicySigner();
        }
        if (action.executed) revert ActionAlreadyExecuted();
        if (!pendingActionApprovals[actionId][msg.sender]) revert ApprovalNotFound();

        _revokePendingAction(actionId, msg.sender);
        emit PendingActionApprovalRevoked(actionId, msg.sender, action.approvalCount);
    }

    function executePendingAction(bytes32 actionId)
        external
        nonReentrant
        returns (bytes32 resultId)
    {
        PendingAction storage action = pendingActions[actionId];
        if (!action.exists) revert UnknownAction();
        if (!_canActOnPolicyAction(action.company, msg.sender, action.actionType)) {
            revert NotPolicySigner();
        }
        if (action.executed) revert ActionAlreadyExecuted();
        if (_isPendingActionExpired(action)) revert ActionExpired();

        PolicyRule memory rule = policyRules[action.company][action.actionType];
        if (action.approvalCount < rule.minApprovals) revert InsufficientApprovals();

        if (action.actionType == PolicyActionType.InvoicePayment) {
            if (!pendingActionHasAmount[actionId]) revert ActionHasNoAmount();
            resultId = _settleInvoicePayment(action.resourceId, pendingActionAmounts[actionId]);
        } else if (action.actionType == PolicyActionType.PayrollExecution) {
            _executePayrollSchedule(action.resourceId);
            resultId = action.resourceId;
        } else if (action.actionType == PolicyActionType.InvoiceCancellation) {
            _cancelInvoiceRecord(action.resourceId);
            resultId = action.resourceId;
        } else {
            revert UnsupportedAction();
        }

        action.executed = true;
        emit PendingActionExecuted(actionId, msg.sender, resultId);
    }

    function createPayrollSchedule(
        address company,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 firstPaymentAt,
        bytes32 metadataHash
    ) external onlyCompanyOperator(company) returns (bytes32 scheduleId) {
        if (!core.isCompanyRegistered(company)) revert CompanyNotRegistered();
        _validatePayrollScheduleInputs(employees, encryptedGrossAmounts, frequency, firstPaymentAt);

        scheduleId = _nextScheduleId(company, metadataHash);
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        schedule.scheduleId = scheduleId;
        schedule.employer = company;
        schedule.frequency = frequency;
        schedule.nextPaymentAt = firstPaymentAt;
        schedule.metadataHash = metadataHash;
        schedule.active = true;

        _replacePayrollScheduleEntries(schedule, company, employees, encryptedGrossAmounts);
        employerSchedules[company].push(scheduleId);
        _refreshPayrollHandles(scheduleId);

        emit PayrollScheduleCreated(scheduleId, company, employees.length);
    }

    function updatePayrollSchedule(
        bytes32 scheduleId,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 nextPaymentAt,
        bytes32 metadataHash
    ) external {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (!_canManagePayroll(scheduleId, msg.sender)) revert NotCompanyOperator();
        if (!schedule.active) revert ScheduleNotActive();

        _validatePayrollScheduleInputs(employees, encryptedGrossAmounts, frequency, nextPaymentAt);

        schedule.frequency = frequency;
        schedule.nextPaymentAt = nextPaymentAt;
        schedule.metadataHash = metadataHash;

        _replacePayrollScheduleEntries(
            schedule,
            schedule.employer,
            employees,
            encryptedGrossAmounts
        );
        _refreshPayrollHandles(scheduleId);

        emit PayrollScheduleUpdated(scheduleId);
    }

    function executePayroll(bytes32 scheduleId) external nonReentrant {
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (!_canManagePayroll(scheduleId, msg.sender)) revert NotCompanyOperator();

        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (_isPolicyActive(schedule.employer, PolicyActionType.PayrollExecution)) {
            revert PolicyApprovalRequired();
        }

        _executePayrollSchedule(scheduleId);
    }

    function cancelPayrollSchedule(bytes32 scheduleId) external {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (!_canManagePayroll(scheduleId, msg.sender)) revert NotCompanyOperator();
        if (!schedule.active) revert ScheduleNotActive();

        schedule.active = false;
        emit PayrollScheduleCancelled(scheduleId);
    }

    function _createPendingAction(
        address company,
        bytes32 resourceId,
        bytes32 metadataHash,
        PolicyActionType actionType,
        euint128 amount,
        bool hasAmount
    ) internal returns (bytes32 actionId) {
        PolicyRule memory rule = policyRules[company][actionType];
        if (!rule.active) revert PolicyNotActive();

        actionId = _nextPendingActionId(company, resourceId, metadataHash, actionType);
        pendingActions[actionId] = PendingAction({
            actionId: actionId,
            company: company,
            proposer: msg.sender,
            resourceId: resourceId,
            metadataHash: metadataHash,
            actionType: actionType,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp) + rule.approvalTtl,
            approvalCount: 0,
            executed: false,
            exists: true
        });
        companyPendingActions[company].push(actionId);

        if (hasAmount) {
            pendingActionAmounts[actionId] = amount;
            pendingActionHasAmount[actionId] = true;
            _grantHandle(amount, company, msg.sender, address(0));
        }

        _approvePendingAction(actionId, msg.sender);

        emit PendingActionProposed(
            actionId,
            company,
            actionType,
            resourceId,
            msg.sender,
            pendingActions[actionId].expiresAt
        );
    }

    function _approvePendingAction(bytes32 actionId, address approver) internal {
        PendingAction storage action = pendingActions[actionId];
        if (pendingActionApprovals[actionId][approver]) revert AlreadyApproved();

        pendingActionApprovals[actionId][approver] = true;
        pendingActionApprovers[actionId].push(approver);
        action.approvalCount += 1;
    }

    function _revokePendingAction(bytes32 actionId, address approver) internal {
        PendingAction storage action = pendingActions[actionId];
        address[] storage approvers = pendingActionApprovers[actionId];

        pendingActionApprovals[actionId][approver] = false;

        for (uint256 i = 0; i < approvers.length; i++) {
            if (approvers[i] == approver) {
                approvers[i] = approvers[approvers.length - 1];
                approvers.pop();
                break;
            }
        }

        action.approvalCount -= 1;
    }

    function _executePayrollSchedule(bytes32 scheduleId) internal {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) revert UnknownSchedule();
        if (!schedule.active) revert ScheduleNotActive();
        if (schedule.nextPaymentAt > uint64(block.timestamp)) revert NotTimeYet();

        euint128 totalRunAmount = euint128.wrap(0);
        uint256 paymentsCreated = 0;

        for (uint256 i = 0; i < schedule.employees.length; i++) {
            euint128 employerBalance = euint128.wrap(core.getAccountBalanceHandle(schedule.employer));
            euint128 safeAmount = _capAmountToSpendablePayroll(
                schedule.grossAmounts[i],
                employerBalance
            );

            if (euint128.unwrap(safeAmount) == 0) {
                continue;
            }

            bytes32 referenceHash = keccak256(
                abi.encodePacked(
                    scheduleId,
                    "payroll",
                    schedule.nextPaymentAt,
                    i,
                    schedule.metadataHash
                )
            );

            _allowCoreHandle(safeAmount);
            core.createManagedPayment(
                schedule.employer,
                schedule.employees[i],
                safeAmount,
                referenceHash,
                IHexaPay.PaymentKind.Payroll
            );

            totalRunAmount = FHE.add(totalRunAmount, safeAmount);
            paymentsCreated += 1;
        }

        schedule.nextPaymentAt += schedule.frequency;
        _refreshPayrollHandles(scheduleId);
        _allowAnalyticsHandle(totalRunAmount);
        IHexaPayAnalytics(core.analyticsModule()).recordPayrollRun(
            scheduleId,
            schedule.employer,
            totalRunAmount
        );

        emit PayrollExecuted(scheduleId, block.timestamp, paymentsCreated);
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

    function _replacePayrollScheduleEntries(
        PayrollSchedule storage schedule,
        address employer,
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts
    ) internal {
        delete schedule.employees;
        delete schedule.grossAmounts;

        for (uint256 i = 0; i < employees.length; i++) {
            if (employees[i] == address(0) || employees[i] == employer) revert InvalidEmployee();

            schedule.employees.push(employees[i]);
            schedule.grossAmounts.push(
                _sanitizePositive(FHE.asEuint128(encryptedGrossAmounts[i]))
            );
        }
    }

    function _validatePayrollScheduleInputs(
        address[] calldata employees,
        InEuint128[] calldata encryptedGrossAmounts,
        uint64 frequency,
        uint64 nextPaymentAt
    ) internal view {
        if (employees.length == 0) revert NoEmployees();
        if (employees.length != encryptedGrossAmounts.length) revert LengthMismatch();
        if (frequency == 0) revert InvalidFrequency();
        if (nextPaymentAt <= uint64(block.timestamp)) revert InvalidDueDate();
    }

    function _capAmountToSpendablePayroll(euint128 grossAmount, euint128 employerBalance)
        internal
        returns (euint128)
    {
        uint16 feeBps = core.platformFeeBps();
        if (feeBps == 0) {
            return FHE.min(grossAmount, employerBalance);
        }

        euint128 affordableGross = FHE.div(
            FHE.mul(employerBalance, FHE.asEuint128(BPS_DENOMINATOR)),
            FHE.asEuint128(BPS_DENOMINATOR + feeBps)
        );

        return FHE.min(grossAmount, affordableGross);
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
            _grantHandle(
                invoiceLineItems[invoiceId][i].amount,
                invoice.issuer,
                invoice.payer,
                invoice.company
            );
        }
    }

    function _refreshPayrollHandles(bytes32 scheduleId) internal {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) {
            return;
        }

        for (uint256 i = 0; i < schedule.grossAmounts.length; i++) {
            _grantHandle(schedule.grossAmounts[i], schedule.employer, schedule.employees[i], address(0));
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

    function _isPendingActionExpired(PendingAction storage action) internal view returns (bool) {
        return action.expiresAt < uint64(block.timestamp);
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

    function _canActOnPolicyAction(
        address company,
        address actor,
        PolicyActionType actionType
    ) internal view returns (bool) {
        return actor == company || _isSignerAuthorizedForAction(company, actor, actionType);
    }

    function _canManagePayroll(bytes32 scheduleId, address operator) internal view returns (bool) {
        PayrollSchedule storage schedule = payrollSchedules[scheduleId];
        if (!_scheduleExists(scheduleId)) {
            return false;
        }

        return core.isCompanyOperator(schedule.employer, operator);
    }

    function _isSignerAuthorizedForAction(
        address company,
        address signer,
        PolicyActionType actionType
    ) internal view returns (bool) {
        if (company == address(0) || signer == address(0) || signer == company) {
            return false;
        }

        return
            signerActionPermissions[company][signer][actionType] &&
            core.isCompanyOperator(company, signer);
    }

    function _isInvoiceEditable(InvoiceStatus status) internal pure returns (bool) {
        return status == InvoiceStatus.PendingApproval || status == InvoiceStatus.Approved;
    }

    function _scheduleExists(bytes32 scheduleId) internal view returns (bool) {
        return payrollSchedules[scheduleId].scheduleId != bytes32(0);
    }

    function _nextScheduleId(address company, bytes32 metadataHash) internal returns (bytes32) {
        scheduleNonce += 1;
        return keccak256(
            abi.encodePacked(address(core), company, metadataHash, scheduleNonce)
        );
    }

    function _nextPendingActionId(
        address company,
        bytes32 resourceId,
        bytes32 metadataHash,
        PolicyActionType actionType
    ) internal returns (bytes32) {
        pendingActionNonce += 1;
        return keccak256(
            abi.encodePacked(
                address(core),
                company,
                resourceId,
                metadataHash,
                actionType,
                pendingActionNonce
            )
        );
    }
}
