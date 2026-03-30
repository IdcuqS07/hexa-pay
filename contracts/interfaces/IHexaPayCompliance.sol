// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./IHexaPay.sol";

/**
 * @title IHexaPayCompliance
 * @notice Interface for scoped compliance rooms and audit workspaces.
 */
interface IHexaPayCompliance {
    struct ComplianceRoom {
        bytes32 roomId;
        address subject;
        address auditor;
        uint64 createdAt;
        uint64 expiresAt;
        bytes32 policyHash;
        bool active;
        bool exists;
    }

    struct ComplianceArtifact {
        address actor;
        bytes32 artifactHash;
        uint64 timestamp;
    }

    struct ComplianceAttestation {
        address auditor;
        bytes32 attestationHash;
        uint64 timestamp;
        bool verified;
    }

    struct ComplianceAccessLog {
        address actor;
        IHexaPay.ComplianceScope scope;
        bytes32 accessHash;
        uint64 timestamp;
    }

    event ComplianceRoomCreated(
        bytes32 indexed roomId,
        address indexed subject,
        address indexed auditor,
        uint64 expiresAt,
        bytes32 policyHash
    );
    event ComplianceRoomExtended(bytes32 indexed roomId, uint64 expiresAt);
    event ComplianceRoomClosed(bytes32 indexed roomId, address indexed closedBy);
    event ComplianceArtifactAdded(bytes32 indexed roomId, address indexed actor, bytes32 artifactHash);
    event ComplianceRoomAttestationAdded(
        bytes32 indexed roomId,
        address indexed auditor,
        bytes32 attestationHash
    );
    event ComplianceAccessLogged(
        bytes32 indexed roomId,
        address indexed actor,
        IHexaPay.ComplianceScope scope,
        bytes32 accessHash
    );

    function core() external view returns (address);

    function createComplianceRoom(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope[] calldata scopes,
        uint64 duration,
        bytes32 policyHash
    ) external returns (bytes32);

    function extendComplianceRoom(bytes32 roomId, uint64 duration) external;

    function closeComplianceRoom(bytes32 roomId) external;

    function addComplianceArtifact(bytes32 roomId, bytes32 artifactHash) external;

    function addAuditAttestation(bytes32 roomId, bytes32 attestationHash) external;

    function recordComplianceAccess(
        bytes32 roomId,
        IHexaPay.ComplianceScope scope,
        bytes32 accessHash
    ) external;

    function canViewScope(bytes32 roomId, IHexaPay.ComplianceScope scope) external view returns (bool);

    function hasScopedAccess(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope scope
    ) external view returns (bool);

    function getComplianceRoom(bytes32 roomId) external view returns (ComplianceRoom memory);

    function getRoomScopes(bytes32 roomId) external view returns (IHexaPay.ComplianceScope[] memory);

    function getSubjectRooms(address subject) external view returns (bytes32[] memory);

    function getAuditorRooms(address auditor) external view returns (bytes32[] memory);

    function getRoomArtifacts(bytes32 roomId) external view returns (ComplianceArtifact[] memory);

    function getRoomAttestations(bytes32 roomId) external view returns (ComplianceAttestation[] memory);

    function getRoomAccessLogs(bytes32 roomId) external view returns (ComplianceAccessLog[] memory);
}
