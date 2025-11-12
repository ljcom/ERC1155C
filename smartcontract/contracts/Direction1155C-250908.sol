// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Direction1155C is
    ERC1155,
    ERC1155Supply,
    AccessControlEnumerable,
    Pausable,
    ReentrancyGuard
{
    bytes32 public constant NOTARY_ROLE = keccak256("NOTARY_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // === KYC / Compliance ===
    mapping(address => bool) public kyc;
    mapping(uint256 => bool) public frozenId; // freeze per ID
    mapping(address => bool) public frozenAccount; // freeze per account

    // === Metadata per ID ===
    struct DocInfo {
        bytes32 hash;
        string cid;
        string uri;
    }
    mapping(uint256 => DocInfo) private _doc;

    // === Mint requests (2-of-2) ===
    struct MintApproval {
        bool byNotary;
        bool byManager;
    }
    struct FeeInfo {
        uint256 notaryFee;
        uint256 managerFee;
        uint256 tax;
    } // contoh nominal
    struct MintRequest {
        address to;
        uint256 id;
        uint256 amount;
        bool executed;
        MintApproval approval;
        FeeInfo fees;
        string uri; // optional set/override uri saat seri pertama kali dimint
        bytes32 docHash;
        string docCid;
    }
    uint256 public mintRequestId;
    mapping(uint256 => MintRequest) public mintRequests;

    // === Fee accrual (pull payments) ===
    mapping(address => uint256) public accrued;

    // === Events ===
    event KycUpdated(address indexed user, bool allowed);
    event IdFrozen(uint256 indexed id, bool frozen);
    event AccountFrozen(address indexed user, bool frozen);
    event DocumentUpdated(uint256 indexed id, bytes32 hash, string cid);
    event MintRequested(
        uint256 indexed requestId,
        address indexed to,
        uint256 indexed id,
        uint256 amount
    );
    event ApprovedByNotary(uint256 indexed requestId);
    event ApprovedByManager(uint256 indexed requestId);
    event MintExecuted(
        uint256 indexed requestId,
        uint256 indexed id,
        uint256 amount,
        address to
    );
    event FeesAccrued(
        uint256 indexed requestId,
        address notary,
        address manager,
        uint256 tax
    );
    event Withdrawn(address indexed to, uint256 amount);

    constructor(string memory baseURI) ERC1155(baseURI) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

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
        emit URI(newUri, id); // ERC1155 standard event
    }

    function uri(uint256 id) public view override returns (string memory) {
        string memory u = _doc[id].uri;
        return bytes(u).length > 0 ? u : super.uri(id);
    }

    function getDocument(
        uint256 id
    ) external view returns (bytes32, string memory) {
        return (_doc[id].hash, _doc[id].cid);
    }

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
        // pemohon harus KYC, tujuan juga KYC (opsi: hanya tujuan)
        require(kyc[msg.sender] && kyc[to], "KYC required");
        require(to != address(0), "bad to");
        require(amount > 0, "amount=0");
        // opsi: larang pemohon = NOTARY/MANAGER jika kebijakan Anda mengharuskan
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

        // set URI/doc pertama kali jika belum diisi
        if (bytes(_doc[r.id].uri).length == 0 && bytes(r.uri).length > 0) {
            _doc[r.id].uri = r.uri;
            emit URI(r.uri, r.id);
        }
        if (_doc[r.id].hash == bytes32(0) && r.docHash != bytes32(0)) {
            _doc[r.id].hash = r.docHash;
            _doc[r.id].cid = r.docCid;
            emit DocumentUpdated(r.id, r.docHash, r.docCid);
        }

        // MINT
        _mint(r.to, r.id, r.amount, "");

        // Accrue fees (contoh: nilai absolut; produksi: hitung dari harga mint)
        // Taruh alamat fee receiver via setter, disederhanakan di contoh ini
        address notary = _onlyOneMember(NOTARY_ROLE);
        address manager = _onlyOneMember(MANAGER_ROLE);
        if (notary != address(0)) accrued[notary] += r.fees.notaryFee;
        if (manager != address(0)) accrued[manager] += r.fees.managerFee;
        accrued[address(this)] += r.fees.tax; // contoh: pajak ditahan kontrak utk disetor

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

    // ===== Hooks & overrides =====
    function _getReq(
        uint256 reqId
    ) internal view returns (MintRequest storage r) {
        require(reqId < mintRequestId, "bad reqId");
        r = mintRequests[reqId]; // mapping lookup yang benar (keccak hashing by compiler)
    }

    // Hook tunggal yang dipanggil untuk mint/burn/transfer (single & batch)
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts
    )
        internal
        override(
            ERC1155,
            ERC1155Supply // <- sebutkan keduanya
        )
        whenNotPaused
    {
        if (to != address(0)) {
            require(kyc[to], "KYC to");
            require(!frozenAccount[to], "to frozen");
            for (uint256 i = 0; i < ids.length; i++) {
                require(!frozenId[ids[i]], "id frozen");
            }
        }
        if (from != address(0)) {
            require(!frozenAccount[from], "from frozen");
        }

        super._update(from, to, ids, amounts); // linearization akan panggil keduanya dengan benar
    }

    function supportsInterface(
        bytes4 iid
    ) public view override(AccessControlEnumerable, ERC1155) returns (bool) {
        return super.supportsInterface(iid);
    }

    // util: ambil satu member role (opsional; lebih baik kelola via registry)
    function _onlyOneMember(bytes32 role) internal view returns (address) {
        uint256 c = getRoleMemberCount(role);
        return c > 0 ? getRoleMember(role, 0) : address(0);
    }

    // receive/withdraw ETH (untuk contoh pull payments)
    receive() external payable {}
}
