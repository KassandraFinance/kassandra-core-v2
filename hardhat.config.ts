import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';

import 'dotenv/config';

const PRIVATE_KEY = process.env.PRIVATE_KEY as string;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY as string;
const AVALANCHE_API_KEY = process.env.AVALANCHE_API_KEY as string;
const ARBITRUM_API_KEY = process.env.ARBITRUM_API_KEY as string;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.7.1',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  networks: {
    polygon: {
      accounts: [PRIVATE_KEY],
      url: 'https://polygon-rpc.com',
      chainId: 137,
    },
    arbitrumOne: {
      accounts: [PRIVATE_KEY],
      url: 'https://arbitrum.llamarpc.com',
      chainId: 42161,
    },
    avalanche: {
      accounts: [PRIVATE_KEY],
      url: 'https://rpc.ankr.com/avalanche',
      chainId: 43114,
    },
    hardhat: {
      allowUnlimitedContractSize: true,
      gas: 'auto',
      chainId: 137,
      forking: {
        url: 'https://polygon-rpc.com',
      },
    },
  },
  etherscan: {
    apiKey: {
      polygon: POLYGON_API_KEY,
      avalanche: AVALANCHE_API_KEY,
      arbitrumOne: ARBITRUM_API_KEY,
    },
  },
  mocha: {
    timeout: 10000000,
  },
};

export default config;
