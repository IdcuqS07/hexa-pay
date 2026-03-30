// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./interfaces/IHexaPay.sol";

/**
 * @title HexaPayFactory
 * @notice Lightweight registry and deployer for isolated HexaPay suites.
 * @dev The factory accepts pre-built creation bytecode so its own runtime does
 * not balloon with embedded suite creation code.
 */
contract HexaPayFactory {
    error DeploymentFailed();
    error InvalidInstance();
    error InvalidOwner();

    event HexaPayDeployed(
        address indexed instance,
        address indexed owner,
        address indexed settlementToken,
        address vault,
        address workflowModule,
        address escrowModule,
        address complianceModule,
        address analyticsModule,
        uint16 feeBps
    );
    event HexaPayRegistered(
        address indexed instance,
        address indexed owner,
        address vault,
        address workflowModule,
        address escrowModule,
        address complianceModule,
        address analyticsModule
    );

    address[] public deployedInstances;
    mapping(address => address[]) public userInstances;
    mapping(address => address) public instanceWorkflowModules;
    mapping(address => address) public instanceEscrowModules;
    mapping(address => address) public instanceComplianceModules;
    mapping(address => address) public instanceAnalyticsModules;
    mapping(address => bool) public knownInstances;

    function deployHexaPay(bytes calldata creationCode) external returns (address instanceAddress) {
        bytes memory bytecode = creationCode;

        assembly {
            instanceAddress := create(0, add(bytecode, 0x20), mload(bytecode))
        }

        if (instanceAddress == address(0)) revert DeploymentFailed();

        IHexaPay hexaPay = IHexaPay(instanceAddress);
        address deployedOwner = hexaPay.owner();

        if (deployedOwner != msg.sender) revert InvalidOwner();
        _trackInstance(instanceAddress, deployedOwner);

        address settlementToken = hexaPay.settlementToken();
        address vault = hexaPay.vault();
        address workflow = hexaPay.workflowModule();
        address escrow = hexaPay.escrowModule();
        address compliance = hexaPay.complianceModule();
        address analytics = hexaPay.analyticsModule();
        uint16 feeBps = hexaPay.platformFeeBps();

        _syncModules(instanceAddress, workflow, escrow, compliance, analytics);

        emit HexaPayDeployed(
            instanceAddress,
            deployedOwner,
            settlementToken,
            vault,
            workflow,
            escrow,
            compliance,
            analytics,
            feeBps
        );
    }

    function registerHexaPay(address instanceAddress) external {
        if (instanceAddress == address(0)) revert InvalidInstance();

        IHexaPay hexaPay = IHexaPay(instanceAddress);
        address deployedOwner = hexaPay.owner();
        if (deployedOwner != msg.sender) revert InvalidOwner();

        address vault = hexaPay.vault();
        address workflow = hexaPay.workflowModule();
        address escrow = hexaPay.escrowModule();
        address compliance = hexaPay.complianceModule();
        address analytics = hexaPay.analyticsModule();

        if (
            hexaPay.settlementToken() == address(0) ||
            vault == address(0) ||
            workflow == address(0) ||
            escrow == address(0) ||
            compliance == address(0) ||
            analytics == address(0)
        ) {
            revert InvalidInstance();
        }

        _trackInstance(instanceAddress, deployedOwner);
        _syncModules(instanceAddress, workflow, escrow, compliance, analytics);

        emit HexaPayRegistered(
            instanceAddress,
            deployedOwner,
            vault,
            workflow,
            escrow,
            compliance,
            analytics
        );
    }

    function getAllInstances() external view returns (address[] memory) {
        return deployedInstances;
    }

    function getUserInstances(address user) external view returns (address[] memory) {
        return userInstances[user];
    }

    function getWorkflowModule(address instance) external view returns (address) {
        return instanceWorkflowModules[instance];
    }

    function getEscrowModule(address instance) external view returns (address) {
        return instanceEscrowModules[instance];
    }

    function getComplianceModule(address instance) external view returns (address) {
        return instanceComplianceModules[instance];
    }

    function getAnalyticsModule(address instance) external view returns (address) {
        return instanceAnalyticsModules[instance];
    }

    function getInstanceCount() external view returns (uint256) {
        return deployedInstances.length;
    }

    function _trackInstance(address instanceAddress, address deployedOwner) internal {
        if (knownInstances[instanceAddress]) {
            return;
        }

        knownInstances[instanceAddress] = true;
        deployedInstances.push(instanceAddress);
        userInstances[deployedOwner].push(instanceAddress);
    }

    function _syncModules(
        address instanceAddress,
        address workflow,
        address escrow,
        address compliance,
        address analytics
    ) internal {
        instanceWorkflowModules[instanceAddress] = workflow;
        instanceEscrowModules[instanceAddress] = escrow;
        instanceComplianceModules[instanceAddress] = compliance;
        instanceAnalyticsModules[instanceAddress] = analytics;
    }
}
