import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers"
import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import {
    KacyAssetManager,
    KassandraManagedPoolController,
    KassandraRules,
    KassandraWhitelist,
    PrivateInvestorsMock,
} from "../typechain-types";

describe("KassandraControllerUpgradablePoolExtension", () => {
    async function deployManagedPoolWithExtension() {
        const [, manager] = await ethers.getSigners();

        const KCUPE = await ethers.getContractFactory("KassandraControllerUpgradablePoolExtension");
        const kcupe = await KCUPE.deploy();

        const KassandraRulesD = await ethers.getContractFactory("KassandraRules");
        const kassandraRules = await upgrades.deployProxy(KassandraRulesD, [
            kcupe.address,
            ethers.utils.parseEther("0.02").div(360),
            time.duration.hours(1),
        ]) as KassandraRules;

        const AssetManagerDeployer = await ethers.getContractFactory("KacyAssetManager");
        const assetManager = await upgrades.deployProxy(AssetManagerDeployer) as KacyAssetManager;

        const PrivateInvestorsDeployer = await ethers.getContractFactory("PrivateInvestorsMock");
        const privateInvestors = await upgrades.deployProxy(PrivateInvestorsDeployer) as PrivateInvestorsMock;

        const KassandraWhitelistDeployer = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await upgrades.deployProxy(KassandraWhitelistDeployer) as KassandraWhitelist;

        const VaultDeployer = await ethers.getContractFactory("VaultMock");
        const vault = await VaultDeployer.deploy();

        const ControllerDeployer = await ethers.getContractFactory("KassandraManagedPoolController");
        const controller = await ControllerDeployer.deploy(
            {
                canTransferOwnership: true,
                canChangeSwapFee: true,
                canUpdateMetadata: true,
            },
            {
                feesToManager: ethers.utils.parseEther("0.015"),
                feesToReferral: ethers.utils.parseEther("0.01"),
            },
            kassandraRules.address,
            manager.address,
            privateInvestors.address,
            true,
            vault.address,
            assetManager.address,
            whitelist.address,
        ) as KassandraManagedPoolController;

        const initialWeights = [
            ethers.utils.parseEther("0.5"),
            ethers.utils.parseEther("0.3"),
            ethers.utils.parseEther("0.2"),
        ];

        const ManagedPoolDeployer = await ethers.getContractFactory("ManagedPoolMock");
        const managedPool = await ManagedPoolDeployer.deploy(controller.address);
        await managedPool.deployed();
        await managedPool.setNormalizedWeights(initialWeights)

        await controller.deployed();
        await controller.initialize(managedPool.address);

        const extendedController = KCUPE.attach(controller.address);

        return { extendedController, manager, kassandraRules, initialWeights };
    }

    /*async function deployManagedPoolWithExtensionAndRealVault() {
        const [, manager] = await ethers.getSigners();

        const KCUPE = await ethers.getContractFactory("KassandraControllerUpgradablePoolExtension");
        const kcupe = await KCUPE.deploy();

        const KassandraRulesD = await ethers.getContractFactory("KassandraRules");
        const kassandraRules = await upgrades.deployProxy(KassandraRulesD, [
            kcupe.address,
            ethers.utils.parseEther("0.02").div(360),
            time.duration.hours(1),
        ]) as KassandraRules;

        const AssetManagerDeployer = await ethers.getContractFactory("KacyAssetManager");
        const assetManager = await upgrades.deployProxy(AssetManagerDeployer) as KacyAssetManager;

        const PrivateInvestorsDeployer = await ethers.getContractFactory("PrivateInvestorsMock");
        const privateInvestors = await upgrades.deployProxy(PrivateInvestorsDeployer) as PrivateInvestorsMock;

        const KassandraWhitelistDeployer = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await upgrades.deployProxy(KassandraWhitelistDeployer) as KassandraWhitelist;

        const MockBasicAuthorizer = await ethers.getContractFactory("MockBasicAuthorizer");
        const basicAuthorizer = await MockBasicAuthorizer.deploy();

        const VaultDeployer = await ethers.getContractFactory("Vault");
        const vault = await VaultDeployer.deploy(basicAuthorizer.address, ethers.constants.AddressZero, 10, 10);

        const ControllerDeployer = await ethers.getContractFactory("KassandraManagedPoolController");
        const controller = await ControllerDeployer.deploy(
            {
                canTransferOwnership: true,
                canChangeSwapFee: true,
                canUpdateMetadata: true,
            },
            {
                feesToManager: ethers.utils.parseEther("0.015"),
                feesToReferral: ethers.utils.parseEther("0.01"),
            },
            kassandraRules.address,
            manager.address,
            privateInvestors.address,
            true,
            vault.address,
            assetManager.address,
            whitelist.address,
        ) as KassandraManagedPoolController;

        const initialWeights = [
            ethers.utils.parseEther("0.5"),
            ethers.utils.parseEther("0.3"),
            ethers.utils.parseEther("0.2"),
        ];

        const TokenDeployer = await ethers.getContractFactory("TokenMock");
        const matic = await TokenDeployer.deploy("Matic", "MATIC");
        const dai = await TokenDeployer.deploy("Dai", "DAI");
        const degen = await TokenDeployer.deploy("Degen", "DGN");

        const ManagedPoolDeployer = await ethers.getContractFactory("ManagedPool");
        const managedPool = await ManagedPoolDeployer.deploy(
            {
                name: "Polygon Social Index",
                symbol: "pHYPE",
                assetManagers: [assetManager.address, assetManager.address, assetManager.address],
            },
            {
                tokens: [matic.address, dai.address, degen.address],
                normalizedWeights: initialWeights,
                swapFeePercentage: ethers.utils.parseEther("0.005"),
                swapEnabledOnStart: true,
                mustAllowlistLPs: true,
                managementAumFeePercentage: ethers.utils.parseEther("0.005"),
                aumFeeId: 3,
            },
            ,
            controller.address,
        );
        await managedPool.deployed();

        await controller.deployed();
        await controller.initialize(managedPool.address);

        const extendedController = KCUPE.attach(controller.address);

        return { extendedController, manager, kassandraRules, initialWeights };
    }*/

    async function deployMockTokens() {
        const TokenDeployer = await ethers.getContractFactory("TokenMock");
        const tokenToAdd = await TokenDeployer.deploy("New Token", "NEW");
        const tokenToRemove = await TokenDeployer.deploy("Old Token", "OLD");
        const tokenFromPool = await TokenDeployer.deploy("Balancer Pool Token", "BPT");

        return { tokenToAdd, tokenToRemove, tokenFromPool };
    }

    describe("Circuit Breaker", () => {
        it("should be disabled for now", async () => {
            const { extendedController } = await loadFixture(deployManagedPoolWithExtension);
            expect(await extendedController.canSetCircuitBreakers()).false;
        })
    })

    /*describe("Modifiers", () => {
        const inheritedFunctions = ["pool", "getManager", "canChangeWeights"];

        it("onlyManager", async () => {
            const { extendedController } = await loadFixture(deployManagedPoolWithExtension);
            const ignoredFunctions = [
                ...inheritedFunctions,
                "canSetCircuitBreakers",
                "joinPool",
                "_joinPoolExactIn",
                "_joinPoolExactOut",
                "_joinPoolAllTokensExactOut"
            ];
            const functions = Object.keys(extendedController.functions).filter(
                functionName => functionName.indexOf("(") < 0 &&
                !ignoredFunctions.includes(functionName)
            );

            functions.forEach(async functionName => {
                extendedController[functionName]()
            });
        })
    });*/

    describe("Token Manipulations", () => {
        it("should fail if end time is smaller than start time", async () => {
            const { extendedController, manager } = await loadFixture(deployManagedPoolWithExtension);
            const nextBlockTime = await time.latest() + 1000;
            await time.setNextBlockTimestamp(nextBlockTime);

            await expect(extendedController.connect(manager).updateWeightsGradually(
                nextBlockTime,
                nextBlockTime - 100,
                [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero],
                [0, 0, 0]
            )).revertedWith("BAL#331");
        })

        it("should fail if duration is smaller than what was set in the rules", async () => {
            const { extendedController, manager, kassandraRules } = await loadFixture(deployManagedPoolWithExtension);
            const minDuration = await kassandraRules.minWeightChangeDuration();
            const nextBlockTime = await time.latest() + 1000;
            await time.setNextBlockTimestamp(nextBlockTime);
            await expect(extendedController.connect(manager).updateWeightsGradually(
                nextBlockTime,
                minDuration.add(nextBlockTime - 1),
                [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero],
                [0, 0, 0]
            )).revertedWith("BAL#331");
        })

        it("should fail if token allocation will increase beyond speed limit", async () => {
            const { extendedController, manager, kassandraRules, initialWeights } = await loadFixture(deployManagedPoolWithExtension);
            const minDuration = await kassandraRules.minWeightChangeDuration();
            const maxSpeed = await kassandraRules.maxWeightChangePerSecond();
            const nextBlockTime = await time.latest() + 1000;
            await time.setNextBlockTimestamp(nextBlockTime);
            const change = minDuration.mul(maxSpeed.add(1));
            await expect(extendedController.connect(manager).updateWeightsGradually(
                nextBlockTime,
                minDuration.add(nextBlockTime),
                [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero],
                [initialWeights[0].sub(change.div(2)), initialWeights[1].sub(change.div(2)), initialWeights[2].add(change)]
            )).revertedWith("BAL#331");
        })

        it("should fail if token allocation will decrease beyond speed limit", async () => {
            const { extendedController, manager, kassandraRules, initialWeights } = await loadFixture(deployManagedPoolWithExtension);
            const minDuration = await kassandraRules.minWeightChangeDuration();
            const maxSpeed = await kassandraRules.maxWeightChangePerSecond();
            const nextBlockTime = await time.latest() + 1000;
            await time.setNextBlockTimestamp(nextBlockTime);
            const change = minDuration.mul(maxSpeed.add(1));
            await expect(extendedController.connect(manager).updateWeightsGradually(
                nextBlockTime,
                minDuration.add(nextBlockTime),
                [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero],
                [initialWeights[0].sub(change), initialWeights[1].add(change.div(2)), initialWeights[2].add(change.div(2))]
            )).revertedWith("BAL#331");
        })

        it("should update weights correctly", async () => {
            const { extendedController, manager, kassandraRules, initialWeights } = await loadFixture(deployManagedPoolWithExtension);
            const minDuration = await kassandraRules.minWeightChangeDuration();
            const maxSpeed = await kassandraRules.maxWeightChangePerSecond();
            const nextBlockTime = await time.latest() + 1000;
            await time.setNextBlockTimestamp(nextBlockTime);
            const change = minDuration.mul(maxSpeed);
            await expect(extendedController.connect(manager).updateWeightsGradually(
                nextBlockTime,
                minDuration.add(nextBlockTime),
                [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero],
                [initialWeights[0].sub(change), initialWeights[1].add(change.div(2)), initialWeights[2].add(change.div(2))]
            )).revertedWith("BAL#331");
        })

        it("should be able to remove a token", async () => {
            const { extendedController, manager, kassandraRules, initialWeights } = await loadFixture(deployManagedPoolWithExtension);
            const { tokenToRemove, tokenFromPool } = await loadFixture(deployMockTokens);
            extendedController.connect(manager).removeToken(tokenToRemove.address, manager.address);
        })
    })

    describe("Joining Pool", () => {
    })
})