import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

describe('PrivateInvestors', () => {
  const POOL_ADDRESS = '0x8ac5fafe2e52e52f5352aec64b64ff8b305e1d4a';

  async function deployPrivateInvestors() {
    const [ownerPrivateInvestor, investor, factory] = await ethers.getSigners();
    const OWNER_ADDRESS = '0xba1ba1ba1ba1ba1ba1ba1ba1ba1ba1ba1ba1ba1b';
    
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [OWNER_ADDRESS],
    });
    const ownerPool = await ethers.getSigner(OWNER_ADDRESS);
    await ownerPrivateInvestor.sendTransaction({to: OWNER_ADDRESS, value: ethers.utils.parseEther("1") });

    const PrivateInvestors = await ethers.getContractFactory('PrivateInvestors');
    const privateInvestors = await PrivateInvestors.deploy();
    
    
    const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
    const managedPool = await ManagedPool.deploy();
    
    const BaseControllerMock = await ethers.getContractFactory("BaseControllerMock");
    const controller = await BaseControllerMock.deploy(managedPool.address);
    const invalidController = await BaseControllerMock.deploy(managedPool.address);
    
    await managedPool.setOwner(controller.address);

    await privateInvestors.setFactory(factory.address);

    return { privateInvestors, investor, ownerPool, factory, controller, invalidController, managedPool };
  }

  it("should revert if call setFactory is not the owner", async () => {
    const { privateInvestors, factory } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.connect(factory).setFactory(factory.address)).to.revertedWith('BAL#426');
  })

  it("should revert if call setController is not authorized", async () => {
    const { privateInvestors, controller } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.setController(controller.address)).to.revertedWith('BAL#401');
  })

  it('should revert with ERR_NOT_AUTHORIZED if controlller is not authorized', async () => {
    const { privateInvestors, investor } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.addPrivateInvestor(investor.address)).to.revertedWith(
      'BAL#401'
    );
  });

  it('should revert with ERR_INVALID_OWNER if controlller is not owner of the pool on addAllowedInvestor', async () => {
    const { privateInvestors, invalidController, investor, factory } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(invalidController.address);

    await expect(invalidController.addAllowedInvestor(investor.address, privateInvestors.address)).to.revertedWith('BAL#426');
  });

  it('should revert with ADDRESS_ALREADY_ALLOWLISTED if investor is already allowed', async () => {
    const { privateInvestors, investor, controller, factory } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);

    await controller.addAllowedInvestor(investor.address, privateInvestors.address);

    await expect(controller.addAllowedInvestor(investor.address, privateInvestors.address)).to.revertedWith(
      'BAL#432'
    );
  });

  it("should add allowed investor if controller is authorized", async () => {
    const { privateInvestors, controller, investor, factory, managedPool } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);

    await controller.addAllowedInvestor(investor.address, privateInvestors.address);
    
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.true;
  })

  it('should revert with ERR_NOT_AUTHORIZED if controlller is not authorized', async () => {
    const { privateInvestors, investor } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.removePrivateInvestor(investor.address)).to.revertedWith(
      'BAL#401'
    );
  });

  it('should revert with ERR_INVALID_OWNER if controlller is not owner of the pool on removeAllowedInvestor', async () => {
    const { privateInvestors, invalidController, investor, factory } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(invalidController.address);

    await expect(invalidController.removeAllowedInvestor(investor.address, privateInvestors.address)).to.revertedWith('BAL#426');
  });

  it('should revert with ADDRESS_NOT_ALLOWLISTED if investor is not listed', async () => {
    const { privateInvestors, investor, controller, factory } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);

    await expect(controller.removeAllowedInvestor(investor.address, privateInvestors.address)).to.revertedWith(
      'BAL#433'
    );
  });

  it("should remove allowed investor if controller is authorized", async () => {
    const { privateInvestors, controller, investor, factory, managedPool } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);
    await controller.addAllowedInvestor(investor.address, privateInvestors.address);

    await controller.removeAllowedInvestor(investor.address, privateInvestors.address);
    
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.false;
  })
});
