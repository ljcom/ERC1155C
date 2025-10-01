require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const raw = process.env.DIRE1155C_ADDRESS;
  console.log("ENV DIRE1155C_ADDRESS (raw) =", JSON.stringify(raw));
  const addr = (raw || "").trim();

  if (!addr) throw new Error("❌ DIRE1155C_ADDRESS kosong. Deploy dulu atau isi di .env");
  if (!hre.ethers.isAddress(addr)) throw new Error(`❌ Alamat tidak valid: ${addr}`);

  const [deployer, , , alice, bob] = await hre.ethers.getSigners();
  console.log("Using address:", addr);

  // Cara 1 (prefer): getContractAt
  const c = await hre.ethers.getContractAt("Direction1155C", addr);

  // (Opsional) Cara 2: langsung dari artifact (kalau Cara 1 tetap error)
  // const artifact = await hre.artifacts.readArtifact("Direction1155C");
  // const c = new hre.ethers.Contract(addr, artifact.abi, deployer);

  // pastikan KYC penerima
  await (await c.setKyc(bob.address, true)).wait();

  const id = 1001, amt = 10;
  await (await c.connect(alice).safeTransferFrom(
    alice.address, bob.address, id, amt, "0x"
  )).wait();

  const bal = await c.balanceOf(bob.address, id);
  console.log("✅ Transfer ok. Bob balance =", bal.toString());
}

main().catch((e) => { console.error(e); process.exit(1); });