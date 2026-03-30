// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./interfaces/IERC20.sol";

/**
 * @title HexaPayVault
 * @notice Minimal custody layer for the settlement token used by HexaPay.
 * @dev Keeps asset custody separate from confidential accounting logic.
 */
contract HexaPayVault {
    IERC20 public immutable asset;
    address public immutable controller;

    event VaultPull(address indexed from, uint256 amount);
    event VaultPush(address indexed to, uint256 amount);

    modifier onlyController() {
        require(msg.sender == controller, "Not controller");
        _;
    }

    constructor(address asset_, address controller_) {
        require(asset_ != address(0), "Invalid asset");
        require(controller_ != address(0), "Invalid controller");

        asset = IERC20(asset_);
        controller = controller_;
    }

    function pullFrom(address from, uint256 amount) external onlyController {
        require(from != address(0), "Invalid source");
        require(amount > 0, "Invalid amount");
        require(asset.transferFrom(from, address(this), amount), "Pull failed");

        emit VaultPull(from, amount);
    }

    function pushTo(address to, uint256 amount) external onlyController {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(asset.transfer(to, amount), "Push failed");

        emit VaultPush(to, amount);
    }

    function balance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
