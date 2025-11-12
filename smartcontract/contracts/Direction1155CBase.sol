// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract Direction1155CBase is
    ERC1155,
    ERC1155Supply,
    AccessControlEnumerable,
    Pausable,
    ReentrancyGuard,
    IERC1155Receiver
{
    bytes32 public constant NOTARY_ROLE = keccak256("NOTARY_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // === KYC / Compliance ===
    mapping(address => bool) public kyc;
    mapping(uint256 => bool) public frozenId;
    mapping(address => bool) public frozenAccount;

    // === Metadata per ID ===
    struct DocInfo {
        bytes32 hash;
        string cid;
        string uri;
    }
    mapping(uint256 => DocInfo) internal _doc;

    // === Mint requests (2-of-2) ===
    struct MintApproval {
        bool byNotary;
        bool byManager;
    }
    struct FeeInfo {
        uint256 notaryFee;
        uint256 managerFee;
        uint256 tax;
    }
    struct MintRequest {
        address to;
        uint256 id;
        uint256 amount;
        bool executed;
        MintApproval approval;
        FeeInfo fees;
        string uri;
        bytes32 docHash;
        string docCid;
    }
    uint256 public mintRequestId;
    mapping(uint256 => MintRequest) public mintRequests;

    // === Fee accrual (pull payments) ===
    mapping(address => uint256) public accrued;

    // === Payment token & marketplace ===
    IERC20 public paymentToken;

    struct Listing {
        address seller;
        uint256 tokenId;
        uint256 pricePerUnit;
        uint256 amountRemaining;
        bool active;
    }
    uint256 internal _listingIdTracker;
    mapping(uint256 => Listing) public listings;

    // === Holder enumeration per ID ===
    mapping(uint256 => address[]) internal _holders;
    mapping(uint256 => mapping(address => bool)) internal _holderExists;
    mapping(uint256 => mapping(address => uint256)) internal _holderIndex;

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
    event PaymentTokenSet(address indexed token);
    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 pricePerUnit
    );
    event ListingCancelled(uint256 indexed listingId, uint256 amountReturned);
    event TokenPurchased(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 amount,
        uint256 totalPrice
    );
    event InterestDistributed(
        uint256 indexed tokenId,
        uint256 totalAmount,
        uint256 distributedAmount
    );

    constructor(string memory baseURI_) ERC1155(baseURI_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        kyc[msg.sender] = true;
        emit KycUpdated(msg.sender, true);
        kyc[address(this)] = true;
        emit KycUpdated(address(this), true);
    }

    // ===== Internal helpers =====
    function _getReq(
        uint256 reqId
    ) internal view returns (MintRequest storage r) {
        require(reqId < mintRequestId, "bad reqId");
        r = mintRequests[reqId];
    }

    function _onlyOneMember(bytes32 role) internal view returns (address) {
        uint256 c = getRoleMemberCount(role);
        return c > 0 ? getRoleMember(role, 0) : address(0);
    }

    function _erc20Transfer(
        IERC20 token,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        require(token.transfer(to, amount), "ERC20 transfer failed");
    }

    function _erc20TransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        require(
            token.transferFrom(from, to, amount),
            "ERC20 transferFrom failed"
        );
    }

    function _syncHolders(
        address from,
        address to,
        uint256[] memory ids
    ) internal {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 tokenId = ids[i];
            if (from != address(0)) {
                _maybeRemoveHolder(tokenId, from);
            }
            if (to != address(0)) {
                _maybeAddHolder(tokenId, to);
            }
        }
    }

    function _maybeAddHolder(uint256 id, address account) internal {
        if (_holderExists[id][account]) return;
        if (balanceOf(account, id) == 0) return;
        _holderIndex[id][account] = _holders[id].length;
        _holderExists[id][account] = true;
        _holders[id].push(account);
    }

    function _maybeRemoveHolder(uint256 id, address account) internal {
        if (!_holderExists[id][account]) return;
        if (balanceOf(account, id) != 0) return;

        uint256 index = _holderIndex[id][account];
        uint256 lastIndex = _holders[id].length - 1;
        if (index != lastIndex) {
            address lastHolder = _holders[id][lastIndex];
            _holders[id][index] = lastHolder;
            _holderIndex[id][lastHolder] = index;
        }
        _holders[id].pop();
        delete _holderIndex[id][account];
        _holderExists[id][account] = false;
    }

    function getHolders(uint256 id) external view returns (address[] memory) {
        return _holders[id];
    }

    // ===== Hooks & overrides =====
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts
    )
        internal
        override(ERC1155, ERC1155Supply)
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

        super._update(from, to, ids, amounts);
        _syncHolders(from, to, ids);
    }

    function supportsInterface(
        bytes4 iid
    )
        public
        view
        virtual
        override(AccessControlEnumerable, ERC1155, IERC165)
        returns (bool)
    {
        return
            iid == type(IERC1155Receiver).interfaceId ||
            super.supportsInterface(iid);
    }

    // receive/withdraw ETH (untuk contoh pull payments)
    receive() external payable {}

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
