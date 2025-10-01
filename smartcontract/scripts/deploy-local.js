const { ethers } = require("hardhat");

async function main() {
  const [deployer, notary, manager, alice] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Notary  :", notary.address);
  console.log("Manager :", manager.address);
  console.log("Alice   :", alice.address);

  // 1) Deploy
  const baseURI = "ipfs://CID_BASE/{id}.json";
  const Factory = await ethers.getContractFactory("Direction1155C");
  const c = await Factory.deploy(baseURI);
  await c.waitForDeployment();
  console.log("Direction1155C deployed at:", c.target);

  // 2) Grant roles
  const NOTARY_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("NOTARY_ROLE"));
  const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));

  await (await c.grantRole(NOTARY_ROLE, notary.address)).wait();
  await (await c.grantRole(MANAGER_ROLE, manager.address)).wait();
  console.log("Roles granted.");

  // 3) KYC: deployer (caller), alice (penerima), notary & manager (opsional)
  await (await c.setKyc(deployer.address, true)).wait();
  await (await c.setKyc(alice.address, true)).wait();
  await (await c.setKyc(notary.address, true)).wait();
  await (await c.setKyc(manager.address, true)).wait();
  console.log("KYC set.");

  // 4) Request mint (oleh deployer sebagai pemohon)
  const id = 1001;                   // ID seri/kelas aset
  const amount = 50;                 // 50 unit
  const fees = { notaryFee: 0, managerFee: 0, tax: 0 }; // contoh
  const setUriIfEmpty = "ipfs://CID_SERI_1001/{id}.json"; // set pertama kali
  const docHash = ethers.keccak256(ethers.toUtf8Bytes("document v1"));
  const docCid = "ipfs://CID_PDF_1001";

  await (await c.requestMint(
    alice.address, id, amount, fees, setUriIfEmpty, docHash, docCid
  )).wait();

  const reqId = await c.mintRequestId() - 1n;
  console.log("Mint requested. reqId =", reqId.toString());

  // 5) Approvals 2-of-2
  await (await c.connect(notary).approveByNotary(reqId)).wait();
  await (await c.connect(manager).approveByManager(reqId)).wait();
  console.log("Approved by Notary & Manager");

  // 6) Execute mint
  await (await c.executeMint(reqId)).wait();
  console.log("Mint executed.");

  // 7) Cek hasil
  const bal = await c.balanceOf(alice.address, id);
  const uri = await c.uri(id);
  const [h, cid] = await c.getDocument(id);

  console.log("Alice balance of id", id, "=", bal.toString());
  console.log("uri(id):", uri);
  console.log("docHash:", h);
  console.log("docCid :", cid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});