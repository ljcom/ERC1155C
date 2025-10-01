// scripts/freeze-pause-test.js
const { ethers } = require("hardhat");
async function main() {
  const [deployer, , , alice, bob] = await ethers.getSigners();
  const c = await ethers.getContractAt("Direction1155C", process.argv[2]);
  const id = 1001;
  await (await c.setKyc(bob.address, true)).wait();

  // Freeze ID
  await (await c.setFreezeId(id, true)).wait();
  await c.connect(alice).safeTransferFrom(alice.address, bob.address, id, 1, "0x")
    .then(()=>console.log("❌ harusnya gagal"))
    .catch(()=>console.log("✅ gagal sesuai harapan (id frozen)"));
  await (await c.setFreezeId(id, false)).wait();

  // Pause
  await (await c.pause()).wait();
  await c.connect(alice).safeTransferFrom(alice.address, bob.address, id, 1, "0x")
    .then(()=>console.log("❌ harusnya gagal"))
    .catch(()=>console.log("✅ gagal sesuai harapan (paused)"));
  await (await c.unpause()).wait();
}
main().catch(e=>{console.error(e);process.exit(1);});