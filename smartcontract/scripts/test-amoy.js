import 'dotenv/config';
import { ethers } from 'ethers';

// --- ENV ---
const {
  RPC_URL,
  CONTRACT_ADDRESS,
  PRIVATE_KEY_SPV,
  PRIVATE_KEY_NOTARY,
  PRIVATE_KEY_MANAGER,
  RECIPIENT,
  TOKEN_ID,
  AMOUNT,
  FEES,
  SET_URI_IF_EMPTY,
  DOC_HASH,
  DOC_CID
} = process.env;

// --- Provider & Signers ---
const provider = new ethers.JsonRpcProvider(RPC_URL);
const spv     = new ethers.Wallet(PRIVATE_KEY_SPV, provider);
const notary  = new ethers.Wallet(PRIVATE_KEY_NOTARY, provider);
const manager = new ethers.Wallet(PRIVATE_KEY_MANAGER, provider);

// --- ABI minimal: fungsi & event yang kita pakai ---
const abi = [
  // roles & views
  "function NOTARY_ROLE() view returns (bytes32)",
  "function MANAGER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function kyc(address) view returns (bool)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",

  // admin/ops
  "function setKyc(address account, bool allowed) external",

  // issuance flow
  "function requestMint(address to, uint256 id, uint256 amount, uint256 fees, bool setUriIfEmpty, bytes32 docHash, string calldata docCid) external",
  "function approveByNotary(uint256 reqId) external",
  "function approveByManager(uint256 reqId) external",
  "function executeMint(uint256 reqId) external",

  // events
  "event MintRequested(uint256 indexed reqId, address indexed to, uint256 id, uint256 amount)",
  "event ApprovedByNotary(uint256 indexed reqId, address indexed by)",
  "event ApprovedByManager(uint256 indexed reqId, address indexed by)",
  "event MintExecuted(uint256 indexed reqId, uint256 id, uint256 amount, address to)"
];

const cSpv     = new ethers.Contract(CONTRACT_ADDRESS, abi, spv);
const cNotary  = new ethers.Contract(CONTRACT_ADDRESS, abi, notary);
const cManager = new ethers.Contract(CONTRACT_ADDRESS, abi, manager);

async function main() {
  console.log("== ERC1155C Issuance Test on Polygon Amoy ==");
  console.log("Contract :", CONTRACT_ADDRESS);
  console.log("SPV      :", await spv.getAddress());
  console.log("Notary   :", await notary.getAddress());
  console.log("Manager  :", await manager.getAddress());
  console.log("Recipient:", RECIPIENT);
  console.log("TokenId  :", TOKEN_ID, "Amount:", AMOUNT);
  console.log("");

  // --- Cek role (opsional tapi sangat membantu) ---
  const NOTARY_ROLE  = await cSpv.NOTARY_ROLE().catch(() => null);
  const MANAGER_ROLE = await cSpv.MANAGER_ROLE().catch(() => null);

  if (NOTARY_ROLE && MANAGER_ROLE) {
    const notaryHas  = await cSpv.hasRole(NOTARY_ROLE, await notary.getAddress());
    const managerHas = await cSpv.hasRole(MANAGER_ROLE, await manager.getAddress());
    if (!notaryHas)  console.warn("WARNING: Notary signer TIDAK punya NOTARY_ROLE");
    if (!managerHas) console.warn("WARNING: Manager signer TIDAK punya MANAGER_ROLE");
  } else {
    console.warn("Catatan: Kontrak mungkin tidak expose NOTARY_ROLE/MANAGER_ROLE public constant.");
  }

  // --- 1) setKyc(RECIPIENT, true) ---
  const alreadyKyc = await cSpv.kyc(RECIPIENT).catch(() => false);
  if (!alreadyKyc) {
    console.log("1) setKyc → true");
    const tx1 = await cSpv.setKyc(RECIPIENT, true);
    await tx1.wait();
    console.log("   setKyc mined:", tx1.hash);
  } else {
    console.log("1) setKyc → SKIP (sudah true)");
  }

  // --- 2) requestMint ---
  console.log("2) requestMint");
  const reqTx = await cSpv.requestMint(
    RECIPIENT,
    BigInt(TOKEN_ID),
    BigInt(AMOUNT),
    BigInt(FEES || 0),
    String(SET_URI_IF_EMPTY).toLowerCase() === 'true',
    DOC_HASH || ethers.ZeroHash,
    DOC_CID || ""
  );
  const reqRcpt = await reqTx.wait();
  console.log("   requestMint mined:", reqTx.hash);

  // Ambil reqId dari event MintRequested
  const iface = new ethers.Interface(abi);
  let reqId = null;
  for (const log of reqRcpt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "MintRequested") {
        reqId = parsed.args.reqId.toString();
        console.log(`   MintRequested → reqId=${reqId}, to=${parsed.args.to}, id=${parsed.args.id}, amount=${parsed.args.amount}`);
        break;
      }
    } catch { /* skip */ }
  }
  if (!reqId) throw new Error("Gagal mendapatkan reqId dari event MintRequested");

  // --- 3) approveByNotary(reqId) ---
  console.log("3) approveByNotary");
  const notaryTx = await cNotary.approveByNotary(reqId);
  await notaryTx.wait();
  console.log("   approveByNotary mined:", notaryTx.hash);

  // --- 4) approveByManager(reqId) ---
  console.log("4) approveByManager");
  const managerTx = await cManager.approveByManager(reqId);
  await managerTx.wait();
  console.log("   approveByManager mined:", managerTx.hash);

  // --- 5) executeMint(reqId) ---
  console.log("5) executeMint");
  const mintTx = await cSpv.executeMint(reqId);
  const mintRcpt = await mintTx.wait();
  console.log("   executeMint mined:", mintTx.hash);

  // Parse event MintExecuted (opsional)
  for (const log of mintRcpt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "MintExecuted") {
        console.log(`   MintExecuted → id=${parsed.args.id} amount=${parsed.args.amount} to=${parsed.args.to}`);
      }
    } catch { /* skip */ }
  }

  // --- 6) verifikasi balance ---
  const bal = await cSpv.balanceOf(RECIPIENT, BigInt(TOKEN_ID));
  console.log(`6) balanceOf(RECIPIENT, ${TOKEN_ID}) = ${bal.toString()}`);

  console.log("\n✅ Selesai. Flow berhasil jika tidak ada revert dan balance bertambah sesuai AMOUNT.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});