// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface ICreditAdapter {
    function canSpend(address user, euint64 amount) external returns (ebool);
    function consume(address user, euint64 amount) external;
}
