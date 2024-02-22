import { ethers, network, upgrades } from 'hardhat';
import { expect } from 'chai';
import { defaultAbiCoder } from '@ethersproject/abi';
import { KassandraControllerList, ProxyInvest } from '../typechain-types';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ParaSwap } from './utils/getDataSwap';

describe('ProxyInvest', () => {
  const VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

  const SWAP_PROVIDER_ADDRESS = '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57';
  const SWAP_TRANSFER_ADDRESS = '0x216B4B4Ba9F3e719726886d34a177484278Bfcae';
  const TOKEN_IN_ADDRESS = '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3';
  const WMATIC_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
  const DAI_ADDRESS = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';

  const settingsParams = {
    tokens: [WMATIC_ADDRESS, DAI_ADDRESS],
    normalizedWeights: [(0.5e18).toString(), (0.5e18).toString()],
    swapFeePercentage: 0.005e18,
    swapEnabledOnStart: true,
    mustAllowlistLPs: false,
    managementAumFeePercentage: 0.005e18,
    aumFeeId: 3,
  };

  const feesSettings = {
    feesToManager: (0.015e18).toString(),
    feesToReferral: (0.015e18).toString(),
  };

  async function deployProxyInvest() {
    const [owner, account, manager, referrer, kassandra] = await ethers.getSigners();

    const withdrawFee = ethers.BigNumber.from((0.005e18).toString());

    const Vault = await ethers.getContractFactory('VaultMock');
    const vault = await Vault.deploy();
    await vault.deployed();
    await vault.mockPoolTokens([ethers.constants.AddressZero, ...settingsParams.tokens]);

    const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
    const proxyInvest = (await upgrades.deployProxy(ProxyInvest, [
      vault.address,
      SWAP_PROVIDER_ADDRESS,
    ])) as ProxyInvest;
    await proxyInvest.deployed();
    await proxyInvest.setProxyTransfer(SWAP_TRANSFER_ADDRESS);
    await proxyInvest.setWETH(WMATIC_ADDRESS);

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [VAULT_ADDRESS],
    });

    const signer = await ethers.getSigner(VAULT_ADDRESS);

    const TokenMock = await ethers.getContractFactory('TokenMock', signer);
    const wmatic = TokenMock.attach(WMATIC_ADDRESS);
    const dai = TokenMock.attach(DAI_ADDRESS);
    const tokenIn = TokenMock.attach(TOKEN_IN_ADDRESS);

    await tokenIn.connect(signer).transfer(account.address, ethers.utils.parseEther('2'));
    await wmatic.connect(signer).transfer(account.address, ethers.utils.parseEther('10'));
    await dai.connect(signer).transfer(account.address, ethers.utils.parseEther('8.4'));

    await dai.connect(signer).transfer(vault.address, ethers.utils.parseEther('2'));
    await wmatic.connect(signer).transfer(vault.address, ethers.utils.parseEther('2'));

    await tokenIn.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await wmatic.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await dai.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);

    const aumFee = ethers.utils.parseEther('0.01');

    const Controller = await ethers.getContractFactory('ControllerMock');
    const controller = await Controller.deploy(manager.address, ethers.constants.AddressZero);
    const Pool = await ethers.getContractFactory('ManagedPoolMock');
    const pool = await Pool.deploy(controller.address, aumFee);

    await controller.setPool(pool.address);
    await controller.setMember(account.address);
    await controller.setFees(feesSettings.feesToManager, feesSettings.feesToReferral);

    const poolId = await pool.getPoolId();
    await vault.mockSavePoolId(poolId);
    const initBalanceManager = await pool.balanceOf(manager.address);
    const initBalanceReferral = await pool.balanceOf(referrer.address);
    const initBalancerInvestor = await pool.balanceOf(account.address);
    const initBalanceMATIC = await wmatic.balanceOf(account.address);
    const initBalanceDAI = await dai.balanceOf(account.address);
    const initBalanceTokenIn = await tokenIn.balanceOf(account.address);

    const ControllerList = await ethers.getContractFactory('KassandraControllerList');
    const controllerList = (await upgrades.deployProxy(ControllerList)) as KassandraControllerList;
    await controllerList.setControllers([controller.address]);
    await proxyInvest.setKassandraControllerList(controllerList.address);
    await proxyInvest.setKassandra(kassandra.address);
    await proxyInvest.setWithdrawFee(withdrawFee);

    return {
      proxyInvest,
      vault,
      owner,
      manager,
      account,
      referrer,
      kassandra,
      poolController: controller,
      pool,
      poolId,
      wmatic,
      dai,
      tokenIn,
      initBalanceManager,
      initBalanceReferral,
      initBalancerInvestor,
      initBalanceMATIC,
      initBalanceDAI,
      initBalanceTokenIn,
      withdrawFee,
      controller,
    };
  }

  describe('Deployment', () => {
    it('should set vault contract', async () => {
      const { proxyInvest, vault } = await loadFixture(deployProxyInvest);

      const vaultAddress = await proxyInvest.getVault();

      expect(vaultAddress).to.equal(vault.address);
    });

    it('should set owner contract', async () => {
      const { proxyInvest, owner } = await loadFixture(deployProxyInvest);

      const ownerContract = await proxyInvest.owner();

      expect(ownerContract).to.equal(owner.address);
    });
  });

  describe('Joins And Exits', () => {
    it('should join pool with one token', async () => {
      const {
        proxyInvest,
        vault,
        pool,
        manager,
        account,
        referrer,
        wmatic,
        dai,
        poolController,
        initBalanceDAI,
        initBalanceMATIC,
        initBalanceManager,
        initBalanceReferral,
        initBalancerInvestor,
      } = await loadFixture(deployProxyInvest);

      const joinKind = 1;
      await vault.mockJoinKind(joinKind);
      await vault.mockPoolAddress(pool.address);
      const amountOut = ethers.BigNumber.from((1e18).toString());
      await vault.mockAmountOut(amountOut);
      const amounts = [ethers.utils.parseEther('2'), ethers.BigNumber.from('0')];
      const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, 0]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false,
      };

      await proxyInvest.connect(account).joinPool(account.address, referrer.address, poolController.address, request);

      const amountToManager = amountOut.mul(feesSettings.feesToManager).div((1e18).toString());
      const amountToReferral = amountOut.mul(feesSettings.feesToReferral).div((1e18).toString());
      const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);
      expect((await pool.balanceOf(account.address)).gte(initBalancerInvestor.add(amountToInvestor))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).eq(initBalanceMATIC.sub(ethers.utils.parseEther('2')))).to.true;
      expect((await dai.balanceOf(account.address)).eq(initBalanceDAI)).to.true;
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    });

    it('should join pool with two tokens', async () => {
      const {
        proxyInvest,
        vault,
        pool,
        manager,
        account,
        referrer,
        wmatic,
        dai,
        poolController,
        initBalanceDAI,
        initBalanceMATIC,
        initBalanceManager,
        initBalanceReferral,
        initBalancerInvestor,
      } = await loadFixture(deployProxyInvest);

      const amounts = [ethers.utils.parseEther('2'), ethers.utils.parseEther('2')];
      const joinKind = 1;
      await vault.mockJoinKind(joinKind);
      await vault.mockPoolAddress(pool.address);
      const amountOut = ethers.BigNumber.from((2e18).toString());
      await vault.mockAmountOut(amountOut);
      const minBPTOut = 0;
      const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, minBPTOut]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false,
      };

      await proxyInvest.connect(account).joinPool(account.address, referrer.address, poolController.address, request);

      const fees = await poolController.getJoinFees();
      const amountToManager = amountOut.mul(fees.feesToManager).div((1e18).toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div((1e18).toString());
      const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);
      expect((await pool.balanceOf(account.address)).gte(initBalancerInvestor.add(amountToInvestor))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).eq(initBalanceMATIC.sub(ethers.utils.parseEther('2')))).to.true;
      expect((await dai.balanceOf(account.address)).eq(initBalanceDAI.sub(ethers.utils.parseEther('2')))).to.true;
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    });

    it('should join pool with EXACT_BPT_OUT', async () => {
      const {
        proxyInvest,
        vault,
        pool,
        manager,
        account,
        referrer,
        wmatic,
        dai,
        poolController,
        initBalanceDAI,
        initBalanceMATIC,
        initBalanceManager,
        initBalanceReferral,
        initBalancerInvestor,
      } = await loadFixture(deployProxyInvest);

      const amounts = [ethers.BigNumber.from((0.5e18).toString()), ethers.BigNumber.from((0e18).toString())];
      const indexTokenIn = 0;
      const joinKind = 2;
      await vault.mockJoinKind(joinKind);
      await vault.mockPoolAddress(pool.address);
      const minBPTOut = ethers.BigNumber.from((1e18).toString());
      const bptAmount = minBPTOut
        .mul((1e18).toString())
        .div(ethers.BigNumber.from((1e18).toString()).sub(feesSettings.feesToManager).sub(feesSettings.feesToReferral));
      await vault.mockAmountOut(bptAmount);

      const userData = defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [joinKind, minBPTOut, indexTokenIn]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false,
      };

      await proxyInvest.connect(account).joinPool(account.address, referrer.address, poolController.address, request);

      const amountToManager = minBPTOut.mul(feesSettings.feesToManager).div((1e18).toString());
      const amountToReferral = minBPTOut.mul(feesSettings.feesToReferral).div((1e18).toString());
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);
      expect((await pool.balanceOf(account.address)).eq(initBalancerInvestor.add(minBPTOut))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect(
        (await wmatic.balanceOf(account.address)).gte(initBalanceMATIC.sub(request.maxAmountsIn[indexTokenIn + 1]))
      ).to.true;
      expect((await dai.balanceOf(account.address)).eq(initBalanceDAI)).to.true;
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    });

    it.skip('should join pool with ALL_TOKENS_IN_FOR_EXACT_BPT_OUT', async () => {
      const {
        proxyInvest,
        vault,
        pool,
        manager,
        account,
        referrer,
        wmatic,
        dai,
        poolController,
        initBalanceDAI,
        initBalanceMATIC,
        initBalanceManager,
        initBalanceReferral,
        initBalancerInvestor,
      } = await loadFixture(deployProxyInvest);

      const amounts = [ethers.BigNumber.from((1e18).toString()), ethers.BigNumber.from((1e18).toString())];
      const joinKind = 3;
      await vault.mockJoinKind(joinKind);
      await vault.mockPoolAddress(pool.address);
      const minBPTOut = ethers.BigNumber.from((1e18).toString());
      const bptAmount = minBPTOut
        .mul((1e18).toString())
        .div(ethers.BigNumber.from((1e18).toString()).sub(feesSettings.feesToManager).sub(feesSettings.feesToReferral));
      await vault.mockAmountOut(bptAmount);

      const userData = defaultAbiCoder.encode(['uint256', 'uint256'], [joinKind, minBPTOut]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        maxAmountsIn: [0, ...amounts],
        userData,
        fromInternalBalance: false,
      };

      await proxyInvest.connect(account).joinPool(account.address, referrer.address, poolController.address, request);

      const amountOut = minBPTOut;
      const amountToManager = amountOut.mul(feesSettings.feesToManager).div((1e18).toString());
      const amountToReferral = amountOut.mul(feesSettings.feesToReferral).div((1e18).toString());
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);
      expect((await pool.balanceOf(account.address)).eq(initBalancerInvestor.add(minBPTOut))).to.true;
      expect(balanceManager.gte(amountToManager)).to.true;
      expect(balanceReferral.gte(amountToReferral)).to.true;
      expect((await wmatic.balanceOf(account.address)).gte(initBalanceMATIC.sub(amounts[0]))).to.true;
      expect((await dai.balanceOf(account.address)).gte(initBalanceDAI.sub(amounts[1]))).to.true;
      expect((await pool.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await wmatic.balanceOf(proxyInvest.address)).eq(0)).true;
      expect((await dai.balanceOf(proxyInvest.address)).eq(0)).true;
    });

    it.skip('should join pool with one token using swap provider', async () => {
      const {
        proxyInvest,
        vault,
        pool,
        manager,
        account,
        referrer,
        wmatic,
        dai,
        tokenIn,
        poolController,
        initBalanceDAI,
        initBalanceMATIC,
        initBalanceManager,
        initBalanceReferral,
        initBalancerInvestor,
        initBalanceTokenIn,
      } = await loadFixture(deployProxyInvest);

      const swapProvider = new ParaSwap();
      const txs = [];
      let minAmountOut = ethers.BigNumber.from(0);
      const sendAmountTokenIn = ethers.utils.parseEther('1');
      const response = await swapProvider.getAmountsOut({
        amount: sendAmountTokenIn.toString(),
        chainId: '137',
        destDecimals: '18',
        destToken: wmatic.address,
        srcDecimals: '18',
        srcToken: tokenIn.address,
      });
      txs.push(response.transactionsDataTx);
      minAmountOut = minAmountOut.add(response.amountsTokenIn);

      const datas = await swapProvider.getDatasTx('137', proxyInvest.address, '1', txs);

      const joinKind = 1;
      await vault.mockJoinKind(joinKind);
      await vault.mockPoolAddress(pool.address);
      const minBPTOut = ethers.utils.parseEther('1');
      const bptAmount = minBPTOut
        .mul((1e18).toString())
        .div(ethers.BigNumber.from((1e18).toString()).sub(feesSettings.feesToManager).sub(feesSettings.feesToReferral));
      await vault.mockAmountOut(bptAmount);

      const res = await proxyInvest.connect(account).callStatic.joinPoolExactTokenInWithSwap(
        {
          recipient: account.address,
          referrer: referrer.address,
          controller: poolController.address,
          tokenIn: tokenIn.address,
          tokenAmountIn: sendAmountTokenIn,
          tokenExchange: WMATIC_ADDRESS,
          minTokenAmountOut: 0,
        },
        datas
      );

      await proxyInvest.connect(account).joinPoolExactTokenInWithSwap(
        {
          recipient: account.address,
          referrer: referrer.address,
          controller: poolController.address,
          tokenIn: tokenIn.address,
          tokenAmountIn: sendAmountTokenIn,
          tokenExchange: WMATIC_ADDRESS,
          minTokenAmountOut: minBPTOut,
        },
        datas
      );

      const fees = await poolController.getJoinFees();
      const amountOut = res.amountToManager.add(res.amountToRecipient).add(res.amountToReferrer);
      const amountToManager = amountOut.mul(fees.feesToManager).div((1e18).toString());
      const amountToReferral = amountOut.mul(fees.feesToReferral).div((1e18).toString());
      const amountToInvestor = amountOut.sub(amountToManager.add(amountToReferral));
      const balanceManager = (await pool.balanceOf(manager.address)).sub(initBalanceManager);
      const balanceReferral = (await pool.balanceOf(referrer.address)).sub(initBalanceReferral);
      expect(await wmatic.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
      expect(await tokenIn.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
      expect(await pool.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
      expect(await wmatic.balanceOf(account.address)).to.be.equal(initBalanceMATIC);
      expect(await dai.balanceOf(account.address)).to.be.equals(initBalanceDAI);
      expect(await tokenIn.balanceOf(account.address)).to.be.equals(initBalanceTokenIn.sub(sendAmountTokenIn));
      expect(await pool.balanceOf(account.address)).to.be.greaterThanOrEqual(
        initBalancerInvestor.add(amountToInvestor)
      );
      expect(await pool.balanceOf(manager.address)).to.be.greaterThanOrEqual(balanceManager);
      expect(await pool.balanceOf(referrer.address)).to.be.greaterThanOrEqual(balanceReferral);
    });

    it.skip('should join pool with native token using swap provider', async () => {
      const {
        proxyInvest,
        vault,
        pool,
        manager,
        account,
        referrer,
        wmatic,
        dai,
        poolController,
        initBalanceDAI,
        initBalanceMATIC,
        initBalanceManager,
        initBalanceReferral,
        initBalancerInvestor,
      } = await loadFixture(deployProxyInvest);

      const swapProvider = new ParaSwap();
      const txs = [];
      let minAmountOut = ethers.BigNumber.from(0);
      const sendAmountTokenIn = '1000000000000000000';
      const res = await swapProvider.getAmountsOut({
        amount: sendAmountTokenIn,
        chainId: '137',
        destDecimals: '18',
        destToken: dai.address,
        srcDecimals: '18',
        srcToken: wmatic.address,
      });
      txs.push(res.transactionsDataTx);
      minAmountOut = minAmountOut.add(res.amountsTokenIn);

      const datas = await swapProvider.getDatasTx('137', proxyInvest.address, '1', txs);

      const initialBalanceNATIVE = await account.getBalance();
      const joinKind = 1;
      await vault.mockJoinKind(joinKind);
      await vault.mockPoolAddress(pool.address);
      const minBPTOut = ethers.utils.parseEther('1');
      const bptAmount = minBPTOut
        .mul((1e18).toString())
        .div(ethers.BigNumber.from((1e18).toString()).sub(feesSettings.feesToManager).sub(feesSettings.feesToReferral));
      await vault.mockAmountOut(bptAmount);

      const response = await proxyInvest.connect(account).callStatic.joinPoolExactTokenInWithSwap(
        {
          recipient: account.address,
          referrer: referrer.address,
          controller: poolController.address,
          tokenIn: wmatic.address,
          tokenAmountIn: sendAmountTokenIn,
          tokenExchange: DAI_ADDRESS,
          minTokenAmountOut: minBPTOut,
        },
        datas,
        { value: sendAmountTokenIn }
      );

      const tx = await proxyInvest.connect(account).joinPoolExactTokenInWithSwap(
        {
          recipient: account.address,
          referrer: referrer.address,
          controller: poolController.address,
          tokenIn: wmatic.address,
          tokenAmountIn: sendAmountTokenIn,
          tokenExchange: DAI_ADDRESS,
          minTokenAmountOut: response.amountToRecipient,
        },
        datas,
        { value: sendAmountTokenIn }
      );

      const receipt = await tx.wait();
      const gasCostForTxn = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      expect((await pool.balanceOf(account.address)).sub(initBalancerInvestor)).to.be.greaterThanOrEqual(
        response.amountToRecipient
      );
      expect((await pool.balanceOf(manager.address)).sub(initBalanceManager)).to.be.greaterThanOrEqual(
        response.amountToManager
      );
      expect((await pool.balanceOf(referrer.address)).sub(initBalanceReferral)).to.be.greaterThanOrEqual(
        response.amountToReferrer
      );
      expect(await wmatic.balanceOf(account.address)).to.be.equal(initBalanceMATIC);
      expect(await dai.balanceOf(account.address)).to.be.equals(initBalanceDAI);
      expect(initialBalanceNATIVE.sub(await account.getBalance())).to.be.equals(
        ethers.BigNumber.from(sendAmountTokenIn).add(gasCostForTxn)
      );
      expect(await pool.balanceOf(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
      expect(await dai.balanceOf(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
      expect(await wmatic.balanceOf(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
      expect(await ethers.provider.getBalance(proxyInvest.address)).to.be.equals(ethers.BigNumber.from(0));
    });

    it('should exit pool and collect withdraw fee', async () => {
      const { proxyInvest, vault, pool, account, tokenIn, poolController, initBalanceTokenIn, withdrawFee, kassandra } =
        await loadFixture(deployProxyInvest);

      const swapProvider = new ParaSwap();

      const amounts = [ethers.utils.parseEther('1'), ethers.utils.parseEther('1')];
      const txs = [];
      let minAmountOut = ethers.BigNumber.from(0);
      for (let i = 0; i < settingsParams.tokens.length; i++) {
        const res = await swapProvider.getAmountsOut({
          amount: amounts[i].toString(),
          chainId: '137',
          destDecimals: '18',
          destToken: tokenIn.address,
          srcDecimals: '18',
          srcToken: settingsParams.tokens[i],
        });
        txs.push(res.transactionsDataTx);
        minAmountOut = minAmountOut.add(res.amountsTokenIn);
      }

      const datas = await swapProvider.getDatasTx('137', proxyInvest.address, '1', txs);

      await vault.mockPoolAddress(pool.address);
      await vault.mockPoolTokensAmountOut([0, ...amounts]);

      const exitKind = 1;
      const bptAmount = ethers.BigNumber.from((1e18).toString());
      const userData = defaultAbiCoder.encode(['uint256', 'uint256'], [exitKind, bptAmount]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        minAmountsOut: [0, ...amounts],
        userData,
        toInternalBalance: false,
      };
      await pool.mint(account.address, bptAmount);
      await (await pool.connect(account).approve(proxyInvest.address, bptAmount)).wait();
      const amountToKassandra = minAmountOut.mul(withdrawFee).div((1e18).toString());
      const minAmountWithoutFee = minAmountOut.sub(amountToKassandra);

      await proxyInvest
        .connect(account)
        .exitPoolExactTokenInWithSwap(
          account.address,
          poolController.address,
          bptAmount,
          tokenIn.address,
          minAmountWithoutFee,
          request,
          datas
        );

      const lastBalance = await tokenIn.balanceOf(account.address);
      const lastBalanceKassandra = await tokenIn.balanceOf(kassandra.address);
      expect(lastBalance.sub(initBalanceTokenIn).gt(0)).to.true;
      expect(lastBalance.sub(initBalanceTokenIn).gte(minAmountWithoutFee)).to.true;
      expect(lastBalanceKassandra.eq(amountToKassandra)).to.true;
    });

    it('should exit pool', async () => {
      const { proxyInvest, vault, pool, account, tokenIn, poolController, initBalanceTokenIn, kassandra, controller } =
        await loadFixture(deployProxyInvest);

      await controller.setIsPrivatePool(true);

      const swapProvider = new ParaSwap();

      const amounts = [ethers.utils.parseEther('1'), ethers.utils.parseEther('1')];
      const txs = [];
      let minAmountOut = ethers.BigNumber.from(0);
      for (let i = 0; i < settingsParams.tokens.length; i++) {
        const res = await swapProvider.getAmountsOut({
          amount: amounts[i].toString(),
          chainId: '137',
          destDecimals: '18',
          destToken: tokenIn.address,
          srcDecimals: '18',
          srcToken: settingsParams.tokens[i],
        });
        txs.push(res.transactionsDataTx);
        minAmountOut = minAmountOut.add(res.amountsTokenIn);
      }

      const datas = await swapProvider.getDatasTx('137', proxyInvest.address, '1', txs);

      await vault.mockPoolAddress(pool.address);
      await vault.mockPoolTokensAmountOut([0, ...amounts]);

      const exitKind = 1;
      const bptAmount = ethers.BigNumber.from((1e18).toString());
      const userData = defaultAbiCoder.encode(['uint256', 'uint256'], [exitKind, bptAmount]);
      const request = {
        assets: [pool.address, ...settingsParams.tokens],
        minAmountsOut: [0, ...amounts],
        userData,
        toInternalBalance: false,
      };
      await pool.mint(account.address, bptAmount);
      await (await pool.connect(account).approve(proxyInvest.address, bptAmount)).wait();

      await proxyInvest
        .connect(account)
        .exitPoolExactTokenInWithSwap(
          account.address,
          poolController.address,
          bptAmount,
          tokenIn.address,
          minAmountOut,
          request,
          datas
        );

      const lastBalance = await tokenIn.balanceOf(account.address);
      const lastBalanceKassandra = await tokenIn.balanceOf(kassandra.address);
      expect(lastBalance.sub(initBalanceTokenIn).gt(0)).to.true;
      expect(lastBalance.sub(initBalanceTokenIn).gte(minAmountOut)).to.true;
      expect(lastBalanceKassandra.eq(0)).to.true;
    });
  });
});
