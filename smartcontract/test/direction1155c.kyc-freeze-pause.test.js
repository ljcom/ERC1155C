const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Direction1155C - KYC, Freeze & Pause", function () {
  let c, admin, notary, manager, owner, bob;

  beforeEach(async () => {
    [admin, notary, manager, owner, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Direction1155C");
    c = await F.deploy("ipfs://CID_BASE/{id}.json");
    await c.waitForDeployment();

    await c.grantRole(await c.NOTARY_ROLE(), notary.address);
    await c.grantRole(await c.MANAGER_ROLE(), manager.address);

    await c.setKyc(admin.address, true);
    await c.setKyc(owner.address, true);
    await c.setKyc(notary.address, true);
    await c.setKyc(manager.address, true);

    // mint 20 unit ke owner
    const id = 777;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };
    await c.requestMint(owner.address, id, 20, fees, "", ethers.ZeroHash, "");
    const reqId = (await c.mintRequestId()) - 1n;
    await c.connect(notary).approveByNotary(reqId);
    await c.connect(manager).approveByManager(reqId);
    await c.executeMint(reqId);
  });

  it("blocks transfer to non-KYC and allows after KYC", async () => {
    const id = 777;

    // non-KYC should fail
    await expect(
      c.connect(owner).safeTransferFrom(owner.address, bob.address, id, 1, "0x")
    ).to.be.revertedWith("KYC to");

    // set KYC, then ok
    await c.setKyc(bob.address, true);
    await c.connect(owner).safeTransferFrom(owner.address, bob.address, id, 5, "0x");
    expect(await c.balanceOf(bob.address, id)).to.equal(5);
  });

  it("freezes ID and prevents transfers", async () => {
    const id = 777;
    await c.setKyc(bob.address, true);
    await c.connect(manager).setFreezeId(id, true);

    await expect(
      c.connect(owner).safeTransferFrom(owner.address, bob.address, id, 1, "0x")
    ).to.be.revertedWith("id frozen");

    await c.connect(manager).setFreezeId(id, false);
    await c.connect(owner).safeTransferFrom(owner.address, bob.address, id, 1, "0x");
    expect(await c.balanceOf(bob.address, id)).to.equal(1);
  });

  it("pauses all transfers globally", async () => {
    const id = 777;
    await c.setKyc(bob.address, true);
    await c.connect(manager).pause();

    // OZ v5 Pausable pakai custom error; cukup cek revert tanpa reason
    await expect(
      c.connect(owner).safeTransferFrom(owner.address, bob.address, id, 1, "0x")
    ).to.be.reverted;

    await c.connect(manager).unpause();
    await c.connect(owner).safeTransferFrom(owner.address, bob.address, id, 1, "0x");
    expect(await c.balanceOf(bob.address, id)).to.equal(1);
  });

  it("supports batch transfer checks (KYC & freeze per ID)", async () => {
    const idA = 7001, idB = 7002;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };

    // mint idA & idB ke owner
    await c.requestMint(owner.address, idA, 5, fees, "", ethers.ZeroHash, "");
    await c.requestMint(owner.address, idB, 5, fees, "", ethers.ZeroHash, "");
    const r1 = (await c.mintRequestId()) - 2n;
    const r2 = (await c.mintRequestId()) - 1n;
    await c.connect(notary).approveByNotary(r1);
    await c.connect(manager).approveByManager(r1);
    await c.executeMint(r1);
    await c.connect(notary).approveByNotary(r2);
    await c.connect(manager).approveByManager(r2);
    await c.executeMint(r2);

    // bob non-KYC → batch revert
    await expect(
      c.connect(owner).safeBatchTransferFrom(owner.address, bob.address, [idA, idB], [1, 1], "0x")
    ).to.be.revertedWith("KYC to");

    // KYC bob & freeze idB → batch revert karena salah satu ID frozen
    await c.setKyc(bob.address, true);
    await c.connect(manager).setFreezeId(idB, true);
    await expect(
      c.connect(owner).safeBatchTransferFrom(owner.address, bob.address, [idA, idB], [1, 1], "0x")
    ).to.be.revertedWith("id frozen");

    // unfreeze idB → batch sukses
    await c.connect(manager).setFreezeId(idB, false);
    await c.connect(owner).safeBatchTransferFrom(owner.address, bob.address, [idA, idB], [1, 1], "0x");
    expect(await c.balanceOf(bob.address, idA)).to.equal(1);
    expect(await c.balanceOf(bob.address, idB)).to.equal(1);
  });
});