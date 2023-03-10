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
    let kassandra: SignerWithAddress;
    const fees = {
        feesToManager: ethers.utils.parseEther("0.015"),
        feesToReferral: ethers.utils.parseEther("0.01")
    }
    const kassandraAumFee = ethers.BigNumber.from(0.05e18.toString());
    const managerAumFee = ethers.BigNumber.from(0.005e18.toString());
    const totalAumFee = kassandraAumFee.add(managerAumFee);

    before(async () => {
        [owner, manager, investor, kassandra] = await ethers.getSigners();

        const PrivateInvestors = await ethers.getContractFactory("PrivateInvestors");
        privateInvestors = await upgrades.deployProxy(PrivateInvestors) as PrivateInvestors;
        await privateInvestors.deployed();
        await privateInvestors.setFactory(owner.address);

        const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
        managedPool = await ManagedPool.deploy(owner.address, totalAumFee) as ManagedPoolMock;
        await managedPool.deployed();

        const baseRights = {
            canTransferOwnership: true,
            canChangeSwapFee: true,
            canUpdateMetadata: true,
        }

        const minWeightChangeDuration = time.duration.days(1);
        const KassandraRules = await ethers.getContractFactory("KassandraRules");
        const kassandraRules = await upgrades.deployProxy(KassandraRules, [ethers.constants.AddressZero, 1000, minWeightChangeDuration, kassandraAumFee]);

        const Whitelist = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await upgrades.deployProxy(Whitelist);

        const KassandraManagedPoolController = await ethers.getContractFactory("KassandraManagedPoolController");
        kassandraManagedPoolController = await KassandraManagedPoolController.deploy(
            baseRights,
            kassandraRules.address,
            manager.address,
            privateInvestors.address,
            true,
            VAULT_ADDRESS,
            ethers.constants.AddressZero,
            whitelist.address,
            kassandraAumFee
        ) as KassandraManagedPoolController;

        await kassandraManagedPoolController.deployed();

        await managedPool.mint(kassandraManagedPoolController.address, ethers.utils.parseEther('10'));

        const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
        const proxyInvest = await upgrades.deployProxy(ProxyInvest, [VAULT_ADDRESS, ethers.constants.AddressZero, privateInvestors.address])
        await proxyInvest.deployed();
        await managedPool.setOwner(kassandraManagedPoolController.address);
        await kassandraManagedPoolController["initialize(address,address,(uint64,uint64))"](managedPool.address, proxyInvest.address, fees);

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

    describe("Getters", () => {
        it("should revert if caller is not the manager", async () => {
            await expect(kassandraManagedPoolController.setPublicPool()).to.revertedWith("BAL#426");
            await expect(kassandraManagedPoolController.addAllowedAddresses([investor.address])).to.revertedWith("BAL#426");
            await expect(kassandraManagedPoolController.removeAllowedAddresses([investor.address])).to.revertedWith("BAL#426");
        })

        it("should return a timedelta for getMinWeightChangeDuration", async () => {
            expect(await kassandraManagedPoolController.getMinWeightChangeDuration()).to.equal(time.duration.days(1));
        })

        it("should be able to get the join fees", async () => {
            const [ managerFee, referrerFee ] = await kassandraManagedPoolController.getJoinFees();

            expect(managerFee).equal(fees.feesToManager);
            expect(referrerFee).equal(fees.feesToReferral);
        })

        it("should be able to get total aum fee", async () => {
            const { aumFeePercentage } = await kassandraManagedPoolController.getManagementAumFeeParams();

            expect(aumFeePercentage).equal(totalAumFee);
        })
    })

    describe("Private Pool", () => {
        it("should add private investors", async () => {
            await kassandraManagedPoolController.connect(manager).addAllowedAddresses([investor.address]);

            expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.true;
        })

        it("should return true if investor is allowed member", async () => {
            expect(await kassandraManagedPoolController.isAllowedAddress(investor.address)).to.true;
        })

        it("should remove private investors", async () => {
            await kassandraManagedPoolController.connect(manager).removeAllowedAddresses([investor.address]);

            expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.false;
        })

        it("should return false if investor is not allowed member", async () => {
            expect(await kassandraManagedPoolController.isAllowedAddress(investor.address)).to.false;
        })

        it("should start as a private pool", async () => {
            expect(await kassandraManagedPoolController.isPrivatePool()).true;
        })

        it("should make a private pool public", async() => {
            await kassandraManagedPoolController.connect(manager).setPublicPool();
            expect(await kassandraManagedPoolController.isPrivatePool()).false;
        })

        it("should return true on isAllowedAddress if pools is public", async () => {
            expect(await kassandraManagedPoolController.isAllowedAddress(investor.address)).to.true;
        })

        it("should not allow a public pool going private", async() => {
            await expect(kassandraManagedPoolController.connect(manager).setPublicPool()).revertedWith("BAL#435");;
        })
    })
})