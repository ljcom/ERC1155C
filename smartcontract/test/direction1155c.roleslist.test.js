const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Direction1155C - Role Listing", function () {
  let c, admin, notary, manager, requestor;

  beforeEach(async () => {
    [admin, notary, manager, requestor] = await ethers.getSigners();
    const F = await ethers.getContractFactory("Direction1155C");
    c = await F.deploy("ipfs://CID_BASE/{id}.json");
    await c.waitForDeployment();

    await c.grantRole(await c.NOTARY_ROLE(), notary.address);
    await c.grantRole(await c.MANAGER_ROLE(), manager.address);

    await c.setKyc(requestor.address, true); // analog whitelisting v721
  });

  it("addresses have their respective roles", async () => {
    const ADMIN_ROLE = await c.DEFAULT_ADMIN_ROLE();
    const NOTARY_ROLE = await c.NOTARY_ROLE();
    const MANAGER_ROLE = await c.MANAGER_ROLE();

    expect(await c.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    expect(await c.hasRole(NOTARY_ROLE, notary.address)).to.be.true;
    expect(await c.hasRole(MANAGER_ROLE, manager.address)).to.be.true;
  });

  it("denies roles to outsiders", async () => {
    const outsider = (await ethers.getSigners())[5];
    const NOTARY_ROLE = await c.NOTARY_ROLE();
    const MANAGER_ROLE = await c.MANAGER_ROLE();

    expect(await c.hasRole(NOTARY_ROLE, outsider.address)).to.be.false;
    expect(await c.hasRole(MANAGER_ROLE, outsider.address)).to.be.false;
  });

  it("lists NOTARY and MANAGER role members", async () => {
    const NOTARY_ROLE = await c.NOTARY_ROLE();
    const MANAGER_ROLE = await c.MANAGER_ROLE();

    const notaryCount = await c.getRoleMemberCount(NOTARY_ROLE);
    const managerCount = await c.getRoleMemberCount(MANAGER_ROLE);

    // ambil semua member dan cek includes
    const notaries = [];
    for (let i = 0n; i < notaryCount; i++) {
      notaries.push(await c.getRoleMember(NOTARY_ROLE, i));
    }
    const managers = [];
    for (let i = 0n; i < managerCount; i++) {
      managers.push(await c.getRoleMember(MANAGER_ROLE, i));
    }

    expect(notaries).to.include(notary.address);
    expect(managers).to.include(manager.address);
  });
});