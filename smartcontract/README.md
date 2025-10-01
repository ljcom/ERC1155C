# ERC1155C Issuance Flow Test (Polygon Amoy)

This repository contains scripts and notes for testing an **ERC1155C dual-approval issuance flow** (SPV → Notary → Manager → Mint) on the **Polygon Amoy testnet**.

---

## Overview

The contract enforces a 3-step approval flow before minting:

1. **SPV** submits a mint request (`requestMint`)
2. **Notary** approves the request (`approveByNotary`)
3. **Manager** approves the request (`approveByManager`)
4. **SPV** executes the mint (`executeMint`)

Additional constraints:
- Recipient must pass **KYC**
- Mint request must include **docHash** + **docCid (IPFS)**
- Contract may enforce `SPV_ROLE` or `MINTER_ROLE`

---

## Environment Setup

1. Copy `.env.example` → `.env` and fill in values:

```ini
RPC_URL=https://rpc-amoy.polygon.technology
CONTRACT_ADDRESS=0x7c80E676758cc6f1748ddF0c02dB0abE8Ec42631

PRIVATE_KEY_SPV=...
PRIVATE_KEY_NOTARY=...
PRIVATE_KEY_MANAGER=...

RECIPIENT=0x... #address
TOKEN_ID=1
AMOUNT=10
FEES=0

SET_URI_IF_EMPTY=true
DOC_HASH=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DOC_CID=ipfs://thisisfakeipfs

## Run
---
1. Install deps:
   npm install ethers dotenv

2. Jalankan:
   node scripts/test-amoy.js

## Sample Output
-------------
paused(): false
NOTARY_ROLE ok?: true
MANAGER_ROLE ok?: true
uri(1): ipfs://placeholder/{id}.json
1) setKyc(recipient) → SKIP (sudah true)
2) requestMint → MintRequested (reqId=4)
3) approveByNotary → mined: 0x5a22cf2a...
4) approveByManager → mined: 0x39100350...
5) executeMint → mined: 0x4350d91d...
6) balanceOf(RECIPIENT, 1) = 10

✅ Flow selesai tanpa revert, balance sesuai AMOUNT.

Tx Hashes
---------
requestMint      0x26f3e60b21fe14...
approveByNotary  0x5a22cf2acd9d3...
approveByManager 0x391003501aec2...
executeMint      0x4350d91d1571f...
