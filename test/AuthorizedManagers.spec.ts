import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { AuthorizedManagers } from "../typechain-types";

describe("CreateAuthorizedManagers", () => {
    let authorizedManagers: AuthorizedManagers;
    let owner: SignerWithAddress;
    let manager: SignerWithAddress;
    let manager2: SignerWithAddress;
    let factory: SignerWithAddress;

    before(async () => {
        [owner, manager, manager2, factory] = await ethers.getSigners();

        const AuthorizedManagers = await ethers.getContractFactory("AuthorizedManagers");
        authorizedManagers = await AuthorizedManagers.deploy(factory.address);
        await authorizedManagers.deployed();
    })

    it("should revert if caller is not owner", async () => {
        await expect(authorizedManagers.connect(manager).setManager(manager.address, 10)).to.revertedWith("BAL#426");
    })

    it("should revert if manager is equal zero address", async () => {
        await expect(authorizedManagers.setManager(ethers.constants.AddressZero, 2)).to.revertedWith("ERR_ZERO_ADDRESS");
    })

    it("should set manager", async () => {
        await authorizedManagers.setManager(manager.address, 2);

        expect(await authorizedManagers.canCreatePool(manager.address)).to.true;
    })

    it("should return amount of pools the manager can create", async () => {
        expect(await authorizedManagers.getAllowedPoolsToCreate(manager.address)).to.equal(2);
    })
    
    it("should revert if msg.sender not is factory", async () => {
        await expect(authorizedManagers.managerCreatedPool(manager.address)).to.revertedWith("ERR_NOT_ALLOWED");
    })

    it("should update manager if update is called", async () => {
        await authorizedManagers.connect(factory).managerCreatedPool(manager.address);
        await authorizedManagers.connect(factory).managerCreatedPool(manager.address);

        expect(await authorizedManagers.canCreatePool(manager.address)).to.false;
    })

    it("should revert if manager not is allowed", async () => {
        await expect(authorizedManagers.connect(factory).managerCreatedPool(manager.address)).to.revertedWith("ERR_NOT_ALLOWED");
    })
})