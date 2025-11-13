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
  const tx = await contract.grantRole(role, wallet.address);
  await tx.wait();
  log("info", "Granted role", { role, account: wallet.address, label });
}

async function ensureKyc(contract, address, label) {
  const allowed = await contract.kyc(address);
  if (allowed) {
    log("info", "Address already KYC'd", { address, label });
    return;
  }
  const tx = await contract.setKyc(address, true);
  await tx.wait();
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
          paymentToken.mint(wallet.address, MOCK_TOKEN_AIRDROP).then((tx) => tx.wait())
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
    await contract.setPaymentToken(desiredPaymentToken).then((tx) => tx.wait());
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
  };
}

async function expectRevert(action, expected) {
  try {
    await action();
    assert.fail(`Expected revert containing "${expected}"`);
  } catch (err) {
    const msg = err?.reason
      || err?.shortMessage
      || err?.info?.error?.message
      || err?.message
      || "";
    assert.ok(
      msg.toLowerCase().includes(String(expected).toLowerCase()),
      `Expected error to include "${expected}" but got "${msg}"`
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
    const { contract, admin, notary, manager, owner, outsider, receiver, NOTARY_ROLE, MANAGER_ROLE } = ctx;
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

    log("info", "requestMint initiated", {
      owner: owner.address,
      tokenId: id,
      amount,
    });

    await contract.requestMint(owner.address, id, amount, fees, setUriIfEmpty, docHash, docCid);
    const reqId = (await contract.mintRequestId()) - 1n;

    await contract.connect(notary).approveByNotary(reqId);
    await contract.connect(manager).approveByManager(reqId);
    await contract.executeMint(reqId);

    assert.equal(await contract.balanceOf(owner.address, id), BigInt(amount));
    assert.equal(await contract.uri(id), setUriIfEmpty);
    const [storedHash, storedCid] = await contract.getDocument(id);
    assert.equal(storedHash, docHash);
    assert.equal(storedCid, docCid);
    log("info", "Mint flow completed", { requestId: reqId.toString(), tokenId: id, amount });

    await expectRevert(
      () => contract.connect(owner).safeTransferFrom(owner.address, outsider.address, id, 1, "0x"),
      "KYC to"
    );

    await contract.setKyc(receiver.address, true);
    await contract.connect(owner).safeTransferFrom(owner.address, receiver.address, id, 10, "0x");
    assert.equal(await contract.balanceOf(receiver.address, id), 10n);
  });

  it("reverts executeMint when approvals are missing", async () => {
    const { contract, notary, manager, owner } = ctx;
    const id = 2001;
    const fees = { notaryFee: 0, managerFee: 0, tax: 0 };
    await contract.requestMint(owner.address, id, 5, fees, "", ethers.ZeroHash, "");
    const reqId = (await contract.mintRequestId()) - 1n;

    await expectRevert(() => contract.executeMint(reqId), "need 2-of-2");

    await contract.connect(notary).approveByNotary(reqId);
    await expectRevert(() => contract.executeMint(reqId), "need 2-of-2");

    await contract.connect(manager).approveByManager(reqId);
    await contract.executeMint(reqId);
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

    const txDoc = await contract.grantRole(NOTARY_ROLE, admin.address);
    await txDoc.wait();
    await contract.setDocument(4001, ethers.keccak256(ethers.toUtf8Bytes("real")), "ipfs://real");

    const txUri = await contract.grantRole(MANAGER_ROLE, admin.address);
    await txUri.wait();
    await contract.setURI(4001, "ipfs://custom/{id}.json");
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

    await contract.requestMint(owner.address, propertyId, totalMintAmount, fees, "", ethers.ZeroHash, "");
    const reqId = (await contract.mintRequestId()) - 1n;
    await contract.connect(notary).approveByNotary(reqId);
    await contract.connect(manager).approveByManager(reqId);
    await contract.executeMint(reqId);
    log("info", "Property minted for marketplace test", { tokenId: propertyId, amount: totalMintAmount });

    await contract.setKyc(receiver.address, true);

    const tx = await contract
      .connect(owner)
      .createListing(propertyId, BigInt(amountForSale), LISTING_PRICE_PER_UNIT);
    const receipt = await tx.wait();
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

    await paymentToken.connect(receiver).approve(contractAddress, totalPrice).then((tx) => tx.wait());
    await contract.connect(receiver).buyListing(listingId, BigInt(amountForSale));
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
    await paymentToken
      .connect(admin)
      .approve(contractAddress, INTEREST_DISTRIBUTION_TOTAL)
      .then((tx) => tx.wait());
    await contract.connect(admin).distributeInterest(propertyId, INTEREST_DISTRIBUTION_TOTAL);
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
