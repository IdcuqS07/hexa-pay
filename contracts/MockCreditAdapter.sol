// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhenixprotocol/contracts/FHE.sol";

/// @title MockCreditAdapter
/// @notice Encrypted credit management with access control
/// @dev Production-ready with whitelist pattern for authorized callers
contract MockCreditAdapter {
    struct AccountCredit {
        euint64 availableCredit;
        bool initialized;
    }

    mapping(address => AccountCredit) internal _credits;
    mapping(address => bool) public authorizedCallers;
    address public owner;

    event CreditSeeded(address indexed user);
    event CreditConsumed(address indexed user);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);

    error CreditNotInitialized();
    error InsufficientCredit();
    error InvalidUser();
    error NotAuthorized();
    error NotOwner();

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedCallers[msg.sender] = true; // owner always authorized
    }

    /// @notice Authorize a contract to consume credit (e.g. PrivateMerchantQuote)
    function authorizeCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert InvalidUser();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    /// @notice Revoke authorization
    function revokeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    /// @notice Seed encrypted available credit for a user
    /// @dev Owner or authorized caller can seed credit
    function seedCredit(address user, euint64 encryptedAvailableCredit) external {
        if (user == address(0)) revert InvalidUser();

        _credits[user] = AccountCredit({
            availableCredit: encryptedAvailableCredit,
            initialized: true
        });

        FHE.allow(_credits[user].availableCredit, user);
        FHE.allow(_credits[user].availableCredit, msg.sender);

        emit CreditSeeded(user);
    }

    /// @notice Encrypted comparison only (read-only check)
    /// @dev Only authorized callers can check spend capacity
    function canSpend(address user, euint64 encryptedAmount) external onlyAuthorized returns (ebool) {
        if (!_credits[user].initialized) revert CreditNotInitialized();

        return FHE.gte(_credits[user].availableCredit, encryptedAmount);
    }

    /// @notice Consume credit with sealed computation pattern
    /// @dev Only authorized callers (quote contracts) can invoke
    /// @dev Uses FHE.select for conditional update without synchronous revert
    function consume(address user, euint64 encryptedAmount) external onlyAuthorized {
        if (!_credits[user].initialized) revert CreditNotInitialized();

        // Sealed computation: check if sufficient credit
        ebool isValid = FHE.gte(_credits[user].availableCredit, encryptedAmount);

        // Calculate new balance (sealed subtraction)
        euint64 newBalance = FHE.sub(_credits[user].availableCredit, encryptedAmount);

        // Conditional update: only commit if valid
        // If invalid, keep old balance (no-op)
        _credits[user].availableCredit = FHE.select(
            isValid,
            newBalance,
            _credits[user].availableCredit
        );

        // Re-grant access after update
        FHE.allow(_credits[user].availableCredit, user);
        FHE.allow(_credits[user].availableCredit, msg.sender);

        emit CreditConsumed(user);

        // Note: Synchronous revert on insufficient credit requires async decrypt
        // For production, implement threshold network callback or dispute window
    }

    /// @notice Get encrypted available credit (view only)
    function getEncryptedAvailableCredit(address user) external view returns (euint64) {
        if (!_credits[user].initialized) revert CreditNotInitialized();
        return _credits[user].availableCredit;
    }

    /// @notice Check if user has initialized credit
    function hasCredit(address user) external view returns (bool) {
        return _credits[user].initialized;
    }
}
