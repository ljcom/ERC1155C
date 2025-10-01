// scripts/listProperties.js
const hre = require("hardhat");

async function main() {
    const raw = process.env.DIRE1155C_ADDRESS;
    console.log("ENV DIRE1155C_ADDRESS (raw) =", JSON.stringify(raw));
    const addr = (raw || "").trim();

    const contract = await hre.ethers.getContractAt("Direction1155C", addr);

    // Ambil total jumlah request yang pernah dibuat
    const total = await contract.mintRequestId();
    console.log("Total mint requests:", total.toString());

    for (let i = 0; i < total; i++) {
        const req = await contract.mintRequests(i);
        if (req.executed) continue; // skip yang sudah dieksekusi

        console.log(`\n[ PENDING ] RequestId: ${i}`);
        console.log("  To:", req.to);
        console.log("  TokenId:", req.id.toString());
        console.log("  Amount:", req.amount.toString());
        console.log("  Approved By Notary:", req.approval.byNotary);
        console.log("  Approved By Manager:", req.approval.byManager);
        console.log("  URI:", req.uri);
        console.log("  DocHash:", req.docHash);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});