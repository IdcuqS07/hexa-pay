// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IHexaPay.sol";
import "./interfaces/IHexaPayCore.sol";
import "./interfaces/IHexaPayAnalytics.sol";

/**
 * @title HexaPayAnalyticsModule
 * @notice Confidential aggregate analytics with sealed reads and lightweight checkpoints.
 */
contract HexaPayAnalyticsModule {
    error InvalidCompany();
    error InvalidCore();
    error InvalidTimeRange();
    error NoAnalyticsAccess();
    error NotCore();
    error NotEscrowModule();
    error NotWorkflowModule();
    error UnknownCheckpoint();

    struct SpendCheckpoint {
        uint64 timestamp;
        euint128 cumulative;
        bytes32 checkpointId;
    }

    struct AnalyticsCheckpoint {
        bytes32 checkpointId;
        address company;
        bytes32 snapshotHash;
        uint64 timestamp;
    }

    IHexaPayCore public immutable core;

    mapping(address => euint128) private companySpendCumulative;
    mapping(address => SpendCheckpoint[]) private companySpendHistory;
    mapping(bytes32 => euint128) private payrollRunTotals;
    mapping(bytes32 => address) private payrollRunOwners;
    mapping(address => euint128) private companyInvoiceExposure;
    mapping(address => euint128) private companyEscrowExposure;
    mapping(bytes32 => AnalyticsCheckpoint) private analyticsCheckpoints;
    mapping(address => bytes32[]) private companyCheckpoints;
    uint256 private checkpointNonce;

    event AnalyticsCheckpointCreated(
        bytes32 indexed checkpointId,
        address indexed company,
        bytes32 snapshotHash,
        uint64 timestamp
    );
    event SpendRecorded(address indexed company, bytes32 indexed checkpointId);
    event PayrollRunRecorded(bytes32 indexed scheduleId, address indexed employer, uint64 timestamp);
    event InvoiceExposureUpdated(address indexed company, bool increased, uint64 timestamp);
    event EscrowExposureUpdated(address indexed company, bool increased, uint64 timestamp);

    modifier onlyCore() {
        if (msg.sender != address(core)) revert NotCore();
        _;
    }

    modifier onlyWorkflowModule() {
        if (msg.sender != core.workflowModule()) revert NotWorkflowModule();
        _;
    }

    modifier onlyEscrowModule() {
        if (msg.sender != core.escrowModule()) revert NotEscrowModule();
        _;
    }

    constructor(address core_) {
        if (core_ == address(0)) revert InvalidCore();
        core = IHexaPayCore(core_);
    }

    function recordPaymentSpend(
        address company,
        euint128 totalDebit
    ) external onlyCore returns (bytes32 checkpointId) {
        if (company == address(0)) revert InvalidCompany();

        companySpendCumulative[company] = FHE.add(companySpendCumulative[company], totalDebit);
        _grantCompanyHandle(companySpendCumulative[company], company);
        checkpointId = keccak256(
            abi.encodePacked(address(core), company, block.timestamp, companySpendHistory[company].length)
        );

        companySpendHistory[company].push(
            SpendCheckpoint({
                timestamp: uint64(block.timestamp),
                cumulative: companySpendCumulative[company],
                checkpointId: checkpointId
            })
        );
        _grantCompanyHandle(companySpendHistory[company][companySpendHistory[company].length - 1].cumulative, company);

        emit SpendRecorded(company, checkpointId);
    }

    function recordPayrollRun(
        bytes32 scheduleId,
        address employer,
        euint128 totalAmount
    ) external onlyWorkflowModule {
        payrollRunTotals[scheduleId] = totalAmount;
        payrollRunOwners[scheduleId] = employer;
        _grantCompanyHandle(payrollRunTotals[scheduleId], employer);

        emit PayrollRunRecorded(scheduleId, employer, uint64(block.timestamp));
    }

    function increaseInvoiceExposure(address company, euint128 amount) external onlyWorkflowModule {
        companyInvoiceExposure[company] = FHE.add(companyInvoiceExposure[company], amount);
        _grantCompanyHandle(companyInvoiceExposure[company], company);
        emit InvoiceExposureUpdated(company, true, uint64(block.timestamp));
    }

    function decreaseInvoiceExposure(address company, euint128 amount) external onlyWorkflowModule {
        companyInvoiceExposure[company] = FHE.sub(companyInvoiceExposure[company], amount);
        _grantCompanyHandle(companyInvoiceExposure[company], company);
        emit InvoiceExposureUpdated(company, false, uint64(block.timestamp));
    }

    function increaseEscrowExposure(address company, euint128 amount) external onlyEscrowModule {
        companyEscrowExposure[company] = FHE.add(companyEscrowExposure[company], amount);
        _grantCompanyHandle(companyEscrowExposure[company], company);
        emit EscrowExposureUpdated(company, true, uint64(block.timestamp));
    }

    function decreaseEscrowExposure(address company, euint128 amount) external onlyEscrowModule {
        companyEscrowExposure[company] = FHE.sub(companyEscrowExposure[company], amount);
        _grantCompanyHandle(companyEscrowExposure[company], company);
        emit EscrowExposureUpdated(company, false, uint64(block.timestamp));
    }

    function getSealedCompanySpend(
        address company,
        uint64 from,
        uint64 to,
        bytes32 publicKey
    ) external view returns (uint256) {
        publicKey;
        if (!_canViewAnalytics(company, msg.sender)) revert NoAnalyticsAccess();
        if (to != 0 && from > to) revert InvalidTimeRange();

        euint128 upper = to == 0 ? companySpendCumulative[company] : _cumulativeSpendAt(company, to);
        if (from == 0) {
            return euint128.unwrap(upper);
        }

        euint128 lower = _cumulativeSpendBefore(company, from);
        uint256 upperValue = euint128.unwrap(upper);
        uint256 lowerValue = euint128.unwrap(lower);
        if (upperValue <= lowerValue) {
            return 0;
        }

        return upperValue - lowerValue;
    }

    function getSealedPayrollRunTotal(bytes32 scheduleId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        address employer = payrollRunOwners[scheduleId];
        if (employer == address(0)) revert NoAnalyticsAccess();
        if (!_canViewAnalytics(employer, msg.sender)) revert NoAnalyticsAccess();
        return euint128.unwrap(payrollRunTotals[scheduleId]);
    }

    function getSealedInvoiceExposure(address company, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!_canViewAnalytics(company, msg.sender)) revert NoAnalyticsAccess();
        return euint128.unwrap(companyInvoiceExposure[company]);
    }

    function getSealedEscrowExposure(address company, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!_canViewAnalytics(company, msg.sender)) revert NoAnalyticsAccess();
        return euint128.unwrap(companyEscrowExposure[company]);
    }

    function checkpointAnalytics(address company, bytes32 snapshotHash) external returns (bytes32 checkpointId) {
        if (company == address(0)) revert InvalidCompany();
        if (!_canManageAnalytics(company, msg.sender)) revert NoAnalyticsAccess();

        checkpointNonce += 1;
        checkpointId = keccak256(
            abi.encodePacked(address(core), company, snapshotHash, checkpointNonce)
        );

        analyticsCheckpoints[checkpointId] = AnalyticsCheckpoint({
            checkpointId: checkpointId,
            company: company,
            snapshotHash: snapshotHash,
            timestamp: uint64(block.timestamp)
        });
        companyCheckpoints[company].push(checkpointId);

        emit AnalyticsCheckpointCreated(checkpointId, company, snapshotHash, uint64(block.timestamp));
    }

    function getAnalyticsCheckpoint(bytes32 checkpointId)
        external
        view
        returns (IHexaPayAnalytics.AnalyticsCheckpoint memory)
    {
        AnalyticsCheckpoint memory checkpoint = analyticsCheckpoints[checkpointId];
        if (checkpoint.checkpointId == bytes32(0)) revert UnknownCheckpoint();
        if (!_canViewAnalytics(checkpoint.company, msg.sender)) revert NoAnalyticsAccess();

        return IHexaPayAnalytics.AnalyticsCheckpoint({
            checkpointId: checkpoint.checkpointId,
            company: checkpoint.company,
            snapshotHash: checkpoint.snapshotHash,
            timestamp: checkpoint.timestamp
        });
    }

    function getCompanyCheckpoints(address company) external view returns (bytes32[] memory) {
        if (!_canViewAnalytics(company, msg.sender)) revert NoAnalyticsAccess();
        return companyCheckpoints[company];
    }

    function _cumulativeSpendAt(address company, uint64 timestamp) internal view returns (euint128 cumulative) {
        SpendCheckpoint[] storage history = companySpendHistory[company];
        cumulative = euint128.wrap(0);

        for (uint256 i = 0; i < history.length; i++) {
            if (history[i].timestamp <= timestamp) {
                cumulative = history[i].cumulative;
            } else {
                break;
            }
        }
    }

    function _cumulativeSpendBefore(address company, uint64 timestamp)
        internal
        view
        returns (euint128 cumulative)
    {
        SpendCheckpoint[] storage history = companySpendHistory[company];
        cumulative = euint128.wrap(0);

        for (uint256 i = 0; i < history.length; i++) {
            if (history[i].timestamp < timestamp) {
                cumulative = history[i].cumulative;
            } else {
                break;
            }
        }
    }

    function _canManageAnalytics(address company, address viewer) internal view returns (bool) {
        return viewer == company || core.isCompanyOperator(company, viewer);
    }

    function _canViewAnalytics(address company, address viewer) internal view returns (bool) {
        return
            _canManageAnalytics(company, viewer) ||
            core.canAuditorViewScope(company, viewer, IHexaPay.ComplianceScope.Analytics);
    }

    function _grantCompanyHandle(euint128 handle, address company) internal {
        if (company == address(0) || euint128.unwrap(handle) == 0) {
            return;
        }

        FHE.allowThis(handle);
        FHE.allow(handle, company);
    }
}
