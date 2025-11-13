const fs = require("fs");
const path = require("path");

const dotenvPath = path.join(__dirname, "..", ".env");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Factory = await ethers.getContractFactory(
    "contracts/mocks/MockERC20.sol:MockERC20"
  );
  const token = await Factory.deploy();
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log("MockERC20 deployed at:", addr);

  let env = "";
  if (fs.existsSync(dotenvPath)) {
    env = fs.readFileSync(dotenvPath, "utf8");
  }
  const lines = env
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith("MOCK_USDT_ADDRESS="));
  lines.push(`MOCK_USDT_ADDRESS=${addr}`);
  fs.writeFileSync(dotenvPath, lines.join("\n") + "\n");
  console.log("✅ Updated .env MOCK_USDT_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
