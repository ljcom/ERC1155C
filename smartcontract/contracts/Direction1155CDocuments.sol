// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "./Direction1155CKyc.sol";

abstract contract Direction1155CDocuments is Direction1155CKyc {
    constructor(string memory baseURI_) Direction1155CKyc(baseURI_) {}

    // ===== Documents & URI per ID =====
    function setDocument(
        uint256 id,
        bytes32 hash_,
        string calldata cid_
    ) external onlyRole(NOTARY_ROLE) {
        _doc[id].hash = hash_;
        _doc[id].cid = cid_;
        emit DocumentUpdated(id, hash_, cid_);
    }

    function setURI(
        uint256 id,
        string calldata newUri
    ) external onlyRole(MANAGER_ROLE) {
        _doc[id].uri = newUri;
        emit URI(newUri, id);
    }

    function uri(
        uint256 id
    ) public view virtual override(ERC1155) returns (string memory) {
        string memory u = _doc[id].uri;
        return bytes(u).length > 0 ? u : super.uri(id);
    }

    function getDocument(
        uint256 id
    ) external view returns (bytes32, string memory) {
        return (_doc[id].hash, _doc[id].cid);
    }
}
