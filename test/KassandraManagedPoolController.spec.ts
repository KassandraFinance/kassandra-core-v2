import { time } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { PrivateInvestors, KassandraManagedPoolController, ManagedPoolMock } from "../typechain-types";

describe("KassandraManagedPoolController", () => {
    const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    let kassandraManagedPoolController: KassandraManagedPoolController;
    let managedPool: ManagedPoolMock;
    let privateInvestors: PrivateInvestors;
    let owner: SignerWithAddress;
    let manager: SignerWithAddress;
    let investor: SignerWithAddress;

    before(async () => {
        [owner, manager, investor] = await ethers.getSigners();

        const PrivateInvestors = await ethers.getContractFactory("PrivateInvestors");
        privateInvestors = await upgrades.deployProxy(PrivateInvestors) as PrivateInvestors;
        await privateInvestors.deployed();
        await privateInvestors.setFactory(owner.address);

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        managedPool = await ManagedPool.deploy(owner.address);
        await managedPool.deployed();

        const baseRights = {
            canTransferOwnership: true,
            canChangeSwapFee: true,
            canUpdateMetadata: true,
        }

        const minWeightChangeDuration = time.duration.days(1);
        const KassandraRules = await ethers.getContractFactory("KassandraRules");
        const kassandraRules = await upgrades.deployProxy(KassandraRules, [ethers.constants.AddressZero, 1000, minWeightChangeDuration]);

        const Whitelist = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await upgrades.deployProxy(Whitelist);

        const KassandraManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        kassandraManagedPoolController = await KassandraManagedPoolController.deploy(
            baseRights,
            { feesToManager: 0.015e18.toString(), feesToReferral: 0.015e18.toString() },
            kassandraRules.address,
            manager.address,
            privateInvestors.address,
            true,
            VAULT_ADDRESS,
            ethers.constants.AddressZero,
            whitelist.address
        );

        await kassandraManagedPoolController.deployed();
        await managedPool.setOwner(kassandraManagedPoolController.address);
        await kassandraManagedPoolController.initialize(managedPool.address);

        await privateInvestors.setController(kassandraManagedPoolController.address);
    })

    describe("Deployment", () => {
        it("should be able to query the correct manager", async () => {
            expect(await kassandraManagedPoolController.getManager()).to.be.equal(manager.address);
        })

        it("should be able to query the controlled pool", async () => {
            expect(await kassandraManagedPoolController.pool()).to.be.equal(managedPool.address);
        })
    })

    describe("Set Allow list LP", () => {
        // to do -> create a private pool and set pool is public
        // it("should set setMustAllowlistLPs", async () => {
        //     const mustAllowlistLPs = true;
        //     await kassandraManagedPoolController.connect(manager).setMustAllowlistLPs(mustAllowlistLPs);

        //     expect(await kassandraManagedPoolController.isPrivatePool()).to.be.equal(mustAllowlistLPs);
        // })

        it("should add private investors", async () => {
            await kassandraManagedPoolController.connect(manager).addAllowedAddress(investor.address);

            expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.true;
        })

        it("should remove private investors", async () => {
            await kassandraManagedPoolController.connect(manager).removeAllowedAddress(investor.address);

            expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.false;
        })

        it("should revert if caller is not the manager", async () => {
            await expect(kassandraManagedPoolController.setPublicPool()).to.revertedWith("BAL#426");
            await expect(kassandraManagedPoolController.addAllowedAddress(investor.address)).to.revertedWith("BAL#426");
            await expect(kassandraManagedPoolController.removeAllowedAddress(investor.address)).to.revertedWith("BAL#426");
        })

        describe("Fixed Permissions", () => {
            it("should return true for canChangeWeights", async () => {
                expect(await kassandraManagedPoolController.canChangeWeights()).to.true;
            })

            it("should return false for canDisableSwaps", async () => {
                expect(await kassandraManagedPoolController.canDisableSwaps()).to.false;
            })

            it("should return false for canSetMustAllowlistLPs", async () => {
                expect(await kassandraManagedPoolController.canSetMustAllowlistLPs()).to.false;
            })

            it("should return false for canSetCircuitBreakers", async () => {
                expect(await kassandraManagedPoolController.canSetCircuitBreakers()).to.false;
            })

            it("should return true for canChangeTokens", async () => {
                expect(await kassandraManagedPoolController.canChangeTokens()).to.true;
            })

            it("should return false for canChangeManagementFees", async () => {
                expect(await kassandraManagedPoolController.canChangeManagementFees()).to.false;
            })

            it("should return false for canDisableJoinExit", async () => {
                expect(await kassandraManagedPoolController.canDisableJoinExit()).to.false;
            })

            it("should return true for canTransferOwnership", async () => {
                expect(await kassandraManagedPoolController.canTransferOwnership()).to.true;
            })

            it("should return true for canChangeSwapFee", async () => {
                expect(await kassandraManagedPoolController.canChangeSwapFee()).to.true;
            })

            it("should return true for canUpdateMetadata", async () => {
                expect(await kassandraManagedPoolController.canUpdateMetadata()).to.true;
            })
        });

        it("should return a timedelta for getMinWeightChangeDuration", async () => {
            expect(await kassandraManagedPoolController.getMinWeightChangeDuration()).to.equal(time.duration.days(1));
        })

        describe("Private Pool", () => {
            it("should start as a private pool", async () => {
                expect(await kassandraManagedPoolController.isPrivatePool()).true;
            })

            it("should make a private pool public", async() => {
                await kassandraManagedPoolController.connect(manager).setPublicPool();
                expect(await kassandraManagedPoolController.isPrivatePool()).false;
            })

            it("should not allow a public pool going private", async() => {
                await expect(kassandraManagedPoolController.connect(manager).setPublicPool()).revertedWith("BAL#435");;
            })
        })
    })
})