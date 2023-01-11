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
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBalancerQueries.sol";

import "./interfaces/IPrivateInvestors.sol";

import "./BasePoolController.sol";

import "hardhat/console.sol";

/**
 * @dev Pool controller that serves as the "owner" of a Managed pool, and is in turn owned by
 * an account empowered to make calls on this contract, which are forwarded to the underlyling pool.
 *
 * This contract can place limits on whether and how these calls can be made. For instance,
 * imposing a minimum gradual weight change duration.
 *
 * While Balancer pool owners are immutable, ownership of this pool controller can be transferrable,
 * if the corresponding permission is set.
 */
contract KassandraManagedPoolController is BasePoolController {
    using SafeERC20 for IERC20;
    using WordCodec for bytes32;
    using FixedPoint for uint256;

    struct FeesPercentages {
        uint64 feesToManager;
        uint64 feesToReferral;
    }

    // The minimum weight change duration could be replaced with more sophisticated rate-limiting.
    uint256 internal immutable _minWeightChangeDuration;

    IPrivateInvestors private _privateInvestors;
    IVault private _vault;
    IBalancerQueries private _balancerQueries;

    bool private _isPrivatePool;
    FeesPercentages private _feesPercentages;

    /**
     * @dev Pass in the `BasePoolRights` and `ManagedPoolRights` structures, to form the complete set of
     * immutable rights. Then pass any parameters related to restrictions on those rights. For instance,
     * a minimum duration if changing weights is enabled.
     */
    constructor(
        BasePoolRights memory baseRights,
        FeesPercentages memory feesPercentages, 
        uint256 minWeightChangeDuration,
        address manager,
        IPrivateInvestors privateInvestors,
        bool isPrivatePool,
        IVault vault,
        IBalancerQueries balancerQueries
    ) BasePoolController(super.encodePermissions(baseRights), manager) {
        _minWeightChangeDuration = minWeightChangeDuration;
        _privateInvestors = privateInvestors;
        _isPrivatePool = isPrivatePool;
        _vault = vault;
        _feesPercentages = feesPercentages;
        _balancerQueries = balancerQueries;
    }

    function initialize(address poolAddress) public override {
        super.initialize(poolAddress);

        IManagedPool(pool).setMustAllowlistLPs(true);
        IManagedPool(pool).addAllowedAddress(address(this));
    }

    function getInvestFees() external view returns (uint64 feesToManager, uint64 feesToReferral) {
        return (_feesPercentages.feesToManager, _feesPercentages.feesToReferral);
    }

    function joinPool(address recipient, address referrer, IVault.JoinPoolRequest memory request) external {
        uint256 joinKind = abi.decode(request.userData, (uint256));
        bytes32 poolId = IManagedPool(pool).getPoolId();
        if (joinKind == 1) {
            _joinPoolExactIn(poolId, recipient, referrer, request);
        } else if (joinKind == 2) {
            _joinPoolExactOut(poolId, recipient, referrer, request);
        }
    }

    uint256 constant TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
    function _joinPoolExactOut(bytes32 poolId, address recipient, address referrer, IVault.JoinPoolRequest memory request) internal {
        (, uint256 bptAmountToRecipient, uint256 indexToken) = abi.decode(request.userData, (uint256, uint256, uint256));
        uint256 bptAmount = bptAmountToRecipient.divDown(FixedPoint.ONE.sub(_feesPercentages.feesToManager).sub(_feesPercentages.feesToReferral));

        uint256 indexTokenIn = indexToken + 1;
        IERC20 tokenIn = IERC20(address(request.assets[indexTokenIn]));
        if (tokenIn.allowance(address(this), address(_vault)) < type(uint256).max) {
            tokenIn.safeApprove(address(_vault), type(uint256).max);
        }

        tokenIn.safeTransferFrom(msg.sender, address(this), request.maxAmountsIn[indexTokenIn]);

        request.userData = abi.encode(TOKEN_IN_FOR_EXACT_BPT_OUT, bptAmount, indexToken);

        _vault.joinPool(poolId, address(this), address(this), request);

        address _manager = getManager();
        
        if (referrer == address(0)) {
            referrer = _manager;
        }

        uint256 amountToManager = bptAmount.mulDown(_feesPercentages.feesToManager);
        uint256 amountToReferral = bptAmount.mulDown(_feesPercentages.feesToReferral);
        
        IERC20 poolToken = IERC20(pool);
        
        poolToken.safeTransfer(recipient, bptAmountToRecipient);
        poolToken.safeTransfer(_manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferral);
        tokenIn.safeTransfer(recipient, tokenIn.balanceOf(address(this)));
    }
    
    function _joinPoolExactIn(bytes32 poolId, address recipient, address referrer, IVault.JoinPoolRequest memory request) internal {
        for (uint256 i = 1; i < request.assets.length; i++) {
            IERC20 tokenIn = IERC20(address(request.assets[i]));
            if (tokenIn.allowance(address(this), address(_vault)) < request.maxAmountsIn[i]) {
                tokenIn.safeApprove(address(_vault), request.maxAmountsIn[i]);
            }
            tokenIn.safeTransferFrom(msg.sender, address(this), request.maxAmountsIn[i]);
        }

        _vault.joinPool(poolId, address(this), address(this), request);

        uint256 amountOutBPT = IERC20(pool).balanceOf(address(this));
        uint256 amountToManager = amountOutBPT.mulDown(_feesPercentages.feesToManager);
        uint256 amountToReferral = amountOutBPT.mulDown(_feesPercentages.feesToReferral);
        uint256 amountToInvestor = amountOutBPT.sub(amountToManager).sub(amountToReferral);

        address _manager = getManager();
        
        if (referrer == address(0)) {
            referrer = _manager;
        }

        IERC20(pool).safeTransfer(recipient, amountToInvestor);
        IERC20(pool).safeTransfer(_manager, amountToManager);
        IERC20(pool).safeTransfer(referrer, amountToReferral);
    }

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
     * @dev Getter for the canSetCircuitBreakers permission.
     */
    function canSetCircuitBreakers() public pure returns (bool) {
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
        return _minWeightChangeDuration;
    }

    /**
     * @dev Update weights linearly from the current values to the given end weights, between startTime
     * and endTime.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        IERC20[] calldata tokens,
        uint256[] calldata endWeights
    ) external virtual onlyManager withBoundPool {
        _require(canChangeWeights(), Errors.FEATURE_DISABLED);
        _require(
            endTime >= startTime && endTime - startTime >= _minWeightChangeDuration,
            Errors.WEIGHT_CHANGE_TOO_FAST
        );

        IManagedPool(pool).updateWeightsGradually(startTime, endTime, tokens, endWeights);
    }

    /**
     * @dev Pass a call to ManagedPool's setSwapEnabled through to the underlying pool.
     */
    function setSwapEnabled(bool swapEnabled) external virtual onlyManager withBoundPool {
        _require(canDisableSwaps(), Errors.FEATURE_DISABLED);

        IManagedPool(pool).setSwapEnabled(swapEnabled);
    }

    function setPublicPool() external virtual onlyManager withBoundPool {
        _require(_isPrivatePool, Errors.INVALID_OPERATION);
        _isPrivatePool = false;
    }

    function addAllowedAddress(address member) external virtual onlyManager withBoundPool {
        _privateInvestors.addPrivateInvestor(member);
    }

    function removeAllowedAddress(address member) external virtual onlyManager withBoundPool {
        _privateInvestors.removePrivateInvestor(member);
    }

    /**
     * @dev Transfer any BPT management fees from this contract to the recipient.
     */
    function withdrawCollectedManagementFees(address recipient) external virtual onlyManager withBoundPool {
        IERC20(pool).safeTransfer(recipient, IERC20(pool).balanceOf(address(this)));
    }

    /**
     * @dev Pass a call to ManagedPool's setManagementAumFeePercentage through to the underlying pool.
     */
    function setManagementAumFeePercentage(uint256 managementAumFeePercentage)
        external
        virtual
        onlyManager
        withBoundPool
        returns (uint256)
    {
        _require(canChangeManagementFees(), Errors.FEATURE_DISABLED);

        return IManagedPool(pool).setManagementAumFeePercentage(managementAumFeePercentage);
    }

    /**
     * @dev Pass a call to ManagedPool's setJoinExitEnabled through to the underlying pool.
     */
    function setJoinExitEnabled(bool joinExitEnabled) external virtual onlyManager withBoundPool {
        _require(canDisableJoinExit(), Errors.FEATURE_DISABLED);

        IManagedPool(pool).setJoinExitEnabled(joinExitEnabled);
    }
}
