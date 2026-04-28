// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IHexaPay.sol";
import "./interfaces/IHexaPayWorkflow.sol";

interface IHexaPayExternalSettlementExecutor {
    function paymentRecords(bytes32 intentHash)
        external
        view
        returns (
            bytes32 storedIntentHash,
            bytes32 storedRequestIdHash,
            address token,
            address payer,
            address merchant,
            uint256 amount,
            uint256 executedAt
        );
}

contract HexaPayExternalSettlementBridge is Ownable {
    error InvalidExecutor();
    error InvalidSettlement();
    error InvalidWorkflow();
    error SettlementAlreadyRecorded();

    struct ExecutorPaymentRecord {
        bytes32 intentHash;
        bytes32 requestIdHash;
        address token;
        address payer;
        address merchant;
        uint256 amount;
        uint256 executedAt;
    }

    IHexaPayWorkflow public immutable workflow;
    IHexaPayExternalSettlementExecutor public immutable executor;
    IHexaPay public immutable core;
    address public immutable settlementToken;

    mapping(bytes32 => bool) public settlementRecorded;
    mapping(bytes32 => bytes32) public settlementTxHash;
    mapping(bytes32 => bytes32) public settlementInvoiceId;

    event ExternalSettlementReceiptRecorded(
        bytes32 indexed settlementId,
        bytes32 indexed invoiceId,
        bytes32 indexed intentHash,
        bytes32 requestIdHash,
        bytes32 txHash,
        address payer,
        address merchant,
        address token,
        uint256 amount,
        address recorder
    );

    constructor(address initialOwner, address workflow_, address executor_) Ownable(initialOwner) {
        if (workflow_ == address(0)) revert InvalidWorkflow();
        if (executor_ == address(0)) revert InvalidExecutor();

        workflow = IHexaPayWorkflow(workflow_);
        executor = IHexaPayExternalSettlementExecutor(executor_);

        address coreAddress = workflow.core();
        if (coreAddress == address(0)) revert InvalidWorkflow();

        core = IHexaPay(coreAddress);
        settlementToken = core.settlementToken();
    }

    function buildSettlementId(bytes32 intentHash, bytes32 requestIdHash)
        public
        view
        returns (bytes32)
    {
        if (intentHash == bytes32(0) || requestIdHash == bytes32(0)) {
            revert InvalidSettlement();
        }

        return keccak256(
            abi.encode(
                block.chainid,
                address(executor),
                intentHash,
                requestIdHash
            )
        );
    }

    function _getExecutorPaymentRecord(bytes32 intentHash)
        internal
        view
        returns (ExecutorPaymentRecord memory record)
    {
        (
            record.intentHash,
            record.requestIdHash,
            record.token,
            record.payer,
            record.merchant,
            record.amount,
            record.executedAt
        ) = executor.paymentRecords(intentHash);
    }

    function recordExternalSettlementReceipt(
        bytes32 invoiceId,
        bytes32 intentHash,
        bytes32 requestIdHash,
        bytes32 txHash,
        address payerWallet,
        address merchant,
        address token,
        uint128 observedAmount
    ) external onlyOwner returns (bytes32 settlementId) {
        if (
            invoiceId == bytes32(0) ||
            intentHash == bytes32(0) ||
            requestIdHash == bytes32(0) ||
            txHash == bytes32(0) ||
            payerWallet == address(0) ||
            merchant == address(0) ||
            token == address(0) ||
            observedAmount == 0
        ) revert InvalidSettlement();

        ExecutorPaymentRecord memory paymentRecord = _getExecutorPaymentRecord(intentHash);

        if (paymentRecord.intentHash == bytes32(0) || paymentRecord.executedAt == 0) {
            revert InvalidSettlement();
        }
        if (paymentRecord.requestIdHash != requestIdHash) revert InvalidSettlement();
        if (paymentRecord.token != token || token != settlementToken) revert InvalidSettlement();
        if (paymentRecord.payer != payerWallet) revert InvalidSettlement();
        if (paymentRecord.merchant != merchant) revert InvalidSettlement();
        if (paymentRecord.amount != uint256(observedAmount)) revert InvalidSettlement();

        settlementId = buildSettlementId(intentHash, requestIdHash);
        if (settlementRecorded[settlementId]) revert SettlementAlreadyRecorded();

        workflow.recordExternalSettlementReceipt(
            invoiceId,
            settlementId,
            intentHash,
            requestIdHash,
            txHash,
            payerWallet,
            merchant,
            token,
            observedAmount
        );

        settlementRecorded[settlementId] = true;
        settlementTxHash[settlementId] = txHash;
        settlementInvoiceId[settlementId] = invoiceId;

        emit ExternalSettlementReceiptRecorded(
            settlementId,
            invoiceId,
            intentHash,
            requestIdHash,
            txHash,
            payerWallet,
            merchant,
            token,
            observedAmount,
            msg.sender
        );
    }
}
