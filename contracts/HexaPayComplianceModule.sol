// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./interfaces/IHexaPay.sol";
import "./interfaces/IHexaPayCompliance.sol";
import "./interfaces/IHexaPayCore.sol";

/**
 * @title HexaPayComplianceModule
 * @notice Scoped compliance rooms and auditor workspace for HexaPay suites.
 */
contract HexaPayComplianceModule {
    error InvalidAuditor();
    error InvalidDuration();
    error InvalidSubject();
    error NoScopes();
    error NotRoomAuditor();
    error NotRoomManager();
    error RoomClosed();
    error RoomExpired();
    error UnknownRoom();

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

    IHexaPayCore public immutable core;

    mapping(bytes32 => ComplianceRoom) private rooms;
    mapping(bytes32 => mapping(IHexaPay.ComplianceScope => bool)) private roomScopes;
    mapping(bytes32 => IHexaPay.ComplianceScope[]) private roomScopeList;
    mapping(bytes32 => ComplianceArtifact[]) private roomArtifacts;
    mapping(bytes32 => ComplianceAttestation[]) private roomAttestations;
    mapping(bytes32 => ComplianceAccessLog[]) private roomAccessLogs;
    mapping(address => bytes32[]) private subjectRooms;
    mapping(address => bytes32[]) private auditorRooms;
    mapping(address => mapping(address => bytes32[])) private subjectAuditorRooms;

    uint256 private roomNonce;

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

    constructor(address core_) {
        if (core_ == address(0)) revert InvalidSubject();
        core = IHexaPayCore(core_);
    }

    function createComplianceRoom(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope[] calldata scopes,
        uint64 duration,
        bytes32 policyHash
    ) external returns (bytes32 roomId) {
        if (subject == address(0)) revert InvalidSubject();
        if (!core.isAuthorizedAuditor(auditor)) revert InvalidAuditor();
        if (!_canManageSubject(subject, msg.sender)) revert NotRoomManager();
        if (duration == 0) revert InvalidDuration();
        if (scopes.length == 0) revert NoScopes();

        roomId = _nextRoomId(subject, auditor, policyHash);

        rooms[roomId] = ComplianceRoom({
            roomId: roomId,
            subject: subject,
            auditor: auditor,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp) + duration,
            policyHash: policyHash,
            active: true,
            exists: true
        });

        for (uint256 i = 0; i < scopes.length; i++) {
            if (!roomScopes[roomId][scopes[i]]) {
                roomScopes[roomId][scopes[i]] = true;
                roomScopeList[roomId].push(scopes[i]);
            }
        }

        subjectRooms[subject].push(roomId);
        auditorRooms[auditor].push(roomId);
        subjectAuditorRooms[subject][auditor].push(roomId);

        emit ComplianceRoomCreated(
            roomId,
            subject,
            auditor,
            uint64(block.timestamp) + duration,
            policyHash
        );
    }

    function extendComplianceRoom(bytes32 roomId, uint64 duration) external {
        ComplianceRoom storage room = rooms[roomId];
        if (!room.exists) revert UnknownRoom();
        if (!_canManageSubject(room.subject, msg.sender)) revert NotRoomManager();
        if (!room.active) revert RoomClosed();
        if (duration == 0) revert InvalidDuration();

        uint64 baseTime = room.expiresAt > uint64(block.timestamp)
            ? room.expiresAt
            : uint64(block.timestamp);
        room.expiresAt = baseTime + duration;

        emit ComplianceRoomExtended(roomId, room.expiresAt);
    }

    function closeComplianceRoom(bytes32 roomId) external {
        ComplianceRoom storage room = rooms[roomId];
        if (!room.exists) revert UnknownRoom();
        if (!_canManageSubject(room.subject, msg.sender) && msg.sender != room.auditor) {
            revert NotRoomManager();
        }

        room.active = false;
        emit ComplianceRoomClosed(roomId, msg.sender);
    }

    function addComplianceArtifact(bytes32 roomId, bytes32 artifactHash) external {
        ComplianceRoom storage room = rooms[roomId];
        _requireActiveRoom(room);
        if (!_canInteractWithRoom(room, msg.sender)) revert NotRoomManager();

        roomArtifacts[roomId].push(
            ComplianceArtifact({
                actor: msg.sender,
                artifactHash: artifactHash,
                timestamp: uint64(block.timestamp)
            })
        );

        emit ComplianceArtifactAdded(roomId, msg.sender, artifactHash);
    }

    function addAuditAttestation(bytes32 roomId, bytes32 attestationHash) external {
        ComplianceRoom storage room = rooms[roomId];
        _requireActiveRoom(room);
        if (msg.sender != room.auditor) revert NotRoomAuditor();

        roomAttestations[roomId].push(
            ComplianceAttestation({
                auditor: msg.sender,
                attestationHash: attestationHash,
                timestamp: uint64(block.timestamp),
                verified: true
            })
        );

        emit ComplianceRoomAttestationAdded(roomId, msg.sender, attestationHash);
    }

    function recordComplianceAccess(
        bytes32 roomId,
        IHexaPay.ComplianceScope scope,
        bytes32 accessHash
    ) external {
        ComplianceRoom storage room = rooms[roomId];
        _requireActiveRoom(room);
        if (!_canInteractWithRoom(room, msg.sender)) revert NotRoomManager();
        if (!roomScopes[roomId][scope]) revert NoScopes();

        roomAccessLogs[roomId].push(
            ComplianceAccessLog({
                actor: msg.sender,
                scope: scope,
                accessHash: accessHash,
                timestamp: uint64(block.timestamp)
            })
        );

        emit ComplianceAccessLogged(roomId, msg.sender, scope, accessHash);
    }

    function canViewScope(bytes32 roomId, IHexaPay.ComplianceScope scope) external view returns (bool) {
        ComplianceRoom storage room = rooms[roomId];
        if (!room.exists || !_isRoomActive(room)) {
            return false;
        }

        return roomScopes[roomId][scope] && _canInteractWithRoom(room, msg.sender);
    }

    function hasScopedAccess(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope scope
    ) external view returns (bool) {
        return _hasScopedAccess(subject, auditor, scope);
    }

    function getComplianceRoom(bytes32 roomId)
        external
        view
        returns (IHexaPayCompliance.ComplianceRoom memory)
    {
        ComplianceRoom storage room = rooms[roomId];
        if (!room.exists) revert UnknownRoom();

        return IHexaPayCompliance.ComplianceRoom({
            roomId: room.roomId,
            subject: room.subject,
            auditor: room.auditor,
            createdAt: room.createdAt,
            expiresAt: room.expiresAt,
            policyHash: room.policyHash,
            active: room.active,
            exists: room.exists
        });
    }

    function getRoomScopes(bytes32 roomId)
        external
        view
        returns (IHexaPay.ComplianceScope[] memory)
    {
        if (!rooms[roomId].exists) revert UnknownRoom();
        return roomScopeList[roomId];
    }

    function getSubjectRooms(address subject) external view returns (bytes32[] memory) {
        return subjectRooms[subject];
    }

    function getAuditorRooms(address auditor) external view returns (bytes32[] memory) {
        return auditorRooms[auditor];
    }

    function getRoomArtifacts(bytes32 roomId)
        external
        view
        returns (IHexaPayCompliance.ComplianceArtifact[] memory artifacts)
    {
        if (!rooms[roomId].exists) revert UnknownRoom();
        ComplianceArtifact[] storage stored = roomArtifacts[roomId];
        artifacts = new IHexaPayCompliance.ComplianceArtifact[](stored.length);

        for (uint256 i = 0; i < stored.length; i++) {
            artifacts[i] = IHexaPayCompliance.ComplianceArtifact({
                actor: stored[i].actor,
                artifactHash: stored[i].artifactHash,
                timestamp: stored[i].timestamp
            });
        }
    }

    function getRoomAttestations(bytes32 roomId)
        external
        view
        returns (IHexaPayCompliance.ComplianceAttestation[] memory attestations)
    {
        if (!rooms[roomId].exists) revert UnknownRoom();
        ComplianceAttestation[] storage stored = roomAttestations[roomId];
        attestations = new IHexaPayCompliance.ComplianceAttestation[](stored.length);

        for (uint256 i = 0; i < stored.length; i++) {
            attestations[i] = IHexaPayCompliance.ComplianceAttestation({
                auditor: stored[i].auditor,
                attestationHash: stored[i].attestationHash,
                timestamp: stored[i].timestamp,
                verified: stored[i].verified
            });
        }
    }

    function getRoomAccessLogs(bytes32 roomId)
        external
        view
        returns (IHexaPayCompliance.ComplianceAccessLog[] memory logs)
    {
        if (!rooms[roomId].exists) revert UnknownRoom();
        ComplianceAccessLog[] storage stored = roomAccessLogs[roomId];
        logs = new IHexaPayCompliance.ComplianceAccessLog[](stored.length);

        for (uint256 i = 0; i < stored.length; i++) {
            logs[i] = IHexaPayCompliance.ComplianceAccessLog({
                actor: stored[i].actor,
                scope: stored[i].scope,
                accessHash: stored[i].accessHash,
                timestamp: stored[i].timestamp
            });
        }
    }

    function _requireActiveRoom(ComplianceRoom storage room) internal view {
        if (!room.exists) revert UnknownRoom();
        if (!room.active) revert RoomClosed();
        if (room.expiresAt < uint64(block.timestamp)) revert RoomExpired();
    }

    function _isRoomActive(ComplianceRoom storage room) internal view returns (bool) {
        return room.active && room.expiresAt >= uint64(block.timestamp);
    }

    function _canManageSubject(address subject, address actor) internal view returns (bool) {
        return actor == subject || core.isCompanyOperator(subject, actor);
    }

    function _canInteractWithRoom(ComplianceRoom storage room, address actor) internal view returns (bool) {
        return actor == room.auditor || _canManageSubject(room.subject, actor);
    }

    function _hasScopedAccess(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope scope
    ) internal view returns (bool) {
        bytes32[] storage roomIds = subjectAuditorRooms[subject][auditor];

        for (uint256 i = 0; i < roomIds.length; i++) {
            ComplianceRoom storage room = rooms[roomIds[i]];

            if (_isRoomActive(room) && roomScopes[room.roomId][scope]) {
                return true;
            }
        }

        return false;
    }

    function _nextRoomId(
        address subject,
        address auditor,
        bytes32 policyHash
    ) internal returns (bytes32) {
        roomNonce += 1;
        return keccak256(abi.encodePacked(address(core), subject, auditor, policyHash, roomNonce));
    }
}
