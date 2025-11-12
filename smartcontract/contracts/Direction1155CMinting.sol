// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Direction1155CDocuments.sol";

abstract contract Direction1155CMinting is Direction1155CDocuments {
    constructor(string memory baseURI_) Direction1155CDocuments(baseURI_) {}

    // ===== Mint Request (2-of-2) =====
    function requestMint(
        address to,
        uint256 id,
        uint256 amount,
        FeeInfo calldata fees,
        string calldata setUriIfEmpty,
        bytes32 docHash,
        string calldata docCid
    ) external {
        require(kyc[msg.sender] && kyc[to], "KYC required");
        require(to != address(0), "bad to");
        require(amount > 0, "amount=0");

        MintRequest storage r = mintRequests[mintRequestId];
        r.to = to;
        r.id = id;
        r.amount = amount;
        r.fees = fees;
        r.uri = setUriIfEmpty;
        r.docHash = docHash;
        r.docCid = docCid;

        emit MintRequested(mintRequestId, to, id, amount);
        mintRequestId++;
    }

    function approveByNotary(uint256 reqId) external onlyRole(NOTARY_ROLE) {
        MintRequest storage r = _getReq(reqId);
        require(!r.approval.byNotary, "already");
        r.approval.byNotary = true;
        emit ApprovedByNotary(reqId);
    }

    function approveByManager(uint256 reqId) external onlyRole(MANAGER_ROLE) {
        MintRequest storage r = _getReq(reqId);
        require(!r.approval.byManager, "already");
        r.approval.byManager = true;
        emit ApprovedByManager(reqId);
    }

    function executeMint(uint256 reqId) external nonReentrant {
        MintRequest storage r = _getReq(reqId);
        require(!r.executed, "executed");
        require(r.approval.byNotary && r.approval.byManager, "need 2-of-2");
        require(!frozenId[r.id] && !frozenAccount[r.to], "frozen");
        require(kyc[r.to], "to not KYC");

        if (bytes(_doc[r.id].uri).length == 0 && bytes(r.uri).length > 0) {
            _doc[r.id].uri = r.uri;
            emit URI(r.uri, r.id);
        }
        if (_doc[r.id].hash == bytes32(0) && r.docHash != bytes32(0)) {
            _doc[r.id].hash = r.docHash;
            _doc[r.id].cid = r.docCid;
            emit DocumentUpdated(r.id, r.docHash, r.docCid);
        }

        _mint(r.to, r.id, r.amount, "");

        address notary = _onlyOneMember(NOTARY_ROLE);
        address manager = _onlyOneMember(MANAGER_ROLE);
        if (notary != address(0)) accrued[notary] += r.fees.notaryFee;
        if (manager != address(0)) accrued[manager] += r.fees.managerFee;
        accrued[address(this)] += r.fees.tax;

        r.executed = true;
        emit MintExecuted(reqId, r.id, r.amount, r.to);
        emit FeesAccrued(reqId, notary, manager, r.fees.tax);
    }

    function withdraw() external nonReentrant {
        uint256 amt = accrued[msg.sender];
        require(amt > 0, "no funds");
        accrued[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amt);
    }
}
