// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignatureLib} from "./SignatureLib.sol";
import {ReportRegistry} from "./ReportRegistry.sol";

/// @title ConsentManagement
/// @notice Records and enforces the reporter's consent. Grant, revoke and the alert choice are
/// authorised only by the reporter's signature. Institutional users (staff) are registered
/// by the administrator's signature and act by signing with their own bound wallet.
/// Nothing is ever deleted: a revoked grant keeps its record with status Revoked.
contract ConsentManagement {
    // Roles (0 = none)
    uint8 public constant ROLE_GBV_OFFICE = 1; // designated office: receives alerts
    uint8 public constant ROLE_LEGAL = 2;
    uint8 public constant ROLE_HEALTH = 3;
    uint8 public constant ROLE_SOCIAL_WORKER = 4;
    uint8 public constant MAX_ROLE = 4;

    // Scope bits, same values as ReportRegistry sections
    uint8 public constant SCOPE_ALL = 7;

    bytes32 public constant CREATE_TAG = keccak256("GBV.CREATE_CONSENT");
    bytes32 public constant GRANT_TAG = keccak256("GBV.GRANT");
    bytes32 public constant REVOKE_TAG = keccak256("GBV.REVOKE");
    bytes32 public constant REQUEST_TAG = keccak256("GBV.REQUEST_ACCESS");
    bytes32 public constant REGISTER_INST_TAG = keccak256("GBV.REGISTER_INSTITUTION");
    bytes32 public constant DEACTIVATE_INST_TAG = keccak256("GBV.DEACTIVATE_INSTITUTION");

    enum Status { None, Granted, Revoked }

    struct Grant {
        Status status;
        uint8 scope;
        uint64 validUntil;
        uint64 updatedAt;
    }

    struct ReportConsent {
        bool exists;
        uint8 category;
        uint32 reportDay; // days since 1970-01-01, never an exact time
        uint256 nonce;
    }

    struct Institution {
        bool active;
        uint8 role;
        bytes32 staffRef; // HMAC of the staff number, computed off-chain
    }

    ReportRegistry public immutable registry;
    address public immutable admin;
    uint256 public adminNonce;

    mapping(bytes32 => ReportConsent) private consents;
    mapping(bytes32 => mapping(uint8 => Grant)) private grants;
    mapping(address => Institution) private institutions;
    mapping(address => uint256) public staffNonce;

    event AlertSent(bytes32 indexed reportId, uint8 officeRole, uint8 category, uint32 reportDay);
    event ConsentGranted(bytes32 indexed reportId, uint8 role, uint8 scope, uint64 validUntil);
    event ConsentRevoked(bytes32 indexed reportId, uint8 role);
    event AccessRequested(bytes32 indexed reportId, uint8 role, bytes32 staffRef, address staff, uint8 scope);
    event InstitutionRegistered(address indexed account, uint8 role, bytes32 staffRef);
    event InstitutionDeactivated(address indexed account);

    error BadSignature();
    error BadNonce();
    error AlreadyCreated();
    error UnknownReport();
    error ReportNotActive();
    error BadRole();
    error BadScope();
    error BadExpiry();
    error NotInstitution();
    error NotGranted();

    constructor(address registryAddress, address adminAddress) {
        registry = ReportRegistry(registryAddress);
        admin = adminAddress;
    }

    // ---------- reporter (signed) ----------

    /// @notice Records the reporter's required choice at submission ("share now" or "alert only")
    /// and always emits a minimal alert (ID, office role, category, day) to the designated office.
    function createConsent(
        bytes32 reportId,
        uint8 category,
        uint32 reportDay,
        bool shareNow,
        uint8 scope,
        uint64 validUntil,
        bytes calldata signature
    ) external {
        if (consents[reportId].exists) revert AlreadyCreated();
        address reporter = registry.reporterOf(reportId);
        if (reporter == address(0)) revert UnknownReport();
        if (!registry.isActive(reportId)) revert ReportNotActive();
        bytes32 digest = keccak256(
            abi.encode(address(this), block.chainid, CREATE_TAG, reportId, category, reportDay, shareNow, scope, validUntil)
        );
        if (SignatureLib.signer(digest, signature) != reporter) revert BadSignature();

        consents[reportId] = ReportConsent({exists: true, category: category, reportDay: reportDay, nonce: 0});
        emit AlertSent(reportId, ROLE_GBV_OFFICE, category, reportDay);
        if (shareNow) {
            _grant(reportId, ROLE_GBV_OFFICE, scope, validUntil);
        }
    }

    function grantAccess(
        bytes32 reportId,
        uint8 role,
        uint8 scope,
        uint64 validUntil,
        uint256 nonce,
        bytes calldata signature
    ) external {
        ReportConsent storage c = _existing(reportId);
        bytes32 digest = keccak256(
            abi.encode(address(this), block.chainid, GRANT_TAG, reportId, role, scope, validUntil, nonce)
        );
        _useReporterNonce(reportId, c, digest, nonce, signature);
        _grant(reportId, role, scope, validUntil);
    }

    function revokeConsent(bytes32 reportId, uint8 role, uint256 nonce, bytes calldata signature) external {
        ReportConsent storage c = _existing(reportId);
        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, REVOKE_TAG, reportId, role, nonce));
        _useReporterNonce(reportId, c, digest, nonce, signature);
        Grant storage g = grants[reportId][role];
        if (g.status != Status.Granted) revert NotGranted();
        g.status = Status.Revoked;
        g.updatedAt = uint64(block.timestamp);
        emit ConsentRevoked(reportId, role);
    }

    // ---------- staff (signed with their bound wallet) ----------

    function requestAccess(bytes32 reportId, uint8 scope, uint256 nonce, bytes calldata signature) external {
        _existing(reportId);
        if (scope == 0 || scope > SCOPE_ALL) revert BadScope();
        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, REQUEST_TAG, reportId, scope, nonce));
        address staff = SignatureLib.signer(digest, signature);
        Institution storage inst = institutions[staff];
        if (!inst.active) revert NotInstitution();
        if (nonce != staffNonce[staff]) revert BadNonce();
        staffNonce[staff] = nonce + 1;
        emit AccessRequested(reportId, inst.role, inst.staffRef, staff, scope);
    }

    // ---------- administrator (signed) ----------

    function registerInstitution(address account, uint8 role, bytes32 staffRef, uint256 nonce, bytes calldata signature)
        external
    {
        if (role == 0 || role > MAX_ROLE) revert BadRole();
        bytes32 digest = keccak256(
            abi.encode(address(this), block.chainid, REGISTER_INST_TAG, account, role, staffRef, nonce)
        );
        _useAdminNonce(digest, nonce, signature);
        institutions[account] = Institution({active: true, role: role, staffRef: staffRef});
        emit InstitutionRegistered(account, role, staffRef);
    }

    function deactivateInstitution(address account, uint256 nonce, bytes calldata signature) external {
        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, DEACTIVATE_INST_TAG, account, nonce));
        _useAdminNonce(digest, nonce, signature);
        if (!institutions[account].active) revert NotInstitution();
        institutions[account].active = false;
        emit InstitutionDeactivated(account);
    }

    // ---------- views ----------

    /// @return true only when the report is live, the role holds an unexpired Granted
    /// consent, and every requested section is inside the granted scope.
    function checkConsent(bytes32 reportId, uint8 role, uint8 sections) public view returns (bool) {
        if (sections == 0) return false;
        if (!registry.isActive(reportId)) return false;
        Grant storage g = grants[reportId][role];
        return g.status == Status.Granted && block.timestamp <= g.validUntil && (g.scope & sections) == sections;
    }

    function viewConsent(bytes32 reportId, uint8 role) external view returns (Grant memory) {
        return grants[reportId][role];
    }

    function consentInfo(bytes32 reportId) external view returns (ReportConsent memory) {
        return consents[reportId];
    }

    function institutionOf(address account) external view returns (Institution memory) {
        return institutions[account];
    }

    function nonceOf(bytes32 reportId) external view returns (uint256) {
        return consents[reportId].nonce;
    }

    // ---------- internal ----------

    function _existing(bytes32 reportId) private view returns (ReportConsent storage c) {
        c = consents[reportId];
        if (!c.exists) revert UnknownReport();
        if (!registry.isActive(reportId)) revert ReportNotActive();
    }

    function _useReporterNonce(
        bytes32 reportId,
        ReportConsent storage c,
        bytes32 digest,
        uint256 nonce,
        bytes calldata signature
    ) private {
        if (nonce != c.nonce) revert BadNonce();
        if (SignatureLib.signer(digest, signature) != registry.reporterOf(reportId)) revert BadSignature();
        c.nonce = nonce + 1;
    }

    function _useAdminNonce(bytes32 digest, uint256 nonce, bytes calldata signature) private {
        if (nonce != adminNonce) revert BadNonce();
        if (SignatureLib.signer(digest, signature) != admin) revert BadSignature();
        adminNonce = nonce + 1;
    }

    function _grant(bytes32 reportId, uint8 role, uint8 scope, uint64 validUntil) private {
        if (role == 0 || role > MAX_ROLE) revert BadRole();
        if (scope == 0 || scope > SCOPE_ALL) revert BadScope();
        if (validUntil <= block.timestamp) revert BadExpiry();
        grants[reportId][role] =
            Grant({status: Status.Granted, scope: scope, validUntil: validUntil, updatedAt: uint64(block.timestamp)});
        emit ConsentGranted(reportId, role, scope, validUntil);
    }
}
