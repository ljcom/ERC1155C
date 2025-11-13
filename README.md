# Direction1155C (Polygon Amoy)

Modular ERC‑1155 contract with dual-approval minting, KYC enforcement, ERC20-settled marketplace, and interest distribution—built for Polygon Amoy testing and future mainnet deployment.

---

## Highlights
- **Dual approval minting** (Notary + Manager) with per-request documents (`docHash`, `docCid`, optional URI override) before tokens are issued.
- **KYC & compliance controls**: address + token-ID freezes, global pause, and role-gated setters.
- **ERC20 payment rails**: admin-selected payment token (mock USDT or real stablecoin) held in escrow during secondary sales.
- **Marketplace listing flow**: sellers escrow ERC1155 into the contract, buyers purchase via `buyListing`, funds auto-forward to the seller.
- **Holder enumeration & interest distribution**: `_holders[id]` stays in sync on every mint/transfer/burn so coupon payouts can be distributed pro‑rata using `distributeInterest`.
- **Hardhat + ESM**: project uses `"type": "module"`, so configs/scripts that rely on `require` must use `.cjs`.

---

## Repository Layout
```
smartcontract/
├── contracts/
│   ├── Direction1155CBase.sol            // shared storage + hooks
│   ├── Direction1155CKyc.sol             // admin/KYC controls
│   ├── Direction1155CDocuments.sol       // document + URI logic
│   ├── Direction1155CMinting.sol         // 2-of-2 mint workflow
│   ├── Direction1155CMarketplace.sol     // marketplace + interest
│   ├── Direction1155C.sol                // deployable wrapper
│   └── mocks/MockERC20.sol               // mock USDT for testing
├── scripts/
│   ├── deploy-amoy.cjs                   // deploy Direction1155C to Amoy
│   ├── deploy-mock-usdt.cjs              // deploy MockERC20
│   ├── grant-amoy.js / freeze.js ...     // helper flows (legacy CJS/JS mix)
│   └── ...                               // other operational scripts
└── test/
    ├── direction1155c.flow.test.cjs      // core mint flow
    ├── direction1155c.kyc-freeze-pause.cjs
    ├── direction1155c.marketplace.test.cjs
    └── direction1155c.roleslist.test.cjs
```

---

## Requirements
- **Node.js 18 or 20** recommended (Node 21 works but Hardhat prints a warning).
- `npm install` (run inside `smartcontract/`).
- `.env` file with RPC + deployer secrets. Example:

```ini
# Wallet used by Hardhat scripts (needs Amoy MATIC)
PRIVATE_KEY=0xabc...

# Polygon Amoy RPC (full URL, e.g. from Alchemy)
ALCHEMY_API_KEY_AMOY=https://polygon-amoy.g.alchemy.com/v2/xxxx

# Optional defaults
BASE_URI=ipfs://placeholder/{id}.json
DIRE1155C_ADDRESS=0x... # auto-filled after deployment
MOCK_USDT_ADDRESS=0x... # auto-filled after mock deploy
```

---

## Local Development & Tests
```bash
cd smartcontract
npm install
npx hardhat test
```
- Hardhat auto-compiles before running the 19 Mocha tests (mint flow, KYC/pause controls, marketplace, interest distribution, role checks, plus the default `Lock` sample).
- You’ll see a Node-21 warning if you haven’t switched to LTS—safe to ignore for local runs; switch to Node 20 to silence it.

### Latest Run (Hardhat)
```
  Lock
    Deployment
      ✔ Should set the right unlockTime (466ms)
      ✔ Should set the right owner
      ✔ Should receive and store the funds to lock
      ✔ Should fail if the unlockTime is not in the future
    Withdrawals
      Validations
        ✔ Should revert with the right error if called too soon
        ✔ Should revert with the right error if called from another account
        ✔ Shouldn't fail if the unlockTime has arrived and the owner calls it
      Events
        ✔ Should emit an event on withdrawals
      Transfers
        ✔ Should transfer the funds to the owner

  Direction1155C - End to End Flow
    ✔ mints after 2-of-2 approvals, sets URI & doc, then enforces KYC on transfers

  Direction1155C - KYC, Freeze & Pause
    ✔ blocks transfer to non-KYC and allows after KYC
    ✔ freezes ID and prevents transfers
    ✔ pauses all transfers globally
    ✔ supports batch transfer checks (KYC & freeze per ID)

  Direction1155C - Marketplace & Interest
    ✔ allows KYC seller to list tokens and buyer to purchase with ERC20 payments
    ✔ distributes interest proportionally to holders using holder enumeration

  Direction1155C - Role Listing
    ✔ addresses have their respective roles
    ✔ denies roles to outsiders
    ✔ lists NOTARY and MANAGER role members

  19 passing (783ms)
```

---

## Deployment to Polygon Amoy
1. **Deploy Direction1155C**
   ```bash
   cd smartcontract
   npx hardhat run scripts/deploy-amoy.cjs --network amoy
   ```
   - Uses the signer from `PRIVATE_KEY`.
   - Writes the freshly deployed address into `.env` as `DIRE1155C_ADDRESS`.

2. **Deploy Mock USDT (optional but recommended for marketplace testing)**
   ```bash
   npx hardhat run scripts/deploy-mock-usdt.cjs --network amoy
   ```
   - Appends `MOCK_USDT_ADDRESS` to `.env`.

3. **Post-deploy configuration**
   - Grant roles (`grant-amoy.js` or Hardhat console) to Notary/Manager addresses.
   - `setKyc(address, true)` for every participant (seller, buyer, distributor, escrow).
   - `setPaymentToken(MOCK_USDT_ADDRESS)` so marketplace + interest flows accept the mock stablecoin.

4. **Operational scripts**
   - `scripts/mint.js`, `scripts/freeze.js`, `scripts/manager-list.js`, etc., can be executed with `npx hardhat run --network amoy ...` (rename to `.cjs` if they still use `require`).

5. **Verifying on Polygonscan**
   ```bash
   npx hardhat verify --network amoy <DIRE1155C_ADDRESS> "ipfs://BASE/{id}.json"
   ```

---

## Manual Testing on Amoy
- **Hardhat console**: `npx hardhat console --network amoy` then interact with `await ethers.getContractAt("contracts/Direction1155C.sol:Direction1155C", process.env.DIRE1155C_ADDRESS)`.
- **Front-end / scripts**: point your DApp or scripts to the Amoy RPC and use the same ABI.
- **Common flow**:
  1. Admin KYC + role assignments.
  2. Seller mints via dual approval, then `createListing`.
  3. Buyer approves ERC20 allowance and calls `buyListing`.
  4. Treasury/issuer calls `distributeInterest` with total coupon amount.
  5. Use `getHolders(id)` to audit enumerated owners before payouts.

---

## Troubleshooting
- **Hardhat HH19 / HH600**: ensure config scripts using `require` have `.cjs` extension (already applied to `hardhat.config.cjs`, `deploy-*.cjs`).
- **HH701 (duplicate artifacts)**: reference fully qualified names (e.g., `"contracts/Direction1155C.sol:Direction1155C"`) when multiple files declare the same contract name.
- **Node version warning**: Hardhat only officially supports Node 18 & 20 today. Switch with `nvm install 20 && nvm use 20` if desired.
- **Missing Mock token**: run `deploy-mock-usdt.cjs` and update payment token via `setPaymentToken`.
- **KYC errors**: every transfer/mint/buy requires both parties to be KYC’d; ensure the contract address itself stays KYC’d (done by constructor).

---

## Security & Operational Notes
- Keep all private keys in `.env`; never commit them.
- Production deployments should replace `MockERC20` with a verified stablecoin and consider multi-sig control over admin roles.
- `_holders` tracking increases storage writes; consider gas implications on high-volume transfers.
- Interest distribution loops over all holders for a token ID; suitable for limited holder counts or periodic batching.

---

Happy building on Polygon Amoy! Reach out or open issues if you extend the contract or need extra automation scripts.***
