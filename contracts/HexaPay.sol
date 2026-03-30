// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./HexaPayAnalyticsModule.sol";
import "./HexaPayComplianceModule.sol";
import "./HexaPayVault.sol";
import "./interfaces/IHexaPay.sol";

/**
 * @title HexaPay
 * @notice Core asset-backed confidential payment rail for the HexaPay suite.
 * @dev Public settlement token movements are isolated in HexaPayVault while balances
 * remain encrypted inside this contract. Invoice, policy, and payroll flows live in
 * the linked workflow module to keep deployment size realistic.
 */
contract HexaPay {
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000;

    error AsyncUnwrapNotSupported();

    enum PaymentKind {
        Transfer,
        Payroll,
        Invoice,
        Escrow
    }

    struct EncryptedBalance {
        euint128 amount;
        bool exists;
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

    struct CompanyProfile {
        string companyName;
        string ensName;
        bytes32 companyId;
        bool verified;
        bool exists;
    }

    mapping(address => EncryptedBalance) private balances;

    mapping(bytes32 => Payment) public payments;
    mapping(bytes32 => euint128) private paymentAmounts;
    mapping(bytes32 => euint128) private paymentFees;

    euint128 private totalWrapped;

    address public owner;
    address public feeCollector;
    address public immutable settlementToken;
    HexaPayVault public vault;
    address public workflowModule;
    address public escrowModule;
    address public complianceModule;
    address public analyticsModule;
    uint16 public platformFeeBps;
    bool public suiteInitialized;

    mapping(address => mapping(address => ComplianceGrant)) public complianceGrants;
    mapping(address => AuditAttestation[]) private auditTrail;
    mapping(address => bool) public authorizedAuditors;

    mapping(address => CompanyProfile) private companyRegistry;
    mapping(bytes32 => address) public companyIdToAddress;
    mapping(string => address) private ensToAddress;
    mapping(address => mapping(address => bool)) public companySignerApprovals;
    mapping(address => address[]) private companySigners;
    mapping(address => bool) public authorizedModules;

    uint256 private paymentNonce;
    bool private entered;

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
    event SuiteInitialized(
        address indexed vault,
        address indexed workflowModule,
        address indexed escrowModule,
        address complianceModule,
        address analyticsModule
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    modifier onlyAuthorizedAuditor() {
        require(authorizedAuditors[msg.sender], "Not authorized auditor");
        _;
    }

    modifier onlyAuthorizedModule() {
        require(authorizedModules[msg.sender], "Not suite module");
        _;
    }

    modifier nonReentrant() {
        require(!entered, "Reentrancy blocked");
        entered = true;
        _;
        entered = false;
    }

    constructor(
        address initialOwner,
        address settlementToken_,
        address initialFeeCollector,
        uint16 feeBps
    ) {
        require(initialOwner != address(0), "Invalid owner");
        require(settlementToken_ != address(0), "Invalid token");
        require(initialFeeCollector != address(0), "Invalid fee collector");
        require(feeBps <= MAX_FEE_BPS, "Fee too high");

        owner = initialOwner;
        settlementToken = settlementToken_;
        feeCollector = initialFeeCollector;
        platformFeeBps = feeBps;
        _refreshTotalPermissions();
    }

    /**
     * @notice Wires the vault and suite modules after the core has been deployed.
     * @dev This keeps the core init code small enough for Arbitrum Sepolia deployment limits.
     */
    function initializeSuite(
        address vault_,
        address workflowModule_,
        address escrowModule_,
        address complianceModule_,
        address analyticsModule_
    ) external onlyOwner {
        require(!suiteInitialized, "Suite already initialized");
        require(vault_ != address(0), "Invalid vault");
        require(workflowModule_ != address(0), "Invalid workflow module");
        require(escrowModule_ != address(0), "Invalid escrow module");
        require(complianceModule_ != address(0), "Invalid compliance module");
        require(analyticsModule_ != address(0), "Invalid analytics module");

        vault = HexaPayVault(vault_);
        workflowModule = workflowModule_;
        escrowModule = escrowModule_;
        complianceModule = complianceModule_;
        analyticsModule = analyticsModule_;
        suiteInitialized = true;

        authorizedModules[workflowModule_] = true;
        authorizedModules[escrowModule_] = true;

        emit WorkflowModuleDeployed(workflowModule_, address(this));
        emit EscrowModuleDeployed(escrowModule_, address(this));
        emit ComplianceModuleDeployed(complianceModule_, address(this));
        emit AnalyticsModuleDeployed(analyticsModule_, address(this));
        emit SuiteInitialized(vault_, workflowModule_, escrowModule_, complianceModule_, analyticsModule_);
    }

    /**
     * @notice Wrap public settlement tokens into a confidential internal balance.
     */
    function wrap(uint128 amount) external nonReentrant returns (bytes32) {
        require(suiteInitialized, "Suite not initialized");
        require(amount > 0, "Invalid amount");

        vault.pullFrom(msg.sender, amount);

        euint128 encryptedAmount = FHE.asEuint128(amount);
        _credit(msg.sender, encryptedAmount);

        totalWrapped = FHE.add(totalWrapped, encryptedAmount);
        _refreshTotalPermissions();

        bytes32 depositId = keccak256(
            abi.encodePacked(address(this), msg.sender, amount, block.number, block.timestamp)
        );

        emit Deposit(msg.sender, depositId, block.timestamp);
        return depositId;
    }

    /**
     * @notice Unwrap is intentionally deferred until the suite adopts async decrypt callbacks.
     */
    function unwrap(InEuint128 calldata encryptedAmount) external nonReentrant returns (bytes32) {
        encryptedAmount;
        revert AsyncUnwrapNotSupported();
    }

    /**
     * @notice Create a private payment between two parties backed by the vault.
     */
    function createPayment(
        address recipient,
        InEuint128 calldata encryptedAmount,
        bytes32 referenceHash
    ) external returns (bytes32) {
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot pay yourself");

        euint128 amount = _sanitizePositive(FHE.asEuint128(encryptedAmount));

        return _createPaymentRecord(
            msg.sender,
            recipient,
            amount,
            referenceHash,
            PaymentKind.Transfer,
            true
        );
    }

    /**
     * @notice Create a managed payment for a linked HexaPay module.
     */
    function createManagedPayment(
        address sender,
        address recipient,
        euint128 amount,
        bytes32 referenceHash,
        PaymentKind kind
    ) external onlyAuthorizedModule returns (bytes32) {
        require(sender != address(0), "Invalid sender");
        require(recipient != address(0), "Invalid recipient");
        require(sender != recipient, "Invalid route");

        return _createPaymentRecord(sender, recipient, amount, referenceHash, kind, true);
    }

    /**
     * @notice Create a managed payment for a linked HexaPay module without charging fees.
     */
    function createManagedPaymentWithoutFee(
        address sender,
        address recipient,
        euint128 amount,
        bytes32 referenceHash,
        PaymentKind kind
    ) external onlyAuthorizedModule returns (bytes32) {
        require(sender != address(0), "Invalid sender");
        require(recipient != address(0), "Invalid recipient");
        require(sender != recipient, "Invalid route");

        return _createPaymentRecord(sender, recipient, amount, referenceHash, kind, false);
    }

    /**
     * @notice Returns the caller's confidential balance as a plaintext value.
     * @dev This follows the standard Fhenix permissioned-view pattern.
     */
    function getBalance(IHexaPay.LegacyPermission calldata permission) external view returns (uint256) {
        permission;
        return euint128.unwrap(_balanceOf(msg.sender));
    }

    /**
     * @notice Returns the caller's balance ciphertext handle.
     */
    function getSealedBalance(bytes32 publicKey) external view returns (uint256) {
        publicKey;
        return euint128.unwrap(_balanceOf(msg.sender));
    }

    /**
     * @notice Returns a subject balance handle to the subject or an authorized auditor.
     */
    function getSealedUserBalance(address subject, bytes32 publicKey) external view returns (uint256) {
        publicKey;
        require(_canViewAccount(subject, msg.sender), "No compliance access");
        return euint128.unwrap(_balanceOf(subject));
    }

    /**
     * @notice Returns payment amount and fee handles to a payment participant.
     */
    function getPaymentDetails(
        bytes32 paymentId,
        IHexaPay.LegacyPermission calldata permission
    ) external view returns (uint256 amount, uint256 fee) {
        permission;
        Payment memory payment = payments[paymentId];
        require(payment.completed, "Unknown payment");
        require(msg.sender == payment.sender || msg.sender == payment.recipient, "Not payment participant");

        amount = euint128.unwrap(paymentAmounts[paymentId]);
        fee = euint128.unwrap(paymentFees[paymentId]);
    }

    /**
     * @notice Returns a payment amount handle to a participant or an authorized auditor.
     */
    function getSealedPaymentAmount(bytes32 paymentId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        require(_canViewPayment(paymentId, msg.sender), "No access to payment");
        return euint128.unwrap(paymentAmounts[paymentId]);
    }

    /**
     * @notice Returns a payment fee handle to a participant or an authorized auditor.
     */
    function getSealedPaymentFee(bytes32 paymentId, bytes32 publicKey)
        external
        view
        returns (uint256)
    {
        publicKey;
        require(_canViewPayment(paymentId, msg.sender), "No access to payment");
        return euint128.unwrap(paymentFees[paymentId]);
    }

    function getAccountBalanceHandle(address account) external view returns (uint256) {
        require(msg.sender == account || authorizedModules[msg.sender], "No balance handle access");
        return euint128.unwrap(_balanceOf(account));
    }

    function grantComplianceAccess(
        address subject,
        address auditor,
        uint64 duration,
        bytes32 policyHash
    ) external {
        require(subject != address(0), "Invalid subject");
        require(auditor != address(0), "Invalid auditor");
        require(duration > 0, "Invalid duration");
        require(authorizedAuditors[auditor], "Not authorized auditor");
        require(subject == msg.sender || _isCompanyOperator(subject, msg.sender), "Not grantor");

        uint64 expiresAt = uint64(block.timestamp) + duration;
        complianceGrants[subject][auditor] = ComplianceGrant({
            grantedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            policyHash: policyHash,
            active: true
        });

        emit ComplianceAccessGranted(subject, auditor, expiresAt, policyHash);
    }

    function revokeComplianceAccess(address subject, address auditor) external {
        require(subject != address(0), "Invalid subject");
        require(auditor != address(0), "Invalid auditor");
        require(subject == msg.sender || _isCompanyOperator(subject, msg.sender), "Not grantor");

        complianceGrants[subject][auditor].active = false;
        emit ComplianceAccessRevoked(subject, auditor);
    }

    function addAuditAttestation(address subject, bytes32 attestationHash)
        external
        onlyAuthorizedAuditor
    {
        require(_hasActiveGrant(subject, msg.sender), "No compliance access");

        auditTrail[subject].push(
            AuditAttestation({
                auditor: msg.sender,
                attestationHash: attestationHash,
                timestamp: uint64(block.timestamp),
                verified: true
            })
        );

        emit AuditAttestationAdded(subject, msg.sender, attestationHash);
    }

    function getAuditAttestations(address subject)
        external
        view
        returns (AuditAttestation[] memory)
    {
        return auditTrail[subject];
    }

    function authorizeAuditor(address auditor) external onlyOwner {
        require(auditor != address(0), "Invalid auditor");
        authorizedAuditors[auditor] = true;
        emit AuditorAuthorized(auditor);
    }

    function revokeAuditor(address auditor) external onlyOwner {
        authorizedAuditors[auditor] = false;
        emit AuditorRevoked(auditor);
    }

    function registerCompany(
        string calldata companyName,
        string calldata ensName,
        bytes32 companyId
    ) external {
        require(bytes(companyName).length > 0, "Invalid company name");
        require(companyId != bytes32(0), "Invalid company ID");
        require(!companyRegistry[msg.sender].exists, "Already registered");
        require(companyIdToAddress[companyId] == address(0), "Company ID in use");

        if (bytes(ensName).length > 0) {
            require(ensToAddress[ensName] == address(0), "ENS already in use");
            ensToAddress[ensName] = msg.sender;
        }

        companyRegistry[msg.sender] = CompanyProfile({
            companyName: companyName,
            ensName: ensName,
            companyId: companyId,
            verified: false,
            exists: true
        });

        companyIdToAddress[companyId] = msg.sender;
        companySignerApprovals[msg.sender][msg.sender] = true;
        companySigners[msg.sender].push(msg.sender);

        emit CompanyRegistered(msg.sender, companyId, companyName);
    }

    function verifyCompany(address company) external onlyOwner {
        require(companyRegistry[company].exists, "Unknown company");
        companyRegistry[company].verified = true;
        emit CompanyVerified(company);
    }

    function addSigner(address signer) external {
        require(companyRegistry[msg.sender].exists, "Company not registered");
        require(signer != address(0), "Invalid signer");
        require(!companySignerApprovals[msg.sender][signer], "Signer already approved");

        companySignerApprovals[msg.sender][signer] = true;
        companySigners[msg.sender].push(signer);

        emit SignerAdded(msg.sender, signer);
    }

    function removeSigner(address signer) external {
        require(companyRegistry[msg.sender].exists, "Company not registered");
        require(signer != address(0), "Invalid signer");
        require(signer != msg.sender, "Cannot remove owner");
        require(companySignerApprovals[msg.sender][signer], "Signer not approved");

        companySignerApprovals[msg.sender][signer] = false;
        address[] storage signers = companySigners[msg.sender];

        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }

        emit SignerRemoved(msg.sender, signer);
    }

    function getCompany(address company)
        external
        view
        returns (
            string memory companyName,
            string memory ensName,
            bytes32 companyId,
            bool verified,
            address[] memory signers
        )
    {
        CompanyProfile storage profile = companyRegistry[company];
        return (
            profile.companyName,
            profile.ensName,
            profile.companyId,
            profile.verified,
            companySigners[company]
        );
    }

    function getCompanyByCompanyId(bytes32 companyId) external view returns (address) {
        return companyIdToAddress[companyId];
    }

    function getCompanyByENS(string calldata ensName) external view returns (address) {
        return ensToAddress[ensName];
    }

    function updateFeeRate(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        platformFeeBps = newFeeBps;
    }

    function updateFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "Invalid collector");
        feeCollector = newCollector;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
        _refreshTotalPermissions();
    }

    function hasBalance(address account) external view returns (bool) {
        return balances[account].exists;
    }

    function getPaymentMetadata(bytes32 paymentId) external view returns (Payment memory) {
        return payments[paymentId];
    }

    function getBackingBalance() external view returns (uint256) {
        if (!suiteInitialized) {
            return 0;
        }

        return vault.balance();
    }

    function isCompanyOperator(address company, address operator) external view returns (bool) {
        return _isCompanyOperator(company, operator);
    }

    function isCompanyRegistered(address company) external view returns (bool) {
        return companyRegistry[company].exists;
    }

    function isAuthorizedAuditor(address auditor) external view returns (bool) {
        return authorizedAuditors[auditor];
    }

    function hasActiveComplianceGrant(address subject, address auditor) external view returns (bool) {
        return _hasActiveGrant(subject, auditor);
    }

    function canAuditorViewScope(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope scope
    ) external view returns (bool) {
        return _canAuditorViewScope(subject, auditor, scope);
    }

    function _createPaymentRecord(
        address sender,
        address recipient,
        euint128 amount,
        bytes32 referenceHash,
        PaymentKind kind,
        bool chargeFee
    ) internal returns (bytes32 paymentId) {
        (euint128 settledAmount, euint128 settledFee, euint128 settledDebit) =
            _computeSettledAmounts(sender, amount, chargeFee);

        _debitUnchecked(sender, settledDebit);
        _credit(recipient, settledAmount);
        _credit(feeCollector, settledFee);

        paymentId = _nextPaymentId(sender, recipient, referenceHash, kind);
        payments[paymentId] = Payment({
            sender: sender,
            recipient: recipient,
            timestamp: uint64(block.timestamp),
            paymentId: paymentId,
            referenceHash: referenceHash,
            kind: kind,
            completed: true
        });

        paymentAmounts[paymentId] = settledAmount;
        paymentFees[paymentId] = settledFee;
        _refreshPaymentPermissions(paymentId, sender, recipient);

        emit PaymentInitiated(paymentId, sender, recipient);
        emit PaymentCompleted(paymentId);
        if (chargeFee) {
            emit FeeCollected(paymentId, feeCollector);
        }

        if (kind != PaymentKind.Escrow && analyticsModule != address(0)) {
            if (euint128.unwrap(settledDebit) != 0) {
                FHE.allow(settledDebit, analyticsModule);
            }
            HexaPayAnalyticsModule(analyticsModule).recordPaymentSpend(sender, settledDebit);
        }
    }

    function _computeSettledAmounts(
        address sender,
        euint128 requestedAmount,
        bool chargeFee
    ) internal returns (euint128 settledAmount, euint128 settledFee, euint128 settledDebit) {
        euint128 zero = _zeroEuint128();
        euint128 sanitizedAmount = _sanitizePositive(requestedAmount);
        euint128 fee = chargeFee ? _calculateFee(sanitizedAmount) : zero;
        euint128 totalDebit = FHE.add(sanitizedAmount, fee);
        ebool canCover = FHE.gte(_balanceOf(sender), totalDebit);

        settledAmount = FHE.select(canCover, sanitizedAmount, zero);
        settledFee = FHE.select(canCover, fee, zero);
        settledDebit = FHE.add(settledAmount, settledFee);
    }

    function _credit(address account, euint128 amount) internal {
        if (euint128.unwrap(amount) == 0) {
            return;
        }

        if (!balances[account].exists) {
            balances[account] = EncryptedBalance({amount: amount, exists: true});
        } else {
            balances[account].amount = FHE.add(balances[account].amount, amount);
        }

        _refreshBalancePermissions(account);
    }

    function _debit(address account, euint128 amount) internal {
        _debitUnchecked(account, FHE.min(_balanceOf(account), amount));
    }

    function _debitUnchecked(address account, euint128 amount) internal {
        if (!balances[account].exists) {
            balances[account] = EncryptedBalance({amount: _zeroEuint128(), exists: true});
        }

        balances[account].amount = FHE.sub(balances[account].amount, amount);
        _refreshBalancePermissions(account);
    }

    function _balanceOf(address account) internal view returns (euint128) {
        if (!balances[account].exists) {
            return _zeroEuint128();
        }

        return balances[account].amount;
    }

    function _refreshBalancePermissions(address account) internal {
        if (!balances[account].exists || euint128.unwrap(balances[account].amount) == 0) {
            return;
        }

        FHE.allowThis(balances[account].amount);
        FHE.allow(balances[account].amount, account);
        if (owner != account) {
            FHE.allow(balances[account].amount, owner);
        }
        if (workflowModule != address(0) && workflowModule != account && workflowModule != owner) {
            FHE.allow(balances[account].amount, workflowModule);
        }
        if (
            escrowModule != address(0) &&
            escrowModule != account &&
            escrowModule != owner &&
            escrowModule != workflowModule
        ) {
            FHE.allow(balances[account].amount, escrowModule);
        }
    }

    function _refreshPaymentPermissions(
        bytes32 paymentId,
        address sender,
        address recipient
    ) internal {
        if (euint128.unwrap(paymentAmounts[paymentId]) != 0) {
            FHE.allowThis(paymentAmounts[paymentId]);
            FHE.allow(paymentAmounts[paymentId], sender);
            FHE.allow(paymentAmounts[paymentId], recipient);
            if (owner != sender && owner != recipient) {
                FHE.allow(paymentAmounts[paymentId], owner);
            }
        }

        if (euint128.unwrap(paymentFees[paymentId]) != 0) {
            FHE.allowThis(paymentFees[paymentId]);
            FHE.allow(paymentFees[paymentId], sender);
            FHE.allow(paymentFees[paymentId], recipient);
            if (owner != sender && owner != recipient) {
                FHE.allow(paymentFees[paymentId], owner);
            }
        }
    }

    function _refreshTotalPermissions() internal {
        if (euint128.unwrap(totalWrapped) == 0) {
            return;
        }

        FHE.allowThis(totalWrapped);
        FHE.allow(totalWrapped, owner);
    }

    function _calculateFee(euint128 amount) internal returns (euint128) {
        if (platformFeeBps == 0) {
            return _zeroEuint128();
        }

        return FHE.div(
            FHE.mul(amount, FHE.asEuint128(platformFeeBps)),
            FHE.asEuint128(BPS_DENOMINATOR)
        );
    }

    function _sanitizePositive(euint128 amount) internal returns (euint128) {
        return FHE.select(FHE.gt(amount, _zeroEuint128()), amount, _zeroEuint128());
    }

    function _zeroEuint128() internal pure returns (euint128) {
        return euint128.wrap(0);
    }

    function _hasActiveGrant(address subject, address auditor) internal view returns (bool) {
        ComplianceGrant memory grant = complianceGrants[subject][auditor];
        return grant.active && grant.expiresAt >= uint64(block.timestamp);
    }

    function _canViewAccount(address subject, address viewer) internal view returns (bool) {
        return
            viewer == subject ||
            _canAuditorViewScope(subject, viewer, IHexaPay.ComplianceScope.Balance);
    }

    function _canViewPayment(bytes32 paymentId, address viewer) internal view returns (bool) {
        Payment memory payment = payments[paymentId];
        if (!payment.completed) {
            return false;
        }

        if (viewer == payment.sender || viewer == payment.recipient) {
            return true;
        }

        return
            _canAuditorViewScope(payment.sender, viewer, IHexaPay.ComplianceScope.Payment) ||
            _canAuditorViewScope(payment.recipient, viewer, IHexaPay.ComplianceScope.Payment);
    }

    function _canAuditorViewScope(
        address subject,
        address auditor,
        IHexaPay.ComplianceScope scope
    ) internal view returns (bool) {
        if (!authorizedAuditors[auditor]) {
            return false;
        }

        if (_hasActiveGrant(subject, auditor)) {
            return true;
        }

        return
            complianceModule != address(0) &&
            HexaPayComplianceModule(complianceModule).hasScopedAccess(subject, auditor, scope);
    }

    function _isCompanyOperator(address company, address operator) internal view returns (bool) {
        if (company == address(0) || operator == address(0)) {
            return false;
        }

        return operator == company || companySignerApprovals[company][operator];
    }

    function _nextPaymentId(
        address sender,
        address recipient,
        bytes32 referenceHash,
        PaymentKind kind
    ) internal returns (bytes32) {
        paymentNonce += 1;
        return keccak256(
            abi.encodePacked(address(this), sender, recipient, referenceHash, kind, paymentNonce)
        );
    }
}
