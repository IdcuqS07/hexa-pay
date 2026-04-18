// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    EncryptedInput,
    FunctionId,
    ITaskManager,
    Utils
} from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/**
 * @notice Minimal local TaskManager mock for unit tests.
 * @dev This keeps encrypted handles equal to plaintext values so the legacy
 * suite assertions remain valid while still exercising the CoFHE call surface.
 */
contract HexaPayMockTaskManager is ITaskManager {
    error DecryptionResultNotReady(uint256 ctHash);
    error UnsupportedMockFunction(uint8 functionId);

    struct PendingDecrypt {
        uint256 value;
        uint64 readyAt;
        bool requested;
    }

    mapping(uint256 => PendingDecrypt) private pendingDecrypts;

    function createTask(
        uint8 returnType,
        FunctionId funcId,
        uint256[] memory encryptedInputs,
        uint256[] memory extraInputs
    ) external override returns (uint256) {
        if (funcId == FunctionId.trivialEncrypt) {
            return _mask(extraInputs[0], returnType);
        }

        if (funcId == FunctionId.random) {
            return _mask(uint256(blockhash(block.number - 1)), returnType);
        }

        if (funcId == FunctionId.cast) {
            return _mask(encryptedInputs[0], returnType);
        }

        if (funcId == FunctionId.not) {
            return _mask(~encryptedInputs[0], returnType);
        }

        if (funcId == FunctionId.square) {
            return _mask(encryptedInputs[0] * encryptedInputs[0], returnType);
        }

        if (funcId == FunctionId.select) {
            return encryptedInputs[0] > 0
                ? _mask(encryptedInputs[1], returnType)
                : _mask(encryptedInputs[2], returnType);
        }

        uint256 lhs = encryptedInputs[0];
        uint256 rhs = encryptedInputs[1];

        if (funcId == FunctionId.add) {
            return _mask(lhs + rhs, returnType);
        }

        if (funcId == FunctionId.sub) {
            return _mask(lhs - rhs, returnType);
        }

        if (funcId == FunctionId.mul) {
            return _mask(lhs * rhs, returnType);
        }

        if (funcId == FunctionId.div) {
            return rhs == 0 ? type(uint256).max : _mask(lhs / rhs, returnType);
        }

        if (funcId == FunctionId.rem) {
            return rhs == 0 ? 0 : _mask(lhs % rhs, returnType);
        }

        if (funcId == FunctionId.and) {
            return _mask(lhs & rhs, returnType);
        }

        if (funcId == FunctionId.or) {
            return _mask(lhs | rhs, returnType);
        }

        if (funcId == FunctionId.xor) {
            return _mask(lhs ^ rhs, returnType);
        }

        if (funcId == FunctionId.shl) {
            return _mask(lhs << rhs, returnType);
        }

        if (funcId == FunctionId.shr) {
            return _mask(lhs >> rhs, returnType);
        }

        if (funcId == FunctionId.rol) {
            return _rotateLeft(lhs, rhs, returnType);
        }

        if (funcId == FunctionId.ror) {
            return _rotateRight(lhs, rhs, returnType);
        }

        if (funcId == FunctionId.eq) {
            return lhs == rhs ? 1 : 0;
        }

        if (funcId == FunctionId.ne) {
            return lhs != rhs ? 1 : 0;
        }

        if (funcId == FunctionId.gt) {
            return lhs > rhs ? 1 : 0;
        }

        if (funcId == FunctionId.gte) {
            return lhs >= rhs ? 1 : 0;
        }

        if (funcId == FunctionId.lt) {
            return lhs < rhs ? 1 : 0;
        }

        if (funcId == FunctionId.lte) {
            return lhs <= rhs ? 1 : 0;
        }

        if (funcId == FunctionId.min) {
            return _mask(lhs < rhs ? lhs : rhs, returnType);
        }

        if (funcId == FunctionId.max) {
            return _mask(lhs > rhs ? lhs : rhs, returnType);
        }

        revert UnsupportedMockFunction(uint8(funcId));
    }

    function createDecryptTask(uint256 ctHash, address) external override {
        uint64 delay = uint64((block.timestamp % 10) + 1);
        pendingDecrypts[ctHash] = PendingDecrypt({
            value: ctHash,
            readyAt: uint64(block.timestamp) + delay,
            requested: true
        });
    }

    function verifyInput(EncryptedInput memory input, address)
        external
        pure
        override
        returns (uint256)
    {
        return _mask(input.ctHash, input.utype);
    }

    function allow(uint256, address) external pure override {}

    function isAllowed(uint256, address) external pure override returns (bool) {
        return true;
    }

    function allowGlobal(uint256) external pure override {}

    function allowTransient(uint256, address) external pure override {}

    function getDecryptResultSafe(uint256 ctHash)
        external
        view
        override
        returns (uint256, bool)
    {
        PendingDecrypt memory pending = pendingDecrypts[ctHash];

        if (!pending.requested || block.timestamp < pending.readyAt) {
            return (0, false);
        }

        return (pending.value, true);
    }

    function getDecryptResult(uint256 ctHash) external view override returns (uint256) {
        PendingDecrypt memory pending = pendingDecrypts[ctHash];

        if (!pending.requested || block.timestamp < pending.readyAt) {
            revert DecryptionResultNotReady(ctHash);
        }

        return pending.value;
    }

    function _rotateLeft(uint256 value, uint256 shift, uint8 returnType) private pure returns (uint256) {
        uint256 bits = _bitWidth(returnType);
        if (bits == 0 || bits == 256) {
            return _mask(value, returnType);
        }

        shift %= bits;
        uint256 masked = _mask(value, returnType);
        return _mask((masked << shift) | (masked >> (bits - shift)), returnType);
    }

    function _rotateRight(uint256 value, uint256 shift, uint8 returnType) private pure returns (uint256) {
        uint256 bits = _bitWidth(returnType);
        if (bits == 0 || bits == 256) {
            return _mask(value, returnType);
        }

        shift %= bits;
        uint256 masked = _mask(value, returnType);
        return _mask((masked >> shift) | (masked << (bits - shift)), returnType);
    }

    function _mask(uint256 value, uint8 returnType) private pure returns (uint256) {
        if (returnType == Utils.EBOOL_TFHE) {
            return value == 0 ? 0 : 1;
        }

        if (returnType == Utils.EUINT8_TFHE) {
            return value & type(uint8).max;
        }

        if (returnType == Utils.EUINT16_TFHE) {
            return value & type(uint16).max;
        }

        if (returnType == Utils.EUINT32_TFHE) {
            return value & type(uint32).max;
        }

        if (returnType == Utils.EUINT64_TFHE) {
            return value & type(uint64).max;
        }

        if (returnType == Utils.EUINT128_TFHE) {
            return value & type(uint128).max;
        }

        if (returnType == Utils.EADDRESS_TFHE) {
            return value & type(uint160).max;
        }

        if (returnType == Utils.EUINT256_TFHE) {
            return value;
        }

        return value;
    }

    function _bitWidth(uint8 returnType) private pure returns (uint256) {
        if (returnType == Utils.EBOOL_TFHE) {
            return 1;
        }

        if (returnType == Utils.EUINT8_TFHE) {
            return 8;
        }

        if (returnType == Utils.EUINT16_TFHE) {
            return 16;
        }

        if (returnType == Utils.EUINT32_TFHE) {
            return 32;
        }

        if (returnType == Utils.EUINT64_TFHE) {
            return 64;
        }

        if (returnType == Utils.EUINT128_TFHE) {
            return 128;
        }

        if (returnType == Utils.EADDRESS_TFHE) {
            return 160;
        }

        if (returnType == Utils.EUINT256_TFHE) {
            return 256;
        }

        return 0;
    }
}
