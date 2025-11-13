// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Direction1155CMinting.sol";

abstract contract Direction1155CMarketplace is Direction1155CMinting {
    constructor(string memory baseURI_) Direction1155CMinting(baseURI_) {}

    function setPaymentToken(
        address token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0), "invalid token");
        paymentToken = IERC20(token);
        emit PaymentTokenSet(token);
    }

    // ===== Marketplace =====
    function createListing(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit
    ) external nonReentrant returns (uint256) {
        require(kyc[msg.sender], "KYC required");
        require(address(paymentToken) != address(0), "payment token not set");
        require(amount > 0, "amount=0");
        require(pricePerUnit > 0, "price=0");

        uint256 listingId = _listingIdTracker++;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenId: tokenId,
            pricePerUnit: pricePerUnit,
            amountRemaining: amount,
            active: true
        });

        _safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        emit ListingCreated(listingId, msg.sender, tokenId, amount, pricePerUnit);
        return listingId;
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.seller != address(0), "invalid listing");
        require(listing.active, "inactive");
        require(listing.seller == msg.sender, "not seller");

        listing.active = false;
        uint256 remaining = listing.amountRemaining;
        listing.amountRemaining = 0;

        if (remaining > 0) {
            _safeTransferFrom(
                address(this),
                listing.seller,
                listing.tokenId,
                remaining,
                ""
            );
        }

        emit ListingCancelled(listingId, remaining);
    }

    function buyListing(
        uint256 listingId,
        uint256 amount
    ) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.seller != address(0) && listing.active, "invalid listing");
        require(amount > 0, "amount=0");
        require(amount <= listing.amountRemaining, "exceeds listing");
        require(kyc[msg.sender], "KYC required");
        IERC20 token = paymentToken;
        require(address(token) != address(0), "payment token not set");

        uint256 totalPrice = listing.pricePerUnit * amount;
        require(totalPrice > 0, "bad price");

        require(
            balanceOf(address(this), listing.tokenId) >= amount,
            "insufficient escrow"
        );

        _erc20TransferFrom(token, msg.sender, address(this), totalPrice);
        _erc20Transfer(token, listing.seller, totalPrice);

        listing.amountRemaining -= amount;
        if (listing.amountRemaining == 0) {
            listing.active = false;
        }

        _safeTransferFrom(address(this), msg.sender, listing.tokenId, amount, "");

        emit TokenPurchased(listingId, msg.sender, amount, totalPrice);
    }

    // ===== Interest distribution =====
    function distributeInterest(
        uint256 tokenId,
        uint256 totalAmount
    ) external nonReentrant {
        require(totalAmount > 0, "amount=0");
        require(kyc[msg.sender], "KYC required");
        IERC20 token = paymentToken;
        require(address(token) != address(0), "payment token not set");
        require(!frozenId[tokenId], "id frozen");

        address[] storage holders = _holders[tokenId];
        require(holders.length > 0, "no holders");

        uint256 supply = totalSupply(tokenId);
        require(supply > 0, "no supply");

        _erc20TransferFrom(token, msg.sender, address(this), totalAmount);

        uint256 distributed;
        for (uint256 i = 0; i < holders.length; i++) {
            address holder = holders[i];
            uint256 balance = balanceOf(holder, tokenId);
            if (balance == 0) continue;

            uint256 share = (totalAmount * balance) / supply;
            if (share == 0) continue;

            distributed += share;
            _erc20Transfer(token, holder, share);
        }

        emit InterestDistributed(tokenId, totalAmount, distributed);
    }
}
