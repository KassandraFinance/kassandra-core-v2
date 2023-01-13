import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';

describe("Whitelist", () => {
    const DAI_ADDRESS = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
    const ANY_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const tokens = [
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 
        '0x239e55F427D44C3cc793f49bFB507ebe76638a2b', 
        '0x8aC5FAfE2E52e52f5352Aec64B64FF8B305E1D4A',
        '0x2934b36ca9A4B31E633C5BE670C8C8b28b6aA015',
        '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4',
        '0x1111111254eeb25477b68fb85ed929f73a960582',
        '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'
    ]

    async function WhitelistDeploy() {
        const [owner, account] = await ethers.getSigners();

        const Whitelist = await ethers.getContractFactory("KassandraWhitelist");
        const whitelist = await Whitelist.deploy();
        whitelist.deployed();

        return { whitelist, owner, account };
    }

    it("must not set whitelist if sender is not owner", async () => {
        const { whitelist, account } = await loadFixture(WhitelistDeploy);

        await expect(whitelist.connect(account).addTokenToList(DAI_ADDRESS)).to.revertedWith("BAL#426");
    })

    it("must not set whitelist if token is zero", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);

        await expect(whitelist.addTokenToList(ethers.constants.AddressZero)).to.revertedWith("ERR_ZERO_ADDRESS");
    })

    it("should set whitelist", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        
        await whitelist.addTokenToList(DAI_ADDRESS);
        
        expect(await whitelist.isTokenWhitelisted(DAI_ADDRESS)).true
        expect(await whitelist.getTokens(0, 1)).deep.equal([DAI_ADDRESS]);
    })

    it("should update whitelist", async () => {
        const { whitelist, account } = await loadFixture(WhitelistDeploy);
        await whitelist.addTokenToList(DAI_ADDRESS);
        
        await whitelist.removeTokenFromList(DAI_ADDRESS);
        
        expect(await whitelist.connect(account).isTokenWhitelisted(DAI_ADDRESS)).false
        expect(await whitelist.getTokens(0, 1)).deep.equal([]);
    })


    it("should revert if token already has add", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        await whitelist.addTokenToList(DAI_ADDRESS);
        
        await expect(whitelist.addTokenToList(DAI_ADDRESS)).to.revertedWith("ERR_ALREADY_INCLUDED");
    })

    it("should return false if token has not been defined", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);

        expect(await whitelist.isTokenWhitelisted(ANY_ADDRESS)).false
    })

    it("should return tokens with pagination", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        const skip = 0;
        const take = 5;
        const filterTokens = tokens.filter((_, i) => i < 5);
        await Promise.all(tokens.map(async (address) => {
            return await whitelist.addTokenToList(address);
        }))

        const tokensList = await whitelist.getTokens(skip, take);

        expect(tokensList).deep.equal(filterTokens)
    })

    it("should return tokens with pagination", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        const skip = 2;
        const take = 5;
        const filterTokens = tokens.filter((_, i) => i >= skip && i < take + skip);
        await Promise.all(tokens.map(async (address) => {
            return await whitelist.addTokenToList(address);
        }))

        const tokensList = await whitelist.getTokens(skip, take);

        expect(tokensList).deep.equal(filterTokens)
    })

    it("should returns correct tokens after set one token not allowed", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        const skip = 0;
        const take = 10;
        await Promise.all(tokens.map(async (address) => {
            return await whitelist.addTokenToList(address);
        }))
        await whitelist.removeTokenFromList(tokens[0]);
        const [removedToken, ..._tokens] = tokens;

        const tokensList = await whitelist.getTokens(skip, take);

        expect(tokensList).not.contain(removedToken);
        expect(tokensList.length).to.equal(_tokens.length);
    })

    it("should returns correct tokens after set any token not allowed", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        const skip = 0;
        const take = 10;
        await Promise.all(tokens.map(async (address) => {
            return await whitelist.addTokenToList(address);
        }))
        await whitelist.removeTokenFromList(tokens[0]);
        await whitelist.removeTokenFromList(tokens[3]);
        await whitelist.removeTokenFromList(tokens[tokens.length - 1]);

        const tokensList = await whitelist.getTokens(skip, take);

        expect(tokensList).not.contain(tokens[0]);
        expect(tokensList).not.contain(tokens[3]);
        expect(tokensList).not.contain(tokens[tokens.length - 1]);
        expect(tokensList.length).to.equal(tokens.length - 3);
    })

    it("should revert with ERR_SKIP_OUT_OFF_RANGE if skip is greater than tokens length", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);
        const invalidSkip = 10;
        const take = 10;
        await Promise.all(tokens.map(async (address) => {
            return await whitelist.addTokenToList(address);
        }))
        await whitelist.removeTokenFromList(tokens[0]);
        await whitelist.removeTokenFromList(tokens[3]);
        await whitelist.removeTokenFromList(tokens[tokens.length - 1]);

        expect(await whitelist.getTokens(invalidSkip, take)).to.deep.equal([]);
    })

    it("should retun false is call function isBlacklist", async () => {
        const { whitelist } = await loadFixture(WhitelistDeploy);

        expect(await whitelist.isBlacklist()).to.false;
    })
})