require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const {
  PRIVATE_KEY,
  ALCHEMY_API_KEY_AMOY,  // <— isi di .env
  ALCHEMY_API_KEY_POLYGON // optional kalau mau mainnet
} = process.env;

const networks = {
  localhost: { url: "http://127.0.0.1:8545" },
};

if (ALCHEMY_API_KEY_AMOY && PRIVATE_KEY) {
  networks.amoy = {
    url: `${ALCHEMY_API_KEY_AMOY}`,
    accounts: [PRIVATE_KEY],
    chainId: 80002,
  };
}

if (ALCHEMY_API_KEY_POLYGON && PRIVATE_KEY) {
  networks.polygon = {
    url: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_POLYGON}`,
    accounts: [PRIVATE_KEY],
    chainId: 137,
  };
}

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false, // biar stack traces rapi & ukuran code oke
    },
  },
  networks,
};