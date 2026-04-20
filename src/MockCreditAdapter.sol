// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockCreditAdapter
/// @notice Simple credit adapter for testing with bytes32 encrypted handles
/// @dev Bootstrap version - uses bytes32 instead of euint64 for easier testing
contract MockCreditAdapter {
    struct AccountCredit {
        bytes32 availableCredit;
        bool initialized;
    }

    mapping(address => AccountCredit) internal _credits;
    mapping(address => bool) public authorizedCallers;
    address public owner;

    bool public forceApprove = true;

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
        authorizedCallers[msg.sender] = true;
    }

    function authorizeCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert InvalidUser();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    function revokeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    function setForceApprove(bool v) external onlyOwner {
        forceApprove = v;
    }

    function seedCredit(address user, bytes32 encryptedAvailableCredit) external {
        if (user == address(0)) revert InvalidUser();

        _credits[user] = AccountCredit({
            availableCredit: encryptedAvailableCredit,
            initialized: true
        });

        emit CreditSeeded(user);
    }

    function canSpend(address user, bytes32 /* amountCt */) external view onlyAuthorized returns (bool) {
        if (!_credits[user].initialized) revert CreditNotInitialized();
        return forceApprove;
    }

    function consume(address user, bytes32 /* amountCt */) external onlyAuthorized {
        if (!_credits[user].initialized) revert CreditNotInitialized();
        if (!forceApprove) revert InsufficientCredit();

        emit CreditConsumed(user);
    }

    function getEncryptedAvailableCredit(address user) external view returns (bytes32) {
        if (!_credits[user].initialized) revert CreditNotInitialized();
        return _credits[user].availableCredit;
    }

    function hasCredit(address user) external view returns (bool) {
        return _credits[user].initialized;
    }
}
