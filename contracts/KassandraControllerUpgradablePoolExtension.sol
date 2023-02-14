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
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

import "./KassandraManagedPoolController.sol";

contract KassandraControllerUpgradablePoolExtension {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    /*******************************************************************************************************************
    *                                           Controller Storage Interface                                           *
    *                                             DO NOT CHANGE BELOW THIS                                             *
    *******************************************************************************************************************/

    /*============================================== BasePoolController ==============================================*/

    address private _manager;
    address private _managerCandidate;
    address private _swapFeeController;
    address public pool;
    uint256 private constant _TRANSFER_OWNERSHIP_OFFSET = 0;
    uint256 private constant _CHANGE_SWAP_FEE_OFFSET = 1;
    uint256 private constant _UPDATE_METADATA_OFFSET = 2;
    bytes private _metadata;

    /*======================================== KassandraManagedPoolController ========================================*/

    IKassandraRules public kassandraRules;
    IWhitelist private _whitelist;
    address private _assetManager;
    IVault private _vault;
    IPrivateInvestors private _privateInvestors;
    KassandraManagedPoolController.FeesPercentages private _feesPercentages;
    bool private _isPrivatePool;

    /*******************************************************************************************************************
    *                                       End of Controller Storage Interface                                        *
    *                                             DO NOT CHANGE ABOVE THIS                                             *
    *******************************************************************************************************************/

    /*******************************************************************************************************************
    *                                                Extended Functions                                                *
    *                                         New functions for the controllers                                        *
    *******************************************************************************************************************/

    event JoinedPool(
        address indexed recipient,
        address indexed manager,
        address indexed referrer,
        uint256         amountToRecipient,
        uint256         amountToManager,
        uint256         amountToReferrer
    );

    modifier withBoundPool {
        _require(pool != address(0), Errors.UNINITIALIZED_POOL_CONTROLLER);
        _;
    }

    modifier onlyManager() {
        _require(_manager == msg.sender, Errors.CALLER_IS_NOT_OWNER);
        _;
    }

    /**
     * @dev Getter for the canSetCircuitBreakers permission.
     */
    function canSetCircuitBreakers() public pure returns (bool) {
        return false;
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
        tokenToAdd.safeTransferFrom(_manager, _assetManager, tokenToAddBalance);

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

    /**
     * @dev Update weights linearly from the current values to the given end weights, between startTime
     * and endTime.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        IERC20[] calldata tokens,
        uint256[] calldata endWeights
    ) external onlyManager withBoundPool {
        // solhint-disable-next-line not-rely-on-time
        uint256 realStartTime = Math.max(block.timestamp, startTime);
        uint256 timedelta = endTime - realStartTime;
        _require(
            endTime >= realStartTime && timedelta >= kassandraRules.minWeightChangeDuration(),
            Errors.WEIGHT_CHANGE_TOO_FAST
        );

        IManagedPool managedPool = IManagedPool(pool);
        uint256 maxWeightChangePerSecond = kassandraRules.maxWeightChangePerSecond();
        uint256[] memory startWeights = managedPool.getNormalizedWeights();

        for (uint256 i = 0; i < startWeights.length; i++) {
            _require(
                startWeights[i] > endWeights[i]
                ? (startWeights[i] - endWeights[i]) / timedelta <= maxWeightChangePerSecond
                : (endWeights[i] - startWeights[i]) / timedelta <= maxWeightChangePerSecond,
                Errors.WEIGHT_CHANGE_TOO_FAST
            );
        }

        managedPool.updateWeightsGradually(realStartTime, endTime, tokens, endWeights);
    }

    function joinPool(
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        external withBoundPool
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        _require(!_isPrivatePool || _privateInvestors.isInvestorAllowed(pool, recipient), Errors.SENDER_NOT_ALLOWED);

        WeightedPoolUserData.JoinKind joinKind = abi.decode(request.userData, (WeightedPoolUserData.JoinKind));
        bytes32 poolId = IManagedPool(pool).getPoolId();

        if (joinKind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _joinPoolExactIn(poolId, recipient, referrer, request);
        } else if (joinKind == WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return _joinPoolExactOut(poolId, recipient, referrer, request);
        } else if (joinKind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return _joinPoolAllTokensExactOut(poolId, recipient, referrer, request);
        }
    }

    /* solhint-disable-next-line private-vars-leading-underscore */
    function _joinPoolExactIn(
        bytes32 poolId,
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        private
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        (, , uint256 minBPTAmountOut) = abi.decode(request.userData, (uint256, uint256[], uint256));
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
        _require(amountToRecipient >= minBPTAmountOut, Errors.BPT_OUT_MIN_AMOUNT);
        address manager = _manager;

        if (referrer == address(0)) {
            referrer = manager;
        }

        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);
        emit JoinedPool(recipient, manager, referrer, amountToRecipient, amountToManager, amountToReferrer);

        amountsIn = request.maxAmountsIn;
    }

    /* solhint-disable-next-line private-vars-leading-underscore */
    function _joinPoolExactOut(
        bytes32 poolId,
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        private
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

        request.userData = abi.encode(WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT, bptAmount, indexToken);
        _vault.joinPool(poolId, address(this), address(this), request);
        address manager = _manager;

        if (referrer == address(0)) {
            referrer = manager;
        }

        amountToManager = bptAmount.mulDown(_feesPercentages.feesToManager);
        amountToReferrer = bptAmount.mulDown(_feesPercentages.feesToReferral);

        IERC20 poolToken = IERC20(pool);
        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);
        emit JoinedPool(recipient, manager, referrer, amountToRecipient, amountToManager, amountToReferrer);

        uint256 amountGiveBack = tokenIn.balanceOf(address(this));
        amountsIn = new uint256[](request.maxAmountsIn.length);
        amountsIn[indexTokenIn] = request.maxAmountsIn[indexTokenIn].sub(amountGiveBack);
        tokenIn.safeTransfer(recipient, amountGiveBack);
    }

    /* solhint-disable-next-line private-vars-leading-underscore */
    function _joinPoolAllTokensExactOut(
        bytes32 poolId,
        address recipient,
        address referrer,
        IVault.JoinPoolRequest memory request
    )
        private
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
        request.userData = abi.encode(WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, bptAmount);

        _vault.joinPool(poolId, address(this), address(this), request);

        address manager = _manager;

        if (referrer == address(0)) {
            referrer = manager;
        }

        amountToManager = bptAmount.mulDown(_feesPercentages.feesToManager);
        amountToReferrer = bptAmount.mulDown(_feesPercentages.feesToReferral);

        IERC20 poolToken = IERC20(pool);

        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);
        emit JoinedPool(recipient, manager, referrer, amountToRecipient, amountToManager, amountToReferrer);

        amountsIn = request.maxAmountsIn;

        for (uint256 i = 1; i < request.assets.length; i++) {
            IERC20 tokenIn = IERC20(address(request.assets[i]));
            uint256 amountGiveBack = tokenIn.balanceOf(address(this));
            amountsIn[i] = request.maxAmountsIn[i].sub(amountGiveBack);
            tokenIn.safeTransfer(msg.sender, amountGiveBack);
        }
    }

    function _approveAndTransferTokens(
        address payerAddress,
        address vaultAddress,
        IVault.JoinPoolRequest memory request
    ) private {
        for (uint256 i = 1; i < request.assets.length; i++) {
            IERC20 tokenIn = IERC20(address(request.assets[i]));
            if (tokenIn.allowance(payerAddress, vaultAddress) < request.maxAmountsIn[i]) {
                tokenIn.safeApprove(vaultAddress, type(uint256).max);
            }
            tokenIn.safeTransferFrom(msg.sender, payerAddress, request.maxAmountsIn[i]);
        }
    }
}
