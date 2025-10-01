// scripts/mint.js

const hre = require("hardhat");

async function main() {
  const [sender] = await hre.ethers.getSigners();

  // Ganti dengan address kontrak kamu (hasil deploy sebelumnya)
  const contractAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; //diretoken contract

  // Panggil kontraknya
  const DIREToken = await hre.ethers.getContractAt("DIREToken", contractAddress);

  // Token URI (biasanya link ke IPFS atau metadata JSON, bisa dummy dulu)
  const tokenURI = "https://example.com/metadata/1.json";

  // Mint NFT ke address kedua (akun #1 di Hardhat)
  const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // bisa diganti

  console.log("Minting NFT to:", recipient);
  const tx = await DIREToken.mint(recipient, tokenURI);
  await tx.wait();

  console.log("✅ Mint successful!");

  const total = await DIREToken.tokenCount();
  console.log("Total NFT:", total.toString());

  const uri = await DIREToken.tokenURI(1);
  console.log("Token #1 URI:", uri);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});