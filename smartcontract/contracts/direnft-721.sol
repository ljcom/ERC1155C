// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "hardhat/console.sol";

contract DIRENFT is ERC721, AccessControl {
    bytes32 public constant NOTARY_ROLE = keccak256("NOTARY_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    uint256 private _tokenIdCounter;
    uint256 public mintRequestId;
    address[] private _whitelistedUsers;
    address public contractOwner;

    struct OwnerInfo {
        string name;
        string email;
    }

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
        string tokenURI;
        bool executed;
        MintApproval approval;
        FeeInfo fees;
    }

    mapping(uint256 => address) public lastOwner;
    mapping(address => bool) public whitelisted;
    mapping(address => OwnerInfo) public ownerInfo;
    mapping(uint256 => MintRequest) public mintRequests;
    mapping(uint256 => string) private _tokenURIs;
    mapping(address => bytes32) public didHash;
    mapping(bytes32 => address[]) private _roleMembers;
    
    event MintRequested(uint256 indexed requestId, address indexed to);
    event ApprovedByNotary(uint256 indexed requestId);
    event ApprovedByManager(uint256 indexed requestId);
    event NFTMinted(uint256 indexed tokenId, address indexed to);

    constructor() ERC721("DIRENFT", "DIRE") {
        contractOwner = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function exists(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    function whitelistAddress(
        address user,
        string memory name,
        string memory email,
        bytes32 _didHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!whitelisted[user], "Already whitelisted");
        whitelisted[user] = true;
        ownerInfo[user] = OwnerInfo(name, email);
        didHash[user] = _didHash;
        _whitelistedUsers.push(user);
    }

    modifier onlyWhitelisted(address user) {
        require(whitelisted[user], "Address not whitelisted");
        _;
    }

    function requestMint(
        address to,
        string memory _tokenURI,
        FeeInfo memory fees
    ) external onlyWhitelisted(to) {
        require(to != contractOwner, "Requestor cannot be contract owner");

        address notary = getRoleAddress(NOTARY_ROLE);
        require(to != notary, "Requestor cannot be Notary");

        address manager = getRoleAddress(MANAGER_ROLE);
        require(to != manager, "Requestor cannot be Manager");

        mintRequests[mintRequestId] = MintRequest(
            to,
            _tokenURI,
            false,
            MintApproval(false, false),
            fees
        );
        emit MintRequested(mintRequestId, to);
        mintRequestId++;
    }

    function approveByNotary(uint256 requestId) external onlyRole(NOTARY_ROLE) {
        require(requestId < mintRequestId, "Invalid requestId");
        require(!mintRequests[requestId].approval.byNotary, "Already approved by Notary");

        mintRequests[requestId].approval.byNotary = true;
        emit ApprovedByNotary(requestId);
    }

    function approveByManager(uint256 requestId) external onlyRole(MANAGER_ROLE) {
        require(requestId < mintRequestId, "Invalid requestId");
        require(!mintRequests[requestId].approval.byManager, "Already approved by Manager");

        mintRequests[requestId].approval.byManager = true;
        emit ApprovedByManager(requestId);
    }

    function executeMint(uint256 requestId) external {
        require(requestId < mintRequestId, "Invalid requestId");

        MintRequest storage req = mintRequests[requestId];
        console.log("Mint exec: to=%s", req.to);
        
        require(!req.executed, "Already minted");
        require(req.approval.byNotary, "Notary not approved");
        require(req.approval.byManager, "Manager not approved");
        require(req.to != address(0), "Invalid recipient");

        uint256 tokenId = _tokenIdCounter;
        _safeMint(req.to, tokenId);
        _setTokenURI(tokenId, req.tokenURI);
        lastOwner[tokenId] = req.to;
        _tokenIdCounter++;
        req.executed = true;

        emit NFTMinted(tokenId, req.to);
    }

    function _setTokenURI(uint256 tokenId, string memory uri) internal {
        require(exists(tokenId), "URI set of nonexistent token");
        _tokenURIs[tokenId] = uri;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(exists(tokenId), "tokenURI query for nonexistent token");
        return _tokenURIs[tokenId];
    }

    function getMintFees(uint256 requestId) external view returns (FeeInfo memory) {
        return mintRequests[requestId].fees;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(AccessControl, ERC721) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function grantRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        require(account != contractOwner, "Owner cannot be assigned to any role");
        require(role != NOTARY_ROLE || account != getRoleAddress(MANAGER_ROLE), "Notary cannot be Manager");
        require(role != MANAGER_ROLE || account != getRoleAddress(NOTARY_ROLE), "Manager cannot be Notary");
        super.grantRole(role, account);
        _roleMembers[role].push(account);
    }

    function getRoleMembers(bytes32 role) external view returns (address[] memory) {
        return _roleMembers[role];
    }

    function getRoleAddress(bytes32 role) internal view returns (address) {
        address[] memory members = _roleMembers[role];
        if (members.length > 0) {
            return members[0];
        }
        return address(0);
    }

    function getWhitelistedUsers() external view returns (address[] memory) {
        return _whitelistedUsers;
    }
    
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        require(whitelisted[to], "Recipient must be whitelisted");
        return super._update(to, tokenId, auth);
    }
}