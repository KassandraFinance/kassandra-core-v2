import { ethers } from "hardhat"
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from "chai"

describe("ProxyInvest", () => {
    const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
    const THX_ADDRESS = "0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4"
    const stMATIC_ADDRESS = "0x2934b36ca9a4b31e633c5be670c8c8b28b6aa015"

    const deployProxyInvest = async () => {
        const ProxyInvest = await ethers.getContractFactory("ProxyInvest")
        const proxyInvest = await ProxyInvest.deploy(VAULT_ADDRESS)
        await proxyInvest.deployed()

        return { proxyInvest, VAULT_ADDRESS }
    }

    describe("Deployment", () => {
        it("should set vault contract", async () => {
            const { proxyInvest, VAULT_ADDRESS } = await loadFixture(deployProxyInvest)

            const vaultAddress = await proxyInvest.vault()

            expect(vaultAddress).to.equal(VAULT_ADDRESS)
        })
    })
})