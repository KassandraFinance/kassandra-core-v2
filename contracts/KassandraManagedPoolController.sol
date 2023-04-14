// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@openzeppelin/contracts/proxy/Proxy.sol";

import "./interfaces/IKacyAssetManager.sol";
import "./interfaces/IKassandraRules.sol";
import "./interfaces/IWhitelist.sol";
import "./interfaces/IPrivateInvestors.sol";

import "./BasePoolController.sol";

/**
 * @dev Pool controller that serves as the "owner" of a Managed pool, and is in turn owned by
 * an account empowered to make calls on this contract, which are forwarded to the underlying pool.
 *
 * This contract can place limits on whether and how these calls can be made. For instance,
 * imposing a minimum gradual weight change duration.
 *
 * While Balancer pool owners are immutable, ownership of this pool controller can be transferable,
 * if the corresponding permission is set.
 */
contract KassandraManagedPoolController is BasePoolController, Proxy {
    using SafeERC20 for IERC20;
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using FixedPoint for uint64;

    uint256 internal constant _MAX_INVEST_FEES = 95 * 10 ** 16;

    struct FeesPercentages {
        uint64 feesToManager;
        uint64 feesToReferral;
    }

    /// @dev address allowed to manage the assets
    address private _strategist;
    // The minimum weight change duration could be replaced with more sophisticated rate-limiting.
    IKassandraRules public kassandraRules;
    IWhitelist private _whitelist;
    address private _assetManager;
    IVault private _vault;
    IPrivateInvestors private _privateInvestors;
    FeesPercentages private _feesPercentages;
    bool private _isPrivatePool;
    uint256 private _kassandraAumFee;

    event JoinFeesUpdate(uint256 feesToManager, uint256 feesToReferral);
    event StrategistChanged(address previousStrategist, address newStrategist);
    event PoolMadePublic();

    /**
     * @dev Pass in the `BasePoolRights` and `ManagedPoolRights` structures, to form the complete set of
     * immutable rights. Then pass any parameters related to restrictions on those rights. For instance,
     * a minimum duration if changing weights is enabled.
     */
    constructor(
        BasePoolRights memory baseRights,
        address kassandraRulesContract,
        address manager,
        IPrivateInvestors privateInvestors,
        bool isPrivatePool,
        IVault vault,
        address assetManager,
        IWhitelist whitelist,
        uint256 kassandraAumFee
    ) BasePoolController(encodePermissions(baseRights), manager) {
        _strategist = manager;
        kassandraRules = IKassandraRules(kassandraRulesContract);
        _privateInvestors = privateInvestors;
        _isPrivatePool = isPrivatePool;
        _vault = vault;
        _assetManager = assetManager;
        _whitelist = whitelist;
        _kassandraAumFee = kassandraAumFee;
    }

    function initialize(address poolAddress, address proxyInvest, FeesPercentages memory feesPercentages) public {
        super.initialize(poolAddress);

        _setJoinFees(feesPercentages);
        IManagedPool(pool).setMustAllowlistLPs(true);
        IManagedPool(pool).addAllowedAddress(proxyInvest);
    }

    /**
     * @dev Getter for the fees paid when joining the pool.
     */
    function getJoinFees() external view returns (uint64 feesToManager, uint64 feesToReferral) {
        return (_feesPercentages.feesToManager, _feesPercentages.feesToReferral);
    }

    /**
     * @dev Getter for the fee paid when swapping in the pool.
     */
    function getSwapFeePercentage() external view returns (uint256) {
        return IManagedPool(pool).getSwapFeePercentage();
    }

    /**
     * @dev Getter for the fee paid when swapping in the pool.
     */
    function getManagementAumFeeParams() external view
        returns (uint256 aumFeePercentage, uint256 lastCollectionTimestamp)
    {
        return IManagedPool(pool).getManagementAumFeeParams();
    }

    /**
     * @dev The Kassandra controller is partially a beacon proxy
     */
    function _implementation() internal view override returns (address) {
        return kassandraRules.controllerExtender();
    }

    /**
     * @dev Getter for whether that's a private pool
     */
    function isPrivatePool() external view returns (bool) {
        return _isPrivatePool;
    }

    /**
     * @dev Getter for the canChangeWeights permission.
     */
    function canChangeWeights() public pure returns (bool) {
        return true;
    }

    /**
     * @dev Getter for the canDisableSwaps permission.
     */
    function canDisableSwaps() public pure returns (bool) {
        return false;
    }

    /**
     * @dev Getter for the mustAllowlistLPs permission.
     */
    function canSetMustAllowlistLPs() public pure returns (bool) {
        return false;
    }

    /**
     * @dev Getter for the canChangeTokens permission.
     */
    function canChangeTokens() public pure returns (bool) {
        return true;
    }

    /**
     * @dev Getter for the canChangeManagementFees permission.
     */
    function canChangeManagementFees() public pure returns (bool) {
        return false;
    }

    /**
     * @dev Getter for the canDisableJoinExit permission.
     */
    function canDisableJoinExit() public pure returns (bool) {
        return false;
    }

    /**
     * @dev Getter for the minimum weight change duration.
     */
    function getMinWeightChangeDuration() external view returns (uint256) {
        return kassandraRules.minWeightChangeDuration();
    }

    function getWhitelist() external view returns (IWhitelist) {
        return _whitelist;
    }

    function transferOwnership(address newManager) public override {
        super.transferOwnership(newManager);
        _strategist = newManager;
    }

    /**
     * @dev Update the fees paid for the manager and the broker
     *
     * @param feesPercentages: How much to pay yourself and a referrral in percetage
     */
    function _setJoinFees(FeesPercentages memory feesPercentages) internal {
        _require(
            feesPercentages.feesToManager.add(feesPercentages.feesToReferral) < _MAX_INVEST_FEES,
            Errors.MAX_SWAP_FEE_PERCENTAGE
        );
        _feesPercentages = feesPercentages;
        emit JoinFeesUpdate(feesPercentages.feesToManager, feesPercentages.feesToReferral);
    }

    /**
     * @dev Update the fees paid for the manager and the broker
     *
     * @param feesPercentages: How much to pay yourself and a referrral in percetage
     */
    function setJoinFees(FeesPercentages memory feesPercentages) external onlyManager {
        _setJoinFees(feesPercentages);
    }

    function setPublicPool() external virtual onlyManager withBoundPool {
        _require(_isPrivatePool, Errors.INVALID_OPERATION);
        _isPrivatePool = false;
        emit PoolMadePublic();
    }

    function addAllowedAddresses(address[] calldata members) external virtual onlyManager withBoundPool {
        _privateInvestors.addPrivateInvestors(members);
    }

    function removeAllowedAddresses(address[] calldata members) external virtual onlyManager withBoundPool {
        _privateInvestors.removePrivateInvestors(members);
    }

    function isAllowedAddress(address member) external view virtual returns (bool) {
        return !_isPrivatePool || _privateInvestors.isInvestorAllowed(pool, member);
    }

    function getStrategist() external view returns (address) {
        return _strategist;
    }

    /**
     * @dev Change the address allowed to update assets.
     */
    function setStrategist(address newStrategist) external onlyManager {
        emit StrategistChanged(_strategist, newStrategist);
        _strategist = newStrategist;
    }
}
