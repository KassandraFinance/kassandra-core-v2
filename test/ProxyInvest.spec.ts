import { ethers, network, upgrades } from 'hardhat';
import { expect } from 'chai';
import { defaultAbiCoder } from '@ethersproject/abi';
import { AuthorizedManagers, BalancerHelperMock, KassandraManagedPoolController, ProxyInvest, TokenMock, ManagedPool, KassandraControlledManagedPoolFactory } from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
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

    const PrivateInvestors = await ethers.getContractFactory("PrivateInvestors");
    const privateInvestors = await upgrades.deployProxy(PrivateInvestors);
    await privateInvestors.deployed();
    const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
    proxyInvest = await upgrades.deployProxy(ProxyInvest, [VAULT_ADDRESS, SWAP_PROVIDER_ADDRESS_V5, privateInvestors.address]) as ProxyInvest;
    await proxyInvest.deployed();

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [VAULT_ADDRESS],
    });

    const signer = await ethers.getSigner(VAULT_ADDRESS);

    helperBalancer = await ethers.getContractAt("BalancerHelperMock", BALANCER_HELPER_ADDRESS) as BalancerHelperMock;

    const TokenMock = await ethers.getContractFactory('TokenMock', signer);
    wmatic = TokenMock.attach(WMATIC_ADDRESS) as TokenMock;
    dai = TokenMock.attach(DAI_ADDRESS) as TokenMock;
    tokenIn = TokenMock.attach(TOKEN_IN_ADDRESS) as TokenMock;

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
    const KCUPE = await ethers.getContractFactory("KassandraControllerUpgradablePoolExtension");
    const kcupe = await KCUPE.deploy();
    const KassandraRules = await ethers.getContractFactory("KassandraRules");
    const kassandraRules = await upgrades.deployProxy(KassandraRules, [kcupe.address, 1, 1, 0]);
    const AuthorizedManagers = await ethers.getContractFactory("AuthorizedManagers");
    const authorizedManagers = await upgrades.deployProxy(AuthorizedManagers) as AuthorizedManagers;
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
    const controllerManagedFactory = await ControllerManagedFactory.deploy(
      managedFactory.address,
      privateInvestors.address,
      authorizedManagers.address,
      VAULT_ADDRESS,
      kassandraRules.address,
      ethers.constants.AddressZero,
      proxyInvest.address
    ) as KassandraControlledManagedPoolFactory;
    await controllerManagedFactory.deployed();
    await authorizedManagers.setFactory(controllerManagedFactory.address);
    await authorizedManagers.setManager(manager.address, 2);
    await privateInvestors.setFactory(controllerManagedFactory.address);
    const maxAmountsIn = [ethers.utils.parseEther('10'), ethers.utils.parseEther('8.4')];
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

    pool = await ethers.getContractAt("ManagedPool", response.pool) as ManagedPool;
    poolController = await ethers.getContractAt("KassandraManagedPoolController", response.poolController) as KassandraManagedPoolController;
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

      const response = await helperBalancer.callStatic.queryJoin(poolId, proxyInvest.address, proxyInvest.address, request);

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
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
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
      const response = await helperBalancer.callStatic.queryJoin(poolId, proxyInvest.address, proxyInvest.address, request);

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
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    })

    it('should join pool with EXACT_BPT_OUT', async () => {
      const amounts = [ethers.BigNumber.from(0), ethers.BigNumber.from(0)];
      const indexTokenIn = 0;
      const joinKind = 2;
      const minBPTOut = ethers.BigNumber.from(1e18.toString());
      const fees = await poolController.getJoinFees();
      const bptAmount = minBPTOut.mul(1e18.toString()).div(
        ethers.BigNumber.from(1e18.toString()).sub(fees.feesToManager).sub(fees.feesToReferral)
      );
      let userData = defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [joinKind, bptAmount, indexTokenIn]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false
      }

      const response = await helperBalancer.callStatic.queryJoin(poolId, proxyInvest.address, proxyInvest.address, request);

      userData = defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [joinKind, minBPTOut, indexTokenIn]);
      request.maxAmountsIn = response.amountsIn;
      request.userData = userData;

      await proxyInvest
        .connect(account)
        .joinPool(account.address, referrer.address, poolController.address, request);

      const amountOut = response.bptOut;
      const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);

      expect((await pool.balanceOf(account.address)).eq(initBalancerInvestor.add(minBPTOut))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).gte(initBalanceMATIC.sub(response.amountsIn[indexTokenIn + 1]))).to.true;
      expect((await dai.balanceOf(account.address)).eq(initBalanceDAI)).to.true;
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    })

    it('should join pool with ALL_TOKENS_IN_FOR_EXACT_BPT_OUT', async () => {
      const amounts = [ethers.BigNumber.from(0), ethers.BigNumber.from(0)];
      const joinKind = 3;
      const minBPTOut = ethers.BigNumber.from(1e18.toString());
      const fees = await poolController.getJoinFees();
      const bptAmount = minBPTOut.mul(1e18.toString()).div(
        ethers.BigNumber.from(1e18.toString()).sub(fees.feesToManager).sub(fees.feesToReferral)
      );
      let userData = defaultAbiCoder.encode(['uint256', 'uint256'], [joinKind, bptAmount]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false
      }
      
      const response = await helperBalancer.callStatic.queryJoin(poolId, proxyInvest.address, proxyInvest.address, request);

      userData = defaultAbiCoder.encode(['uint256', 'uint256'], [joinKind, minBPTOut]);
      request.maxAmountsIn = response.amountsIn;
      request.userData = userData;

      await proxyInvest
        .connect(account)
        .joinPool(account.address, referrer.address, poolController.address, request);

      const amountOut = response.bptOut;
      const amountToManager = amountOut.mul(fees.feesToManager).div(1e18.toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div(1e18.toString());
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);

      expect((await pool.balanceOf(account.address)).eq(initBalancerInvestor.add(minBPTOut))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).gte(initBalanceMATIC.sub(response.amountsIn[1]))).to.true;
      expect((await dai.balanceOf(account.address)).gte(initBalanceDAI.sub(response.amountsIn[2]))).to.true;
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    })

    // url to get data
    // https://api.1inch.io/v5.0/137/swap?fromTokenAddress=0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619&toTokenAddress=0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270&amount=1000000000000000000&fromAddress=0xb602db4ddaa85b2f8495dbA4Fe6a9950178047cA&slippage=1&disableEstimate=true
    it('should join pool with one token using swap provider', async () => {
      const data = "0x12aa3caf000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb0000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f6190000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb00000000000000000000000006816f66538cb5bf17243f6c404d841e0ac96b690000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000047c686183796edaeff0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015800000000000000000000000000000000000000000000013a00010c0000c200a007e5c0d200000000000000000000000000000000000000000000000000009e00004f02a0000000000000000000000000000000000000000000000000000000005ec81107ee63c1e50055caabb0d2b704fd0ef8192a7e35d8837e6782077ceb23fd6bc0add59e62ac25578270cff1b9f61902a0000000000000000000000000000000000000000000000047c686183796edaeffee63c1e500a374094527e1673a86de625aa59517c5de346d322791bca1f2de4661ed88a30c99a7a9449aa8417400a0f2fa6b660d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000048802003c65f90685d000000000000000073a474c76c51d15a80a06c4eca270d500b1d8e8ef31e21c99d1db9a6444d3adf12701111111254eeb25477b68fb85ed929f73a9605820000000000000000cfee7c08";
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
      expect(await pool.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
      expect(await wmatic.balanceOf(account.address)).to.be.equal(initBalanceMATIC);
      expect(await dai.balanceOf(account.address)).to.be.equals(initBalanceDAI);
      expect(await tokenIn.balanceOf(account.address)).to.be.equals(initBalanceTokenIn.sub(sendAmountTokenIn));
      expect(await pool.balanceOf(account.address)).to.be.greaterThanOrEqual(initBalancerInvestor.add(amountToInvestor));
      expect(await pool.balanceOf(manager.address)).to.be.greaterThanOrEqual(balanceManager);
      expect(await pool.balanceOf(referrer.address)).to.be.greaterThanOrEqual(balanceReferral);
    });

    // url to get data
    // https://api.1inch.io/v5.0/137/swap?fromTokenAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&toTokenAddress=0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063&amount=1000000000000000000&fromAddress=0x06816f66538CB5bf17243F6C404D841e0ac96B69&slippage=1&disableEstimate=true
    it('should join pool with native token using swap provider', async () => {
      const data = '0x12aa3caf000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a063000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb00000000000000000000000006816f66538cb5bf17243f6c404d841e0ac96b690000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000107250543ce5b36b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c70000000000000000000000000000000000000000000000000000a900001a40410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf1270eef611894ceae652979c9d0dae1deb597790c6ee6ae40711b8002dc6c0eef611894ceae652979c9d0dae1deb597790c6ee1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000107250543ce5b36b0d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000cfee7c08';
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
            tokenAmountIn: 0,
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
      expect(await pool.balanceOf(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
      expect(await dai.balanceOf(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
      expect(await wmatic.balanceOf(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
      expect(await ethers.provider.getBalance(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
    });
  })
});
