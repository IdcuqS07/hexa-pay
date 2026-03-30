// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./IHexaPay.sol";

/**
 * @title IHexaPayCore
 * @notice Internal interface consumed by HexaPay suite modules.
 */
interface IHexaPayCore is IHexaPay {
    function createManagedPayment(
        address sender,
        address recipient,
        euint128 amount,
        bytes32 referenceHash,
        PaymentKind kind
    ) external returns (bytes32);

    function createManagedPaymentWithoutFee(
        address sender,
        address recipient,
        euint128 amount,
        bytes32 referenceHash,
        PaymentKind kind
    ) external returns (bytes32);
}
