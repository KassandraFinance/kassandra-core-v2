import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { defaultAbiCoder } from "ethers/lib/utils";
import { ethers, network } from "hardhat";
import { AuthorizedManagers, BalancerHelperMock, KassandraControlledManagedPoolFactory, KassandraManagedPoolController, KassandraManagedPoolController__factory, KassandraWhitelist, ManagedPool, TokenMock } from "../typechain-types";

describe("KassandraControlledManagedPoolFactory", () => {
    const BALANCER_HELPER_ADDRESS = '0x239e55F427D44C3cc793f49bFB507ebe76638a2b';
    const WMATIC_ADDRESS = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
    const DAI_ADDRESS = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
    const PROTOCOL_FEE_PROVIDER_ADDRESS = "0x42AC0e6FA47385D55Aff070d79eF0079868C48a6";
    const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    let balancerHelper: BalancerHelperMock;
    let controllerManagedFactory: KassandraControlledManagedPoolFactory;
    let authorizedManagers: AuthorizedManagers;
    let controller: KassandraManagedPoolController__factory;
    let whitelist: KassandraWhitelist;
    let owner: SignerWithAddress;
    let investor: SignerWithAddress;
    let referral: SignerWithAddress;
    let manager: SignerWithAddress;
    let maxAmountsIn: BigNumber[];
    let wmatic: TokenMock;
    let dai: TokenMock;

    const managedPoolParams = {
        name: "Polygon Social Index",
        symbol: "PSI",
        assetManagers: [ethers.constants.AddressZero, ethers.constants.AddressZero]
    }

    const settingsParams = {
        tokens: [WMATIC_ADDRESS, DAI_ADDRESS],
        normalizedWeights: [0.5e18.toString(), 0.5e18.toString()],
        swapFeePercentage: 0.005e18,
        swapEnabledOnStart: true,
        mustAllowlistLPs: false,
        managementAumFeePercentage: 0.005e18,
        aumFeeId: 2 // verificar aumFeeId
    }

    const feesSettings = {
        feesToManager: 0.015e18.toString(),
        feesToReferral: 0.015e18.toString()
    }

    let Pool;
    let pool: ManagedPool;
    let newController: KassandraManagedPoolController;
    let poolAddress: string;

    before(async () => {
        Pool = await ethers.getContractFactory("ERC20");
        balancerHelper = await ethers.getContractAt("BalancerHelperMock", BALANCER_HELPER_ADDRESS);

        [owner, referral, manager, investor] = await ethers.getSigners();

        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [VAULT_ADDRESS],
        });
        const signer = await ethers.getSigner(VAULT_ADDRESS);

        const TokenMock = await ethers.getContractFactory('TokenMock', signer);
        dai = TokenMock.attach(DAI_ADDRESS);
        wmatic = TokenMock.attach(WMATIC_ADDRESS);

        await wmatic.connect(signer).transfer(manager.address, ethers.utils.parseEther('10'));
        await dai.connect(signer).transfer(manager.address, ethers.utils.parseEther('8.4'));
        await wmatic.connect(signer).transfer(investor.address, ethers.utils.parseEther('4'));
        await dai.connect(signer).transfer(investor.address, ethers.utils.parseEther('4'));

        maxAmountsIn = [ethers.utils.parseEther('10'), ethers.utils.parseEther('8.4')];

        const PrivateInvestors = await ethers.getContractFactory("PrivateInvestors");
        const privateInvestors = await PrivateInvestors.deploy();
        await privateInvestors.deployed();

        const Whitelist = await ethers.getContractFactory("KassandraWhitelist");
        whitelist = await Whitelist.deploy();
        await whitelist.addTokenToList(WMATIC_ADDRESS);
        

        const KassandraRules = await ethers.getContractFactory("KassandraRules");
        const kassandraRules = await KassandraRules.deploy();

        const AuthorizedManagers = await ethers.getContractFactory("AuthorizedManagers");
        authorizedManagers = await AuthorizedManagers.deploy(ethers.constants.AddressZero);
        await authorizedManagers.deployed();

        const CircuitBreakerLib = await (await ethers.getContractFactory("CircuitBreakerLib")).deploy();
        const ManagedPoolAddRemoveTokenLib = await (await ethers.getContractFactory("ManagedPoolAddRemoveTokenLib")).deploy();

        const ManagedFactory = await ethers.getContractFactory("ManagedPoolFactory", {
            libraries: {
                CircuitBreakerLib: CircuitBreakerLib.address,
                ManagedPoolAddRemoveTokenLib: ManagedPoolAddRemoveTokenLib.address
            }
        });

        const managedFactory = await ManagedFactory.deploy(VAULT_ADDRESS, PROTOCOL_FEE_PROVIDER_ADDRESS, "2", "2", 10, 10);
        await managedFactory.deployed();

        const ControllerManagedFactory = await ethers.getContractFactory("KassandraControlledManagedPoolFactory");
        controllerManagedFactory = await ControllerManagedFactory.deploy(
            managedFactory.address,
            privateInvestors.address,
            authorizedManagers.address,
            VAULT_ADDRESS,
            kassandraRules.address,
            ethers.constants.AddressZero
        );
        await controllerManagedFactory.deployed();

        await authorizedManagers.setFactory(controllerManagedFactory.address);
        await authorizedManagers.setManager(manager.address, 2);
        await privateInvestors.setFactory(controllerManagedFactory.address);

        controller = await ethers.getContractFactory("KassandraManagedPoolController");
        await wmatic.connect(manager).approve(controllerManagedFactory.address, await wmatic.balanceOf(manager.address));
        await dai.connect(manager).approve(controllerManagedFactory.address, await dai.balanceOf(manager.address));
    })

    it("should revert if manager is not allowed to create pools", async () => {
        await expect(controllerManagedFactory.create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            whitelist.address,
            maxAmountsIn,
            true,
        )).to.be.revertedWith("BAL#401");
    })

    it("should revert if amounts and tokens lists are incompatible", async () => {
        await expect(controllerManagedFactory.connect(manager).create(
            managedPoolParams,
            { ...settingsParams, tokens: [...settingsParams.tokens, ethers.constants.AddressZero]},
            feesSettings,
            whitelist.address,
            maxAmountsIn,
            true,
        )).to.be.revertedWith("BAL#103");
    })

    it("should revert if token is not whitelisted", async () => {
        await expect(controllerManagedFactory.connect(manager).create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            whitelist.address,
            maxAmountsIn,
            true,
        )).to.be.revertedWith("BAL#309");
    })

    it("should create pool and controller", async () => {
        await whitelist.addTokenToList(DAI_ADDRESS);
        const response = await controllerManagedFactory.connect(manager).callStatic.create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            whitelist.address,
            maxAmountsIn,
            true
        )

        await controllerManagedFactory.connect(manager).create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            whitelist.address,
            maxAmountsIn,
            true
        )

        pool = await ethers.getContractAt("ManagedPool", response.pool);
        newController = controller.attach(response.poolController);


        await wmatic.connect(investor).approve(newController.address, ethers.utils.parseEther("100"));
        await dai.connect(investor).approve(newController.address, ethers.utils.parseEther("100"));

        expect(response.pool).to.be.equals(await newController.pool());
        expect(await newController.isPrivatePool()).to.true;
        expect(await newController.getManager()).to.equal(manager.address);
    })

    it("should revert if investor not allowed in a private pool", async () => {
        const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
        const amounts = [ethers.utils.parseEther("2"), ethers.BigNumber.from("0")];
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, 0]);
        const request = {
            assets: [pool.address, ...settingsParams.tokens],
            maxAmountsIn: [0, ...amounts],
            userData,
            fromInternalBalance: false
        }

        await expect(newController.connect(investor).joinPool(investor.address, referral.address, request)).revertedWith("BAL#401");
    })

    it("should be able to join in the pool with join kind EXACT_TOKENS_IN_FOR_BPT_OUT", async () => {
        await newController.connect(manager).addAllowedAddress(investor.address);
        const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
        const poolId = await pool.getPoolId();
        const initBalanceManager = await pool.balanceOf(manager.address);
        const initBalanceReferral = await pool.balanceOf(referral.address);

        const amounts = [ethers.utils.parseEther("2"), ethers.BigNumber.from("0")];
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, 0]);
        const request = {
            assets: [pool.address, ...settingsParams.tokens],
            maxAmountsIn: [0, ...amounts],
            userData,
            fromInternalBalance: false
        }
        const response = await balancerHelper.callStatic.queryJoin(poolId, newController.address, newController.address, request);
        const res = await newController.connect(investor).callStatic.joinPool(investor.address, referral.address, request);
        request.userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, res.amountToRecipient]);
        await newController.connect(investor).joinPool(investor.address, referral.address, request);

        const fees = await newController.getJoinFees();
        const amountOut = response.bptOut;
        const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
        const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
        const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));

        const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
        const balanceReferral = (await pool.balanceOf(referral.address)).sub(initBalanceReferral);

        expect((await pool.balanceOf(investor.address)).gte(amountToInvestor)).to.true;
        expect(balanceManager.gte(amountToManager)).to.true;
        expect(balanceReferral.gte(amountToReferral)).to.true;
    })

    it("should be able to join in the pool with join kind TOKEN_IN_FOR_EXACT_BPT_OUT", async () => {
        const TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
        const amountToInvestor = ethers.BigNumber.from("17000000000");
        const poolId = await pool.getPoolId();
        const initialBalanceInvestor = await pool.balanceOf(investor.address);
        const initBalanceManager = await pool.balanceOf(manager.address);
        const initBalanceReferral = await pool.balanceOf(referral.address);
        const amounts = [ethers.utils.parseEther("0"), ethers.utils.parseEther("2")];
        const userData = defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [TOKEN_IN_FOR_EXACT_BPT_OUT, amountToInvestor, 1]);
        const request = {
            assets: [pool.address, ...settingsParams.tokens],
            maxAmountsIn: [0, ...amounts],
            userData,
            fromInternalBalance: false
        }
        const queryToController = await newController.connect(investor).callStatic.joinPool(investor.address, referral.address, request);
        const totalAmountOut = queryToController.amountToManager.add(queryToController.amountToRecipient).add(queryToController.amountToReferrer);

        await newController.connect(investor).joinPool(investor.address, referral.address, request);

        const fees = await newController.getJoinFees();
        const amountToManager = totalAmountOut.mul(fees.feesToManager).div(1e18.toString());
        const amountToReferral = totalAmountOut.mul(fees.feesToReferral).div(1e18.toString());

        const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
        const balanceReferral = (await pool.balanceOf(referral.address)).sub(initBalanceReferral);
        const amountInvestor = (await pool.balanceOf(investor.address)).sub(initialBalanceInvestor);

        expect(amountInvestor.eq(amountToInvestor)).to.true;
        expect(balanceManager.eq(amountToManager)).to.true;
        expect(balanceReferral.eq(amountToReferral)).to.true;
    })

    it("should be able to join in the pool with join kind ALL_TOKENS_IN_FOR_EXACT_BPT_OUT", async () => {
        const ALL_TOKENS_IN_FOR_EXACT_BPT_OUT = 3;
        const poolId = await pool.getPoolId();
        const amountToInvestor = ethers.BigNumber.from("170000000000000");
        const initialBalanceInvestor = await pool.balanceOf(investor.address);
        const initialBalanceReferrer = await pool.balanceOf(referral.address);
        const initialBalanceManager = await pool.balanceOf(manager.address);
        const initialBalanceInvestorWMATIC = await wmatic.balanceOf(investor.address);
        const initialBalanceInvestorDAI = await dai.balanceOf(investor.address);

        const userData = defaultAbiCoder.encode(['uint256', 'uint256'], [ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, amountToInvestor]);
        const amounts = [ethers.utils.parseEther("1"), ethers.utils.parseEther("1")];
        const request = {
            assets: [pool.address, ...settingsParams.tokens],
            maxAmountsIn: [0, ...amounts],
            userData,
            fromInternalBalance: false
        }
        const responsequery = await newController.connect(investor).callStatic.joinPool(investor.address, referral.address, request);

        await newController.connect(investor).joinPool(investor.address, referral.address, request);

        expect((await pool.balanceOf(investor.address)).sub(initialBalanceInvestor).eq(amountToInvestor)).to.true;
        expect((await pool.balanceOf(referral.address)).sub(initialBalanceReferrer).eq(responsequery.amountToReferrer)).to.true;
        expect((await pool.balanceOf(manager.address)).sub(initialBalanceManager).eq(responsequery.amountToManager)).to.true;

        expect(initialBalanceInvestorWMATIC.sub(await wmatic.balanceOf(investor.address)).lte(responsequery.amountsIn[1])).to.true;
        expect(initialBalanceInvestorDAI.sub(await dai.balanceOf(investor.address)).lte(responsequery.amountsIn[2])).to.true;
    })

    it("should return true if pool is created from Kassandra factory", async () => {
        expect(await controllerManagedFactory.isPoolFromFactory(pool.address)).to.true;
    })
})