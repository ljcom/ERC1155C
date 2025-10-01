// contracts/DIREToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract DIREToken is ERC721URIStorage {
    uint256 public tokenCount;

    constructor() ERC721("DIREToken", "DIRE") {}

    function mint(address to, string memory tokenURI) public returns (uint256) {
        tokenCount += 1;
        uint256 newTokenId = tokenCount;
        _mint(to, newTokenId);
        _setTokenURI(newTokenId, tokenURI);
        return newTokenId;
    }
}