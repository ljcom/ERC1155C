const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");
const { ethers } = require("ethers");
const dotenv = require("dotenv");
const { deployPaymentTokenAndAirdrop } = require("./direction1155c.add.mUSDT.cjs");

function log(level, message, extra) {
  const time = new Date().toISOString();
  const context = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  console[level === "warn" ? "warn" : "log"](`[${time}] ${level.toUpperCase()} ${message}${context}`);
}

const envCandidates = [
  process.env.DIRECTION1155C_TEST_ENV
    ? path.resolve(process.env.DIRECTION1155C_TEST_ENV)
    : null,
  path.join(__dirname, "..", "..", ".env"),
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, ".", ".env"),
].filter(Boolean);

const selectedEnv =
  envCandidates.find((candidate) => fs.existsSync(candidate))
  || envCandidates[0];

dotenv.config({ path: selectedEnv });
log("info", "Loaded environment file", { envPath: selectedEnv });

function resolveRelativePath(target) {
  if (!target) return null;
  return path.isAbsolute(target) ? target : path.join(__dirname, "..", target);
}

function parseDecimals(value, fallback) {
  const raw = (value || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 36) {
    throw new Error(`TEST_PAYMENT_TOKEN_DECIMALS must be between 0-36. Got "${value}"`);
  }
  return Math.trunc(parsed);
}

function parseTokenAmount(envKey, fallback) {
  const raw = (process.env[envKey] || "").trim();
  const value = raw || fallback;
  try {
    return ethers.parseUnits(value, PAYMENT_TOKEN_DECIMALS);
  } catch (err) {
    throw new Error(
      `Invalid ${envKey || "amount"} "${value}" for decimals ${PAYMENT_TOKEN_DECIMALS}: ${err.message}`
    );
  }
}

function getContractAddress(instance) {
  if (!instance) return null;
  return instance.target ?? instance.address ?? null;
}

function isReplacementError(err = {}) {
  const code = String(err.code || "");
  const message = (err?.info?.error?.message || err?.message || "").toLowerCase();
  return (
    code === "REPLACEMENT_UNDERPRICED"
    || message.includes("replacement transaction underpriced")
    || message.includes("replacement fee too low")
  );
}

async function buildFeeOverrides(attempt = 0) {
  if (!FEE_BUMP_PERCENT) return {};
  const feeData = await provider.getFeeData();
  const maxFee = feeData.maxFeePerGas;
  const maxPriority = feeData.maxPriorityFeePerGas || maxFee;
  if (!maxFee || !maxPriority) return {};
  const multiplierPercent = 100 + FEE_BUMP_PERCENT * (attempt + 1);
  const multiplier = BigInt(multiplierPercent);
  return {
    maxFeePerGas: (maxFee * multiplier) / 100n,
    maxPriorityFeePerGas: (maxPriority * multiplier) / 100n,
  };
}

async function sendTxWithRetry(label, action) {
  let attempt = 0;
  for (;;) {
    try {
      const overrides = await buildFeeOverrides(attempt);
      const tx = await action(overrides);
      return await tx.wait();
    } catch (err) {
      if (isReplacementError(err) && attempt < MAX_FEE_RETRIES) {
        attempt += 1;
        log("warn", "Retrying transaction with higher fee", { label, attempt, message: err.message });
        continue;
      }
      const errorName = err?.errorName || err?.info?.error?.data?.errorName || err?.data?.errorName;
      const shortMessage = err?.shortMessage || err?.info?.error?.message || err?.message;
      log("error", "Transaction failed", {
        label,
        attempt,
        code: err?.code,
        errorName,
        message: shortMessage,
      });
      throw err;
    }
  }
}

const PAYMENT_TOKEN_DECIMALS = parseDecimals(process.env.TEST_PAYMENT_TOKEN_DECIMALS, 18);

const SMARTCONTRACT_PATH =
  process.env.SMARTCONTRACT_PATH
  || "../../smartcontract/artifacts/contracts/Direction1155C.sol/Direction1155C.json";
const PAYMENT_TOKEN_ARTIFACT_PATH =
  process.env.PAYMENT_TOKEN_ARTIFACT_PATH
  || "../../smartcontract/artifacts/contracts/mocks/MockERC20.sol/MockERC20.json";

const artifact = require(resolveRelativePath(SMARTCONTRACT_PATH));
const paymentTokenArtifact = require(resolveRelativePath(PAYMENT_TOKEN_ARTIFACT_PATH));

const MOCK_TOKEN_AIRDROP = parseTokenAmount("TEST_MOCK_USDT_AIRDROP", "1000");
const LISTING_PRICE_PER_UNIT = parseTokenAmount("TEST_LISTING_PRICE", "0.01");
const INTEREST_DISTRIBUTION_TOTAL = parseTokenAmount("TEST_INTEREST_AMOUNT", "0.001");
const FEE_BUMP_PERCENT = Math.max(0, Number(process.env.TEST_FEE_BUMP_PERCENT || "20"));
const MAX_FEE_RETRIES = Math.max(0, Number(process.env.TEST_FEE_RETRIES || "3"));
const FORCE_MINT = String(process.env.FORCE_MINT || process.env.FORCE_EXECUTE_MINT || "false")
  .trim()
  .toLowerCase() === "true";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const ROLE_WALLET_FUNDING_ETH = (process.env.TEST_ROLE_MATIC_FUND || "0").trim();
const ALLOW_FAUCET = String(process.env.ALLOW_FAUCET ?? "true")
  .trim()
  .toLowerCase() !== "false";
const EXISTING_CONTRACT_ADDRESS =
  (process.env.TEST_EXISTING_CONTRACT_ADDRESS
    || process.env.DIRE1155C_ADDRESS
    || "").trim();
const EXISTING_PAYMENT_TOKEN_ADDRESS =
  (process.env.TEST_PAYMENT_TOKEN_ADDRESS
    || process.env.MOCK_USDT_ADDRESS
    || "").trim();

const TEST_PRIVATE_KEY = (process.env.TEST_SIGNER_PRIVATE_KEY || "").trim();
const TEST_WALLET_ADDRESS = (process.env.TEST_SIGNER_ADDRESS || "").trim();
if (!TEST_PRIVATE_KEY) {
  throw new Error("TEST_SIGNER_PRIVATE_KEY is required in backend/.env");
}
if (!ethers.isAddress(TEST_WALLET_ADDRESS)) {
  throw new Error("TEST_SIGNER_ADDRESS is missing or invalid in backend/.env");
}

function parseChainId(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  try {
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      return Number(BigInt(trimmed));
    }
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

const envChainId = parseChainId(process.env.CHAIN_ID);
const provider = envChainId
  ? new ethers.JsonRpcProvider(RPC_URL, {
    chainId: envChainId,
    name: process.env.CHAIN_NAME || "custom",
  })
  : new ethers.JsonRpcProvider(RPC_URL);

const adminWallet = new ethers.Wallet(TEST_PRIVATE_KEY, provider);
log("info", "Admin wallet configured", { address: adminWallet.address });
if (adminWallet.address.toLowerCase() !== TEST_WALLET_ADDRESS.toLowerCase()) {
  throw new Error(
    `TEST_SIGNER_ADDRESS (${TEST_WALLET_ADDRESS}) does not match derived address ${adminWallet.address}`
  );
}

function loadRoleWallet(roleKey) {
  const privateKeyVar = `TEST_${roleKey}_PRIVATE_KEY`;
  const addressVar = `TEST_${roleKey}_ADDRESS`;
  const privateKey = (process.env[privateKeyVar] || "").trim();
  const expectedAddress = (process.env[addressVar] || "").trim();

  if (!privateKey) {
    const randomWallet = ethers.Wallet.createRandom().connect(provider);
    log("warn", `Using ephemeral wallet for ${roleKey}`, { address: randomWallet.address });
    return randomWallet;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  if (expectedAddress) {
    if (!ethers.isAddress(expectedAddress)) {
      throw new Error(`${addressVar} is invalid: ${expectedAddress}`);
    }
    if (wallet.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(
        `${addressVar} (${expectedAddress}) does not match derived address ${wallet.address}`
      );
    }
  }
  return wallet;
}

async function fundFromAdmin(targetWallet, amountEth = "1.5") {
  log("info", "Funding wallet with MATIC", { to: targetWallet.address, amountEth });
  const tx = await adminWallet.sendTransaction({
    to: targetWallet.address,
    value: ethers.parseEther(amountEth),
  });
  await tx.wait();
}

async function ensureRole(contract, role, wallet, label) {
  const hasRole = await contract.hasRole(role, wallet.address);
  if (hasRole) {
    log("info", "Role already assigned", { role, account: wallet.address, label });
    return;
  }
  await sendTxWithRetry(`grantRole-${label}`, (overrides) =>
    contract.grantRole(role, wallet.address, overrides)
  );
  log("info", "Granted role", { role, account: wallet.address, label });
}

async function ensureKyc(contract, address, label) {
  const allowed = await contract.kyc(address);
  if (allowed) {
    log("info", "Address already KYC'd", { address, label });
    return;
  }
  await sendTxWithRetry(`setKyc-${label}`, (overrides) =>
    contract.setKyc(address, true, overrides)
  );
  log("info", "KYC granted", { address, label });
}

async function deployFixture() {
  const notary = loadRoleWallet("NOTARY");
  const manager = loadRoleWallet("MANAGER");
  const owner = loadRoleWallet("OWNER");
  const outsider = ethers.Wallet.createRandom().connect(provider);
  const receiver = loadRoleWallet("INVESTOR");

  if (ROLE_WALLET_FUNDING_ETH && ROLE_WALLET_FUNDING_ETH !== "0") {
    await Promise.all([
      fundFromAdmin(notary, ROLE_WALLET_FUNDING_ETH),
      fundFromAdmin(manager, ROLE_WALLET_FUNDING_ETH),
      fundFromAdmin(owner, ROLE_WALLET_FUNDING_ETH),
      fundFromAdmin(outsider, ROLE_WALLET_FUNDING_ETH),
      fundFromAdmin(receiver, ROLE_WALLET_FUNDING_ETH),
    ]);
  } else {
    log("warn", "Skipping automatic MATIC funding for role wallets", {
      envVar: "TEST_ROLE_MATIC_FUND",
      value: ROLE_WALLET_FUNDING_ETH || "0",
    });
  }

  let contract;
  let contractAddress;
  if (EXISTING_CONTRACT_ADDRESS) {
    if (!ethers.isAddress(EXISTING_CONTRACT_ADDRESS)) {
      throw new Error(`TEST_EXISTING_CONTRACT_ADDRESS/DIRE1155C_ADDRESS is invalid: ${EXISTING_CONTRACT_ADDRESS}`);
    }
    contract = new ethers.Contract(EXISTING_CONTRACT_ADDRESS, artifact.abi, adminWallet);
    contractAddress = getContractAddress(contract);
    log("info", "Reusing existing Direction1155C deployment", { address: contractAddress });
  } else {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, adminWallet);
    contract = await factory.deploy("ipfs://CID_BASE/{id}.json");
    await contract.waitForDeployment();
    contractAddress = getContractAddress(contract);
    log("info", "Deployed Direction1155C contract", { address: contractAddress });
  }

  const mockRecipients = [adminWallet, notary, manager, owner, outsider, receiver];
  const skipMintFlow = !FORCE_MINT
    && (await contract.mintRequestId()) > 0n
    && (await contract.balanceOf(owner.address, 1001)) > 0n;
  if (skipMintFlow) {
    log("warn", "Mint flow will be skipped (existing tokens detected). Set FORCE_MINT=true to re-run mint tests.");
  }
  let paymentToken;
  if (EXISTING_PAYMENT_TOKEN_ADDRESS) {
    if (!ethers.isAddress(EXISTING_PAYMENT_TOKEN_ADDRESS)) {
      throw new Error(
        `TEST_PAYMENT_TOKEN_ADDRESS/MOCK_USDT_ADDRESS is invalid: ${EXISTING_PAYMENT_TOKEN_ADDRESS}`
      );
    }
    paymentToken = new ethers.Contract(
      EXISTING_PAYMENT_TOKEN_ADDRESS,
      paymentTokenArtifact.abi,
      adminWallet
    );
    log("info", "Reusing existing payment token", {
      address: getContractAddress(paymentToken),
      faucet: ALLOW_FAUCET,
    });
    if (ALLOW_FAUCET && MOCK_TOKEN_AIRDROP > 0n) {
      await Promise.all(
        mockRecipients.map((wallet) =>
          sendTxWithRetry(`paymentToken-mint-${wallet.address}`, (overrides) =>
            paymentToken.mint(wallet.address, MOCK_TOKEN_AIRDROP, overrides)
          )
        )
      );
      log("info", "Completed mock airdrop on existing payment token", {
        recipients: mockRecipients.length,
        airdrop: MOCK_TOKEN_AIRDROP.toString(),
      });
    } else if (!ALLOW_FAUCET) {
      log("warn", "Skipping payment token airdrop because ALLOW_FAUCET=false");
    }
  } else {
    if (!ALLOW_FAUCET) {
      throw new Error(
        "ALLOW_FAUCET=false but TEST_PAYMENT_TOKEN_ADDRESS / MOCK_USDT_ADDRESS is not set. Provide an existing payment token address."
      );
    }
    const result = await deployPaymentTokenAndAirdrop({
      artifactPath: resolveRelativePath(PAYMENT_TOKEN_ARTIFACT_PATH),
      adminWallet,
      recipients: mockRecipients,
      airdropAmount: MOCK_TOKEN_AIRDROP,
      sendTxWithRetry,
    });
    paymentToken = result.paymentToken;
    log("info", "Deployed payment token and completed mock airdrop", {
      paymentToken: getContractAddress(paymentToken),
      recipients: mockRecipients.length,
      airdrop: MOCK_TOKEN_AIRDROP.toString(),
    });
  }

  const currentPaymentToken = await contract.paymentToken();
  const desiredPaymentToken = getContractAddress(paymentToken);
  if (!desiredPaymentToken) {
    throw new Error("Unable to resolve payment token address");
  }
  if (currentPaymentToken.toLowerCase() !== desiredPaymentToken.toLowerCase()) {
    await sendTxWithRetry("setPaymentToken", (overrides) =>
      contract.setPaymentToken(desiredPaymentToken, overrides)
    );
    log("info", "Payment token configured on contract", { paymentToken: desiredPaymentToken });
  } else {
    log("info", "Payment token already configured", { paymentToken: desiredPaymentToken });
  }

  const NOTARY_ROLE = await contract.NOTARY_ROLE();
  const MANAGER_ROLE = await contract.MANAGER_ROLE();

  await Promise.all([
    ensureRole(contract, NOTARY_ROLE, notary, "notary"),
    ensureRole(contract, MANAGER_ROLE, manager, "manager"),
  ]);

  const kycTargets = [
    { address: adminWallet.address, label: "admin" },
    { address: owner.address, label: "owner" },
    { address: notary.address, label: "notary" },
    { address: manager.address, label: "manager" },
    { address: receiver.address, label: "investor" },
  ];

  await Promise.all(kycTargets.map(({ address, label }) => ensureKyc(contract, address, label)));

  return {
    contract,
    admin: adminWallet,
    notary,
    manager,
    owner,
    outsider,
    receiver,
    paymentToken,
    paymentTokenAddress: desiredPaymentToken,
    contractAddress,
    NOTARY_ROLE,
    MANAGER_ROLE,
    skipMintFlow,
  };
}

async function expectRevert(action, expected) {
  try {
    await action();
    assert.fail(`Expected revert containing "${expected}"`);
  } catch (err) {
    const errorName = err?.errorName || err?.info?.error?.data?.errorName || err?.data?.errorName || "";
    const msg = err?.reason
      || err?.shortMessage
      || err?.info?.error?.message
      || err?.message
      || errorName
      || "";
    const haystack = [msg, errorName].map((item) => String(item || "").toLowerCase());
    const expectedLower = String(expected).toLowerCase();
    const matched = haystack.some((text) => text.includes(expectedLower));
    assert.ok(
      matched,
      `Expected error to include "${expected}" but got "${msg || errorName || "<empty>"}"`
    );
  }
}

describe("Direction1155C (backend/tests)", { concurrency: false }, () => {
  let ctx;

  beforeEach(async () => {
    log("info", "Starting fresh fixture deployment");
    ctx = await deployFixture();
    log("info", "Fixture ready", {
      contract: ctx.contractAddress,
      paymentToken: ctx.paymentTokenAddress,
    });
  });

  it("mints after dual approvals and enforces off-chain KYC rules", async () => {
    const { contract, admin, notary, manager, owner, outsider, receiver, NOTARY_ROLE, MANAGER_ROLE, skipMintFlow } = ctx;
    const id = 1001;
    const amount = 50;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };
    const setUriIfEmpty = "ipfs://CID_SERI_1001/{id}.json";
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("document v1"));
    const docCid = "ipfs://CID_PDF_1001";

    assert.equal(await contract.kyc(owner.address), true, "owner must be KYC'd before mint");
    assert.equal(await contract.kyc(receiver.address), true, "investor must be KYC'd before mint");
    assert.equal(
      await contract.hasRole(NOTARY_ROLE, notary.address),
      true,
      "notary must hold NOTARY_ROLE"
    );
    assert.equal(
      await contract.hasRole(MANAGER_ROLE, manager.address),
      true,
      "manager must hold MANAGER_ROLE"
    );

    if (!skipMintFlow) {
      log("info", "requestMint initiated", {
        owner: owner.address,
        tokenId: id,
        amount,
      });

      await sendTxWithRetry("requestMint", (overrides) =>
        contract.requestMint(owner.address, id, amount, fees, setUriIfEmpty, docHash, docCid, overrides)
      );
      const reqId = (await contract.mintRequestId()) - 1n;

      await sendTxWithRetry("approveByNotary", (overrides) =>
        contract.connect(notary).approveByNotary(reqId, overrides)
      );
      await sendTxWithRetry("approveByManager", (overrides) =>
        contract.connect(manager).approveByManager(reqId, overrides)
      );
      await sendTxWithRetry("executeMint", (overrides) => contract.executeMint(reqId, overrides));

      assert.equal(await contract.balanceOf(owner.address, id), BigInt(amount));
      assert.equal(await contract.uri(id), setUriIfEmpty);
      const [storedHash, storedCid] = await contract.getDocument(id);
      assert.equal(storedHash, docHash);
      assert.equal(storedCid, docCid);
      log("info", "Mint flow completed", { requestId: reqId.toString(), tokenId: id, amount });
    } else {
      log("warn", "Skipping requestMint/approve/executeMint (existing supply detected)");
      const ownerBalanceExisting = await contract.balanceOf(owner.address, id);
      assert.ok(
        ownerBalanceExisting >= 10n,
        "Owner does not hold enough minted tokens; set FORCE_MINT=true to rerun mint."
      );
    }

    await expectRevert(
      () => contract.connect(owner).safeTransferFrom(owner.address, outsider.address, id, 1, "0x"),
      "KYC to"
    );

    const receiverBalanceBefore = await contract.balanceOf(receiver.address, id);
    await sendTxWithRetry("setKyc-investor", (overrides) =>
      contract.setKyc(receiver.address, true, overrides)
    );
    await sendTxWithRetry("safeTransfer-owner", (overrides) =>
      contract
        .connect(owner)
        .safeTransferFrom(owner.address, receiver.address, id, 10, "0x", overrides)
    );
    const receiverBalanceAfter = await contract.balanceOf(receiver.address, id);
    assert.equal(
      receiverBalanceAfter - receiverBalanceBefore,
      10n,
      "Receiver should gain exactly 10 tokens"
    );
  });

  it("reverts executeMint when approvals are missing", async () => {
    const { contract, notary, manager, owner } = ctx;
    const id = 2001;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };
    const reqIdBefore = (await contract.mintRequestId());
    await sendTxWithRetry("requestMint-missing", (overrides) =>
      contract.requestMint(owner.address, id, 5, fees, "", ethers.ZeroHash, "", overrides)
    );
    const reqId = (await contract.mintRequestId()) - 1n;

    await expectRevert(() => contract.executeMint(reqId), "need 2-of-2");

    await sendTxWithRetry("approveByNotary", (overrides) =>
      contract.connect(notary).approveByNotary(reqId, overrides)
    );
    await expectRevert(() => contract.executeMint(reqId), "need 2-of-2");

    await sendTxWithRetry("approveByManager", (overrides) =>
      contract.connect(manager).approveByManager(reqId, overrides)
    );
    await sendTxWithRetry("executeMint", (overrides) => contract.executeMint(reqId, overrides));
  });

  it("restricts document and URI setters to their roles", async () => {
    const { contract, admin, NOTARY_ROLE, MANAGER_ROLE } = ctx;

    await expectRevert(
      () => contract.setDocument(4001, ethers.keccak256(ethers.toUtf8Bytes("fake")), "ipfs://doc"),
      "AccessControl"
    );

    await expectRevert(
      () => contract.setURI(4001, "ipfs://custom/{id}.json"),
      "AccessControl"
    );

    await sendTxWithRetry("grantRole-admin-notary", (overrides) =>
      contract.grantRole(NOTARY_ROLE, admin.address, overrides)
    );
    await sendTxWithRetry("setDocument-admin", (overrides) =>
      contract.setDocument(4001, ethers.keccak256(ethers.toUtf8Bytes("real")), "ipfs://real", overrides)
    );

    await sendTxWithRetry("grantRole-admin-manager", (overrides) =>
      contract.grantRole(MANAGER_ROLE, admin.address, overrides)
    );
    await sendTxWithRetry("setURI-admin", (overrides) =>
      contract.setURI(4001, "ipfs://custom/{id}.json", overrides)
    );
  });

  const faucetIt = ALLOW_FAUCET ? it : it.skip;

  faucetIt("airdrops the configured mock USDT amount to every participant", async () => {
    const { paymentToken, admin, notary, manager, owner, outsider, receiver } = ctx;
    const participants = [
      ["admin", admin],
      ["notary", notary],
      ["manager", manager],
      ["owner", owner],
      ["outsider", outsider],
      ["investor", receiver],
    ];

    for (const [label, wallet] of participants) {
      const balance = await paymentToken.balanceOf(wallet.address);
      assert.equal(
        balance,
        MOCK_TOKEN_AIRDROP,
        `${label} did not receive the expected MOCK_TOKEN_AIRDROP`
      );
    }
  });

  it("lists tokens at the configured price and distributes interest proportionally", async () => {
    const { contract, admin, notary, manager, owner, receiver, paymentToken, contractAddress } = ctx;
    const propertyId = 6001;
    const totalMintAmount = 10;
    const amountForSale = 4;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };

    const ownerBalancePreListing = await contract.balanceOf(owner.address, propertyId);
    const needFreshMint = FORCE_MINT || ownerBalancePreListing < BigInt(amountForSale);
    if (needFreshMint) {
      await sendTxWithRetry("requestMint-market", (overrides) =>
        contract.requestMint(owner.address, propertyId, totalMintAmount, fees, "", ethers.ZeroHash, "", overrides)
      );
      const reqId = (await contract.mintRequestId()) - 1n;
      await sendTxWithRetry("approveByNotary", (overrides) =>
        contract.connect(notary).approveByNotary(reqId, overrides)
      );
      await sendTxWithRetry("approveByManager", (overrides) =>
        contract.connect(manager).approveByManager(reqId, overrides)
      );
      await sendTxWithRetry("executeMint", (overrides) => contract.executeMint(reqId, overrides));
      log("info", "Property minted for marketplace test", { tokenId: propertyId, amount: totalMintAmount });
    } else {
      log("warn", "Skipping marketplace mint (owner already holds sufficient tokens)", {
        ownerBalance: ownerBalancePreListing.toString(),
      });
    }

    const ownerBalanceForListing = await contract.balanceOf(owner.address, propertyId);
    assert.ok(
      ownerBalanceForListing >= BigInt(amountForSale),
      "Owner balance too low for listing; set FORCE_MINT=true"
    );

    await sendTxWithRetry("setKyc-investor", (overrides) =>
      contract.setKyc(receiver.address, true, overrides)
    );

    const receipt = await sendTxWithRetry("createListing", (overrides) =>
      contract.connect(owner).createListing(propertyId, BigInt(amountForSale), LISTING_PRICE_PER_UNIT, overrides)
    );
    const listingEvent = receipt.logs
      .map((log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "ListingCreated");
    const listingId = listingEvent?.args?.listingId;
    if (listingId === undefined) {
      throw new Error("Failed to parse ListingCreated event for listingId");
    }
    log("info", "Listing created", {
      listingId: listingId.toString(),
      tokenId: propertyId,
      amount: amountForSale,
      pricePerUnit: LISTING_PRICE_PER_UNIT.toString(),
    });

    const totalPrice = LISTING_PRICE_PER_UNIT * BigInt(amountForSale);

    const ownerStableBeforeSale = await paymentToken.balanceOf(owner.address);
    const receiverStableBeforeSale = await paymentToken.balanceOf(receiver.address);

    await sendTxWithRetry("erc20-approve-buyer", (overrides) =>
      paymentToken.connect(receiver).approve(contractAddress, totalPrice, overrides)
    );
    await sendTxWithRetry("buyListing", (overrides) =>
      contract.connect(receiver).buyListing(listingId, BigInt(amountForSale), overrides)
    );
    log("info", "Listing purchased", { listingId: listingId.toString(), buyer: receiver.address });

    const ownerStableAfterSale = await paymentToken.balanceOf(owner.address);
    const receiverStableAfterSale = await paymentToken.balanceOf(receiver.address);

    assert.equal(ownerStableAfterSale - ownerStableBeforeSale, totalPrice);
    assert.equal(receiverStableBeforeSale - receiverStableAfterSale, totalPrice);

    const ownerBalance = await contract.balanceOf(owner.address, propertyId);
    const receiverBalance = await contract.balanceOf(receiver.address, propertyId);
    assert.equal(ownerBalance, BigInt(totalMintAmount - amountForSale));
    assert.equal(receiverBalance, BigInt(amountForSale));

    const ownerStableBeforeInterest = ownerStableAfterSale;
    const receiverStableBeforeInterest = receiverStableAfterSale;

    const supply = await contract.totalSupply(propertyId);
    await sendTxWithRetry("erc20-approve-interest", (overrides) =>
      paymentToken.connect(admin).approve(contractAddress, INTEREST_DISTRIBUTION_TOTAL, overrides)
    );
    await sendTxWithRetry("distributeInterest", (overrides) =>
      contract.connect(admin).distributeInterest(propertyId, INTEREST_DISTRIBUTION_TOTAL, overrides)
    );
    log("info", "Interest distributed", {
      tokenId: propertyId,
      total: INTEREST_DISTRIBUTION_TOTAL.toString(),
    });

    const expectedOwnerShare = (INTEREST_DISTRIBUTION_TOTAL * ownerBalance) / supply;
    const expectedReceiverShare = (INTEREST_DISTRIBUTION_TOTAL * receiverBalance) / supply;

    const ownerStableAfterInterest = await paymentToken.balanceOf(owner.address);
    const receiverStableAfterInterest = await paymentToken.balanceOf(receiver.address);

    assert.equal(ownerStableAfterInterest - ownerStableBeforeInterest, expectedOwnerShare);
    assert.equal(receiverStableAfterInterest - receiverStableBeforeInterest, expectedReceiverShare);
  });
});
