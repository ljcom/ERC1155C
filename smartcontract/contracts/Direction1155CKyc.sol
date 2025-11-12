// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Direction1155CBase.sol";

abstract contract Direction1155CKyc is Direction1155CBase {
    constructor(string memory baseURI_) Direction1155CBase(baseURI_) {}

    // ===== Admin/KYC =====
    function setKyc(
        address user,
        bool allowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        kyc[user] = allowed;
        emit KycUpdated(user, allowed);
    }

    function setFreezeId(
        uint256 id,
        bool frozen
    ) external onlyRole(MANAGER_ROLE) {
        frozenId[id] = frozen;
        emit IdFrozen(id, frozen);
    }

    function setFreezeAccount(
        address user,
        bool frozen
    ) external onlyRole(MANAGER_ROLE) {
        frozenAccount[user] = frozen;
        emit AccountFrozen(user, frozen);
    }

    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }
}
