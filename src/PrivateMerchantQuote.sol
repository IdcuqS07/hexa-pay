// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface ICreditAdapter {
    function canSpend(address user, bytes32 amountCt) external returns (bool);
    function consume(address user, bytes32 amountCt) external;
}

contract PrivateMerchantQuote {
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
        bytes32 amountCt;
        bool accessGranted;
    }

    mapping(bytes32 => Quote) internal quotes;

    ICreditAdapter public immutable credit;

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
    error InvalidAmount();

    constructor(address _credit) {
        credit = ICreditAdapter(_credit);
    }

    function createQuote(
        bytes32 id,
        address payer,
        bytes32 amountCt,
        uint64 expiresAt
    ) external {
        Quote storage q = quotes[id];
        if (q.merchant != address(0)) revert AlreadyExists();
        if (payer == address(0)) revert InvalidPayer();
        if (amountCt == bytes32(0)) revert InvalidAmount();

        q.merchant = msg.sender;
        q.payer = payer;
        q.expiresAt = expiresAt;
        q.status = Status.Pending;
        q.amountCt = amountCt;
        q.accessGranted = false;

        emit QuoteCreated(id, msg.sender, payer);
    }

    function grantAccess(bytes32 id, address payer) external {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (q.status != Status.Pending) revert InvalidState();
        if (msg.sender != q.merchant) revert NotAuthorized();
        if (payer != q.payer) revert InvalidPayer();

        q.accessGranted = true;

        emit AccessGranted(id, payer);
    }

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

        bool ok = credit.canSpend(msg.sender, q.amountCt);
        if (!ok) revert InvalidState();

        credit.consume(msg.sender, q.amountCt);

        q.status = Status.Settled;

        emit QuoteSettled(id, msg.sender);
    }

    function cancelExpired(bytes32 id) external {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (msg.sender != q.merchant) revert NotAuthorized();
        if (q.status != Status.Pending) revert InvalidState();
        if (block.timestamp <= q.expiresAt) revert InvalidState();

        q.status = Status.Cancelled;

        emit QuoteCancelled(id, msg.sender);
    }

    function cancelQuote(bytes32 id) external {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        if (msg.sender != q.merchant) revert NotAuthorized();
        if (q.status != Status.Pending) revert InvalidState();

        q.status = Status.Cancelled;

        emit QuoteCancelled(id, msg.sender);
    }

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

    function getEncryptedAmount(bytes32 id) external view returns (bytes32) {
        Quote storage q = quotes[id];
        if (q.merchant == address(0)) revert QuoteNotFound();
        return q.amountCt;
    }
}
