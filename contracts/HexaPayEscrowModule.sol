// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IHexaPay.sol";
import "./interfaces/IHexaPayAnalytics.sol";
import "./interfaces/IHexaPayCore.sol";

/**
 * @title HexaPayEscrowModule
 * @notice Confidential escrow, milestone release, and dispute handling for HexaPay.
 */
contract HexaPayEscrowModule {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    error BpsMismatch();
    error EscrowAlreadyConfigured();
    error EscrowExpired();
    error EscrowNotExpired();
    error EscrowNotOpen();
    error EscrowHasNoFunds();
    error EscrowNotDisputed();
    error IndexOutOfBounds();
    error InvalidArbiter();
    error InvalidCore();
    error InvalidExpiry();
    error InvalidParticipant();
    error LengthMismatch();
    error MilestoneAlreadyReleased();
    error MilestonesAlreadyReleased();
    error NoEscrowAccess();
    error NotArbiter();
    error NotBuyer();
    error NotBuyerOperator();
    error NotSeller();
    error NotSellerOperator();
    error ReentrancyBlocked();
    error UnknownEscrow();

    enum EscrowStatus {
        Open,
        Disputed,
        Released,
        Refunded,
        Resolved,
        Expired
    }

    struct Escrow {
        bytes32 escrowId;
        address buyer;
        address seller;
        address arbiter;
        uint64 createdAt;
        uint64 expiresAt;
        bytes32 metadataHash;
        bytes32 disputeReasonHash;
        bytes32 rulingHash;
        EscrowStatus status;
        uint32 fundingCount;
        uint32 releaseCount;
        bool fullyFunded;
        bool exists;
    }

    struct EscrowMilestone {
        bytes32 referenceHash;
        euint128 amount;
        bool released;
    }

    IHexaPayCore public immutable core;

    mapping(bytes32 => Escrow) private escrows;
    mapping(bytes32 => euint128) private escrowTotals;
    mapping(bytes32 => euint128) private escrowFunded;
    mapping(bytes32 => euint128) private escrowReleased;
    mapping(bytes32 => euint128) private escrowRefunded;
    mapping(bytes32 => euint128) private escrowRemaining;
    mapping(bytes32 => EscrowMilestone[]) private escrowMilestones;
    mapping(bytes32 => bytes32[]) private escrowPayments;
    mapping(address => bytes32[]) private buyerEscrows;
    mapping(address => bytes32[]) private sellerEscrows;

    uint256 private escrowNonce;
    bool private entered;

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

    function createEscrow(
        address seller,
        address arbiter,
        InEuint128 calldata encryptedTotalAmount,
        bytes32 metadataHash,
        uint64 expiresAt
    ) external returns (bytes32 escrowId) {
        if (seller == address(0) || seller == msg.sender) revert InvalidParticipant();
        if (arbiter == address(0)) revert InvalidArbiter();
        if (expiresAt <= uint64(block.timestamp)) revert InvalidExpiry();

        euint128 totalAmount = _sanitizePositive(FHE.asEuint128(encryptedTotalAmount));

        escrowId = _nextEscrowId(msg.sender, seller, metadataHash);
        escrows[escrowId] = Escrow({
            escrowId: escrowId,
            buyer: msg.sender,
            seller: seller,
            arbiter: arbiter,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            metadataHash: metadataHash,
            disputeReasonHash: bytes32(0),
            rulingHash: bytes32(0),
            status: EscrowStatus.Open,
            fundingCount: 0,
            releaseCount: 0,
            fullyFunded: false,
            exists: true
        });

        escrowTotals[escrowId] = totalAmount;
        escrowFunded[escrowId] = euint128.wrap(0);
        escrowReleased[escrowId] = euint128.wrap(0);
        escrowRefunded[escrowId] = euint128.wrap(0);
        escrowRemaining[escrowId] = euint128.wrap(0);
        buyerEscrows[msg.sender].push(escrowId);
        sellerEscrows[seller].push(escrowId);
        _refreshEscrowHandles(escrowId);

        emit EscrowCreated(escrowId, msg.sender, seller, arbiter, expiresAt);
    }

    function fundEscrow(bytes32 escrowId, InEuint128 calldata encryptedAmount)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.buyer, msg.sender)) revert NotBuyerOperator();
        _requireOpenAndNotExpired(escrowId, escrow);

        euint128 amount = _sanitizePositive(FHE.asEuint128(encryptedAmount));
        euint128 availableFunding = FHE.sub(escrowTotals[escrowId], escrowFunded[escrowId]);
        euint128 buyerBalance = euint128.wrap(core.getAccountBalanceHandle(escrow.buyer));
        euint128 safeAmount = FHE.min(amount, availableFunding);
        safeAmount = FHE.min(safeAmount, buyerBalance);
        euint128 nextFunded = FHE.add(escrowFunded[escrowId], safeAmount);

        bytes32 referenceHash = keccak256(
            abi.encodePacked(escrowId, "fund", escrow.fundingCount + 1, escrow.metadataHash)
        );

        _allowCoreHandle(safeAmount);
        paymentId = core.createManagedPayment(
            escrow.buyer,
            address(this),
            safeAmount,
            referenceHash,
            IHexaPay.PaymentKind.Escrow
        );

        escrowFunded[escrowId] = nextFunded;
        escrowRemaining[escrowId] = FHE.add(escrowRemaining[escrowId], safeAmount);
        escrow.fundingCount += 1;
        escrowPayments[escrowId].push(paymentId);
        _allowAnalyticsHandle(safeAmount);
        IHexaPayAnalytics(core.analyticsModule()).increaseEscrowExposure(escrow.buyer, safeAmount);
        escrow.fullyFunded = true;
        _refreshEscrowHandles(escrowId);

        emit EscrowFunded(escrowId, paymentId, escrow.fundingCount);
    }

    function createEscrowMilestones(
        bytes32 escrowId,
        InEuint128[] calldata encryptedMilestoneAmounts,
        bytes32[] calldata referenceHashes
    ) external {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.buyer, msg.sender)) revert NotBuyerOperator();
        if (escrowMilestones[escrowId].length != 0) revert EscrowAlreadyConfigured();
        if (escrow.fundingCount != 0 || escrow.releaseCount != 0) revert MilestonesAlreadyReleased();
        if (encryptedMilestoneAmounts.length != referenceHashes.length) revert LengthMismatch();
        if (encryptedMilestoneAmounts.length == 0) revert LengthMismatch();
        _requireOpenAndNotExpired(escrowId, escrow);

        euint128 milestoneSum = euint128.wrap(0);

        for (uint256 i = 0; i < encryptedMilestoneAmounts.length; i++) {
            euint128 amount = _sanitizePositive(FHE.asEuint128(encryptedMilestoneAmounts[i]));

            escrowMilestones[escrowId].push(
                EscrowMilestone({
                    referenceHash: referenceHashes[i],
                    amount: amount,
                    released: false
                })
            );

            milestoneSum = FHE.add(milestoneSum, amount);
        }

        milestoneSum;
        _refreshEscrowHandles(escrowId);
        emit EscrowMilestonesCreated(escrowId, encryptedMilestoneAmounts.length);
    }

    function releaseEscrow(bytes32 escrowId, InEuint128 calldata encryptedAmount)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.buyer, msg.sender)) revert NotBuyerOperator();
        _requireOpenAndNotExpired(escrowId, escrow);

        euint128 amount = _sanitizePositive(FHE.asEuint128(encryptedAmount));

        paymentId = _releaseEscrowAmount(escrowId, amount, keccak256(
            abi.encodePacked(escrowId, "release", escrow.releaseCount + 1, escrow.metadataHash)
        ));
    }

    function releaseEscrowMilestone(bytes32 escrowId, uint256 milestoneIndex)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.buyer, msg.sender)) revert NotBuyerOperator();
        _requireOpenAndNotExpired(escrowId, escrow);
        if (milestoneIndex >= escrowMilestones[escrowId].length) revert IndexOutOfBounds();

        EscrowMilestone storage milestone = escrowMilestones[escrowId][milestoneIndex];
        if (milestone.released) revert MilestoneAlreadyReleased();
        milestone.released = true;
        paymentId = _releaseEscrowAmount(escrowId, milestone.amount, milestone.referenceHash);
    }

    function refundEscrow(bytes32 escrowId, InEuint128 calldata encryptedAmount)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.seller, msg.sender)) revert NotSellerOperator();
        _requireOpenAndNotExpired(escrowId, escrow);

        euint128 amount = _sanitizePositive(FHE.asEuint128(encryptedAmount));

        paymentId = _refundEscrowAmount(escrowId, amount, keccak256(
            abi.encodePacked(escrowId, "refund", escrow.releaseCount, escrow.fundingCount, escrow.metadataHash)
        ));
    }

    function openDispute(bytes32 escrowId, bytes32 reasonHash) external {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.buyer, msg.sender) && !_canActForParty(escrow.seller, msg.sender)) {
            revert NoEscrowAccess();
        }
        _requireOpenAndNotExpired(escrowId, escrow);
        if (escrow.fundingCount == 0) revert EscrowHasNoFunds();

        escrow.status = EscrowStatus.Disputed;
        escrow.disputeReasonHash = reasonHash;

        emit EscrowDisputeOpened(escrowId, msg.sender, reasonHash);
    }

    function resolveDispute(
        bytes32 escrowId,
        uint16 buyerBps,
        uint16 sellerBps,
        bytes32 rulingHash
    ) external nonReentrant returns (bytes32 buyerPaymentId, bytes32 sellerPaymentId) {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (!_canActForParty(escrow.arbiter, msg.sender)) revert NotArbiter();
        if (escrow.status != EscrowStatus.Disputed) revert EscrowNotDisputed();
        if (buyerBps + sellerBps != BPS_DENOMINATOR) revert BpsMismatch();

        euint128 remainingAmount = escrowRemaining[escrowId];
        euint128 buyerAmount = FHE.div(
            FHE.mul(remainingAmount, FHE.asEuint128(buyerBps)),
            FHE.asEuint128(BPS_DENOMINATOR)
        );
        euint128 sellerAmount = FHE.sub(remainingAmount, buyerAmount);

        bytes32 buyerRef = keccak256(
            abi.encodePacked(escrowId, "dispute-buyer", buyerBps, sellerBps, rulingHash)
        );
        _allowCoreHandle(buyerAmount);
        buyerPaymentId = core.createManagedPaymentWithoutFee(
            address(this),
            escrow.buyer,
            buyerAmount,
            buyerRef,
            IHexaPay.PaymentKind.Escrow
        );
        escrowRefunded[escrowId] = FHE.add(escrowRefunded[escrowId], buyerAmount);
        escrowPayments[escrowId].push(buyerPaymentId);

        bytes32 sellerRef = keccak256(
            abi.encodePacked(escrowId, "dispute-seller", buyerBps, sellerBps, rulingHash)
        );
        _allowCoreHandle(sellerAmount);
        sellerPaymentId = core.createManagedPaymentWithoutFee(
            address(this),
            escrow.seller,
            sellerAmount,
            sellerRef,
            IHexaPay.PaymentKind.Escrow
        );
        escrowReleased[escrowId] = FHE.add(escrowReleased[escrowId], sellerAmount);
        escrow.releaseCount += 1;
        escrowPayments[escrowId].push(sellerPaymentId);

        _allowAnalyticsHandle(remainingAmount);
        IHexaPayAnalytics(core.analyticsModule()).decreaseEscrowExposure(escrow.buyer, remainingAmount);
        escrowRemaining[escrowId] = euint128.wrap(0);
        escrow.rulingHash = rulingHash;
        escrow.status = EscrowStatus.Resolved;
        _refreshEscrowHandles(escrowId);

        emit EscrowDisputeResolved(escrowId, msg.sender, buyerBps, sellerBps, rulingHash);
    }

    function closeExpiredEscrow(bytes32 escrowId)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Escrow storage escrow = escrows[escrowId];

        if (!escrow.exists) revert UnknownEscrow();
        if (escrow.status != EscrowStatus.Open) revert EscrowNotOpen();
        if (!isEscrowExpired(escrowId)) revert EscrowNotExpired();

        euint128 remainingAmount = escrowRemaining[escrowId];
        _allowCoreHandle(remainingAmount);
        paymentId = core.createManagedPaymentWithoutFee(
            address(this),
            escrow.buyer,
            remainingAmount,
            keccak256(abi.encodePacked(escrowId, "expired-close", escrow.metadataHash)),
            IHexaPay.PaymentKind.Escrow
        );

        escrowRefunded[escrowId] = FHE.add(escrowRefunded[escrowId], remainingAmount);
        escrowRemaining[escrowId] = euint128.wrap(0);
        escrow.status = EscrowStatus.Expired;
        escrowPayments[escrowId].push(paymentId);
        _allowAnalyticsHandle(remainingAmount);
        IHexaPayAnalytics(core.analyticsModule()).decreaseEscrowExposure(escrow.buyer, remainingAmount);
        _refreshEscrowHandles(escrowId);

        emit EscrowExpiredClosed(escrowId, paymentId);
    }

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
        )
    {
        Escrow storage escrow = escrows[escrowId];
        if (!escrow.exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();

        return (
            escrow.buyer,
            escrow.seller,
            escrow.arbiter,
            escrow.createdAt,
            escrow.expiresAt,
            escrow.metadataHash,
            escrow.disputeReasonHash,
            escrow.rulingHash,
            escrow.status,
            escrow.fundingCount,
            escrow.releaseCount,
            escrow.fullyFunded
        );
    }

    function getBuyerEscrows(address buyer) external view returns (bytes32[] memory) {
        if (
            !_canActForParty(buyer, msg.sender) &&
            !_hasAuditorScope(buyer, msg.sender, IHexaPay.ComplianceScope.Escrow)
        ) {
            revert NoEscrowAccess();
        }
        return buyerEscrows[buyer];
    }

    function getSellerEscrows(address seller) external view returns (bytes32[] memory) {
        if (
            !_canActForParty(seller, msg.sender) &&
            !_hasAuditorScope(seller, msg.sender, IHexaPay.ComplianceScope.Escrow)
        ) {
            revert NoEscrowAccess();
        }
        return sellerEscrows[seller];
    }

    function getEscrowPayments(bytes32 escrowId) external view returns (bytes32[] memory) {
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return escrowPayments[escrowId];
    }

    function getEscrowMilestoneCount(bytes32 escrowId) external view returns (uint256) {
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return escrowMilestones[escrowId].length;
    }

    function getEscrowMilestone(bytes32 escrowId, uint256 index)
        external
        view
        returns (bytes32 referenceHash, bool released)
    {
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        if (index >= escrowMilestones[escrowId].length) revert IndexOutOfBounds();

        EscrowMilestone storage milestone = escrowMilestones[escrowId][index];
        return (milestone.referenceHash, milestone.released);
    }

    function getSealedEscrowTotal(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return euint128.unwrap(escrowTotals[escrowId]);
    }

    function getSealedEscrowFunded(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return euint128.unwrap(escrowFunded[escrowId]);
    }

    function getSealedEscrowReleased(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return euint128.unwrap(escrowReleased[escrowId]);
    }

    function getSealedEscrowRefunded(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return euint128.unwrap(escrowRefunded[escrowId]);
    }

    function getSealedEscrowRemaining(bytes32 escrowId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        return euint128.unwrap(escrowRemaining[escrowId]);
    }

    function getSealedEscrowMilestoneAmount(bytes32 escrowId, uint256 index, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        if (!escrows[escrowId].exists) revert UnknownEscrow();
        if (!_canViewEscrow(escrowId, msg.sender)) revert NoEscrowAccess();
        if (index >= escrowMilestones[escrowId].length) revert IndexOutOfBounds();
        return euint128.unwrap(escrowMilestones[escrowId][index].amount);
    }

    function isEscrowExpired(bytes32 escrowId) public view returns (bool) {
        Escrow storage escrow = escrows[escrowId];
        if (!escrow.exists) revert UnknownEscrow();

        return
            escrow.expiresAt != 0 &&
            escrow.expiresAt < uint64(block.timestamp) &&
            escrow.status == EscrowStatus.Open;
    }

    function _releaseEscrowAmount(
        bytes32 escrowId,
        euint128 amount,
        bytes32 referenceHash
    ) internal returns (bytes32 paymentId) {
        Escrow storage escrow = escrows[escrowId];
        euint128 safeAmount = FHE.min(_sanitizePositive(amount), escrowRemaining[escrowId]);

        _allowCoreHandle(safeAmount);
        paymentId = core.createManagedPaymentWithoutFee(
            address(this),
            escrow.seller,
            safeAmount,
            referenceHash,
            IHexaPay.PaymentKind.Escrow
        );

        escrowReleased[escrowId] = FHE.add(escrowReleased[escrowId], safeAmount);
        escrowRemaining[escrowId] = FHE.sub(escrowRemaining[escrowId], safeAmount);
        escrow.releaseCount += 1;
        escrowPayments[escrowId].push(paymentId);
        _allowAnalyticsHandle(safeAmount);
        IHexaPayAnalytics(core.analyticsModule()).decreaseEscrowExposure(escrow.buyer, safeAmount);
        _refreshEscrowHandles(escrowId);

        emit EscrowReleaseApplied(escrowId, paymentId, escrow.releaseCount);
    }

    function _refundEscrowAmount(
        bytes32 escrowId,
        euint128 amount,
        bytes32 referenceHash
    ) internal returns (bytes32 paymentId) {
        Escrow storage escrow = escrows[escrowId];
        euint128 safeAmount = FHE.min(_sanitizePositive(amount), escrowRemaining[escrowId]);

        _allowCoreHandle(safeAmount);
        paymentId = core.createManagedPaymentWithoutFee(
            address(this),
            escrow.buyer,
            safeAmount,
            referenceHash,
            IHexaPay.PaymentKind.Escrow
        );

        escrowRefunded[escrowId] = FHE.add(escrowRefunded[escrowId], safeAmount);
        escrowRemaining[escrowId] = FHE.sub(escrowRemaining[escrowId], safeAmount);
        escrowPayments[escrowId].push(paymentId);
        _allowAnalyticsHandle(safeAmount);
        IHexaPayAnalytics(core.analyticsModule()).decreaseEscrowExposure(escrow.buyer, safeAmount);
        _refreshEscrowHandles(escrowId);

        emit EscrowRefundApplied(escrowId, paymentId);
    }

    function _requireOpenAndNotExpired(bytes32 escrowId, Escrow storage escrow) internal view {
        escrowId;

        if (escrow.status != EscrowStatus.Open) revert EscrowNotOpen();
        if (escrow.expiresAt < uint64(block.timestamp)) revert EscrowExpired();
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

    function _refreshEscrowHandles(bytes32 escrowId) internal {
        Escrow storage escrow = escrows[escrowId];
        if (!escrow.exists) {
            return;
        }

        _grantHandle(escrowTotals[escrowId], escrow.buyer, escrow.seller, escrow.arbiter);
        _grantHandle(escrowFunded[escrowId], escrow.buyer, escrow.seller, escrow.arbiter);
        _grantHandle(escrowReleased[escrowId], escrow.buyer, escrow.seller, escrow.arbiter);
        _grantHandle(escrowRefunded[escrowId], escrow.buyer, escrow.seller, escrow.arbiter);
        _grantHandle(escrowRemaining[escrowId], escrow.buyer, escrow.seller, escrow.arbiter);

        for (uint256 i = 0; i < escrowMilestones[escrowId].length; i++) {
            _grantHandle(escrowMilestones[escrowId][i].amount, escrow.buyer, escrow.seller, escrow.arbiter);
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

    function _canActForParty(address party, address actor) internal view returns (bool) {
        return actor == party || core.isCompanyOperator(party, actor);
    }

    function _hasAuditorScope(
        address subject,
        address viewer,
        IHexaPay.ComplianceScope scope
    ) internal view returns (bool) {
        return core.canAuditorViewScope(subject, viewer, scope);
    }

    function _canViewEscrow(bytes32 escrowId, address viewer) internal view returns (bool) {
        Escrow storage escrow = escrows[escrowId];

        if (
            viewer == escrow.buyer ||
            viewer == escrow.seller ||
            viewer == escrow.arbiter ||
            core.isCompanyOperator(escrow.buyer, viewer) ||
            core.isCompanyOperator(escrow.seller, viewer) ||
            core.isCompanyOperator(escrow.arbiter, viewer)
        ) {
            return true;
        }

        return
            _hasAuditorScope(escrow.buyer, viewer, IHexaPay.ComplianceScope.Escrow) ||
            _hasAuditorScope(escrow.seller, viewer, IHexaPay.ComplianceScope.Escrow) ||
            _hasAuditorScope(escrow.arbiter, viewer, IHexaPay.ComplianceScope.Escrow);
    }

    function _nextEscrowId(
        address buyer,
        address seller,
        bytes32 metadataHash
    ) internal returns (bytes32) {
        escrowNonce += 1;
        return keccak256(abi.encodePacked(address(core), buyer, seller, metadataHash, escrowNonce));
    }
}
