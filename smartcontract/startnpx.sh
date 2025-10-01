#terminal node
npx hardhat clean
npx hardhat compile
npx hardhat node

#DEPLOY
npx hardhat compile
npx hardhat run --network localhost scripts/deploy-local.js

#DEPLOY-AMOY
npx hardhat compile
npx hardhat run --network amoy scripts/deploy-amoy.js

#terminal flow
npx hardhat run --network localhost scripts/flow-e2e.js

#terminal transfer
npx hardhat run --network localhost scripts/transfer-ok.js

#terminal test
#npx hardhat run --network localhost test/direction1155c.flow.test.js
npx hardhat test

#test amoy
node scripts/test-amoy.js
