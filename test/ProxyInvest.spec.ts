import { ethers, network, upgrades } from 'hardhat';
import { expect } from 'chai';
import { defaultAbiCoder } from '@ethersproject/abi';
import { AuthorizedManagers, BalancerHelperMock, KassandraManagedPoolController, ProxyInvest, TokenMock } from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ManagedPool } from '../typechain-types/contracts/managed';
import { BigNumber } from 'ethers';

describe('ProxyInvest', () => {
  const VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  const BALANCER_HELPER_ADDRESS = '0x239e55F427D44C3cc793f49bFB507ebe76638a2b';

  const SWAP_PROVIDER_ADDRESS_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582';
  const TOKEN_IN_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
  const PROTOCOL_FEE_PROVIDER_ADDRESS = "0x42AC0e6FA47385D55Aff070d79eF0079868C48a6";
  const WMATIC_ADDRESS = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270";
  const DAI_ADDRESS = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";

  let proxyInvest: ProxyInvest;
  let owner: SignerWithAddress;
  let account: SignerWithAddress;
  let manager: SignerWithAddress;
  let referrer: SignerWithAddress;
  let helperBalancer: BalancerHelperMock;
  let poolController: KassandraManagedPoolController;
  let wmatic: TokenMock;
  let dai: TokenMock;
  let tokenIn: TokenMock;
  let pool: ManagedPool;

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
    aumFeeId: 3
  }

  const feesSettings = {
    feesToManager: 0.015e18.toString(),
    feesToReferral: 0.015e18.toString()
  }

  before(async () => {
    [owner, account, manager, referrer] = await ethers.getSigners();
    const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
    proxyInvest = await ProxyInvest.deploy(VAULT_ADDRESS, SWAP_PROVIDER_ADDRESS_V5);
    await proxyInvest.deployed();

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [VAULT_ADDRESS],
    });

    const signer = await ethers.getSigner(VAULT_ADDRESS);

    helperBalancer = await ethers.getContractAt("BalancerHelperMock", BALANCER_HELPER_ADDRESS);

    const TokenMock = await ethers.getContractFactory('TokenMock', signer);
    wmatic = TokenMock.attach(WMATIC_ADDRESS);
    dai = TokenMock.attach(DAI_ADDRESS);
    tokenIn = TokenMock.attach(TOKEN_IN_ADDRESS);

    await tokenIn.connect(signer).transfer(account.address, ethers.utils.parseEther('2'));
    await wmatic.connect(signer).transfer(manager.address, ethers.utils.parseEther('10'));
    await dai.connect(signer).transfer(manager.address, ethers.utils.parseEther('8.4'));
    await wmatic.connect(signer).transfer(account.address, ethers.utils.parseEther('10'));
    await dai.connect(signer).transfer(account.address, ethers.utils.parseEther('8.4'));

    await tokenIn.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await wmatic.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await dai.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);

    const Whitelist = await ethers.getContractFactory("KassandraWhitelist");
    const whitelist = await upgrades.deployProxy(Whitelist);
    await whitelist.addTokenToList(WMATIC_ADDRESS);
    await whitelist.addTokenToList(DAI_ADDRESS);
    const KassandraRules = await ethers.getContractFactory("KassandraRules");
    const kassandraRules = await upgrades.deployProxy(KassandraRules, [ethers.constants.AddressZero, 0, 0]);
    const AuthorizedManagers = await ethers.getContractFactory("AuthorizedManagers");
    const authorizedManagers = await upgrades.deployProxy(AuthorizedManagers, [ethers.constants.AddressZero]) as AuthorizedManagers;
    await authorizedManagers.deployed();
    const PrivateInvestors = await ethers.getContractFactory("PrivateInvestors");
    const privateInvestors = await upgrades.deployProxy(PrivateInvestors);
    await privateInvestors.deployed();
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
    const controllerManagedFactory = await ControllerManagedFactory.deploy(
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
    const maxAmountsIn = [ethers.utils.parseEther('10'), ethers.utils.parseEther('8.4')];
    console.log("create controllerr and pool");
    await wmatic.connect(manager).approve(controllerManagedFactory.address, await wmatic.balanceOf(manager.address));
    await dai.connect(manager).approve(controllerManagedFactory.address, await dai.balanceOf(manager.address));
    const response = await controllerManagedFactory.connect(manager).callStatic.create(
      managedPoolParams.name,
      managedPoolParams.symbol,
      false,
      whitelist.address,
      maxAmountsIn,
      settingsParams,
      feesSettings,
    )

    await controllerManagedFactory.connect(manager).create(
      managedPoolParams.name,
      managedPoolParams.symbol,
      false,
      whitelist.address,
      maxAmountsIn,
      settingsParams,
      feesSettings,
    )

    pool = await ethers.getContractAt("ManagedPool", response.pool);
    poolController = await ethers.getContractAt("KassandraManagedPoolController", response.poolController);
    pool.connect(account).approve(proxyInvest.address, ethers.constants.MaxInt256);
  })

  describe('Deployment', () => {
    it('should set vault contract', async () => {
      const vaultAddress = await proxyInvest.getVault();

      expect(vaultAddress).to.equal(VAULT_ADDRESS);
    });

    it('should set owner contract', async () => {
      const ownerContract = await proxyInvest.owner();

      expect(ownerContract).to.equal(owner.address);
    });
  });

  describe("Joins And Exits", () => {
    let poolId: string;
    let initBalanceManager: BigNumber;
    let initBalanceReferral: BigNumber;
    let initBalancerInvestor: BigNumber;
    let initBalanceMATIC: BigNumber;
    let initBalanceDAI: BigNumber;
    let initBalanceTokenIn: BigNumber;

    beforeEach(async () => {
      poolId = await pool.getPoolId();
      initBalanceManager = await pool.balanceOf(manager.address);
      initBalanceReferral = await pool.balanceOf(referrer.address);
      initBalancerInvestor = await pool.balanceOf(account.address);
      initBalanceMATIC = await wmatic.balanceOf(account.address);
      initBalanceDAI = await dai.balanceOf(account.address);
      initBalanceTokenIn = await tokenIn.balanceOf(account.address);
    })

    it('should join pool with one token', async () => {
      const joinKind = 1;
      const amounts = [ethers.utils.parseEther("2"), ethers.BigNumber.from("0")];
      const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, 0]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false
      }
      const response = await helperBalancer.callStatic.queryJoin(poolId, poolController.address, poolController.address, request);

      await proxyInvest
        .connect(account)
        .joinPool(account.address, referrer.address, poolController.address, request);

      const fees = await poolController.getJoinFees();
      const amountOut = response.bptOut;
      const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
      const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);

      expect((await pool.balanceOf(account.address)).gte(initBalancerInvestor.add(amountToInvestor))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).eq(initBalanceMATIC.sub(ethers.utils.parseEther("2")))).to.true;
      expect((await dai.balanceOf(account.address)).eq(initBalanceDAI)).to.true;
    })

    it('should join pool with two tokens', async () => {
      const amounts = [ethers.utils.parseEther("2"), ethers.utils.parseEther("2")];
      const joinKind = 1;
      const minBPTOut = 0;
      const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, minBPTOut]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false
      }
      const response = await helperBalancer.callStatic.queryJoin(poolId, poolController.address, poolController.address, request);

      await proxyInvest
        .connect(account)
        .joinPool(account.address, referrer.address, poolController.address, request);

      const fees = await poolController.getJoinFees();
      const amountOut = response.bptOut;
      const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
      const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);

      expect((await pool.balanceOf(account.address)).gte(initBalancerInvestor.add(amountToInvestor))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).eq(initBalanceMATIC.sub(ethers.utils.parseEther("2")))).to.true;
      expect((await dai.balanceOf(account.address)).eq(initBalanceDAI.sub(ethers.utils.parseEther("2")))).to.true;
    })

    it('should join pool with one token using swap provider', async () => {
      const data = "0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000ec20dcbf0380f1c9856ee345af41f62ee45a95a10000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000056b56b9876de0af764000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002520000000000000000000000000000000000000000000002340002060001bc00a0c9e75c480000000000000000060400000000000000000000000000000000000000000000000000018e0000c200a007e5c0d200000000000000000000000000000000000000000000000000009e00004f02a00000000000000000000000000000000000000000000000000000000023db6a3eee63c1e50045dda9cb7c25131df268515131f647d726f506087ceb23fd6bc0add59e62ac25578270cff1b9f61902a0000000000000000000000000000000000000000000000022aeabce38624c667cee63c1e500a374094527e1673a86de625aa59517c5de346d322791bca1f2de4661ed88a30c99a7a9449aa8417400a0c9e75c480000000000000000240e00000000000000000000000000000000000000000000000000009e00004f02a000000000000000000000000000000000000000000000000e91838a35637a9966ee63c1e50033c4f0043e2e988b3c2e9c77e2c670efe709bfe37ceb23fd6bc0add59e62ac25578270cff1b9f61902a0000000000000000000000000000000000000000000000025753c40091843f782ee63c1e50086f1d8390222a3691c28938ec7404a1661e618e07ceb23fd6bc0add59e62ac25578270cff1b9f61900a0f2fa6b660d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000005795a2fc4459d2303200000000000000009362a6ee112f9d3d80a06c4eca270d500b1d8e8ef31e21c99d1db9a6444d3adf12701111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000cfee7c08";
      const sendAmountTokenIn = ethers.utils.parseEther('1');

      const res = await proxyInvest
        .connect(account).callStatic
        .joinPoolExactTokenInWithSwap(
          {
            recipient: account.address,
            referrer: referrer.address,
            controller: poolController.address,
            tokenIn: tokenIn.address,
            tokenAmountIn: sendAmountTokenIn,
            tokenExchange: WMATIC_ADDRESS,
            minTokenAmountOut: 0
          },
          data
        );

      await proxyInvest
        .connect(account)
        .joinPoolExactTokenInWithSwap(
          {
            recipient: account.address,
            referrer: referrer.address,
            controller: poolController.address,
            tokenIn: tokenIn.address,
            tokenAmountIn: sendAmountTokenIn,
            tokenExchange: WMATIC_ADDRESS,
            minTokenAmountOut: res.amountToRecipient
          },
          data
        );

      const fees = await poolController.getJoinFees();
      const amountOut = res.amountToManager.add(res.amountToRecipient).add(res.amountToReferrer);
      const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
      const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));

      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);

      expect(await wmatic.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
      expect(await tokenIn.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
      expect(await wmatic.balanceOf(account.address)).to.be.equal(initBalanceMATIC);
      expect(await dai.balanceOf(account.address)).to.be.equals(initBalanceDAI);
      expect(await tokenIn.balanceOf(account.address)).to.be.equals(initBalanceTokenIn.sub(sendAmountTokenIn));
      expect(await pool.balanceOf(account.address)).to.be.greaterThanOrEqual(initBalancerInvestor.add(amountToInvestor));
      expect(await pool.balanceOf(manager.address)).to.be.greaterThanOrEqual(balanceManager);
      expect(await pool.balanceOf(referrer.address)).to.be.greaterThanOrEqual(balanceReferral);
    });

    it('should join pool with native token using swap provider', async () => {
      const data = ethers.utils.arrayify('0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000ec20dcbf0380f1c9856ee345af41f62ee45a95a10000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000000ceaa34506e233f4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c70000000000000000000000000000000000000000000000000000a900001a40410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf12708929d3fea77398f64448c85015633c2d6472fb296ae4071138002dc6c08929d3fea77398f64448c85015633c2d6472fb291111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000ceaa34506e233f40d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000cfee7c08')
      const initialBalanceNATIVE = await account.getBalance();
      const sendAmountTokenIn = '1000000000000000000';

      const response = await proxyInvest
        .connect(account).callStatic
        .joinPoolExactTokenInWithSwap(
          {
            recipient: account.address,
            referrer: referrer.address,
            controller: poolController.address,
            tokenIn: tokenIn.address,
            tokenAmountIn: sendAmountTokenIn,
            tokenExchange: DAI_ADDRESS,
            minTokenAmountOut: 0
          },
          data,
          { value: sendAmountTokenIn }
        );

      const tx = await proxyInvest
        .connect(account)
        .joinPoolExactTokenInWithSwap(
          {
            recipient: account.address,
            referrer: referrer.address,
            controller: poolController.address,
            tokenIn: tokenIn.address,
            tokenAmountIn: sendAmountTokenIn,
            tokenExchange: DAI_ADDRESS,
            minTokenAmountOut: response.amountToRecipient
          },
          data,
          { value: sendAmountTokenIn }
        );

      const receipt = await tx.wait();
      const gasCostForTxn = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      expect((await pool.balanceOf(account.address)).sub(initBalancerInvestor)).to.be.greaterThanOrEqual(response.amountToRecipient);
      expect((await pool.balanceOf(manager.address)).sub(initBalanceManager)).to.be.greaterThanOrEqual(response.amountToManager);
      expect((await pool.balanceOf(referrer.address)).sub(initBalanceReferral)).to.be.greaterThanOrEqual(response.amountToReferrer);
      expect(await wmatic.balanceOf(account.address)).to.be.equal(initBalanceMATIC);
      expect(await dai.balanceOf(account.address)).to.be.equals(initBalanceDAI);
      expect(initialBalanceNATIVE.sub(await account.getBalance())).to.be.equals(ethers.BigNumber.from(sendAmountTokenIn).add(gasCostForTxn));
    });
  })
});
