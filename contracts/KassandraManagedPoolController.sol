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
contract KassandraManagedPoolController is BasePoolController {
    using SafeERC20 for IERC20;
    using WordCodec for bytes32;
    using FixedPoint for uint256;

    uint256 constant internal _TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
    uint256 constant internal _ALL_TOKENS_IN_FOR_EXACT_BPT_OUT = 3;

    struct FeesPercentages {
        uint64 feesToManager;
        uint64 feesToReferral;
    }

    // The minimum weight change duration could be replaced with more sophisticated rate-limiting.
    IKassandraRules private immutable _kassandraRules;
    IWhitelist private immutable _whitelist;
    address private immutable _assetManager;

    IPrivateInvestors private _privateInvestors;
    IVault private _vault;

    FeesPercentages private _feesPercentages;
    bool private _isPrivatePool;

    /**
     * @dev Pass in the `BasePoolRights` and `ManagedPoolRights` structures, to form the complete set of
     * immutable rights. Then pass any parameters related to restrictions on those rights. For instance,
     * a minimum duration if changing weights is enabled.
     */
    constructor(
        BasePoolRights memory baseRights,
        FeesPercentages memory feesPercentages,
        address kassandraRules,
        address manager,
        IPrivateInvestors privateInvestors,
        bool isPrivatePool,
        IVault vault,
        address assetManager,
        IWhitelist whitelist
    ) BasePoolController(encodePermissions(baseRights), manager) {
        _kassandraRules = IKassandraRules(kassandraRules);
        _privateInvestors = privateInvestors;
        _isPrivatePool = isPrivatePool;
        _vault = vault;
        _feesPercentages = feesPercentages;
        _assetManager = assetManager;
        _whitelist = whitelist;
    }

    function initialize(address poolAddress) public override {
        super.initialize(poolAddress);

        IManagedPool(pool).setMustAllowlistLPs(true);
        IManagedPool(pool).addAllowedAddress(address(this));
    }

    /**
     * @dev Getter for the fees paid when joining the pool.
     */
    function getJoinFees() external view returns (uint64 feesToManager, uint64 feesToReferral) {
        return (_feesPercentages.feesToManager, _feesPercentages.feesToReferral);
    }

    function joinPool(
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        external
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        _require(!_isPrivatePool || _privateInvestors.isInvestorAllowed(pool, recipient), Errors.SENDER_NOT_ALLOWED);

        uint256 joinKind = abi.decode(request.userData, (uint256));
        bytes32 poolId = IManagedPool(pool).getPoolId();
        if (joinKind == 1) {
            return _joinPoolExactIn(poolId, recipient, referrer, request);
        } else if (joinKind == 2) {
            return _joinPoolExactOut(poolId, recipient, referrer, request);
        } else if (joinKind == 3) {
            return _joinPoolAllTokensExactOut(poolId, recipient, referrer, request);
        }
    }

    function _joinPoolExactIn(
        bytes32 poolId,
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        internal
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        IERC20 poolToken = IERC20(pool);
        uint256 initialPoolAmount = poolToken.balanceOf(address(this));
        for (uint256 i = 1; i < request.assets.length; i++) {
            IERC20 tokenIn = IERC20(address(request.assets[i]));
            if (tokenIn.allowance(address(this), address(_vault)) < request.maxAmountsIn[i]) {
                tokenIn.safeApprove(address(_vault), type(uint256).max);
            }
            tokenIn.safeTransferFrom(msg.sender, address(this), request.maxAmountsIn[i]);
        }

        _vault.joinPool(poolId, address(this), address(this), request);

        uint256 amountOutBPT = poolToken.balanceOf(address(this)).sub(initialPoolAmount);
        amountToManager = amountOutBPT.mulDown(_feesPercentages.feesToManager);
        amountToReferrer = amountOutBPT.mulDown(_feesPercentages.feesToReferral);
        amountToRecipient = amountOutBPT.sub(amountToManager).sub(amountToReferrer);

        address _manager = getManager();

        if (referrer == address(0)) {
            referrer = _manager;
        }

        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(_manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);

        amountsIn = request.maxAmountsIn;
    }

    function _joinPoolExactOut(
        bytes32 poolId,
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        internal
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        uint256 indexToken;
        (, amountToRecipient, indexToken) = abi.decode(request.userData, (uint256, uint256, uint256));
        uint256 bptAmount = amountToRecipient.divDown(
            FixedPoint.ONE.sub(_feesPercentages.feesToManager).sub(_feesPercentages.feesToReferral)
        );
        
        uint256 indexTokenIn = indexToken + 1;
        IERC20 tokenIn = IERC20(address(request.assets[indexTokenIn]));
        if (tokenIn.allowance(address(this), address(_vault)) < request.maxAmountsIn[indexTokenIn]) {
            tokenIn.safeApprove(address(_vault), type(uint256).max);
        }
        tokenIn.safeTransferFrom(msg.sender, address(this), request.maxAmountsIn[indexTokenIn]);

        request.userData = abi.encode(_TOKEN_IN_FOR_EXACT_BPT_OUT, bptAmount, indexToken);
        _vault.joinPool(poolId, address(this), address(this), request);
        address _manager = getManager();

        if (referrer == address(0)) {
            referrer = _manager;
        }

        amountToManager = bptAmount.mulDown(_feesPercentages.feesToManager);
        amountToReferrer = bptAmount.mulDown(_feesPercentages.feesToReferral);

        IERC20 poolToken = IERC20(pool);
        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(_manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);

        uint256 amountGiveBack = tokenIn.balanceOf(address(this));
        amountsIn = new uint256[](request.maxAmountsIn.length);
        amountsIn[indexTokenIn] = request.maxAmountsIn[indexTokenIn].sub(amountGiveBack);
        tokenIn.safeTransfer(recipient, amountGiveBack);
    }

    function _joinPoolAllTokensExactOut(
        bytes32 poolId,
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        internal
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        (, amountToRecipient) = abi.decode(request.userData, (uint256, uint256));
        uint256 bptAmount = amountToRecipient.divDown(
            FixedPoint.ONE.sub(_feesPercentages.feesToManager).sub(_feesPercentages.feesToReferral)
        );
        for (uint256 i = 1; i < request.assets.length; i++) {
            IERC20 tokenIn = IERC20(address(request.assets[i]));
            if (tokenIn.allowance(address(this), address(_vault)) < request.maxAmountsIn[i]) {
                tokenIn.safeApprove(address(_vault), type(uint256).max);
            }
            tokenIn.safeTransferFrom(msg.sender, address(this), request.maxAmountsIn[i]);
        }
        request.userData = abi.encode(_ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, bptAmount);

        _vault.joinPool(poolId, address(this), address(this), request);

        address _manager = getManager();

        if (referrer == address(0)) {
            referrer = _manager;
        }

        amountToManager = bptAmount.mulDown(_feesPercentages.feesToManager);
        amountToReferrer = bptAmount.mulDown(_feesPercentages.feesToReferral);

        IERC20 poolToken = IERC20(pool);

        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(_manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);

        amountsIn = request.maxAmountsIn;

        for (uint256 i = 1; i < request.assets.length; i++) {
            IERC20 tokenIn = IERC20(address(request.assets[i]));
            uint256 amountGiveBack = tokenIn.balanceOf(address(this));
            amountsIn[i] = request.maxAmountsIn[i].sub(amountGiveBack);
            tokenIn.safeTransfer(msg.sender, amountGiveBack);
        }
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
        return _kassandraRules.minWeightChangeDuration();
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
        uint256 timedelta = endTime - startTime;
        _require(
            endTime >= startTime && timedelta >= _kassandraRules.minWeightChangeDuration(),
            Errors.WEIGHT_CHANGE_TOO_FAST
        );

        IManagedPool managedPool = IManagedPool(pool);
        uint256 maxWeightChangePerSecond = _kassandraRules.maxWeightChangePerSecond();
        uint256[] memory startWeights = managedPool.getNormalizedWeights();

        for (uint256 i = 0; i < startWeights.length; i++) {
            _require(
                startWeights[i] > endWeights[i]
                ? (startWeights[i] - endWeights[i]) / timedelta < maxWeightChangePerSecond
                : (endWeights[i] - startWeights[i]) / timedelta < maxWeightChangePerSecond,
                Errors.WEIGHT_CHANGE_TOO_FAST
            );
        }

        managedPool.updateWeightsGradually(startTime, endTime, tokens, endWeights);
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

    function addToken(
        IERC20 tokenToAdd,
        uint256 tokenToAddNormalizedWeight,
        uint256 tokenToAddBalance,
        address recipient
    ) external onlyManager withBoundPool {
        bool isBlacklist = _whitelist.isBlacklist();
        bool isTokenWhitelisted = _whitelist.isTokenWhitelisted(address(tokenToAdd));
        bool isWhitelisted;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            isWhitelisted := xor(isBlacklist, isTokenWhitelisted)
        }
        _require(isWhitelisted, Errors.INVALID_TOKEN);

        IManagedPool managedPool = IManagedPool(pool);
        uint256 totalSupply = managedPool.getActualSupply();

        //                totalSupply * tokenToAddNormalizedWeight
        // mintAmount = -------------------------------------------
        //              FixedPoint.ONE - tokenToAddNormalizedWeight
        uint256 mintAmount = totalSupply.mulDown(tokenToAddNormalizedWeight).divDown(
            FixedPoint.ONE.sub(tokenToAddNormalizedWeight)
        );

        // First gets the tokens from msg.sender to the Asset Manager contract
        tokenToAdd.safeTransferFrom(getManager(), _assetManager, tokenToAddBalance);

        managedPool.addToken(tokenToAdd, _assetManager, tokenToAddNormalizedWeight, mintAmount, recipient);
        IKacyAssetManager(_assetManager).addToken(tokenToAdd, tokenToAddBalance, _vault, managedPool.getPoolId());
    }

    function removeToken(
        IERC20 tokenToRemove,
        address sender
    ) external onlyManager withBoundPool {
        IManagedPool managedPool = IManagedPool(pool);
        bytes32 poolId = managedPool.getPoolId();

        uint256 totalSupply = managedPool.getActualSupply();
        (uint256 tokenToRemoveBalance, , , ) = _vault.getPoolTokenInfo(poolId, tokenToRemove);

        (IERC20[] memory registeredTokens, , ) = _vault.getPoolTokens(managedPool.getPoolId());
        uint256[] memory registeredTokensWeights = managedPool.getNormalizedWeights();
        uint256 tokenToRemoveNormalizedWeight;

        // registeredTokens contains the BPT in the first slot, registeredTokensWeights does not
        for (uint256 i = 1; i < registeredTokens.length; i++) {
            if (registeredTokens[i] != tokenToRemove) {
                continue;
            }

            tokenToRemoveNormalizedWeight = registeredTokensWeights[i - 1];
            break;
        }

        IKacyAssetManager(_assetManager).removeToken(tokenToRemove, tokenToRemoveBalance, _vault, poolId);

        // burnAmount = totalSupply * tokenToRemoveNormalizedWeight
        uint256 burnAmount = totalSupply.mulDown(tokenToRemoveNormalizedWeight);

        managedPool.removeToken(tokenToRemove, burnAmount, sender);
    }
}
