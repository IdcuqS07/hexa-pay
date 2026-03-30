// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @title IHexaPay
 * @notice User-facing interface for the HexaPay core asset rail.
 */
interface IHexaPay {
    enum PaymentKind {
        Transfer,
        Payroll,
        Invoice,
        Escrow
    }

    enum ComplianceScope {
        Balance,
        Payment,
        Invoice,
        Payroll,
        Escrow,
        Analytics
    }

    struct Payment {
        address sender;
        address recipient;
        uint64 timestamp;
        bytes32 paymentId;
        bytes32 referenceHash;
        PaymentKind kind;
        bool completed;
    }

    struct ComplianceGrant {
        uint64 grantedAt;
        uint64 expiresAt;
        bytes32 policyHash;
        bool active;
    }

    struct AuditAttestation {
        address auditor;
        bytes32 attestationHash;
        uint64 timestamp;
        bool verified;
    }

    struct LegacyPermission {
        bytes32 publicKey;
        bytes signature;
    }

    event WorkflowModuleDeployed(address indexed workflowModule, address indexed core);
    event EscrowModuleDeployed(address indexed escrowModule, address indexed core);
    event ComplianceModuleDeployed(address indexed complianceModule, address indexed core);
    event AnalyticsModuleDeployed(address indexed analyticsModule, address indexed core);
    event Deposit(address indexed user, bytes32 indexed depositId, uint256 timestamp);
    event PaymentInitiated(bytes32 indexed paymentId, address indexed sender, address indexed recipient);
    event PaymentCompleted(bytes32 indexed paymentId);
    event Withdrawal(address indexed user, bytes32 indexed withdrawalId, uint256 timestamp);
    event FeeCollected(bytes32 indexed paymentId, address indexed collector);
    event ComplianceAccessGranted(
        address indexed subject,
        address indexed auditor,
        uint64 expiresAt,
        bytes32 policyHash
    );
    event ComplianceAccessRevoked(address indexed subject, address indexed auditor);
    event AuditAttestationAdded(address indexed subject, address indexed auditor, bytes32 attestationHash);
    event AuditorAuthorized(address indexed auditor);
    event AuditorRevoked(address indexed auditor);
    event CompanyRegistered(address indexed companyAddress, bytes32 indexed companyId, string companyName);
    event CompanyVerified(address indexed companyAddress);
    event SignerAdded(address indexed companyAddress, address indexed signer);
    event SignerRemoved(address indexed companyAddress, address indexed signer);

    function owner() external view returns (address);

    function feeCollector() external view returns (address);

    function settlementToken() external view returns (address);

    function vault() external view returns (address);

    function workflowModule() external view returns (address);

    function escrowModule() external view returns (address);

    function complianceModule() external view returns (address);

    function analyticsModule() external view returns (address);

    function platformFeeBps() external view returns (uint16);

    function wrap(uint128 amount) external returns (bytes32);

    function unwrap(InEuint128 calldata encryptedAmount) external returns (bytes32);

    function createPayment(
        address recipient,
        InEuint128 calldata encryptedAmount,
        bytes32 referenceHash
    ) external returns (bytes32);

    function getBalance(LegacyPermission calldata permission) external view returns (uint256);

    function getSealedBalance(bytes32 publicKey) external view returns (uint256);

    function getSealedUserBalance(address subject, bytes32 publicKey) external view returns (uint256);

    function getPaymentDetails(
        bytes32 paymentId,
        LegacyPermission calldata permission
    ) external view returns (uint256 amount, uint256 fee);

    function getSealedPaymentAmount(
        bytes32 paymentId,
        bytes32 publicKey
    ) external view returns (uint256);

    function getSealedPaymentFee(
        bytes32 paymentId,
        bytes32 publicKey
    ) external view returns (uint256);

    function getAccountBalanceHandle(address account) external view returns (uint256);

    function grantComplianceAccess(
        address subject,
        address auditor,
        uint64 duration,
        bytes32 policyHash
    ) external;

    function revokeComplianceAccess(address subject, address auditor) external;

    function addAuditAttestation(address subject, bytes32 attestationHash) external;

    function getAuditAttestations(address subject)
        external
        view
        returns (AuditAttestation[] memory);

    function authorizeAuditor(address auditor) external;

    function revokeAuditor(address auditor) external;

    function registerCompany(
        string calldata companyName,
        string calldata ensName,
        bytes32 companyId
    ) external;

    function verifyCompany(address company) external;

    function addSigner(address signer) external;

    function removeSigner(address signer) external;

    function getCompany(address company)
        external
        view
        returns (
            string memory companyName,
            string memory ensName,
            bytes32 companyId,
            bool verified,
            address[] memory signers
        );

    function getCompanyByCompanyId(bytes32 companyId) external view returns (address);

    function getCompanyByENS(string calldata ensName) external view returns (address);

    function updateFeeRate(uint16 newFeeBps) external;

    function updateFeeCollector(address newCollector) external;

    function transferOwnership(address newOwner) external;

    function hasBalance(address account) external view returns (bool);

    function getPaymentMetadata(bytes32 paymentId) external view returns (Payment memory);

    function getBackingBalance() external view returns (uint256);

    function isCompanyOperator(address company, address operator) external view returns (bool);

    function isCompanyRegistered(address company) external view returns (bool);

    function isAuthorizedAuditor(address auditor) external view returns (bool);

    function hasActiveComplianceGrant(address subject, address auditor) external view returns (bool);

    function canAuditorViewScope(
        address subject,
        address auditor,
        ComplianceScope scope
    ) external view returns (bool);
}
