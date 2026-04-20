// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract HexaPayUSDCExecutor is Ownable {
    using SafeERC20 for IERC20;

    struct PaymentRecord {
        bytes32 intentHash;
        bytes32 requestIdHash;
        address token;
        address payer;
        address merchant;
        uint256 amount;
        uint256 executedAt;
    }

    mapping(bytes32 => bool) public executedIntentHashes;
    mapping(bytes32 => bool) public executedRequestIds;
    mapping(bytes32 => PaymentRecord) public paymentRecords;

    event PaymentExecuted(
        bytes32 indexed intentHash,
        bytes32 indexed requestIdHash,
        address indexed payer,
        address merchant,
        address token,
        uint256 amount,
        uint256 executedAt
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function executePayment(
        bytes32 intentHash,
        bytes32 requestIdHash,
        address token,
        address payer,
        address merchant,
        uint256 amount
    ) external onlyOwner {
        require(intentHash != bytes32(0), "invalid intent hash");
        require(requestIdHash != bytes32(0), "invalid requestId hash");
        require(token != address(0), "invalid token");
        require(payer != address(0), "invalid payer");
        require(merchant != address(0), "invalid merchant");
        require(amount > 0, "invalid amount");
        require(!executedIntentHashes[intentHash], "intent already executed");
        require(!executedRequestIds[requestIdHash], "request already executed");

        executedIntentHashes[intentHash] = true;
        executedRequestIds[requestIdHash] = true;

        IERC20(token).safeTransferFrom(payer, merchant, amount);

        paymentRecords[intentHash] = PaymentRecord({
            intentHash: intentHash,
            requestIdHash: requestIdHash,
            token: token,
            payer: payer,
            merchant: merchant,
            amount: amount,
            executedAt: block.timestamp
        });

        emit PaymentExecuted(
            intentHash,
            requestIdHash,
            payer,
            merchant,
            token,
            amount,
            block.timestamp
        );
    }

    function wasIntentExecuted(bytes32 intentHash) external view returns (bool) {
        return executedIntentHashes[intentHash];
    }

    function wasRequestExecuted(bytes32 requestIdHash) external view returns (bool) {
        return executedRequestIds[requestIdHash];
    }
}
