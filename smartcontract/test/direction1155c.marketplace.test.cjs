const { expect } = require("chai");
const { ethers } = require("hardhat");

const CONTRACT_FQN = "contracts/Direction1155C.sol:Direction1155C";

describe("Direction1155C - Marketplace & Interest", function () {
  let c, stable, admin, notary, manager, seller, buyer, extra, contractAddress;
  const tokenId = 1;
  const mintAmount = 100n;

  beforeEach(async () => {
    [admin, notary, manager, seller, buyer, extra] = await ethers.getSigners();

    const Contract = await ethers.getContractFactory(CONTRACT_FQN);
    c = await Contract.deploy("ipfs://BASE/{id}.json");
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

  it("allows KYC seller to list tokens and buyer to purchase with ERC20 payments", async () => {
    const price = ethers.parseUnits("5", 18);
    const amountForSale = 30n;
    const createTx = await c
      .connect(seller)
      .createListing(tokenId, amountForSale, price);
    const receipt = await createTx.wait();
    const listingEvent = receipt.logs
      .map((log) => {
        try {
          return c.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "ListingCreated");
    const listingId = listingEvent.args.listingId;

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
});
