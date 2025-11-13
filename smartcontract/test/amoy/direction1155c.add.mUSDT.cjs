const path = require("node:path");
const { ethers } = require("ethers");

function requireArtifact(artifactPath) {
  if (!artifactPath) {
    throw new Error("artifactPath is required for deployPaymentTokenAndAirdrop");
  }
  return require(artifactPath);
}

async function deployPaymentTokenAndAirdrop({
  artifactPath,
  adminWallet,
  recipients = [],
  airdropAmount = 0n,
  sendTxWithRetry,
}) {
  if (!adminWallet || !adminWallet.provider) {
    throw new Error("adminWallet with provider is required");
  }

  const resolvedPath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.join(__dirname, "..", artifactPath);

  const artifact = requireArtifact(resolvedPath);
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    adminWallet
  );
  const paymentToken = await factory.deploy();
  await paymentToken.waitForDeployment();

  if (airdropAmount > 0n && recipients.length > 0) {
    const mintAction = (recipient) => {
      if (typeof sendTxWithRetry === "function") {
        return sendTxWithRetry(`paymentToken-mint-${recipient.address}`, (overrides) =>
          paymentToken.mint(recipient.address, airdropAmount, overrides)
        );
      }
      return paymentToken.mint(recipient.address, airdropAmount).then((tx) => tx.wait());
    };

    await Promise.all(recipients.map((recipient) => mintAction(recipient)));
  }

  return { paymentToken };
}

module.exports = {
  deployPaymentTokenAndAirdrop,
};
