// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import {PrivateMerchantQuoteCofhe} from "../src/PrivateMerchantQuoteCofhe.sol";

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

contract DeployCofhe is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        string memory configuredNetworkName = vm.envOr("DEPLOYMENT_NETWORK_NAME", string(""));
        string memory networkName = bytes(configuredNetworkName).length > 0
            ? configuredNetworkName
            : _defaultNetworkName();
        bool requireRemoteFhe = vm.envOr("COFHE_DEPLOY_REQUIRE_REMOTE_FHE", block.chainid != 31337);

        if (requireRemoteFhe) {
            _requireRemoteFheEnv();
        }

        vm.startBroadcast(deployerPk);

        MockCreditAdapter credit = new MockCreditAdapter();
        PrivateMerchantQuoteCofhe quote = new PrivateMerchantQuoteCofhe(address(credit));

        vm.stopBroadcast();

        console2.log("MockCreditAdapter:", address(credit));
        console2.log("PrivateMerchantQuoteCofhe:", address(quote));
        console2.log("Network:", networkName);
        console2.log("Chain ID:", block.chainid);

        _writeManifest(networkName, vm.addr(deployerPk), address(credit), address(quote));
        console2.log("Deployment info saved to deployment-private-quote.json and public/deployment-private-quote.json");
    }

    function _requireRemoteFheEnv() internal view {
        _requireEnv("FHE_PROVIDER_URL");
        _requireEnv("FHE_PRIVATE_KEY");

        string memory allowMock = vm.envOr("FHE_ALLOW_MOCK", string(""));
        require(
            _eq(allowMock, "0") || _eq(allowMock, "false"),
            "FHE_ALLOW_MOCK must be 0 or false for remote CoFHE deploy flow"
        );
    }

    function _requireEnv(string memory key) internal view {
        string memory value = vm.envOr(key, string(""));
        require(bytes(value).length > 0, string.concat(key, " is required for remote CoFHE deploy flow"));
    }

    function _writeManifest(
        string memory networkName,
        address deployer,
        address credit,
        address quote
    ) internal {
        string memory creditAddress = vm.toString(credit);
        string memory quoteAddress = vm.toString(quote);
        string memory manifest = string.concat(
            "{\n",
            '  "network": "', networkName, '",\n',
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "deployedAtUnix": ', vm.toString(block.timestamp), ",\n",
            '  "deployer": "', vm.toString(deployer), '",\n',
            '  "privateQuote": "', quoteAddress, '",\n',
            '  "contracts": {\n',
            '    "MockCreditAdapter": "', creditAddress, '",\n',
            '    "PrivateMerchantQuote": "', quoteAddress, '",\n',
            '    "PrivateMerchantQuoteCofhe": "', quoteAddress, '"\n',
            "  },\n",
            '  "cofhe": {\n',
            '    "mode": "bytes32-handle",\n',
            '    "fheProviderUrlConfigured": ',
            _jsonBool(bytes(vm.envOr("FHE_PROVIDER_URL", string(""))).length > 0),
            ",\n",
            '    "mockAllowed": ',
            _jsonBool(_mockAllowed()),
            "\n",
            "  },\n",
            '  "ui": {\n',
            '    "chainId": ', vm.toString(block.chainid), ",\n",
            '    "addresses": {\n',
            '      "privateQuote": "', quoteAddress, '"\n',
            "    }\n",
            "  }\n",
            "}\n"
        );

        vm.writeFile("deployment-private-quote.json", manifest);
        vm.createDir("public", true);
        vm.writeFile("public/deployment-private-quote.json", manifest);
    }

    function _defaultNetworkName() internal view returns (string memory) {
        if (block.chainid == 31337) {
            return "localhost";
        }

        return "fhenix-testnet";
    }

    function _mockAllowed() internal view returns (bool) {
        string memory value = vm.envOr("FHE_ALLOW_MOCK", string("1"));
        return _eq(value, "1") || _eq(value, "true");
    }

    function _jsonBool(bool value) internal pure returns (string memory) {
        return value ? "true" : "false";
    }

    function _eq(string memory left, string memory right) internal pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
