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

    address private _strategist;
    IKassandraRules public kassandraRules;
    IWhitelist private _whitelist;
    address private _assetManager;
    IVault private _vault;
    IPrivateInvestors private _privateInvestors;
    KassandraManagedPoolController.FeesPercentages private _feesPercentages;
    bool private _isPrivatePool;
    uint256 private _kassandraAumFee;

    /*******************************************************************************************************************
    *                                       End of Controller Storage Interface                                        *
    *                                             DO NOT CHANGE ABOVE THIS                                             *
    *******************************************************************************************************************/

    /*******************************************************************************************************************
    *                                                 Extended Storage                                                 *
    *                                     New storage variables for the controllers                                    *
    *******************************************************************************************************************/

    /*******************************************************************************************************************
    *                                                Extended Functions                                                *
    *                                         New functions for the controllers                                        *
    *******************************************************************************************************************/

    event TokenAdded(IERC20 indexed token, uint256 amount);

    modifier withBoundPool {
        _require(pool != address(0), Errors.UNINITIALIZED_POOL_CONTROLLER);
        _;
    }

    modifier onlyManager() {
        _require(_manager == msg.sender, Errors.CALLER_IS_NOT_OWNER);
        _;
    }

    modifier onlyStrategist() {
        _require(_strategist == msg.sender, Errors.SENDER_NOT_ALLOWED);
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
        address sender,
        address recipient
    ) external onlyStrategist withBoundPool {
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

        // First gets the tokens from sender to the Asset Manager contract
        tokenToAdd.safeTransferFrom(sender, _assetManager, tokenToAddBalance);

        emit TokenAdded(tokenToAdd, tokenToAddBalance);
        managedPool.addToken(tokenToAdd, _assetManager, tokenToAddNormalizedWeight, mintAmount, recipient);
        IKacyAssetManager(_assetManager).addToken(tokenToAdd, tokenToAddBalance, _vault, managedPool.getPoolId());
    }

    function removeToken(
        IERC20 tokenToRemove,
        address sender,
        address recipient
    ) external onlyStrategist withBoundPool {
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
        
        IKacyAssetManager(_assetManager).removeToken(tokenToRemove, tokenToRemoveBalance, _vault, poolId, recipient);

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
    ) external onlyStrategist withBoundPool {
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


    function getManagementAumFee() external view 
        returns (uint256 managerAumFeePercentage, uint256 kassandraAumFeePercentage) 
    {
        (uint256 aumFeePercentage, ) = IManagedPool(pool).getManagementAumFeeParams();
        managerAumFeePercentage = aumFeePercentage.sub(_kassandraAumFee);
        kassandraAumFeePercentage = _kassandraAumFee;
    }

    /**
     * @dev Transfer any BPT management fees to manager and kassandra.
     */
    function withdrawCollectedManagementFees() external virtual withBoundPool returns (uint256 feesToManager, uint256 feesToKassandra) {
        address _msgSender = msg.sender;
        _require(_msgSender == _manager || _msgSender == kassandraRules.owner(), Errors.SENDER_NOT_ALLOWED);
        (uint256 aumFeePercentage, ) = IManagedPool(pool).getManagementAumFeeParams();
        uint256 totalCollected = IERC20(pool).balanceOf(address(this));
        feesToKassandra = totalCollected.mulDown(_kassandraAumFee.divDown(aumFeePercentage));
        IERC20(pool).safeTransfer(kassandraRules.owner(), feesToKassandra);
        if (aumFeePercentage > _kassandraAumFee) {
            feesToManager = totalCollected.sub(feesToKassandra);
            IERC20(pool).safeTransfer(_manager, feesToManager);
        }
    }
}
