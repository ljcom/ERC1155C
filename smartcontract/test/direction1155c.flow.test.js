const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Direction1155C - End to End Flow", function () {
  let c, admin, notary, manager, owner, outsider, receiver;

  beforeEach(async () => {
    [admin, notary, manager, owner, outsider, receiver] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Direction1155C");
    c = await F.deploy("ipfs://CID_BASE/{id}.json");
    await c.waitForDeployment();

    // roles
    await c.grantRole(await c.NOTARY_ROLE(), notary.address);
    await c.grantRole(await c.MANAGER_ROLE(), manager.address);

    // KYC pihak yang perlu
    await c.setKyc(admin.address, true);
    await c.setKyc(owner.address, true);
    await c.setKyc(notary.address, true);
    await c.setKyc(manager.address, true);
  });

  it("mints after 2-of-2 approvals, sets URI & doc, then enforces KYC on transfers", async () => {
    const id = 1001;
    const amount = 50;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };
    const setUriIfEmpty = "ipfs://CID_SERI_1001/{id}.json";
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("document v1"));
    const docCid  = "ipfs://CID_PDF_1001";

    // request by admin (pemohon) ke owner
    await c.requestMint(owner.address, id, amount, fees, setUriIfEmpty, docHash, docCid);

    const reqId = (await c.mintRequestId()) - 1n;

    // approvals 2-of-2
    await c.connect(notary).approveByNotary(reqId);
    await c.connect(manager).approveByManager(reqId);

    // mint
    await c.executeMint(reqId);

    // cek hasil mint
    expect(await c.balanceOf(owner.address, id)).to.equal(amount);
    expect(await c.uri(id)).to.equal(setUriIfEmpty);
    const [h, cid] = await c.getDocument(id);
    expect(h).to.equal(docHash);
    expect(cid).to.equal(docCid);

    // transfer ke non-KYC → revert
    await expect(
      c.connect(owner).safeTransferFrom(owner.address, outsider.address, id, 1, "0x")
    ).to.be.revertedWith("KYC to");

    // KYC receiver → transfer sukses
    await c.setKyc(receiver.address, true);
    await c.connect(owner).safeTransferFrom(owner.address, receiver.address, id, 10, "0x");
    expect(await c.balanceOf(receiver.address, id)).to.equal(10);
  });
});