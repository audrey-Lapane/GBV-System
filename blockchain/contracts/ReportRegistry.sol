// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignatureLib} from "./SignatureLib.sol";

/// @title ReportRegistry
/// @notice Anchors each report's encrypted items (IPFS CID + SHA-256 of the ciphertext).
/// Holds no personal data. Every change is authorised by the reporter's signature, not by
/// the caller, so the backend can relay (and pay gas) but cannot act on its own.
contract ReportRegistry {
    uint8 public constant SECTION_SUMMARY = 1;
    uint8 public constant SECTION_DETAILS = 2;
    uint8 public constant SECTION_EVIDENCE = 4;

    bytes32 public constant REGISTER_TAG = keccak256("GBV.REGISTER");
    bytes32 public constant ADD_ITEM_TAG = keccak256("GBV.ADD_ITEM");
    bytes32 public constant WITHDRAW_ITEM_TAG = keccak256("GBV.WITHDRAW_ITEM");
    bytes32 public constant WITHDRAW_REPORT_TAG = keccak256("GBV.WITHDRAW_REPORT");

    struct ItemInput {
        uint8 section;
        bytes32 contentHash;
        string cid;
    }

    struct Item {
        uint8 section;
        bytes32 contentHash;
        string cid;
        bool active;
        uint64 addedAt;
    }

    struct Report {
        address reporter;
        bool exists;
        bool withdrawn;
        uint256 nonce;
    }

    mapping(bytes32 => Report) private reports;
    mapping(bytes32 => Item[]) private items;

    event ReportRegistered(bytes32 indexed reportId, address reporterKey, uint256 itemCount);
    event ItemAdded(bytes32 indexed reportId, uint256 index, uint8 section, bytes32 contentHash);
    event ItemWithdrawn(bytes32 indexed reportId, uint256 index);
    event ReportWithdrawn(bytes32 indexed reportId);

    error AlreadyRegistered();
    error UnknownReport();
    error BadSignature();
    error BadNonce();
    error BadSection();
    error ReportIsWithdrawn();
    error BadIndex();
    error NoItems();

    // ---------- reporter actions (signed) ----------

    function registerReport(
        bytes32 reportId,
        address reporterKey,
        ItemInput[] calldata newItems,
        bytes calldata signature
    ) external {
        if (reports[reportId].exists) revert AlreadyRegistered();
        if (reporterKey == address(0)) revert BadSignature();
        if (newItems.length == 0) revert NoItems();
        bytes32 digest = keccak256(
            abi.encode(address(this), block.chainid, REGISTER_TAG, reportId, reporterKey, hashItems(newItems))
        );
        if (SignatureLib.signer(digest, signature) != reporterKey) revert BadSignature();

        reports[reportId] = Report({reporter: reporterKey, exists: true, withdrawn: false, nonce: 0});
        emit ReportRegistered(reportId, reporterKey, newItems.length);
        for (uint256 i = 0; i < newItems.length; i++) {
            _push(reportId, newItems[i]);
        }
    }

    function addItem(bytes32 reportId, ItemInput calldata item, uint256 nonce, bytes calldata signature) external {
        Report storage r = _live(reportId);
        bytes32 digest = keccak256(
            abi.encode(
                address(this), block.chainid, ADD_ITEM_TAG, reportId,
                item.section, item.contentHash, keccak256(bytes(item.cid)), nonce
            )
        );
        _useNonce(r, digest, nonce, signature);
        _push(reportId, item);
    }

    function withdrawItem(bytes32 reportId, uint256 index, uint256 nonce, bytes calldata signature) external {
        Report storage r = _live(reportId);
        if (index >= items[reportId].length) revert BadIndex();
        bytes32 digest = keccak256(
            abi.encode(address(this), block.chainid, WITHDRAW_ITEM_TAG, reportId, index, nonce)
        );
        _useNonce(r, digest, nonce, signature);
        items[reportId][index].active = false;
        emit ItemWithdrawn(reportId, index);
    }

    function withdrawReport(bytes32 reportId, uint256 nonce, bytes calldata signature) external {
        Report storage r = _live(reportId);
        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, WITHDRAW_REPORT_TAG, reportId, nonce));
        _useNonce(r, digest, nonce, signature);
        r.withdrawn = true;
        Item[] storage list = items[reportId];
        for (uint256 i = 0; i < list.length; i++) {
            list[i].active = false;
        }
        emit ReportWithdrawn(reportId);
    }

    // ---------- views ----------

    function verifyIntegrity(bytes32 reportId, uint256 index, bytes32 contentHash) external view returns (bool) {
        if (index >= items[reportId].length) return false;
        Item storage it = items[reportId][index];
        return it.active && it.contentHash == contentHash;
    }

    function reporterOf(bytes32 reportId) external view returns (address) {
        return reports[reportId].reporter;
    }

    function isActive(bytes32 reportId) external view returns (bool) {
        return reports[reportId].exists && !reports[reportId].withdrawn;
    }

    function nonceOf(bytes32 reportId) external view returns (uint256) {
        return reports[reportId].nonce;
    }

    function getItems(bytes32 reportId) external view returns (Item[] memory) {
        return items[reportId];
    }

    function hashItems(ItemInput[] calldata list) public pure returns (bytes32) {
        bytes32[] memory parts = new bytes32[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            parts[i] = keccak256(abi.encode(list[i].section, list[i].contentHash, keccak256(bytes(list[i].cid))));
        }
        return keccak256(abi.encodePacked(parts));
    }

    // ---------- internal ----------

    function _live(bytes32 reportId) private view returns (Report storage r) {
        r = reports[reportId];
        if (!r.exists) revert UnknownReport();
        if (r.withdrawn) revert ReportIsWithdrawn();
    }

    function _useNonce(Report storage r, bytes32 digest, uint256 nonce, bytes calldata signature) private {
        if (nonce != r.nonce) revert BadNonce();
        if (SignatureLib.signer(digest, signature) != r.reporter) revert BadSignature();
        r.nonce = nonce + 1;
    }

    function _push(bytes32 reportId, ItemInput calldata item) private {
        if (item.section != SECTION_SUMMARY && item.section != SECTION_DETAILS && item.section != SECTION_EVIDENCE) {
            revert BadSection();
        }
        items[reportId].push(
            Item({section: item.section, contentHash: item.contentHash, cid: item.cid, active: true, addedAt: uint64(block.timestamp)})
        );
        emit ItemAdded(reportId, items[reportId].length - 1, item.section, item.contentHash);
    }
}
