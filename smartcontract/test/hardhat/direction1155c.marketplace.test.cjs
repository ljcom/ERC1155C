const { expect } = require("chai");
const { ethers } = require("hardhat");

const CONTRACT_FQN = "contracts/Direction1155C.sol:Direction1155C";

describe("Direction1155C - Marketplace & Interest", function () {
  let c, stable, admin, notary, manager, seller, buyer, extra, contractAddress;
  const tokenId = 1;
  const mintAmount = 100n;
  let ContractFactory;

  beforeEach(async () => {
    [admin, notary, manager, seller, buyer, extra] = await ethers.getSigners();

    ContractFactory = await ethers.getContractFactory(CONTRACT_FQN);
    c = await ContractFactory.deploy("ipfs://BASE/{id}.json");
    await c.waitForDeployment();
    contractAddress = await c.getAddress();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stable = await MockERC20.deploy();
    await stable.waitForDeployment();

    await c.grantRole(await c.NOTARY_ROLE(), notary.address);
    await c.grantRole(await c.MANAGER_ROLE(), manager.address);

    for (const signer of [admin, notary, manager, seller, buyer, extra]) {
      await c.setKyc(signer.address, true);
    }

    await c.setPaymentToken(await stable.getAddress());

    await c
      .connect(seller)
      .requestMint(
        seller.address,
        tokenId,
        mintAmount,
        { notaryFee: 0, managerFee: 0, tax: 0 },
        "",
        ethers.ZeroHash,
        ""
      );
    const reqId = (await c.mintRequestId()) - 1n;
    await c.connect(notary).approveByNotary(reqId);
    await c.connect(manager).approveByManager(reqId);
    await c.executeMint(reqId);
  });

  async function createListing(amount, price) {
    const tx = await c.connect(seller).createListing(tokenId, amount, price);
    const receipt = await tx.wait();
    const listingEvent = receipt.logs
      .map((log) => {
        try {
          return c.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "ListingCreated");
    return listingEvent.args.listingId;
  }

  it("allows KYC seller to list tokens and buyer to purchase with ERC20 payments", async () => {
    const price = ethers.parseUnits("5", 18);
    const amountForSale = 30n;
    const listingId = await createListing(amountForSale, price);

    const totalPrice = price * amountForSale;
    await stable.mint(buyer.address, totalPrice);
    await stable.connect(buyer).approve(contractAddress, totalPrice);

    const sellerStableBefore = await stable.balanceOf(seller.address);
    await expect(c.connect(buyer).buyListing(listingId, amountForSale))
      .to.emit(c, "TokenPurchased")
      .withArgs(listingId, buyer.address, amountForSale, totalPrice);

    expect(await c.balanceOf(buyer.address, tokenId)).to.equal(amountForSale);
    expect(await stable.balanceOf(seller.address)).to.equal(
      sellerStableBefore + totalPrice
    );

    const listing = await c.listings(listingId);
    expect(listing.active).to.equal(false);
    expect(listing.amountRemaining).to.equal(0);
    expect(await c.balanceOf(contractAddress, tokenId)).to.equal(0);
  });

  it("distributes interest proportionally to holders using holder enumeration", async () => {
    const transferAmount = 40n;
    await c
      .connect(seller)
      .safeTransferFrom(seller.address, buyer.address, tokenId, transferAmount, "0x");

    const sellerBalance = await c.balanceOf(seller.address, tokenId);
    const buyerBalance = await c.balanceOf(buyer.address, tokenId);

    expect(sellerBalance).to.equal(mintAmount - transferAmount);
    expect(buyerBalance).to.equal(transferAmount);

    const totalInterest = ethers.parseUnits("100", 18);
    await stable.mint(admin.address, totalInterest);
    await stable.connect(admin).approve(contractAddress, totalInterest);

    const sellerStableBefore = await stable.balanceOf(seller.address);
    const buyerStableBefore = await stable.balanceOf(buyer.address);

    const expectedSellerShare = (totalInterest * sellerBalance) / mintAmount;
    const expectedBuyerShare = (totalInterest * buyerBalance) / mintAmount;
    const expectedDistributed = expectedSellerShare + expectedBuyerShare;

    await expect(c.connect(admin).distributeInterest(tokenId, totalInterest))
      .to.emit(c, "InterestDistributed")
      .withArgs(tokenId, totalInterest, expectedDistributed);

    expect(await stable.balanceOf(seller.address)).to.equal(
      sellerStableBefore + expectedSellerShare
    );
    expect(await stable.balanceOf(buyer.address)).to.equal(
      buyerStableBefore + expectedBuyerShare
    );

    const residual = totalInterest - expectedSellerShare - expectedBuyerShare;
    expect(await stable.balanceOf(contractAddress)).to.equal(residual);
  });

  it("reverts listing creation for non-KYC sellers", async () => {
    const price = ethers.parseUnits("2", 18);
    await c.setKyc(seller.address, false);
    await expect(
      c.connect(seller).createListing(tokenId, 10, price)
    ).to.be.revertedWith("KYC required");
  });

  it("reverts listing creation for frozen sellers", async () => {
    const price = ethers.parseUnits("2", 18);
    await c.connect(manager).setFreezeAccount(seller.address, true);
    await expect(
      c.connect(seller).createListing(tokenId, 10, price)
    ).to.be.revertedWith("from frozen");
  });

  it("reverts marketplace purchases from non-KYC buyers", async () => {
    const price = ethers.parseUnits("3", 18);
    const listingId = await createListing(10n, price);
    await c.setKyc(buyer.address, false);
    await stable.mint(buyer.address, price * 10n);
    await stable.connect(buyer).approve(contractAddress, price * 10n);
    await expect(
      c.connect(buyer).buyListing(listingId, 5n)
    ).to.be.revertedWith("KYC required");
  });

  it("reverts purchases that exceed the listed amount", async () => {
    const price = ethers.parseUnits("4", 18);
    const listingId = await createListing(10n, price);
    await stable.mint(buyer.address, price * 15n);
    await stable.connect(buyer).approve(contractAddress, price * 15n);
    await expect(
      c.connect(buyer).buyListing(listingId, 11n)
    ).to.be.revertedWith("exceeds listing");
  });

  it("reverts purchases when buyer ERC20 balance is insufficient", async () => {
    const price = ethers.parseUnits("6", 18);
    const listingId = await createListing(10n, price);
    const totalPrice = price * 10n;
    await stable.mint(buyer.address, totalPrice - 1n);
    await stable.connect(buyer).approve(contractAddress, totalPrice);
    await expect(
      c.connect(buyer).buyListing(listingId, 10n)
    )
      .to.be.revertedWithCustomError(stable, "ERC20InsufficientBalance")
      .withArgs(buyer.address, totalPrice - 1n, totalPrice);
  });

  it("requires payment token to be configured before listing creation", async () => {
    const other = await ContractFactory.deploy("ipfs://BASE/{id}.json");
    await other.waitForDeployment();
    for (const signer of [admin, notary, manager, seller, buyer]) {
      await other.setKyc(signer.address, true);
    }
    await other.grantRole(await other.NOTARY_ROLE(), notary.address);
    await other.grantRole(await other.MANAGER_ROLE(), manager.address);
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };
    await other
      .connect(seller)
      .requestMint(seller.address, tokenId, 10n, fees, "", ethers.ZeroHash, "");
    const reqId = (await other.mintRequestId()) - 1n;
    await other.connect(notary).approveByNotary(reqId);
    await other.connect(manager).approveByManager(reqId);
    await other.executeMint(reqId);
    await expect(
      other.connect(seller).createListing(tokenId, 5n, ethers.parseUnits("1", 18))
    ).to.be.revertedWith("payment token not set");
  });

  it("rejects setting the payment token to the zero address", async () => {
    await expect(
      c.setPaymentToken(ethers.ZeroAddress)
    ).to.be.revertedWith("invalid token");
  });

  it("requires interest distributors to be KYC verified", async () => {
    const transferAmount = 10n;
    await c
      .connect(seller)
      .safeTransferFrom(seller.address, buyer.address, tokenId, transferAmount, "0x");
    await c.setKyc(admin.address, false);
    await stable.mint(admin.address, ethers.parseUnits("10", 18));
    await stable.connect(admin).approve(contractAddress, ethers.parseUnits("10", 18));
    await expect(
      c.connect(admin).distributeInterest(tokenId, ethers.parseUnits("10", 18))
    ).to.be.revertedWith("KYC required");
  });

  it("reverts interest distribution when the token ID is frozen", async () => {
    await stable.mint(admin.address, ethers.parseUnits("10", 18));
    await stable.connect(admin).approve(contractAddress, ethers.parseUnits("10", 18));
    await c.connect(manager).setFreezeId(tokenId, true);
    await expect(
      c.connect(admin).distributeInterest(tokenId, ethers.parseUnits("10", 18))
    ).to.be.revertedWith("id frozen");
  });

});
