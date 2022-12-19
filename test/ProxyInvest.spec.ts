import { ethers, network } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { defaultAbiCoder } from '@ethersproject/abi';
import { BalancerHelpers, IVault, ProxyInvest, TokenMock } from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('ProxyInvest', () => {
  const VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  const BALANCER_HELPER_ADDRESS = '0x239e55F427D44C3cc793f49bFB507ebe76638a2b';
  const POOL_ADDRESS = '0x8ac5fafe2e52e52f5352aec64b64ff8b305e1d4a';
  const POOL_ID = '0x8ac5fafe2e52e52f5352aec64b64ff8b305e1d4a0002000000000000000007ab';
  const THX_ADDRESS = '0x2934b36ca9a4b31e633c5be670c8c8b28b6aa015';
  const stMATIC_ADDRESS = '0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4';
  const SWAP_PROVIDER_ADDRESS_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582';
  const DAI_ADDRESS = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';

  let proxyInvest: ProxyInvest;
  let owner: SignerWithAddress; 
  let account: SignerWithAddress; 
  let vault: IVault; 
  let helperBalancer: BalancerHelpers;
  let thx: TokenMock; 
  let matic: TokenMock; 
  let dai: TokenMock;
  let pool: TokenMock; 

  before(async () => {
    [owner, account] = await ethers.getSigners();
    const ProxyInvest = await ethers.getContractFactory('ProxyInvest');
    proxyInvest = await ProxyInvest.deploy(VAULT_ADDRESS, SWAP_PROVIDER_ADDRESS_V5);
    await proxyInvest.deployed();

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [VAULT_ADDRESS],
    });

    const signer = await ethers.getSigner(VAULT_ADDRESS);

    vault = await ethers.getContractAt('IVault', VAULT_ADDRESS);
    helperBalancer = await ethers.getContractAt('BalancerHelpers', BALANCER_HELPER_ADDRESS);


    const TokenMock = await ethers.getContractFactory('TokenMock', signer);
    thx = TokenMock.attach(THX_ADDRESS);
    matic = TokenMock.attach(stMATIC_ADDRESS);
    dai = TokenMock.attach(DAI_ADDRESS);
    pool = TokenMock.attach(POOL_ADDRESS);

    await matic.connect(signer).transfer(account.address, ethers.utils.parseEther('2'));
    await thx.connect(signer).transfer(account.address, ethers.utils.parseEther('2'));
    await dai.connect(signer).transfer(account.address, ethers.utils.parseEther('2'));

    await matic.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await thx.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await dai.connect(account).approve(proxyInvest.address, ethers.constants.MaxUint256);
    await pool.connect(account).approve(proxyInvest.address, ethers.constants.MaxInt256);

    console.log("Proxy address ", proxyInvest.address);
  })

  describe('Deployment', () => {
    it('should set vault contract', async () => {
      const vaultAddress = await proxyInvest.vault();

      expect(vaultAddress).to.equal(VAULT_ADDRESS);
    });

    it('should set owner contract', async () => {
      const ownerContract = await proxyInvest.owner();

      expect(ownerContract).to.equal(owner.address);
    });
  });

  describe('Joins And Exits', () => {
    describe('joinPool', () => {
      it('should join pool with one token', async () => {
        const initialBalanceMATIC = await matic.balanceOf(account.address);
        const initialBalanceTHX = await thx.balanceOf(account.address);
        const sendAmountMATIC = ethers.utils.parseEther('0.5');
        const amounts = [0, sendAmountMATIC];
        const assets = [THX_ADDRESS, stMATIC_ADDRESS];
        const joinKind = 1;
        const minBPTOut = 0;
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, minBPTOut]);
        const [bptOutAmount] = await helperBalancer.callStatic.queryJoin(POOL_ID, proxyInvest.address, account.address, {
          assets,
          maxAmountsIn: amounts,
          userData,
          fromInternalBalance: false,
        });

        await proxyInvest
          .connect(account)
          .joinPool(POOL_ID, { assets, maxAmountsIn: amounts, userData, fromInternalBalance: false });

        expect(await pool.balanceOf(account.address)).to.be.equal(bptOutAmount);
        expect(await matic.balanceOf(account.address)).to.be.equal(initialBalanceMATIC.sub(sendAmountMATIC));
        expect(await thx.balanceOf(account.address)).to.be.equals(initialBalanceTHX);
      });

      it('should join pool with two tokens', async () => {
        const initialBalanceMATIC = await matic.balanceOf(account.address);
        const initialBalanceTHX = await thx.balanceOf(account.address);
        const initialBalanceBPT = await pool.balanceOf(account.address);
        const sendAmountMATIC = ethers.utils.parseEther('0.5');
        const sendAmountTHX = ethers.utils.parseEther('0.5');
        const amounts = [sendAmountTHX, sendAmountMATIC];
        const assets = [THX_ADDRESS, stMATIC_ADDRESS];
        const joinKind = 1;
        const minBPTOut = 0;
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, minBPTOut]);
        const [bptOutAmount] = await helperBalancer.callStatic.queryJoin(POOL_ID, proxyInvest.address, account.address, {
          assets,
          maxAmountsIn: amounts,
          userData,
          fromInternalBalance: false,
        });
        const newUserData = defaultAbiCoder.encode(
          ['uint256', 'uint256[]', 'uint256'],
          [joinKind, amounts, bptOutAmount]
        );

        await proxyInvest
          .connect(account)
          .joinPool(POOL_ID, { assets, maxAmountsIn: amounts, userData: newUserData, fromInternalBalance: false });

        expect(await pool.balanceOf(account.address)).to.be.equal(initialBalanceBPT.add(bptOutAmount));
        expect(await matic.balanceOf(account.address)).to.be.equal(initialBalanceMATIC.sub(sendAmountMATIC));
        expect(await thx.balanceOf(account.address)).to.be.equals(initialBalanceTHX.sub(sendAmountTHX));
      });
    });

    describe('joinPoolWithSwap', () => {
      it('should join pool with one tokens using swap provider', async () => {
        const data = ethers.utils.arrayify('0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000002934b36ca9a4b31e633c5be670c8c8b28b6aa015000000000000000000000000538a485de855e9239570aea1def9adbcbb6af1f8000000000000000000000000dcf79230c7954af96f540f7cf7e430afc7b0b595000000000000000000000000000000000000000000000000000000e8d4a510000000000000000000000000000000000000000000000000000000184b058e86b6000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f80000000000000000000000000000000000000000000000000000000000da00a007e5c0d20000000000000000000000000000000000000000000000000000b600005300206ae4071198000f4240538a485de855e9239570aea1def9adbcbb6af1f8000000000000000000000000000000000000000000000000000000002cbee7b98f3cf7ad23cd3cadbd9735aff958023239c6a06300a0fbb7cd0680aebaaa8cdedddb665089551878dddefe2c50660d0001000000000000000003cf7ceb23fd6bc0add59e62ac25578270cff1b9f6192934b36ca9a4b31e633c5be670c8c8b28b6aa0151111111254eeb25477b68fb85ed929f73a9605820000000000000000cfee7c08')
        const initialBalanceMATIC = await matic.balanceOf(account.address);
        const initialBalanceTHX = await thx.balanceOf(account.address);
        const initialBalanceDAI = await dai.balanceOf(account.address);
        const initialBalanceBPT = await pool.balanceOf(account.address);
        const sendAmountMATIC = 0;
        const sendAmountTHX = '26980297818689';
        const sendAmountDAI = '1000000000000';
        const amounts = [sendAmountTHX, sendAmountMATIC];
        const assets = [THX_ADDRESS, stMATIC_ADDRESS];
        const joinKind = 1;
        const minBPTOut = 0;
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, minBPTOut]);
        const [bptOutAmount] = await helperBalancer.callStatic.queryJoin(POOL_ID, proxyInvest.address, account.address, {
          assets,
          maxAmountsIn: amounts,
          userData,
          fromInternalBalance: false,
        });

        await proxyInvest
          .connect(account)
          .joinPoolExactTokenInWithSwap(POOL_ID, DAI_ADDRESS, sendAmountDAI, THX_ADDRESS, bptOutAmount, data);

        expect(await thx.balanceOf(proxyInvest.address)).to.equal(ethers.BigNumber.from(0));
        expect(await pool.balanceOf(account.address)).to.be.greaterThanOrEqual(initialBalanceBPT.add(bptOutAmount));
        expect(await matic.balanceOf(account.address)).to.be.equal(initialBalanceMATIC);
        expect(await thx.balanceOf(account.address)).to.be.equals(initialBalanceTHX);
        expect(await dai.balanceOf(account.address)).to.be.equals(initialBalanceDAI.sub(sendAmountDAI));
      });

      it('should join pool with native token using swap provider', async () => {
        const data = ethers.utils.arrayify('0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000003a58a54c066fdc0f2d55fc9c89f0415c92ebf3c40000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000dcf79230c7954af96f540f7cf7e430afc7b0b595000000000000000000000000000000000000000000000000002386f26fc10000000000000000000000000000000000000000000000000000002145e6bcee5145000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c70000000000000000000000000000000000000000000000000000a900001a40410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf127065752c54d9102bdfd69d351e1838a1be83c924c66ae4071138002dc6c065752c54d9102bdfd69d351e1838a1be83c924c61111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000002145e6bcee51450d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000cfee7c08')
        const initialBalanceMATIC = await matic.balanceOf(account.address);
        const initialBalanceTHX = await thx.balanceOf(account.address);
        
        const initialBalanceNATIVE = await account.getBalance();
        const sendAmountMATIC = '9460132874728539';
        const sendAmountTHX = 0;
        const initialBalanceBPT = await pool.balanceOf(account.address);
        const sendAmountNATIVE = '10000000000000000';
        const amounts = [sendAmountTHX, sendAmountMATIC];
        const assets = [THX_ADDRESS, stMATIC_ADDRESS];
        const joinKind = 1;
        const minBPTOut = 0;
        const userData = defaultAbiCoder.encode(['uint256', 'uint256[]', 'uint256'], [joinKind, amounts, minBPTOut]);
        const [bptOutAmount] = await helperBalancer.callStatic.queryJoin(POOL_ID, proxyInvest.address, account.address, {
          assets,
          maxAmountsIn: amounts,
          userData,
          fromInternalBalance: false,
        });

        const tx = await proxyInvest
          .connect(account)
          .joinPoolExactTokenInWithSwap(
            POOL_ID, 
            ethers.constants.AddressZero, 
            0, 
            stMATIC_ADDRESS, 
            bptOutAmount, 
            data, 
            { value: sendAmountNATIVE }
          );
        const receipt = await tx.wait();
        const gasCostForTxn = receipt.gasUsed.mul(receipt.effectiveGasPrice)

        expect(await pool.balanceOf(account.address)).to.be.greaterThanOrEqual(initialBalanceBPT.add(bptOutAmount));
        expect(await matic.balanceOf(account.address)).to.be.equal(initialBalanceMATIC);
        expect(await thx.balanceOf(account.address)).to.be.equals(initialBalanceTHX);
        expect(await account.getBalance()).to.be.equals(initialBalanceNATIVE.sub(sendAmountNATIVE).sub(gasCostForTxn));
      });

      it('should exit pool with EXACT_BPT_IN_FOR_ONE_TOKEN_OUT', async () => {
        const initialBalanceMATIC = await matic.balanceOf(account.address);
        const initialBalanceTHX = await thx.balanceOf(account.address);
        const initialBalanceBPT = await pool.balanceOf(account.address);

        const sendAmountBPT = (await pool.balanceOf(account.address)).div('2');

        const assets = [THX_ADDRESS, stMATIC_ADDRESS];
        const exitKind = 0;
        const userData = defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [exitKind, sendAmountBPT, 0]);
        const result = await helperBalancer.callStatic.queryExit(POOL_ID, proxyInvest.address, account.address, {
          assets,
          minAmountsOut: [0, 0],
          userData,
          toInternalBalance: false
        });
        const newUserData = defaultAbiCoder.encode(
          ['uint256', 'uint256', 'uint256'],
          [exitKind, sendAmountBPT, 0]
        );
        const request = { assets, minAmountsOut: result.amountsOut, userData: newUserData, toInternalBalance: false }

        await proxyInvest
          .connect(account)
          .exitPoolExactIn(
            POOL_ID, 
            request
          );

        expect(await pool.balanceOf(proxyInvest.address)).to.be.equal(ethers.BigNumber.from(0));
        expect(await pool.balanceOf(account.address)).to.be.equal(initialBalanceBPT.sub(sendAmountBPT));
        expect(await thx.balanceOf(account.address)).to.be.equal(initialBalanceTHX.add(result.amountsOut[0]));
        expect(await matic.balanceOf(account.address)).to.be.equal(initialBalanceMATIC.add(result.amountsOut[1]));
      });

      it('should exit pool with EXACT_BPT_IN_FOR_TOKENS_OUT', async () => {
        const initialBalanceMATIC = await matic.balanceOf(account.address);
        const initialBalanceTHX = await thx.balanceOf(account.address);
        const initialBalanceBPT = await pool.balanceOf(account.address);

        const sendAmountBPT = (await pool.balanceOf(account.address)).div('2');

        const assets = [THX_ADDRESS, stMATIC_ADDRESS];
        const exitKind = 1;
        const userData = defaultAbiCoder.encode(['uint256', 'uint256'], [exitKind, sendAmountBPT]);
        const result = await helperBalancer.callStatic.queryExit(POOL_ID, proxyInvest.address, account.address, {
          assets,
          minAmountsOut: [0, 0],
          userData,
          toInternalBalance: false
        });
        const newUserData = defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [exitKind, sendAmountBPT]
        );
        const request = { assets, minAmountsOut: result.amountsOut, userData: newUserData, toInternalBalance: false }

        await proxyInvest
          .connect(account)
          .exitPoolExactIn(
            POOL_ID, 
            request
          );

        expect(await pool.balanceOf(proxyInvest.address)).to.be.equal(ethers.BigNumber.from(0));
        expect(await pool.balanceOf(account.address)).to.be.equal(initialBalanceBPT.sub(sendAmountBPT));
        expect(await thx.balanceOf(account.address)).to.be.equal(initialBalanceTHX.add(result.amountsOut[0]));
        expect(await matic.balanceOf(account.address)).to.be.equal(initialBalanceMATIC.add(result.amountsOut[1]));
      });
    });
  });
});
