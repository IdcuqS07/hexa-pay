// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title IHexaPayAnalytics
 * @notice Interface for confidential analytics and sealed aggregate reads.
 */
interface IHexaPayAnalytics {
    struct AnalyticsCheckpoint {
        bytes32 checkpointId;
        address company;
        bytes32 snapshotHash;
        uint64 timestamp;
    }

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

    function core() external view returns (address);

    function recordPaymentSpend(address company, euint128 totalDebit) external returns (bytes32);

    function recordPayrollRun(bytes32 scheduleId, address employer, euint128 totalAmount) external;

    function increaseInvoiceExposure(address company, euint128 amount) external;

    function decreaseInvoiceExposure(address company, euint128 amount) external;

    function increaseEscrowExposure(address company, euint128 amount) external;

    function decreaseEscrowExposure(address company, euint128 amount) external;

    function getSealedCompanySpend(
        address company,
        uint64 from,
        uint64 to,
        bytes32 publicKey
    ) external view returns (uint256);

    function getSealedPayrollRunTotal(bytes32 scheduleId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedInvoiceExposure(address company, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedEscrowExposure(address company, bytes32 publicKey)
        external
        view
        returns (uint256);

    function checkpointAnalytics(address company, bytes32 snapshotHash) external returns (bytes32);

    function getAnalyticsCheckpoint(bytes32 checkpointId)
        external
        view
        returns (AnalyticsCheckpoint memory);

    function getCompanyCheckpoints(address company) external view returns (bytes32[] memory);
}
