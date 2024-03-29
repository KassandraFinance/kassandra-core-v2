import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers, network, upgrades } from 'hardhat';
import { PrivateInvestors } from '../typechain-types';

describe('PrivateInvestors', () => {
  async function deployPrivateInvestors() {
    const [ownerPrivateInvestor, investor, factory, investor2, ...manyInvestors] = await ethers.getSigners();
    const OWNER_ADDRESS = '0xba1ba1ba1ba1ba1ba1ba1ba1ba1ba1ba1ba1ba1b';

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [OWNER_ADDRESS],
    });
    const ownerPool = await ethers.getSigner(OWNER_ADDRESS);
    await ownerPrivateInvestor.sendTransaction({to: OWNER_ADDRESS, value: ethers.utils.parseEther("1") });

    const PrivateInvestors = await ethers.getContractFactory('PrivateInvestors');
    const privateInvestors = await upgrades.deployProxy(PrivateInvestors) as PrivateInvestors;

    const ManagedPool = await ethers.getContractFactory("ManagedPoolMock");
    const managedPool = await ManagedPool.deploy(ownerPrivateInvestor.address, '0');

    const BaseControllerMock = await ethers.getContractFactory("BaseControllerMock");
    const controller = await BaseControllerMock.deploy(managedPool.address);
    const invalidController = await BaseControllerMock.deploy(managedPool.address);

    await managedPool.setOwner(controller.address);

    await privateInvestors.setFactory(factory.address);

    return { privateInvestors, investor, investor2, ownerPool, factory, controller, invalidController, managedPool, manyInvestors };
  }

  it("should not allow running the initializer again", async () => {
    const { privateInvestors } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.initialize()).revertedWith("Initializable: contract is already initialized");
  })

  it("should revert setFactory if caller is not the owner", async () => {
    const { privateInvestors, factory } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.connect(factory).setFactory(factory.address)).to.revertedWith('Ownable: caller is not the owner');
  })

  it("should revert removeFactory if caller is not the owner", async () => {
    const { privateInvestors, factory } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.connect(factory).removeFactory(factory.address)).to.revertedWith('Ownable: caller is not the owner');
  })

  it("should revert setController if caller is not an authorized factory", async () => {
    const { privateInvestors, controller } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.setController(controller.address)).to.revertedWith('BAL#401');
  })

  it('should revert addPrivateInvestors if controller is not authorized', async () => {
    const { privateInvestors, investor } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.addPrivateInvestors([investor.address])).to.revertedWith(
      'BAL#401'
    );
  });

  it('should revert if controller is not the owner of the pool on addAllowedInvestors', async () => {
    const { privateInvestors, invalidController, investor, factory } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(invalidController.address);

    await expect(invalidController.addAllowedInvestors([investor.address], privateInvestors.address)).to.revertedWith('BAL#426');
  });

  it("should add allowed investors if controller is authorized", async () => {
    const { privateInvestors, controller, investor, investor2, factory, managedPool } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);

    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.false;
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor2.address)).to.false;

    await controller.addAllowedInvestors([investor.address, investor2.address], privateInvestors.address);

    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.true;
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor2.address)).to.true;
  })

  it("should list all private investors", async () => {
    const { privateInvestors, controller, factory, managedPool, manyInvestors } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);
    await controller.addAllowedInvestors(manyInvestors.map(investor => investor.address), privateInvestors.address);
    const privateList = await privateInvestors.getInvestors(managedPool.address, 0, 100)

    for (const investor of manyInvestors) {
      expect(privateList).contain(investor.address)
    }
    expect(privateList.length).equal(manyInvestors.length)
  })

  it('should revert removePrivateInvestors if controller is not authorized', async () => {
    const { privateInvestors, investor } = await loadFixture(deployPrivateInvestors);

    await expect(privateInvestors.removePrivateInvestors([investor.address])).to.revertedWith(
      'BAL#401'
    );
  });

  it('should revert if controller is not the owner of the pool on removeAllowedInvestors', async () => {
    const { privateInvestors, invalidController, investor, factory } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(invalidController.address);

    await expect(invalidController.removeAllowedInvestors([investor.address], privateInvestors.address)).to.revertedWith('BAL#426');
  });

  it('should revert when add investor if he is allow listed', async () => {
    const { controller, managedPool, privateInvestors, investor, factory } = await loadFixture(deployPrivateInvestors)
    await privateInvestors.connect(factory).setController(controller.address);

    await controller.addAllowedInvestors([investor.address], privateInvestors.address);
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).true;
  
    await expect(controller.addAllowedInvestors([investor.address], privateInvestors.address)).to.revertedWith('BAL#432')
  })

  it('should revert when remove investor if he is not allow listed', async () => {
    const { controller, managedPool, privateInvestors, investor, factory } = await loadFixture(deployPrivateInvestors)
    await privateInvestors.connect(factory).setController(controller.address);

    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).false;
  
    await expect(controller.removeAllowedInvestors([investor.address], privateInvestors.address)).to.revertedWith('BAL#433')
  })

  it("should remove an allowed investor if controller is authorized", async () => {
    const { privateInvestors, controller, investor, investor2, factory, managedPool } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);
    await controller.addAllowedInvestors([investor.address, investor2.address], privateInvestors.address);

    await controller.removeAllowedInvestors([investor2.address], privateInvestors.address);

    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.true;
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor2.address)).to.false;
  })

  it("should remove many allowed investors if controller is authorized", async () => {
    const { privateInvestors, controller, investor, investor2, factory, managedPool } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);
    await controller.addAllowedInvestors([investor.address, investor2.address], privateInvestors.address);

    await controller.removeAllowedInvestors([investor.address, investor2.address], privateInvestors.address);

    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.false;
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.false;
  })

  it("should list correct private investors after remove", async () => {
    const { privateInvestors, controller, investor, investor2, factory, managedPool, manyInvestors } = await loadFixture(deployPrivateInvestors);
    await privateInvestors.connect(factory).setController(controller.address);
    await controller.addAllowedInvestors([investor.address, ...manyInvestors.map(investor => investor.address), investor2.address], privateInvestors.address);
    
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor.address)).to.true;
    expect(await privateInvestors.isInvestorAllowed(managedPool.address, investor2.address)).to.true; 

    await controller.removeAllowedInvestors([investor.address], privateInvestors.address);
    await controller.removeAllowedInvestors([investor2.address], privateInvestors.address);

    let privateList = await privateInvestors.getInvestors(managedPool.address, 0, 100)


    expect(privateList).not.contains(investor.address)
    expect(privateList).not.contains(investor2.address)
    for (const investor of manyInvestors) {
      expect(privateList).contain(investor.address)
    }
    expect(privateList.length).equal(manyInvestors.length)
  })

  it("should remove a factory", async () => {
    const { privateInvestors, factory } = await loadFixture(deployPrivateInvestors);
    await expect(privateInvestors.removeFactory(factory.address)).not.reverted;
  })

  it("should revert if factory was not added previously", async () => {
    const { privateInvestors, controller } = await loadFixture(deployPrivateInvestors);
    await expect(privateInvestors.removeFactory(controller.address)).revertedWith("BAL#433")
  })
});
