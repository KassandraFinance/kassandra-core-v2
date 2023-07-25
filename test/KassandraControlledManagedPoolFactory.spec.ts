import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { AuthorizedManagers, KacyAssetManager, KassandraControlledManagedPoolFactory, KassandraRules, KassandraWhitelist, PrivateInvestorsMock } from "../typechain-types";
import { polygon } from '../scripts/addressess'

function formatParams(queryParams: any) {
    const searchString = new URLSearchParams(queryParams);
    return searchString;
}

async function getAmountsOut(params: { srcToken: string, destTokens: any[], amount: string, srcDecimals: string, chainId: number }) {
    const {
        srcToken, destTokens, amount, srcDecimals, chainId,
    } = params;
    const txs = [];

    const amountsIn = [];

    const requests = destTokens.map(async (asset: any) => {
        const destToken = asset.token.id.toLowerCase();
        const decimals = asset.token.decimals;
        if (srcToken.toLowerCase() === destToken) {
            return Promise.resolve(
                ethers.BigNumber.from(amount).mul(105).div(100).sub(amount).toString(),
            );
        }
        const query = formatParams({
            srcToken,
            srcDecimals,
            destToken,
            destDecimals: Number(decimals),
            amount: ethers.BigNumber.from(amount).mul(105).div(100).sub(amount).toString(),
            side: 'SELL',
            network: chainId,
        });
        const resJson = await fetch(`https://apiv5.paraswap.io/prices?${query}`);
        const response = await resJson.json();
        return response;
    });

    const amounts = await Promise.all(requests);

    const size = amounts.length;
    for (let index = 0; index < size; index++) {
        const data = amounts[index];
        if (data.priceRoute) {
            txs.push(data.priceRoute);
            amountsIn.push(data.priceRoute.destAmount);
        } else {
            amountsIn.push(data);
        }
    }

    return txs;
}

async function getDatasTx(chainId: number, proxy: string, txs: any) {
    // eslint-disable-next-line max-len
    const txURL = `https://apiv5.paraswap.io/transactions/${chainId}?gasPrice=50000000000&ignoreChecks=true&ignoreGasEstimate=false&onlyParams=false`;
    const requests = txs.map(async (tx: any) => {
        const slipege = ethers.BigNumber.from(tx.destAmount).mul(105).div(100).sub(tx.destAmount).toString()
        const txConfig = {
            priceRoute: tx,
            srcToken: tx.srcToken,
            srcDecimals: tx.srcDecimals,
            destToken: tx.destToken,
            destDecimals: tx.destDecimals,
            srcAmount: tx.srcAmount,
            destAmount: ethers.BigNumber.from(tx.destAmount).sub(slipege).toString(),
            userAddress: proxy,
            partner: tx.partner,
            receiver: proxy,
        };
        const resJson = await fetch(txURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify(txConfig),
        });
        const response = await resJson.json();

        return response.data;
    });
    return Promise.all(requests);
}

async function getTokens() {
    const resJson = await fetch('https://apiv5.paraswap.io/tokens/137')
    const res = await resJson.json()

    return res.tokens.slice(40, 4)
}

const VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
const WMATIC_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
const DAI_ADDRESS = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'
const SWAP_PROVIDER =             '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'
const SWAP_PROXY_PROVIDER = '0x216b4b4ba9f3e719726886d34a177484278bfcae'

describe("KassandraControlledManagedPoolFactory", () => {
    async function deployFactory() {

        const [owner, manager] = await ethers.getSigners();
        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [VAULT_ADDRESS],
        });
        const vaultSigner = await ethers.getSigner(VAULT_ADDRESS);


        const AssetManagerDeployer = await ethers.getContractFactory("KacyAssetManager");
        const assetManager = await upgrades.deployProxy(AssetManagerDeployer) as KacyAssetManager;

        const VaultDeployer = await ethers.getContractFactory("VaultMock");
        const vault = await VaultDeployer.deploy();

        const ManagedPoolFactoryDeployer = await ethers.getContractFactory("ManagedPoolFactoryMock");
        const managedPoolFactory = await ManagedPoolFactoryDeployer.deploy(
            vault.address,
            assetManager.address,
        );

        const PrivateInvestorsDeployer = await ethers.getContractFactory("PrivateInvestorsMock");
        const privateInvestors = await upgrades.deployProxy(PrivateInvestorsDeployer) as PrivateInvestorsMock;

        const AuthorizedManagersDeployer = await ethers.getContractFactory("AuthorizedManagers");
        const authorizedManagers = await upgrades.deployProxy(AuthorizedManagersDeployer) as AuthorizedManagers;

        const kassandraAumFee = 0.005e18.toString()

        const KassandraRulesDeployer = await ethers.getContractFactory("KassandraRules");
        const kassandraRules = await upgrades.deployProxy(KassandraRulesDeployer, [owner.address, 1, 1, kassandraAumFee]) as KassandraRules;

        const WhitelistDeployer = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await upgrades.deployProxy(WhitelistDeployer) as KassandraWhitelist;

        const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
        const proxyInvest = await upgrades.deployProxy(ProxyInvest, [vault.address, ethers.constants.AddressZero]);

        const ControllerFactory = await ethers.getContractFactory('KassandraControlledManagedPoolFactory');
        const controllerFactory = await upgrades.deployProxy(ControllerFactory, [ 
            managedPoolFactory.address,
            privateInvestors.address,
            authorizedManagers.address,
            vault.address,
            kassandraRules.address,
            assetManager.address,
            proxyInvest.address,
            SWAP_PROVIDER,
            SWAP_PROXY_PROVIDER,
            WMATIC_ADDRESS
        ]) as KassandraControlledManagedPoolFactory;

        await authorizedManagers.deployed();
        await authorizedManagers.setManager(manager.address, 2);
        await authorizedManagers.setFactory(controllerFactory.address);

        await privateInvestors.deployed();
        await privateInvestors.setFactory(controllerFactory.address);


        const amountMatic = ethers.utils.parseEther("10");
        const amountDai = ethers.utils.parseEther("8.4");
        const amountweth = ethers.utils.parseEther('2')
        const TokenDeployer = await ethers.getContractFactory("TokenMock");

        const weth = TokenDeployer.attach(WETH_ADDRESS);
        await weth.connect(vaultSigner).transfer(manager.address, amountweth)

        const matic = await TokenDeployer.deploy("Matic", "MATIC");
        const dai = await TokenDeployer.deploy("Dai", "DAI");
        const degen = await TokenDeployer.deploy("Degen", "DGN");
        await matic.deployed();
        await dai.deployed();
        await degen.deployed();
        await matic.connect(manager).approve(controllerFactory.address, amountMatic);
        await dai.connect(manager).approve(controllerFactory.address, amountDai);
        await degen.connect(manager).approve(controllerFactory.address, amountDai);
        await weth.connect(manager).approve(controllerFactory.address, amountweth);
        await matic.mint(manager.address, amountMatic);
        await dai.mint(manager.address, amountDai);
        await degen.mint(manager.address, amountDai);
        await whitelist.deployed();
        await whitelist.addTokenToList(matic.address);
        await whitelist.addTokenToList(dai.address);
        await whitelist.addTokenToList(weth.address)
        await whitelist.addTokenToList(WMATIC_ADDRESS)
        const tokens = polygon.whitelist.slice(0, 20)
        for (let index = 0; index < tokens.length; index++) {
            await whitelist.addTokenToList(tokens[index].address)
        }

        const DAI = TokenDeployer.attach(DAI_ADDRESS)
        const WMATIC = TokenDeployer.attach(WMATIC_ADDRESS)

        const pool = {
            name: "Polygon Social Index",
            symbol: "pHYPE",
            isPrivatePool: false,
            whitelist: whitelist.address,
            maxAmountsIn: [amountMatic, amountDai],
            settingsParams: {
                tokens: [matic.address, dai.address],
                normalizedWeights: [ethers.utils.parseEther("0.5"), ethers.utils.parseEther("0.5")],
                swapFeePercentage: ethers.utils.parseEther("0.005"),
                swapEnabledOnStart: true,
                mustAllowlistLPs: false,
                managementAumFeePercentage: ethers.utils.parseEther("0.005"),
                aumFeeId: 3,
            },
            feesSettings: {
                feesToManager: ethers.utils.parseEther("0.015"),
                feesToReferral: ethers.utils.parseEther("0.015"),
            },
            salt: ethers.constants.HashZero
        };

        const realSettingsParams = {
            tokens: [WMATIC_ADDRESS, DAI_ADDRESS],
            normalizedWeights: [ethers.utils.parseEther("0.5"), ethers.utils.parseEther("0.5")],
            swapFeePercentage: ethers.utils.parseEther("0.005"),
            swapEnabledOnStart: true,
            mustAllowlistLPs: false,
            managementAumFeePercentage: ethers.utils.parseEther("0.005"),
            aumFeeId: 3,
        }

        return {
            controllerFactory,
            pool,
            realSettingsParams,
            manager,
            managedPoolFactory,
            kassandraRules,
            assetManager,
            authorizedManagers,
            privateInvestors,
            amountDai,
            amountMatic,
            dai,
            matic,
            degen,
            vault,
            kassandraAumFee,
            DAI,
            WMATIC
        };
    }

    it("should have set correct addresses from constructor", async () => {
        const { controllerFactory, managedPoolFactory, kassandraRules, assetManager, authorizedManagers, kassandraAumFee } = await loadFixture(deployFactory);
        expect(await controllerFactory.getManagedPoolFactory()).equal(managedPoolFactory.address);
        expect(await controllerFactory.getKassandraRules()).equal(kassandraRules.address);
        expect(await controllerFactory.getAssetManager()).equal(assetManager.address);
        expect(await controllerFactory.getAuthorizedManagers()).equal(authorizedManagers.address);
        expect(await controllerFactory.kassandraAumFeePercentage()).equal(kassandraAumFee);
        expect(await controllerFactory.getSwapProvider()).equal(SWAP_PROVIDER);
        expect((await controllerFactory.getProxyProviderTransfer()).toLowerCase()).equal(SWAP_PROXY_PROVIDER);
    })

    it("should revert if manager is not allowed to create pools", async () => {
        const { controllerFactory, pool } = await loadFixture(deployFactory);
        await expect(controllerFactory.create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: [...pool.maxAmountsIn, 1],
                name: pool.name,
                symbol: pool.symbol,
            },
            pool.settingsParams,
            pool.feesSettings,
            {
                datas: [],
                tokenIn: ethers.constants.AddressZero,
                amountIn: 0
            },
            pool.salt
        )).to.be.revertedWith("BAL#401");
    })

    it("should revert if amounts and tokens lists are incompatible", async () => {
        const { controllerFactory, pool, manager } = await loadFixture(deployFactory);
        await expect(controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: [...pool.maxAmountsIn, 1],
                name: pool.name,
                symbol: pool.symbol,
            },
            pool.settingsParams,
            pool.feesSettings,
            {
                datas: [],
                tokenIn: ethers.constants.AddressZero,
                amountIn: 0
            },
            pool.salt
        )).to.be.revertedWith("BAL#103");
        await expect(controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: [pool.maxAmountsIn[0]],
                name: pool.name,
                symbol: pool.symbol,
            },
            pool.settingsParams,
            pool.feesSettings,
            {
                datas: [],
                tokenIn: ethers.constants.AddressZero,
                amountIn: 0
            },
            pool.salt
        )).to.be.revertedWith("BAL#103");
    })

    it("should revert if token is not whitelisted", async () => {
        const { controllerFactory, pool, manager, matic, degen } = await loadFixture(deployFactory);
        await expect(controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: pool.maxAmountsIn,
                name: pool.name,
                symbol: pool.symbol,
            },
            {
                ...pool.settingsParams,
                tokens: [degen.address, matic.address],
            },
            pool.feesSettings,
            {
                datas: [],
                tokenIn: ethers.constants.AddressZero,
                amountIn: 0
            },
            pool.salt
        )).to.be.revertedWith("BAL#309");
    })

    it("should create pool and controller", async () => {
        const {
            controllerFactory,
            pool,
            manager,
            authorizedManagers,
            privateInvestors,
            kassandraRules,
            dai,
            matic,
            amountDai,
            amountMatic,
            vault,
        } = await loadFixture(deployFactory);
        const tx = await controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: pool.maxAmountsIn,
                name: pool.name,
                symbol: pool.symbol,
            },
            pool.settingsParams,
            pool.feesSettings,
            {
                datas: [],
                tokenIn: ethers.constants.AddressZero,
                amountIn: 0
            },
            pool.salt
        );

        const eventName = "KassandraPoolCreated";
        // event was emitted
        await expect(tx).emit(controllerFactory, eventName);

        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [, , managedPoolAddress, controllerAddress] = (event?.args || [, ethers.constants.AddressZero, ethers.constants.AddressZero]) as string[]
        // pool was created and set as created
        expect(await controllerFactory.isPoolFromFactory(managedPoolAddress)).true;

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        const ManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        const managedPool = ManagedPool.attach(managedPoolAddress);
        const managedPoolController = ManagedPoolController.attach(controllerAddress);
        // owners set correctly
        expect(await managedPool.getOwner()).equal(controllerAddress);
        expect(await managedPoolController.pool()).equal(managedPoolAddress);
        expect(await managedPoolController.getManager()).equal(manager.address);
        expect(await authorizedManagers.getAllowedPoolsToCreate(manager.address)).equal(1);
        expect(await privateInvestors.getController(controllerAddress)).true;
        // tokens were transfered to the vault
        expect(await dai.balanceOf(manager.address)).equal(0);
        expect(await dai.balanceOf(vault.address)).equal(amountDai);
        expect(await matic.balanceOf(manager.address)).equal(0);
        expect(await matic.balanceOf(vault.address)).equal(amountMatic);
        // base pool rights must be true
        expect(await managedPoolController.canTransferOwnership()).true;
        expect(await managedPoolController.canChangeSwapFee()).true;
        expect(await managedPoolController.canUpdateMetadata()).true;
        // settings passed as arguments should have been set correctly
        expect(await managedPoolController.getJoinFees()).deep.equal([pool.feesSettings.feesToManager, pool.feesSettings.feesToReferral]);
        expect(await managedPoolController.kassandraRules()).equal(kassandraRules.address);
        expect(await managedPoolController.isPrivatePool()).false;
        expect(await managedPoolController.getWhitelist()).equal(pool.whitelist);
    })

    it("should create pool and controller with one token", async () => {
        const {
            controllerFactory,
            pool,
            realSettingsParams,
            manager,
            authorizedManagers,
            privateInvestors,
            kassandraRules,
        } = await loadFixture(deployFactory);

        const amountIn = ethers.utils.parseEther('1')
        const assets = []
        for (let i = 0; i < realSettingsParams.normalizedWeights.length; i++) {
            assets.push({
                token: {
                    id: realSettingsParams.tokens[i],
                    decimals: 18,
                },
                weight_normalized: realSettingsParams.normalizedWeights[i]
            })

        }
        // const txs = await getAmountsOut({
        //     srcToken: WETH_ADDRESS,
        //     destTokens: assets,
        //     amount: amountIn.toString(),
        //     srcDecimals: '18',
        //     chainId: 137,
        // });
        // const datas = await getDatasTx(137, controllerFactory.address, txs);

        const datas = [
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000004064f38181a1b38bb40000000000000000000000000000000000000000000000410b77422b0598ea3400000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000000000000000000000000648116b3fc5164b114e741538f5aca70d16d8546000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000124c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee57000000000000000000000000000000000000000000000000000000006489fcd200000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f40d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000031957d19da9759d63700000000000000000000000000000000000000000000003215b4aaec5079c647000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000bc000000000000000000000000000000000000000000000000000000000648116b3f2fb1753eea74894a019c06dc095739a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003000000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008000000000000000000000000a222e6a71d1a1dd5f279805fbe38d5329c1d0e70000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000004b543e89351faa242cb0172b2da0cdb52db699b40000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000009000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003c0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000460ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001e0f93579002dbe8046c43fefe86ec78b1112247bb800000000000000000000075900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000003710055500000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000048e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000178e029173417b1f9c8bc16dcec6f697bc32374600000000000000000000075800000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000f93579002dbe8046c43fefe86ec78b1112247bb8000000000000000000000000178e029173417b1f9c8bc16dcec6f697bc3237460000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000000000000000000047fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000'
        ]

        const tx = await controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: realSettingsParams.tokens.map(_ => '0'),
                name: pool.name,
                symbol: pool.symbol,
            },
            { ...pool.settingsParams, tokens: realSettingsParams.tokens },
            pool.feesSettings,
            {
                datas,
                tokenIn: WETH_ADDRESS,
                amountIn
            },
            pool.salt
        );

        const eventName = "KassandraPoolCreated";
        // event was emitted
        await expect(tx).emit(controllerFactory, eventName);

        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [, , managedPoolAddress, controllerAddress] = (event?.args || [, ethers.constants.AddressZero, ethers.constants.AddressZero]) as string[]
        // pool was created and set as created
        expect(await controllerFactory.isPoolFromFactory(managedPoolAddress)).true;

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        const ManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        const managedPool = ManagedPool.attach(managedPoolAddress);
        const managedPoolController = ManagedPoolController.attach(controllerAddress);
        // owners set correctly
        expect(await managedPool.getOwner()).equal(controllerAddress);
        expect(await managedPoolController.pool()).equal(managedPoolAddress);
        expect(await managedPoolController.getManager()).equal(manager.address);
        expect(await authorizedManagers.getAllowedPoolsToCreate(manager.address)).equal(1);
        expect(await privateInvestors.getController(controllerAddress)).true;
        expect(await managedPoolController.canTransferOwnership()).true;
        expect(await managedPoolController.canChangeSwapFee()).true;
        expect(await managedPoolController.canUpdateMetadata()).true;
        // settings passed as arguments should have been set correctly
        expect(await managedPoolController.getJoinFees()).deep.equal([pool.feesSettings.feesToManager, pool.feesSettings.feesToReferral]);
        expect(await managedPoolController.kassandraRules()).equal(kassandraRules.address);
        expect(await managedPoolController.isPrivatePool()).false;
        expect(await managedPoolController.getWhitelist()).equal(pool.whitelist);
    })

    it("should create pool and controller with native token", async () => {
        const {
            controllerFactory,
            pool,
            realSettingsParams,
            manager,
            authorizedManagers,
            privateInvestors,
            kassandraRules,
        } = await loadFixture(deployFactory);

        const amountIn = ethers.utils.parseEther('1')
        const assets = []
        for (let i = 0; i < realSettingsParams.normalizedWeights.length; i++) {
            assets.push({
                token: {
                    id: realSettingsParams.tokens[i],
                    decimals: 18,
                },
                weight_normalized: realSettingsParams.normalizedWeights[i]
            })

        }
        // const txs = await getAmountsOut({
        //     srcToken: WMATIC_ADDRESS,
        //     destTokens: assets,
        //     amount: amountIn.toString(),
        //     srcDecimals: '18',
        //     chainId: 137,
        // });
        // const datas = await getDatasTx(137, controllerFactory.address, txs);

        const datas = [
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000054f0f6b50638473000000000000000000000000000000000000000000000000055cc9c1bb38902100000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000003a0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000003e00000000000000000000000000000000000000000000000000000000064812317e71f713522d84e7bb137ab5702d11c3f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000000e491a32b690000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000004de48929d3fea77398f64448c85015633c2d6472fb29000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e4000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
        ]

        const tx = await controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: pool.maxAmountsIn,
                name: pool.name,
                symbol: pool.symbol,
            },
            { ...pool.settingsParams, tokens: realSettingsParams.tokens },
            pool.feesSettings,
            {
                datas,
                tokenIn: WMATIC_ADDRESS,
                amountIn
            },
            pool.salt,
            {
                value: amountIn
            }
        );

        const eventName = "KassandraPoolCreated";
        // event was emitted
        await expect(tx).emit(controllerFactory, eventName);

        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [, , managedPoolAddress, controllerAddress] = (event?.args || [, ethers.constants.AddressZero, ethers.constants.AddressZero]) as string[]
        // pool was created and set as created
        expect(await controllerFactory.isPoolFromFactory(managedPoolAddress)).true;

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        const ManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        const managedPool = ManagedPool.attach(managedPoolAddress);
        const managedPoolController = ManagedPoolController.attach(controllerAddress);
        // owners set correctly
        expect(await managedPool.getOwner()).equal(controllerAddress);
        expect(await managedPoolController.pool()).equal(managedPoolAddress);
        expect(await managedPoolController.getManager()).equal(manager.address);
        expect(await authorizedManagers.getAllowedPoolsToCreate(manager.address)).equal(1);
        expect(await privateInvestors.getController(controllerAddress)).true;
        expect(await managedPoolController.canTransferOwnership()).true;
        expect(await managedPoolController.canChangeSwapFee()).true;
        expect(await managedPoolController.canUpdateMetadata()).true;
        // settings passed as arguments should have been set correctly
        expect(await managedPoolController.getJoinFees()).deep.equal([pool.feesSettings.feesToManager, pool.feesSettings.feesToReferral]);
        expect(await managedPoolController.kassandraRules()).equal(kassandraRules.address);
        expect(await managedPoolController.isPrivatePool()).false;
        expect(await managedPoolController.getWhitelist()).equal(pool.whitelist);
    })

    it("should create pool and controller with native token and 50 tokens", async () => {
        const {
            controllerFactory,
            pool,
            manager,
            authorizedManagers,
            privateInvestors,
            kassandraRules,
            vault,
            DAI,
            WMATIC
        } = await loadFixture(deployFactory);

        const amountIn = ethers.utils.parseEther('1')
        const assets = []
        // const tokens = await getTokens()
        const tokens = polygon.whitelist.slice(0, 20)
        for (let i = 0; i < tokens.length; i++) {
            assets.push({
                token: {
                    id: tokens[i].address,
                    decimals: tokens[i].decimals,
                },
                weight_normalized: ethers.utils.parseEther('0.05')
            })
        }
        const orderTokens = assets.sort((a, b) => a.token.id > b.token.id ? 1 : -1)

        // const txs = await getAmountsOut({
        //     srcToken: WETH_ADDRESS,
        //     destTokens: orderTokens,
        //     amount: amountIn.toString(),
        //     srcDecimals: '18',
        //     chainId: 137,
        // });
        // const datas = await getDatasTx(137, controllerFactory.address, txs);

        const datas = [
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000b3f868e0be5597d5db7feb59e1cadbb0fdda50a00000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000000685c52f63da1b890c000000000000000000000000000000000000000000000006dda724691b7b4ce400000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004200000000000000000000000000000000000000000000000000000000064815398f43750397bde47c5af76f7691132dd83000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000124c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f619000bb80b3f868e0be5597d5db7feb59e1cadbb0fdda50a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000000632966a49326f47030000000000000000000000000000000000000000000000068617984d0cab0761000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000007600000000000000000000000000000000000000000000000000000000064815398016f1ae7a00e489c9d424c14591b5cb900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df96cf8654e85ab489ca7e70189046d507eba233613000000000000000000000000172370d5cd63279efa6d502dab29171933a610af0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000f5b509bb0909a69b1c207e495f687a596c168e12000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000000000000000280d500b1d8e8ef31e21c99d1db9a6444d3adf1270172370d5cd63279efa6d502dab29171933a610af0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000004c8ff453de536185800000000000000000000000000000000000000000000000509787ec7e3cd2719000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000900000000000000000000000000000000000000000000000000000000006481539897cf826daf2542299c1d954e59c3b56e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000000c800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000264800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000001d734a02ef1e1f5886e66b0673b71af5b53ffa940000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000f5b509bb0909a69b1c207e495f687a596c168e12000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000000000000000282791bca1f2de4661ed88a30c99a7a9449aa841741d734a02ef1e1f5886e66b0673b71af5b53ffa940000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x46c67b6d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000022fe081c084dc27871b00000000000000000000000000000000000000000000024d581ccaa6cccb4ad9000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000011e00000000000000000000000000000000000000000000000000000000064815398ea91ce3024cc4c9caa88ed06b754f1c100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000a4000000000000000000000000000000000000000000000000000000000000023f000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000000d900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000263700000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000000000000000000000000000000000000000000000255707b70bf90aa112006e1b07b9aea6de0214240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000009000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000260ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020e2f706ef1f7240b803aae877c9c762644bb808d80002000000000000000008c200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000501483b00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000255707b70bf90aa112006e1b07b9aea6de02142400000000000000000000000000000000000000000000000000000000000000027fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000004c28f48448720e9000907bc2611f73022fdce1fa00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de5c3379226aeef21464d05676305dad1261d6f3fac000000000000000000000000255707b70bf90aa112006e1b07b9aea6de0214240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de434da30d1f8ef9799f5ae3b9989e1def926052e780000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000007be163378cae75f4e9000000000000000000000000000000000000000000000082668362e4ed89a37b000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000b2000000000000000000000000000000000000000000000000000000000648153985fca8a20635144c8a52ac3416a14e2e4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000000c800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000264800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000002934b36ca9a4b31e633c5be670c8c8b28b6aa0150000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000009000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000260ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020b204bf10bc3a5435017d3db247f56da601dfe08a0002000000000000000000fe00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000570add900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000002934b36ca9a4b31e633c5be670c8c8b28b6aa01500000000000000000000000000000000000000000000000000000000000000027fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000004b65e89870581a899000000000000000000000000000000000000000000000004f5dcc6a913451d42000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000008e00000000000000000000000000000000000000000000000000000000064815398fbe1a53b1cb449b1b52e963b0b41c43000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df96cf8654e85ab489ca7e70189046d507eba233613000000000000000000000000385eeac5cb85a38a9a07a70c73e0a3271cfb54a70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000f5b509bb0909a69b1c207e495f687a596c168e12000000000000000000000000000000000000000000000000000000000000258000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000000000000000280d500b1d8e8ef31e21c99d1db9a6444d3adf1270385eeac5cb85a38a9a07a70c73e0a3271cfb54a70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de41366c529a133d4153211410126f12aa4e31aaac50000000000000000000000000000000000000000000000000000000000000000',
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000045c32fa6df82ead1e2ef74d17b76547eddfaff8900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000004be6cbd8deb2bd3af000000000000000000000000000000000000000000000004fe578429993b9b7400000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000003a00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000044000000000000000000000000000000000000000000000000000000000648153981bf618fa7f3a4d778dd9e807e8d704f7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000144c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000427ceb23fd6bc0add59e62ac25578270cff1b9f6190001f4c2132d05d31c914a87c6611c10748aeb04b58e8f0001f445c32fa6df82ead1e2ef74d17b76547eddfaff8900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000144000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x46c67b6d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000002382b7ea4cda748020000000000000000000000000000000000000000000000025612d626bd87aa1d000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000ce00000000000000000000000000000000000000000000000000000000064815398f519b08a5c6d4cb6bc276af4c41b64ce00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000520000000000000000000000000000000000000000000000000000000000000138800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000050b728d8d964fd00c2d0aad81718b71311fef68a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc2810000000000000000000000000000000000000000000000000000000000000af000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de5116ff0d1caa91a6b94276b3471f33dbeb52073e7000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000001c2000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f619000bb850b728d8d964fd00c2d0aad81718b71311fef68a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000013880000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df96cf8654e85ab489ca7e70189046d507eba23361300000000000000000000000050b728d8d964fd00c2d0aad81718b71311fef68a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b0d500b1d8e8ef31e21c99d1db9a6444d3adf1270000bb850b728d8d964fd00c2d0aad81718b71311fef68a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000000ccf1a3ac1d055bee000000000000000000000000000000000000000000000000d7bafd20f62096a9000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000007600000000000000000000000000000000000000000000000000000000064815398e33c077fc8e2439c8be332b924d1fc2f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df96cf8654e85ab489ca7e70189046d507eba23361300000000000000000000000053e0bca35ec356bd5dddfebbd1fc0fd03fabad390000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b0d500b1d8e8ef31e21c99d1db9a6444d3adf12700001f453e0bca35ec356bd5dddfebbd1fc0fd03fabad390000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000580a84c73811e1839f75d86d75d88cca0c241ff400000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000007998dfbc0f319bb47300000000000000000000000000000000000000000000007fff3c5a2af0d9cb6b00000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000036000000000000000000000000000000000000000000000000000000000000003c0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000648153981ee26c67aed44ed1bca9ac30d93b9053000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000010491a32b690000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000002000000000000000000004df96cf8654e85ab489ca7e70189046d507eba233613000000000000000000004de49a8b2601760814019b7e6ee0052e25f1c623d1e600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x46c67b6d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000000001ec82ea0cee7fe700000000000000000000000000000000000000000000000002066edb6bed941b000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000006481539852030c32c64d4cf6a245d38a9cdbc73b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000082000000000000000000000000000000000000000000000000000000000000011300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df96cf8654e85ab489ca7e70189046d507eba2336130000000000000000000000006f7c932e7684666c9fd1d44527765433e01ff61d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000238300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b0d500b1d8e8ef31e21c99d1db9a6444d3adf12700027106f7c932e7684666c9fd1d44527765433e01ff61d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000038d00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b0d500b1d8e8ef31e21c99d1db9a6444d3adf1270000bb86f7c932e7684666c9fd1d44527765433e01ff61d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000df7837de1f2fa4631d716cf2502f8b230f1dcc320000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de4fc2fc983a411c4b1e238f7eb949308cf0218c7500000000000000000000000006f7c932e7684666c9fd1d44527765433e01ff61d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000009000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000260ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020c42c42256b484e574a458d5d8ee4fd7876f6d8d700020000000000000000047e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000356d9900000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000df7837de1f2fa4631d716cf2502f8b230f1dcc320000000000000000000000006f7c932e7684666c9fd1d44527765433e01ff61d00000000000000000000000000000000000000000000000000000000000000027fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000',
            '0x46c67b6d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec5000000000000000000000000000000000000000000000000000024c9a0b6780dc67d00000000000000000000000000000000000000000000000026b94adb051bf95b000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef15000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000134000000000000000000000000000000000000000000000000000000000648153982cd8a14c51e34cfeb4cd744a5e094bcd000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000003a00000000000000000000000000000000000000000000000000000000000000b8000000000000000000000000000000000000000000000000000000000000009600000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000008505b9d2254a7ae468c0e9dd10ccea3a837aef5c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de49021a31062a1d9c9c35d632ed54a9d923e46809f00000000000000000000000000000000000000000000000000000000000011f800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000001b300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000255d00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000008505b9d2254a7ae468c0e9dd10ccea3a837aef5c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b2791bca1f2de4661ed88a30c99a7a9449aa84174000bb88505b9d2254a7ae468c0e9dd10ccea3a837aef5c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df96cf8654e85ab489ca7e70189046d507eba2336130000000000000000000000008505b9d2254a7ae468c0e9dd10ccea3a837aef5c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b0d500b1d8e8ef31e21c99d1db9a6444d3adf1270000bb88505b9d2254a7ae468c0e9dd10ccea3a837aef5c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x46c67b6d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000004b38173e2178ce45f000000000000000000000000000000000000000000000004f2d91baa9f86d571000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000d00000000000000000000000000000000000000000000000000000000006481539864518878adb94276b66bd8828010af4c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003a000000000000000000000000000000000000000000000000000000000000008980000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190000648f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e7800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000261000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b2791bca1f2de4661ed88a30c99a7a9449aa841740000648f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000004b52410f4e9a1f2ad000000000000000000000000000000000000000000000004f491c101cd820cec000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000009000000000000000000000000000000000000000000000000000000000064815398080770e7d290455aa4f9c0f1c1f3fc3a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000000c800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000264800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b8000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000009c9e5fd8bbc25984b178fdce6117defa39d2db390000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b8000000000000000000000000000000000000000000000000000000000000002b2791bca1f2de4661ed88a30c99a7a9449aa841740001f49c9e5fd8bbc25984b178fdce6117defa39d2db390000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000009a71012b13ca4d3d0cdc72a177df3ef03b0e76a300000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000000f493d90b9150862f0000000000000000000000000000000000000000000000010173354f8b7d2eee00000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef1500000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000000000000000000000000648153985781fa1ded3a41a09d7543a7a3797bef000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000124c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f619000bb89a71012b13ca4d3d0cdc72a177df3ef03b0e76a300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000001927a5c16b4b85116000000000000000000000000000000000000000000000001a7a93883b0c20482000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef15000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000098000000000000000000000000000000000000000000000000000000000648153984284de26c1fd4bc39155f52e19d76f5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000df7837de1f2fa4631d716cf2502f8b230f1dcc320000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc281000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004de4fc2fc983a411c4b1e238f7eb949308cf0218c750000000000000000000000000b7b31a6bc18e48888545ce79e83e06003be709300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000009000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000260ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020385fd3414afb52d5cd60e22f17826cf9920602440002000000000000000004e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000005f633900000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000df7837de1f2fa4631d716cf2502f8b230f1dcc32000000000000000000000000b7b31a6bc18e48888545ce79e83e06003be7093000000000000000000000000000000000000000000000000000000000000000027fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000',
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000c3c7d422809852031b44ab29eec9f1eff2a5875600000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000020a79986abf021c1400000000000000000000000000000000000000000000000225f9421f85b160ec00000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004200000000000000000000000000000000000000000000000000000000064815398416ab6d41a5e431082ed4c07e0d78ff9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000124c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f619000bb8c3c7d422809852031b44ab29eec9f1eff2a5875600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x54e3f31b00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000d6df932a45c0f255f85145f286ea0b292b21c90b00000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000001478497fc52d504e000000000000000000000000000000000000000000000000158c17790573112900000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004200000000000000000000000000000000000000000000000000000000064815398dbcfbdaaed664b09a1c53cba0643f579000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000000000124c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000def171fe48cf0115b1d80b88dc8eab59176fee5700000000000000000000000000000000000000000000000000000000648a39b800000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f619000bb8d6df932a45c0f255f85145f286ea0b292b21c90b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0x46c67b6d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec500000000000000000000000000000000000000000000000000000000000000001f8f0000000000000000000000000000000000000000000000000000000000002138000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef150000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000000000000000000000000000000000000064815398113d79e79887443db5e820b78c9f4bd7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003a00000000000000000000000000000000000000000000000000000000000000258000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e111178a87a3bff0c8d18decba5798827539ae990000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f619002710e111178a87a3bff0c8d18decba5798827539ae9900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024b800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000004000000000000000000000000f3938337f7294fef84e9b2c6d548a93f956cc28100000000000000000000000000000000000000000000000000000000000000d500000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000004df9d928ce1d0f2642e44615768761c0f00c23e0d588000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000263b00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f42791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000000000000000000000000000000000000000000000e111178a87a3bff0c8d18decba5798827539ae990000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b2791bca1f2de4661ed88a30c99a7a9449aa841740001f4e111178a87a3bff0c8d18decba5798827539ae990000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            '0xa94e78ef00000000000000000000000000000000000000000000000000000000000000200000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61900000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000004bea4c9e70236a98c000000000000000000000000000000000000000000000004fe9283afcc6f6f1a000000000000000000000000f38d5cc7f334729e7efbc90cd6c4181be6f2ef15000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000078000000000000000000000000000000000000000000000000000000000648153988b59b60536ed4648a47f8b7a5107209a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003200000000000000000000000001bfd67037b42cf73acf2047067bd4f2c47d9bfd60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b7000000000000000000000000000000000000000000000000000000000000002b7ceb23fd6bc0add59e62ac25578270cff1b9f6190001f41bfd67037b42cf73acf2047067bd4f2c47d9bfd6000000000000000000000000000000000000000000000000000000000000000000a3fa99a148fa48d14ed51d610c367c61876997f10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e44769f42e1e9592f86b82f206407a8f7c84b4ed00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000f5b509bb0909a69b1c207e495f687a596c168e12000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000648a39b700000000000000000000000000000000000000000000000000000000000000281bfd67037b42cf73acf2047067bd4f2c47d9bfd6a3fa99a148fa48d14ed51d610c367c61876997f10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
        ]

        const tx = await controllerFactory.connect(manager).create(
            {
                isPrivatePool: pool.isPrivatePool,
                whitelist: pool.whitelist,
                amountsIn: orderTokens.map(_ => '0'),
                name: pool.name,
                symbol: pool.symbol,
            },
            {
                ...pool.settingsParams,
                tokens: orderTokens.map(asset => asset.token.id),
                normalizedWeights: orderTokens.map(asset => asset.weight_normalized),
            },
            pool.feesSettings,
            {
                datas,
                tokenIn: WETH_ADDRESS,
                amountIn
            },
            pool.salt
        );

        const eventName = "KassandraPoolCreated";
        // event was emitted
        await expect(tx).emit(controllerFactory, eventName);

        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [, , managedPoolAddress, controllerAddress] = (event?.args || [, ethers.constants.AddressZero, ethers.constants.AddressZero]) as string[]
        // pool was created and set as created
        expect(await controllerFactory.isPoolFromFactory(managedPoolAddress)).true;

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        const ManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        const managedPool = ManagedPool.attach(managedPoolAddress);
        const managedPoolController = ManagedPoolController.attach(controllerAddress);
        // owners set correctly
        expect(await managedPool.getOwner()).equal(controllerAddress);
        expect(await managedPoolController.pool()).equal(managedPoolAddress);
        expect(await managedPoolController.getManager()).equal(manager.address);
        expect(await authorizedManagers.getAllowedPoolsToCreate(manager.address)).equal(1);
        expect(await privateInvestors.getController(controllerAddress)).true;
        expect(await managedPoolController.canTransferOwnership()).true;
        expect(await managedPoolController.canChangeSwapFee()).true;
        expect(await managedPoolController.canUpdateMetadata()).true;
        // settings passed as arguments should have been set correctly
        expect(await managedPoolController.getJoinFees()).deep.equal([pool.feesSettings.feesToManager, pool.feesSettings.feesToReferral]);
        expect(await managedPoolController.kassandraRules()).equal(kassandraRules.address);
        expect(await managedPoolController.isPrivatePool()).false;
        expect(await managedPoolController.getWhitelist()).equal(pool.whitelist);
    })

    it("should create a private pool and controller", async () => {
        const { controllerFactory, pool, manager } = await loadFixture(deployFactory);
        const tx = await controllerFactory.connect(manager).create(
            {
                isPrivatePool: true,
                whitelist: pool.whitelist,
                amountsIn: pool.maxAmountsIn,
                name: pool.name,
                symbol: pool.symbol,
            },
            pool.settingsParams,
            pool.feesSettings,
            {
                datas: [],
                tokenIn: WMATIC_ADDRESS,
                amountIn: '0'
            },
            pool.salt
        );

        const eventName = "KassandraPoolCreated";
        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [, , , controllerAddress] = (event?.args || [, , ethers.constants.AddressZero]) as string[]
        const ManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        const managedPoolController = ManagedPoolController.attach(controllerAddress);
        expect(await managedPoolController.isPrivatePool()).true;
    })
})
