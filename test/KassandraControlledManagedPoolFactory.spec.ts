import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { AuthorizedManagers, KacyAssetManager, KassandraControlledManagedPoolFactory, KassandraRules, KassandraWhitelist, PrivateInvestorsMock } from "../typechain-types";

describe("KassandraControlledManagedPoolFactory", () => {
    async function deployFactory() {
        const [owner, manager] = await ethers.getSigners();

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
        const kassandraRules = await upgrades.deployProxy(KassandraRulesDeployer, [owner.address, 0, 0, kassandraAumFee]) as KassandraRules;

        const WhitelistDeployer = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await upgrades.deployProxy(WhitelistDeployer) as KassandraWhitelist;

        const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
        const proxyInvest = await upgrades.deployProxy(ProxyInvest, [vault.address, ethers.constants.AddressZero, privateInvestors.address]);

        const ControllerFactory = await ethers.getContractFactory("KassandraControlledManagedPoolFactory");
        const controllerFactory = await ControllerFactory.deploy(
            managedPoolFactory.address,
            privateInvestors.address,
            authorizedManagers.address,
            vault.address,
            kassandraRules.address,
            assetManager.address,
            proxyInvest.address
        ) as KassandraControlledManagedPoolFactory;

        await authorizedManagers.deployed();
        await authorizedManagers.setManager(manager.address, 2);
        await authorizedManagers.setFactory(controllerFactory.address);

        await privateInvestors.deployed();
        await privateInvestors.setFactory(controllerFactory.address);

        const amountMatic = ethers.utils.parseEther("10");
        const amountDai = ethers.utils.parseEther("8.4");
        const TokenDeployer = await ethers.getContractFactory("TokenMock");
        const matic = await TokenDeployer.deploy("Matic", "MATIC");
        const dai = await TokenDeployer.deploy("Dai", "DAI");
        const degen = await TokenDeployer.deploy("Degen", "DGN");
        await matic.deployed();
        await dai.deployed();
        await degen.deployed();
        await matic.connect(manager).approve(controllerFactory.address, amountMatic);
        await dai.connect(manager).approve(controllerFactory.address, amountDai);
        await degen.connect(manager).approve(controllerFactory.address, amountDai);
        await matic.mint(manager.address, amountMatic);
        await dai.mint(manager.address, amountDai);
        await degen.mint(manager.address, amountDai);
        await whitelist.deployed();
        await whitelist.addTokenToList(matic.address);
        await whitelist.addTokenToList(dai.address);

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
        };



        return {
            controllerFactory,
            pool,
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
            kassandraAumFee
        };
    }

    it("should have set correct addresses from constructor", async () => {
        const { controllerFactory, managedPoolFactory, kassandraRules, assetManager, authorizedManagers, kassandraAumFee } = await loadFixture(deployFactory);
        expect(await controllerFactory.managedPoolFactory()).equal(managedPoolFactory.address);
        expect(await controllerFactory.kassandraRules()).equal(kassandraRules.address);
        expect(await controllerFactory.assetManager()).equal(assetManager.address);
        expect(await controllerFactory.authorizedManagers()).equal(authorizedManagers.address);
        expect(await controllerFactory.kassandraAumFeePercentage()).equal(kassandraAumFee);
    })

    it("should revert if manager is not allowed to create pools", async () => {
        const { controllerFactory, pool } = await loadFixture(deployFactory);
        await expect(controllerFactory.create(
            pool.name,
            pool.symbol,
            pool.isPrivatePool,
            pool.whitelist,
            pool.maxAmountsIn,
            pool.settingsParams,
            pool.feesSettings,
        )).to.be.revertedWith("BAL#401");
    })

    it("should revert if amounts and tokens lists are incompatible", async () => {
        const { controllerFactory, pool, manager } = await loadFixture(deployFactory);
        await expect(controllerFactory.connect(manager).create(
            pool.name,
            pool.symbol,
            pool.isPrivatePool,
            pool.whitelist,
            [...pool.maxAmountsIn, 1],
            pool.settingsParams,
            pool.feesSettings,
        )).to.be.revertedWith("BAL#103");
        await expect(controllerFactory.connect(manager).create(
            pool.name,
            pool.symbol,
            pool.isPrivatePool,
            pool.whitelist,
            [pool.maxAmountsIn[0]],
            pool.settingsParams,
            pool.feesSettings,
        )).to.be.revertedWith("BAL#103");
    })

    it("should revert if token is not whitelisted", async () => {
        const { controllerFactory, pool, manager, matic, degen } = await loadFixture(deployFactory);
        await expect(controllerFactory.connect(manager).create(
            pool.name,
            pool.symbol,
            pool.isPrivatePool,
            pool.whitelist,
            pool.maxAmountsIn,
            {
                ...pool.settingsParams,
                tokens: [degen.address, matic.address],
            },
            pool.feesSettings,
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
            pool.name,
            pool.symbol,
            pool.isPrivatePool,
            pool.whitelist,
            pool.maxAmountsIn,
            pool.settingsParams,
            pool.feesSettings,
        );

        const eventName = "KassandraPoolCreated";
        // event was emitted
        await expect(tx).emit(controllerFactory, eventName);

        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [ , managedPoolAddress, controllerAddress ] = (event?.args || [ , ethers.constants.AddressZero, ethers.constants.AddressZero]) as string[]
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

    it("should create a private pool and controller", async () => {
        const { controllerFactory, pool, manager } = await loadFixture(deployFactory);
        const tx = await controllerFactory.connect(manager).create(
            pool.name,
            pool.symbol,
            true,
            pool.whitelist,
            pool.maxAmountsIn,
            pool.settingsParams,
            pool.feesSettings,
        );

        const eventName = "KassandraPoolCreated";
        const receipt = await tx.wait();
        const event = receipt.events?.find(event => event.event === eventName);
        const [ , , controllerAddress ] = (event?.args || [ , , ethers.constants.AddressZero]) as string[]
        const ManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        const managedPoolController = ManagedPoolController.attach(controllerAddress);
        expect(await managedPoolController.isPrivatePool()).true;
    })
})
