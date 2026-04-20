// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title PrivateMerchantQuote (CoFHE-compatible version)
/// @notice Encrypted invoice system using bytes32 handles for CoFHE plugin compatibility
/// @dev This version uses bytes32 for encrypted amounts to work with CofheClient
contract PrivateMerchantQuoteCofhe {
    enum Status {
        None,
        Pending,
        Settled,
        Cancelled,
        Expired
    }

    struct Quote {
        address merchant;
        address payer;
        uint64 expiresAt;
        Status status;
        bytes32 amountCt;  // bytes32 handle for CoFHE compatibility
        bool accessGranted;
    }

    mapping(bytes32 => Quote) internal quotes;

    address public immutable credit;

    event QuoteCreated(bytes32 indexed id, address indexed merchant, address indexed payer);
    event AccessGranted(bytes32 indexed id, address indexed payer);
    event QuoteSettled(bytes32 indexed id, address indexed payer);
    event QuoteCancelled(bytes32 indexed id, address indexed merchant);
    event QuoteExpired(bytes32 indexed id);

    error NotAuthorized();
    error InvalidState();
    error Expired();
    error AlreadyExists();
    error InvalidPayer();
    error QuoteNotFound();

    constructor(address _credit) {
        credit = _credit;
    }

    /// @notice Merchant creates encrypted quote
    function createQuote(
        bytes32 id,
        address payer,
        bytes32 amountCt,
        uint64 expiresAt
    ) external {
        Quote storage q = quotes[id];
        if (q.merchant != address(0)) revert AlreadyExists();
        if (payer == address(0)) revert InvalidPayer();

        q.merchant = msg.sender;
        q.payer = payer;
        q.expiresAt = expiresAt;
        q.status = Status.Pending;
        q.amountCt = amountCt;
        q.accessGranted = false;

        emit QuoteCreated(id, msg.sender, payer);
    }

    /// @notice Merchant grants payer access for preview
    function grantAccess(bytes32 id, address payer) external {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (q.status != Status.Pending) revert InvalidState();
        if (msg.sender != q.merchant) revert NotAuthorized();
        if (payer != q.payer) revert InvalidPayer();

        q.accessGranted = true;

        emit AccessGranted(id, payer);
    }

    /// @notice Payer settles quote
    function settleQuote(bytes32 id, bool skipPreview) public {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (q.status != Status.Pending) revert InvalidState();

        if (block.timestamp > q.expiresAt) {
            q.status = Status.Expired;
            emit QuoteExpired(id);
            revert Expired();
        }

        if (msg.sender != q.payer) revert NotAuthorized();

        if (!skipPreview && !q.accessGranted) revert NotAuthorized();

        // Delegate credit check to adapter
        (bool success, ) = credit.call(
            abi.encodeWithSignature("canSpend(address,bytes32)", msg.sender, q.amountCt)
        );
        require(success, "Credit check failed");

        // Consume credit
        (success, ) = credit.call(
            abi.encodeWithSignature("consume(address,bytes32)", msg.sender, q.amountCt)
        );
        require(success, "Credit consumption failed");

        q.status = Status.Settled;

        emit QuoteSettled(id, msg.sender);
    }

    /// @notice Cancel expired quote
    function cancelExpired(bytes32 id) external {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (msg.sender != q.merchant) revert NotAuthorized();
        if (q.status != Status.Pending) revert InvalidState();
        if (block.timestamp <= q.expiresAt) revert InvalidState();

        q.status = Status.Cancelled;

        emit QuoteCancelled(id, msg.sender);
    }

    /// @notice Manual cancel before payment
    function cancelQuote(bytes32 id) external {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (msg.sender != q.merchant) revert NotAuthorized();
        if (q.status != Status.Pending) revert InvalidState();

        q.status = Status.Cancelled;

        emit QuoteCancelled(id, msg.sender);
    }

    /// @notice Get quote details
    function getQuote(bytes32 id)
        external
        view
        returns (
            address merchant,
            address payer,
            uint64 expiresAt,
            uint8 status,
            bool accessGranted
        )
    {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();

        return (
            q.merchant,
            q.payer,
            q.expiresAt,
            uint8(q.status),
            q.accessGranted
        );
    }

    /// @notice Get encrypted amount handle
    function getEncryptedAmount(bytes32 id) external view returns (bytes32) {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        return q.amountCt;
    }
}
