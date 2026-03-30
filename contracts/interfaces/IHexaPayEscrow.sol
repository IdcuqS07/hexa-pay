// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title IHexaPayEscrow
 * @notice Interface for the HexaPay confidential escrow and dispute module.
 */
interface IHexaPayEscrow {
    enum EscrowStatus {
        Open,
        Disputed,
        Released,
        Refunded,
        Resolved,
        Expired
    }

    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        uint64 expiresAt
    );
    event EscrowFunded(bytes32 indexed escrowId, bytes32 indexed paymentId, uint32 fundingCount);
    event EscrowMilestonesCreated(bytes32 indexed escrowId, uint256 milestoneCount);
    event EscrowReleaseApplied(bytes32 indexed escrowId, bytes32 indexed paymentId, uint32 releaseCount);
    event EscrowRefundApplied(bytes32 indexed escrowId, bytes32 indexed paymentId);
    event EscrowDisputeOpened(bytes32 indexed escrowId, address indexed opener, bytes32 reasonHash);
    event EscrowDisputeResolved(
        bytes32 indexed escrowId,
        address indexed resolver,
        uint16 buyerBps,
        uint16 sellerBps,
        bytes32 rulingHash
    );
    event EscrowExpiredClosed(bytes32 indexed escrowId, bytes32 indexed paymentId);

    function core() external view returns (address);

    function createEscrow(
        address seller,
        address arbiter,
        InEuint128 calldata encryptedTotalAmount,
        bytes32 metadataHash,
        uint64 expiresAt
    ) external returns (bytes32);

    function fundEscrow(bytes32 escrowId, InEuint128 calldata encryptedAmount)
        external
        returns (bytes32);

    function createEscrowMilestones(
        bytes32 escrowId,
        InEuint128[] calldata encryptedMilestoneAmounts,
        bytes32[] calldata referenceHashes
    ) external;

    function releaseEscrow(bytes32 escrowId, InEuint128 calldata encryptedAmount)
        external
        returns (bytes32);

    function releaseEscrowMilestone(bytes32 escrowId, uint256 milestoneIndex)
        external
        returns (bytes32);

    function refundEscrow(bytes32 escrowId, InEuint128 calldata encryptedAmount)
        external
        returns (bytes32);

    function openDispute(bytes32 escrowId, bytes32 reasonHash) external;

    function resolveDispute(
        bytes32 escrowId,
        uint16 buyerBps,
        uint16 sellerBps,
        bytes32 rulingHash
    ) external returns (bytes32 buyerPaymentId, bytes32 sellerPaymentId);

    function closeExpiredEscrow(bytes32 escrowId) external returns (bytes32);

    function getEscrow(bytes32 escrowId)
        external
        view
        returns (
            address buyer,
            address seller,
            address arbiter,
            uint64 createdAt,
            uint64 expiresAt,
            bytes32 metadataHash,
            bytes32 disputeReasonHash,
            bytes32 rulingHash,
            EscrowStatus status,
            uint32 fundingCount,
            uint32 releaseCount,
            bool fullyFunded
        );

    function getBuyerEscrows(address buyer) external view returns (bytes32[] memory);

    function getSellerEscrows(address seller) external view returns (bytes32[] memory);

    function getEscrowPayments(bytes32 escrowId) external view returns (bytes32[] memory);

    function getEscrowMilestoneCount(bytes32 escrowId) external view returns (uint256);

    function getEscrowMilestone(bytes32 escrowId, uint256 index)
        external
        view
        returns (bytes32 referenceHash, bool released);

    function getSealedEscrowTotal(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedEscrowFunded(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedEscrowReleased(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedEscrowRefunded(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedEscrowRemaining(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256);

    function getSealedEscrowMilestoneAmount(bytes32 escrowId, uint256 index, bytes32 publicKey)
        external
        view
        returns (uint256);

    function isEscrowExpired(bytes32 escrowId) external view returns (bool);
}
