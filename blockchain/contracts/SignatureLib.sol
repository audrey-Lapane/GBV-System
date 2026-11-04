// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Shared helper: every signed action is keccak256(abi.encode(...)) signed as an
/// EIP-191 personal message, so the browser signs it with ethers `signMessage(getBytes(digest))`
/// and MetaMask signs it with `personal_sign`.
library SignatureLib {
    function signer(bytes32 digest, bytes memory signature) internal pure returns (address) {
        return ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
    }
}
