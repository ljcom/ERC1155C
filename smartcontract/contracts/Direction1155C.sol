// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Direction1155CMarketplace.sol";

contract Direction1155C is Direction1155CMarketplace {
    constructor(string memory baseURI) Direction1155CMarketplace(baseURI) {}
}
