import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { AuthorizedManagers } from "../typechain-types";

describe("AuthorizedManagers", () => {
    let authorizedManagers: AuthorizedManagers;
    let owner: SignerWithAddress;
    let manager: SignerWithAddress;
    let manager2: SignerWithAddress;
    let factory: SignerWithAddress;

    before(async () => {
        [owner, manager, manager2, factory] = await ethers.getSigners();

        const AuthorizedManagers = await ethers.getContractFactory("AuthorizedManagers");
        authorizedManagers = await upgrades.deployProxy(AuthorizedManagers, [factory.address]) as AuthorizedManagers;
        await authorizedManagers.deployed();
    })

    it("should revert if caller is not the owner", async () => {
        await expect(authorizedManagers.connect(manager).setManager(manager.address, 10)).to.revertedWith("Ownable: caller is not the owner");
    })

    it("should revert if manager is equal zero address", async () => {
        await expect(authorizedManagers.setManager(ethers.constants.AddressZero, 2)).to.revertedWith("KACY#101");
    })

    it("should set manager", async () => {
        await authorizedManagers.setManager(manager.address, 2);

        expect(await authorizedManagers.canCreatePool(manager.address)).to.true;
    })

    it("should return the amount of pools the manager can create", async () => {
        expect(await authorizedManagers.getAllowedPoolsToCreate(manager.address)).to.equal(2);
    })

    it("should revert if msg.sender is not the Kassandra factory", async () => {
        await expect(authorizedManagers.managerCreatedPool(manager.address)).to.revertedWith("BAL#401");
    })

    it("should update the amount of pools the manager can create", async () => {
        await authorizedManagers.connect(factory).managerCreatedPool(manager.address);
        await authorizedManagers.connect(factory).managerCreatedPool(manager.address);

        expect(await authorizedManagers.canCreatePool(manager.address)).to.false;
    })

    it("should revert if manager is not allowed to create new pools", async () => {
        await expect(authorizedManagers.connect(factory).managerCreatedPool(manager.address)).to.revertedWith("BAL#401");
    })
})