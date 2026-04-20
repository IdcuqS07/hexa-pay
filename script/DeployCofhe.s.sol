// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {PrivateMerchantQuote} from "../src/PrivateMerchantQuote.sol";

contract MockCreditAdapter {
    bool public forceApprove = true;

    function setForceApprove(bool v) external {
        forceApprove = v;
    }

    function canSpend(address, bytes32) external view returns (bool) {
        return forceApprove;
    }

    function consume(address, bytes32) external view {
        require(forceApprove, "InsufficientCredit");
    }
}

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPk);

        MockCreditAdapter credit = new MockCreditAdapter();
        PrivateMerchantQuote quote = new PrivateMerchantQuote(address(credit));

        vm.stopBroadcast();

        console2.log("MockCreditAdapter:", address(credit));
        console2.log("PrivateMerchantQuote:", address(quote));
    }
}
