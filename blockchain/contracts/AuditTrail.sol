// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignatureLib} from "./SignatureLib.sol";
import {ConsentManagement} from "./ConsentManagement.sol";

/// @title AuditTrail
/// @notice Append-only log of every access attempt, permitted or denied.
/// The contract itself recovers the staff member from their wallet signature and decides
/// `permitted` by calling ConsentManagement.checkConsent, so the gateway (backend) can
/// neither forge who accessed nor claim a permission the chain did not give.
/// There is deliberately no function that edits or removes an entry.
contract AuditTrail {
    bytes32 public constant ACCESS_TAG = keccak256("GBV.ACCESS");

    struct Entry {
        address actor;
        bytes32 staffRef;
        uint8 role;
        uint8 sections;
        bool permitted;
        uint64 timestamp;
    }

    ConsentManagement public immutable consent;
    address public immutable gateway;

    mapping(bytes32 => Entry[]) private logs;
    mapping(address => uint256) public accessNonce;

    event AccessLogged(
        bytes32 indexed reportId, address indexed actor, bytes32 staffRef, uint8 role, uint8 sections, bool permitted
    );

    error OnlyGateway();
    error BadNonce();

    constructor(address consentAddress, address gatewayAddress) {
        consent = ConsentManagement(consentAddress);
        gateway = gatewayAddress;
    }

    /// @notice Records one access attempt and returns whether it was permitted.
    /// Unregistered or deactivated signers are logged with role 0 and are always denied.
    function logAccess(bytes32 reportId, uint8 sections, uint256 nonce, bytes calldata signature)
        external
        returns (bool permitted)
    {
        if (msg.sender != gateway) revert OnlyGateway();
        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, ACCESS_TAG, reportId, sections, nonce));
        address actor = SignatureLib.signer(digest, signature);
        if (nonce != accessNonce[actor]) revert BadNonce();
        accessNonce[actor] = nonce + 1;

        ConsentManagement.Institution memory inst = consent.institutionOf(actor);
        uint8 role = inst.active ? inst.role : 0;
        permitted = role != 0 && consent.checkConsent(reportId, role, sections);

        logs[reportId].push(
            Entry({
                actor: actor,
                staffRef: inst.staffRef,
                role: role,
                sections: sections,
                permitted: permitted,
                timestamp: uint64(block.timestamp)
            })
        );
        emit AccessLogged(reportId, actor, inst.staffRef, role, sections, permitted);
    }

    function getAuditLog(bytes32 reportId) external view returns (Entry[] memory) {
        return logs[reportId];
    }

    function auditCount(bytes32 reportId) external view returns (uint256) {
        return logs[reportId].length;
    }
}
