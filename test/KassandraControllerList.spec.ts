import { ethers, upgrades } from "hardhat";
import { KassandraControllerList } from "../typechain-types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Wallet } from "ethers";

describe("KassandraControllerList", () => {
    let controllerList: KassandraControllerList;
    let user: SignerWithAddress
    let randomWallet: Wallet

    before(async () => {
        [, user] = await ethers.getSigners();
        randomWallet = Wallet.createRandom();
        const ControllerList = await ethers.getContractFactory("KassandraControllerList");
        controllerList = await upgrades.deployProxy(ControllerList) as KassandraControllerList;
    })

    it("should revert if sender is not allowed to set controller", async () => {
        await expect(controllerList.setController(randomWallet.address)).to.revertedWith("BAL#401")
        await expect(controllerList.connect(user).setController(randomWallet.address)).to.revertedWith("BAL#401")
    })

    it("should revert if sender is not the owner", async () => {
        await expect(controllerList.connect(user).setFactory(randomWallet.address, true)).to.revertedWith("Ownable: caller is not the owner")
        await expect(controllerList.connect(user).setControllers([randomWallet.address])).to.revertedWith("Ownable: caller is not the owner")
    })

    it("should return false if contract is not allowed", async () => {
        let isKassandraController = await controllerList.isKassandraController(user.address);
        expect(isKassandraController).false;
        isKassandraController = await controllerList.isKassandraController(randomWallet.address);
        expect(isKassandraController).false;
    })

    it("should set controllers", async () => {
        await controllerList.setControllers([user.address, randomWallet.address]);
        expect(await controllerList.isKassandraController(user.address)).true;
        expect(await controllerList.isKassandraController(randomWallet.address)).true;
    })

    
    it("should set factory", async () => {
        await controllerList.setFactory(user.address, true);
        await controllerList.connect(user).setController(randomWallet.address)
        expect(await controllerList.isKassandraController(randomWallet.address)).true;
    })
})