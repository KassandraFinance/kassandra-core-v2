import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { defaultAbiCoder } from "ethers/lib/utils";
import { ethers, network } from "hardhat";
import { AuthorizedManagers, BalancerHelperMock, KassandraControlledManagedPoolFactory, KassandraManagedPoolController, KassandraManagedPoolController__factory, ManagedPool, TokenMock } from "../typechain-types";

describe("KassandraControlledManagedPoolFactory", () => {
    const MANAGE_POOL_FACTORY_ADDRESS = "0x9Ac3E70dB606659Bf32D4BdFbb687AD193FD1F5B";
    const BALANCER_HELPER_ADDRESS = '0x239e55F427D44C3cc793f49bFB507ebe76638a2b';
    const WMATIC_ADDRESS = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
    const DAI_ADDRESS = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
    const PROTOCOL_FEE_PROVIDER_ADDRESS = "0x42AC0e6FA47385D55Aff070d79eF0079868C48a6";
    const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    let balancerHelper: BalancerHelperMock; 
    let controllerManagedFactory: KassandraControlledManagedPoolFactory;
    let authorizedManagers: AuthorizedManagers;
    let controller: KassandraManagedPoolController__factory;
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
        // const Vault = await ethers.getContractFactory("Vault");
        // vault = await Vault.deploy("0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6", "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", 7776000, 2592000);
        // await vault.deployed();
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
        controllerManagedFactory = await ControllerManagedFactory.deploy(managedFactory.address, privateInvestors.address, authorizedManagers.address, VAULT_ADDRESS, BALANCER_HELPER_ADDRESS);
        await controllerManagedFactory.deployed();

        
        await authorizedManagers.setFactory(controllerManagedFactory.address);
        await authorizedManagers.setManager(manager.address, 2);
        
        
        controller = await ethers.getContractFactory("KassandraManagedPoolController");
        await wmatic.connect(manager).approve(controllerManagedFactory.address, await wmatic.balanceOf(manager.address));
        await dai.connect(manager).approve(controllerManagedFactory.address, await dai.balanceOf(manager.address));      
    })

    it("should be revert if manager not is authorezed", async () => {
        await expect(controllerManagedFactory.create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            maxAmountsIn,
            false,
        )).to.be.revertedWith("BAL#401");
    })

    it("should be create pool and controller if manager already authorized", async () => {
        const response = await controllerManagedFactory.connect(manager).callStatic.create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            maxAmountsIn,
            false
        )
        
        await controllerManagedFactory.connect(manager).create(
            managedPoolParams,
            settingsParams,
            feesSettings,
            maxAmountsIn,
            false
        )

        pool = await ethers.getContractAt("ManagedPool", response.pool);
        newController = controller.attach(response.poolController);
        expect(response.pool).to.be.equals(await newController.pool());
        expect(await newController.isPrivatePool()).to.false;
        expect(await newController.getManager()).to.equal(manager.address);
    })

    it("should be able join in the pool with join kind EXACT_TOKENS_IN_FOR_BPT_OUT", async () => {
        const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
        const poolId = await pool.getPoolId();
        const initBalanceManager = await pool.balanceOf(manager.address);
        const initBalanceReferral = await pool.balanceOf(referral.address);
        await wmatic.connect(investor).approve(newController.address, ethers.utils.parseEther("100"));
        const amounts = [ethers.utils.parseEther("2"), ethers.BigNumber.from("0")];
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, 0]);
        const request = {
            assets: [pool.address, ...settingsParams.tokens],
            maxAmountsIn:[0, ...amounts],
            userData,
            fromInternalBalance: false
        }
        const response = await balancerHelper.callStatic.queryJoin(poolId, newController.address, newController.address, request);
        request.userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, response.bptOut]);
        
        await newController.connect(investor).joinPool(investor.address, referral.address, request);
        
        const fees = await newController.getInvestFees();
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

    it("should be able join in the pool with join kind TOKEN_IN_FOR_EXACT_BPT_OUT", async () => {
        const amountToInvestor = "17000000000";
        const TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
        const poolId = await pool.getPoolId();
        const initialBalanceInvestor = await pool.balanceOf(investor.address);
        const initBalanceManager = await pool.balanceOf(manager.address);
        const initBalanceReferral = await pool.balanceOf(referral.address);
        await dai.connect(investor).approve(newController.address, ethers.utils.parseEther("2"));
        const amounts = [ethers.utils.parseEther("0"), ethers.utils.parseEther("2")];
        const userData = defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [TOKEN_IN_FOR_EXACT_BPT_OUT, amountToInvestor, 1]);
        const request = {
            assets: [pool.address, ...settingsParams.tokens],
            maxAmountsIn:[0, ...amounts],
            userData,
            fromInternalBalance: false
        }
        const response = await balancerHelper.callStatic.queryJoin(poolId, newController.address, newController.address, request);
        await newController.connect(investor).joinPool(investor.address, referral.address, request);
        
        const fees = await newController.getInvestFees();
        const amountOut = response.bptOut;
        const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
        const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
 
        const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
        const balanceReferral = (await pool.balanceOf(referral.address)).sub(initBalanceReferral);

        expect((await pool.balanceOf(investor.address)).sub(initialBalanceInvestor).eq(amountToInvestor)).to.true;
        expect(balanceManager.gte(amountToManager)).to.true;
        expect(balanceReferral.gte(amountToReferral)).to.true;
    })
})