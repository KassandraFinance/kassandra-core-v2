import { time } from "@nomicfoundation/hardhat-network-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai"
import { ethers } from "hardhat"
import { PrivateInvestors, KassandraManagedPoolController, ManagedPoolMock } from "../typechain-types";

describe("KassandraManagedPoolController", () => {
    const BALANCER_HELPER_ADDRESS = '0x239e55F427D44C3cc793f49bFB507ebe76638a2b';
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
        privateInvestors = await PrivateInvestors.deploy();
        await privateInvestors.deployed();
        await privateInvestors.setFactory(owner.address);

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        managedPool = await ManagedPool.deploy();
        await managedPool.deployed();

        const baseRights = {
            canTransferOwnership: true, // sim 
            canChangeSwapFee: true,     // sim
            canUpdateMetadata: true,
        }
        const managedPoolRights = {
            canSetMustAllowlistLPs: true, // sim / com nossa logica // consegue adicionar o endereços 
        }

        const minWeightChangeDuration = time.duration.days(1);
        const KassandraManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        kassandraManagedPoolController = await KassandraManagedPoolController.deploy(
            baseRights,
            { feesToManager: 0.015e18.toString(), feesToReferral: 0.015e18.toString() },
            minWeightChangeDuration,
            manager.address,
            privateInvestors.address,
            false,
            VAULT_ADDRESS,
            BALANCER_HELPER_ADDRESS
            );
            // managedPoolRights,
        await kassandraManagedPoolController.deployed();
        await managedPool.setOwner(kassandraManagedPoolController.address);
        await kassandraManagedPoolController.initialize(managedPool.address);

        await privateInvestors.setController(kassandraManagedPoolController.address);
    })

    describe("Deployment", () => {
        it("should set manager", async () => {
            expect(await kassandraManagedPoolController.getManager()).to.be.equal(manager.address);
        })

        it("should set pool", async () => {
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

        it("should revert if caller is not manager", async () => {
            await expect(kassandraManagedPoolController.setPublicPool()).to.revertedWith("BAL#426");
            await expect(kassandraManagedPoolController.addAllowedAddress(investor.address)).to.revertedWith("BAL#426");
            await expect(kassandraManagedPoolController.removeAllowedAddress(investor.address)).to.revertedWith("BAL#426");
            
        })

        it("should return true if call canChangeWeights", async () => {
            expect(await kassandraManagedPoolController.canChangeWeights()).to.true;
        })

        it("should return false if call canDisableSwaps", async () => {
            expect(await kassandraManagedPoolController.canDisableSwaps()).to.false;
        })

        it("should return throw error if call setSwapEnabled", async () => {
            await expect(kassandraManagedPoolController.connect(manager).setSwapEnabled(true)).to.revertedWith("BAL#344");
        })

        it("should return false if call canSetMustAllowlistLPs", async () => {
            expect(await kassandraManagedPoolController.canSetMustAllowlistLPs()).to.false;
        })

        it("should return false if call canSetCircuitBreakers", async () => {
            expect(await kassandraManagedPoolController.canSetCircuitBreakers()).to.false;
        })

        it("should return true if call canChangeTokens", async () => {
            expect(await kassandraManagedPoolController.canChangeTokens()).to.true;
        })

        it("should return false if call canChangeManagementFees", async () => {
            expect(await kassandraManagedPoolController.canChangeManagementFees()).to.false;
        })

        it("should return throw error if call setManagementAumFeePercentage", async () => {
            await expect(kassandraManagedPoolController.connect(manager).setManagementAumFeePercentage(10)).to.revertedWith("BAL#344");
        })
        
        it("should return false if call canDisableJoinExit", async () => {
            expect(await kassandraManagedPoolController.canDisableJoinExit()).to.false;
        })

        it("should return throw error if call setJoinExitEnabled", async () => {
            await expect(kassandraManagedPoolController.connect(manager).setJoinExitEnabled(true)).to.revertedWith("BAL#344");
        })

        it("should return true if call canTransferOwnership", async () => {
            expect(await kassandraManagedPoolController.canTransferOwnership()).to.true;
        })

        it("should return true if call canChangeSwapFee", async () => {
            expect(await kassandraManagedPoolController.canChangeSwapFee()).to.true;
        })

        it("should return true if call canUpdateMetadata", async () => {
            expect(await kassandraManagedPoolController.canUpdateMetadata()).to.true;
        })

        it("should return false if call isPrivatePool", async () => {
            expect(await kassandraManagedPoolController.isPrivatePool()).to.false;
        })

        it("should return min change duration if call getMinWeightChangeDuration", async () => {
            expect(await kassandraManagedPoolController.getMinWeightChangeDuration()).to.equal(time.duration.days(1));
        })
    })
})