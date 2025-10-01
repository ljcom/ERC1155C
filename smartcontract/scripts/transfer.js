// scripts/transfer.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer, notary, manager, alice, bob] = await ethers.getSigners();
  const addr = process.argv[2]; // alamat kontrak dari argumen
  const id = 1001;
  const amt = 10;

  const c = await ethers.getContractAt("Direction1155C", addr);

  // KYC bob dulu
  await (await c.setKyc(bob.address, true)).wait();

  // transfer dari Alice -> Bob
  await (await c.connect(alice).safeTransferFrom(alice.address, bob.address, id, amt, "0x")).wait();
  console.log("Transfer ok. Bob bal =", (await c.balanceOf(bob.address, id)).toString());
}

main().catch(e => { console.error(e); process.exit(1); });