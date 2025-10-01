const fs = require("fs");
const path = require("path");
const dotenvPath = path.join(__dirname, "..", ".env");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const F = await ethers.getContractFactory("Direction1155C");

  // base URI untuk metadata (bisa dari .env)
  const baseURI = process.env.BASE_URI || "ipfs://placeholder/{id}.json";

  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
  const c = await F.deploy(baseURI);   // <-- KIRIM ARGUMEN CONSTRUCTOR DI SINI
  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log("Direction1155C deployed at:", addr);

  // tulis ke .env
  let env = "";
  if (fs.existsSync(dotenvPath)) env = fs.readFileSync(dotenvPath, "utf8");
  const lines = env.split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith("DIRE1155C_ADDRESS="));
  lines.push(`DIRE1155C_ADDRESS=${addr}`);
  fs.writeFileSync(dotenvPath, lines.join("\n") + "\n");
  console.log("✅ Updated .env DIRE1155C_ADDRESS");
}

main().catch((e) => { console.error(e); process.exit(1); });