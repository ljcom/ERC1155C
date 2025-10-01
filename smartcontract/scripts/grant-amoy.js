import 'dotenv/config';
import { ethers } from 'ethers';

const { RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY_SPV, NOTARY, MANAGER } = process.env;

const abi = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function NOTARY_ROLE() view returns (bytes32)",
  "function MANAGER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function paused() view returns (bool)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const admin = new ethers.Wallet(PRIVATE_KEY_SPV, provider);
  const c = new ethers.Contract(CONTRACT_ADDRESS, abi, admin);

  const [ADM, NTR, MGR] = await Promise.all([
    c.DEFAULT_ADMIN_ROLE(),
    c.NOTARY_ROLE(),
    c.MANAGER_ROLE(),
  ]);

  const who = await admin.getAddress();
  console.log("Admin signer:", who);

  const isAdmin = await c.hasRole(ADM, who);
  if (!isAdmin) {
    console.error("❌ Signer ini BUKAN DEFAULT_ADMIN_ROLE. Gunakan private key admin/deployer.");
    process.exit(1);
  }

  const setRole = async (role, addr, label) => {
    const has = await c.hasRole(role, addr);
    if (has) { console.log(`- ${label} sudah punya role`); return; }
    const tx = await c.grantRole(role, addr);
    await tx.wait();
    console.log(`✅ grantRole(${label}) mined:`, tx.hash);
  };

  await setRole(NTR, NOTARY, "NOTARY");
  await setRole(MGR, MANAGER, "MANAGER");

  const p = await c.paused().catch(() => false);
  console.log("paused():", p);
}

main().catch(e => { console.error("ERROR:", e); process.exit(1); });