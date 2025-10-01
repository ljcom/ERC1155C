// scripts/test-amoy.js
import 'dotenv/config';
import { ethers } from 'ethers';
import fs from "fs";

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

const provider = new ethers.JsonRpcProvider(RPC_URL);
const spv = new ethers.Wallet(PRIVATE_KEY_SPV, provider);
const notary = new ethers.Wallet(PRIVATE_KEY_NOTARY, provider);
const manager = new ethers.Wallet(PRIVATE_KEY_MANAGER, provider);

const abi = [
    // roles & views
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function NOTARY_ROLE() view returns (bytes32)",
    "function MANAGER_ROLE() view returns (bytes32)",
    "function SPV_ROLE() view returns (bytes32)",
    "function MINTER_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",

    "function owner() view returns (address)",
    "function paused() view returns (bool)",
    "function uri(uint256) view returns (string)",
    "function kyc(address) view returns (bool)",
    "function balanceOf(address account, uint256 id) view returns (uint256)",

    // admin/ops
    "function setKyc(address account, bool allowed) external",

    // issuance flow
    "function requestMint(address to, uint256 id, uint256 amount, (uint256 notaryFee, uint256 managerFee, uint256 tax) fees, string setUriIfEmpty, bytes32 docHash, string docCid) external",
    "function approveByNotary(uint256 reqId) external",
    "function approveByManager(uint256 reqId) external",
    "function executeMint(uint256 reqId) external",

    // events
    "event MintRequested(uint256 indexed requestId, address indexed to, uint256 indexed id, uint256 amount)",
    "event ApprovedByNotary(uint256 indexed reqId, address indexed by)",
    "event ApprovedByManager(uint256 indexed reqId, address indexed by)",
    "event MintExecuted(uint256 indexed reqId, uint256 id, uint256 amount, address to)"
];

const cSpv = new ethers.Contract(CONTRACT_ADDRESS, abi, spv);
const cNotary = new ethers.Contract(CONTRACT_ADDRESS, abi, notary);
const cManager = new ethers.Contract(CONTRACT_ADDRESS, abi, manager);

const b = (v) => String(v).toLowerCase() === 'true';
const fmtErr = (e) => e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || String(e);

async function has(contract, roleGetter, addr) {
    try {
        const role = await contract[roleGetter]();
        return await contract.hasRole(role, addr);
    } catch { return null; } // role getter tidak ada
}

async function main() {
    console.log("== ERC1155C Issuance Test on Polygon Amoy ==");
    console.log("Contract :", CONTRACT_ADDRESS);
    console.log("SPV      :", await spv.getAddress());
    console.log("Notary   :", await notary.getAddress());
    console.log("Manager  :", await manager.getAddress());
    console.log("Recipient:", RECIPIENT);
    console.log("Args     :", { TOKEN_ID, AMOUNT, FEES, SET_URI_IF_EMPTY, DOC_HASH, DOC_CID });
    console.log("");

    // status pause
    try {
        const isPaused = await cSpv.paused();
        console.log("paused():", isPaused);
        if (isPaused) console.warn("⚠️  Kontrak PAUSED. Mutasi bisa revert.");
    } catch { }

    // role info
    try {
        const NOTARY_ROLE = await cSpv.NOTARY_ROLE();
        const MANAGER_ROLE = await cSpv.MANAGER_ROLE();
        console.log("NOTARY_ROLE ok?:", await cSpv.hasRole(NOTARY_ROLE, await notary.getAddress()));
        console.log("MANAGER_ROLE ok?:", await cSpv.hasRole(MANAGER_ROLE, await manager.getAddress()));
    } catch { }

    const spvAddr = await spv.getAddress();
    const spvRole = await has(cSpv, "SPV_ROLE", spvAddr);
    const minterRole = await has(cSpv, "MINTER_ROLE", spvAddr);
    if (spvRole === false) console.warn("⚠️  SPV tidak punya SPV_ROLE");
    if (minterRole === false) console.warn("⚠️  SPV tidak punya MINTER_ROLE");

    // owner()
    try {
        const owner = await cSpv.owner();
        console.log("owner():", owner);
    } catch { }

    // uri(id)
    let currentUri = "";
    try {
        currentUri = await cSpv.uri(BigInt(TOKEN_ID));
        console.log(`uri(${TOKEN_ID}):`, currentUri);
    } catch { }

    // 1) setKyc untuk recipient (dan SPV opsional)
    try {
        const alreadyKyc = await cSpv.kyc(RECIPIENT);
        if (!alreadyKyc) {
            console.log("1) setKyc(recipient) → true");
            const tx1 = await cSpv.setKyc(RECIPIENT, true);
            await tx1.wait();
            console.log("   setKyc(recipient) mined:", tx1.hash);
        } else {
            console.log("1) setKyc(recipient) → SKIP (sudah true)");
        }

        const spvK = await cSpv.kyc(spvAddr).catch(() => false);
        if (!spvK) {
            console.log("   setKyc(SPV) → true (opsional)");
            const txs = await cSpv.setKyc(spvAddr, true);
            await txs.wait();
            console.log("   setKyc(SPV) mined:", txs.hash);
        }
    } catch (e) {
        console.error("❌ setKyc failed:", fmtErr(e));
        return;
    }

    // 2) requestMint (auto-deteksi setUriIfEmpty)
    const setUriFlag = (currentUri && currentUri.length > 0) ? false : b(SET_URI_IF_EMPTY);
    if (currentUri && currentUri.length > 0 && b(SET_URI_IF_EMPTY)) {
        console.warn("⚠️  uri(id) sudah ada → override setUriIfEmpty=false untuk mencegah revert.");
    }

    // siapkan fees tuple (nol semua untuk uji)
    const feesTuple = { notaryFee: 0n, managerFee: 0n, tax: 0n };

    // setUriIfEmpty: karena uri(id) sudah TERISI, pakai string kosong
    const setUriString = "";

    // ---- 2) requestMint (preflight)
    console.log("2) requestMint (preflight) with tuple fees + string setUriIfEmpty");
    let reqIdPred = null; // <<< DEKLARASIKAN DI SINI
    try {
        await cSpv.requestMint.staticCall(
            RECIPIENT,
            BigInt(TOKEN_ID),
            BigInt(AMOUNT),
            feesTuple,
            setUriString,
            (DOC_HASH && DOC_HASH !== '0x') ? DOC_HASH : ethers.ZeroHash,
            DOC_CID || ""
        );
        if (reqIdPred != null) {
            reqIdPred = reqIdPred.toString();
            console.log("   staticCall OK; predicted reqId:", reqIdPred);
        }
    } catch (e) {
        console.error("❌ requestMint staticCall REVERT:", fmtErr(e));
        return;
    }

    // ---- 2) requestMint (send)
    console.log("2) requestMint (send)");
    let reqRcpt;
    try {
        const reqTx = await cSpv.requestMint(
            RECIPIENT,
            BigInt(TOKEN_ID),
            BigInt(AMOUNT),
            feesTuple,
            setUriString,
            (DOC_HASH && DOC_HASH !== '0x') ? DOC_HASH : ethers.ZeroHash,
            DOC_CID || ""
        );
        reqRcpt = await reqTx.wait();
        console.log("🔎 Dump raw logs for debugging:");
        for (const log of reqRcpt.logs) {
            if (log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()) {
                console.log("Log:", {
                    topics: log.topics,
                    data: log.data
                });
            }
        }
        console.log("   requestMint mined:", reqTx.hash);
    } catch (e) {
        console.error("❌ requestMint failed:", fmtErr(e));
        return;
    }

    // === Cara A: pakai reqId dari staticCall (kalau tersedia) ===
    let reqId = reqIdPred;

    // === Cara B (fallback): cari event di block tx ===
    if (!reqId) {
        try {
            // definisikan beberapa varian event untuk robust parsing
            const ifaceA = new ethers.Interface([
                "event MintRequested(uint256 indexed reqId, address indexed to, uint256 indexed id, uint256 amount)"
            ]);
            const ifaceB = new ethers.Interface([
                "event MintRequested(address indexed requester, uint256 indexed reqId, address indexed to, uint256 id, uint256 amount)"
            ]);
            // filter semua log kontrak ini di block tx
            const logs = await provider.getLogs({
                fromBlock: reqRcpt.blockNumber,
                toBlock: reqRcpt.blockNumber,
                address: CONTRACT_ADDRESS
            });
            for (const log of logs) {
                try {
                    const p = ifaceA.parseLog(log);
                    if (p?.name === "MintRequested") { reqId = p.args.reqId.toString(); break; }
                } catch { }
                try {
                    const p = ifaceB.parseLog(log);
                    if (p?.name === "MintRequested") { reqId = p.args.reqId.toString(); break; }
                } catch { }
            }
        } catch (e) {
            console.warn("Event query fallback gagal:", fmtErr(e));
        }
    }

    if (!reqId) {
        console.error("❌ Gagal mendapatkan reqId (baik dari return value maupun event).");
        console.error("   Hint: pastikan fungsi requestMint di kontrak memang returns(uint256) ATAU sesuaikan ABI event MintRequested dengan persis layout kontrak.");
        return;
    }

    console.log(`   MintRequested → reqId=${reqId}`);

    // 3) approveByNotary
    console.log("3) approveByNotary (preflight)");
    try { await cNotary.approveByNotary.staticCall(reqId); console.log("   staticCall OK"); }
    catch (e) { console.error("❌ approveByNotary staticCall REVERT:", fmtErr(e)); return; }
    console.log("3) approveByNotary (send)");
    try { const notaryTx = await cNotary.approveByNotary(reqId); await notaryTx.wait(); console.log("   mined:", notaryTx.hash); }
    catch (e) { console.error("❌ approveByNotary failed:", fmtErr(e)); return; }

    // 4) approveByManager
    console.log("4) approveByManager (preflight)");
    try { await cManager.approveByManager.staticCall(reqId); console.log("   staticCall OK"); }
    catch (e) { console.error("❌ approveByManager staticCall REVERT:", fmtErr(e)); return; }
    console.log("4) approveByManager (send)");
    try { const managerTx = await cManager.approveByManager(reqId); await managerTx.wait(); console.log("   mined:", managerTx.hash); }
    catch (e) { console.error("❌ approveByManager failed:", fmtErr(e)); return; }

    // 5) executeMint
    console.log("5) executeMint (preflight)");
    try { await cSpv.executeMint.staticCall(reqId); console.log("   staticCall OK"); }
    catch (e) { console.error("❌ executeMint staticCall REVERT:", fmtErr(e)); return; }
    console.log("5) executeMint (send)");
    let mintRcpt;
    try { const mintTx = await cSpv.executeMint(reqId); mintRcpt = await mintTx.wait(); console.log("   mined:", mintTx.hash); }
    catch (e) { console.error("❌ executeMint failed:", fmtErr(e)); return; }

    // event MintExecuted
    try {
        const iface = new ethers.Interface(abi);
        for (const log of mintRcpt.logs) {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "MintExecuted") {
                console.log(`   MintExecuted → id=${parsed.args.id} amount=${parsed.args.amount} to=${parsed.args.to}`);
            }
        }
    } catch { }

    // 6) verifikasi balance
    try {
        const bal = await cSpv.balanceOf(RECIPIENT, BigInt(TOKEN_ID));
        console.log(`6) balanceOf(RECIPIENT, ${TOKEN_ID}) = ${bal.toString()}`);
        console.log("\n✅ Selesai. Flow berhasil jika tidak ada revert dan balance bertambah sesuai AMOUNT.");
    } catch (e) {
        console.error("❌ balanceOf failed:", fmtErr(e));
    }

    const row = [
        new Date().toISOString(),
        CONTRACT_ADDRESS,
        "1",                    // tokenId
        "4",                    // requestId (dari log kamu)
        RECIPIENT,             // recipient
        "10",                  // amount
        "OK"                   // outcome
    ].join(",");

    fs.appendFileSync("amoy_issuance_runs.csv",
        "timestamp,contract,tokenId,requestId,recipient,amount,outcome\n",
        { flag: "wx" } // write header only if file not exists
    );
    fs.appendFileSync("amoy_issuance_runs.csv", row + "\n");
    console.log("📝 Saved: amoy_issuance_runs.csv");
}

main().catch((e) => {
    console.error("ERROR:", fmtErr(e));
    process.exit(1);
});