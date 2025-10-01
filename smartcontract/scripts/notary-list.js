const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const raw = process.env.DIRE1155C_ADDRESS;
  console.log("ENV DIRE1155C_ADDRESS (raw) =", JSON.stringify(raw));
  const addr = (raw || "").trim();
  const contract = await hre.ethers.getContractAt("Direction1155C", addr); // ganti alamat kontrak

  const roleHash = await contract.NOTARY_ROLE();
  const count = await contract.getRoleMemberCount(roleHash);

  console.log("Total NOTARY_ROLE members:", count.toString());

  for (let i = 0; i < count; i++) {
    const addr = await contract.getRoleMember(roleHash, i);
    console.log(`- ${addr}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});