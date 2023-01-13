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

import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPoolFactory.sol";
import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPool.sol";

import "./KassandraManagedPoolController.sol";

import "./interfaces/IAuthorizedManagers.sol";

/**
 * @dev Deploys a new `ManagedPool` owned by a ManagedPoolController with the specified rights.
 * It uses the ManagedPoolFactory to deploy the pool.
 */
contract KassandraControlledManagedPoolFactory {
    using SafeERC20 for IERC20;

    // The address of the ManagedPoolFactory used to deploy the ManagedPool
    address public immutable managedPoolFactory;
    IVault private _vault;
    IBalancerQueries private _balancerQueries;
    IAuthorizedManagers private _authorizedManagers;
    IPrivateInvestors private _privateInvestors;
    mapping(address => bool) private _isPoolFromFactory;

    event ManagedPoolCreated(address indexed pool, address indexed poolController);

    constructor(
        address factory,
        IPrivateInvestors privateInvestors,
        IAuthorizedManagers authorizedManagers,
        IVault vault,
        IBalancerQueries balancerQueries
    ) {
        managedPoolFactory = factory;
        _authorizedManagers = authorizedManagers;
        _privateInvestors = privateInvestors;
        _vault = vault;
        _balancerQueries = balancerQueries;
    }

    /**
     * @dev Deploys a new `ManagedPool`.
     */
    function create(
        ManagedPool.ManagedPoolParams memory params,
        ManagedPoolSettings.ManagedPoolSettingsParams memory settingsParams,
        KassandraManagedPoolController.FeesPercentages memory feesSettings,
        uint256[] memory amountsIn,
        bool isPrivatePool
    ) external returns (address pool, KassandraManagedPoolController poolController) {
        _require(_authorizedManagers.canCreatePool(msg.sender), Errors.SENDER_NOT_ALLOWED);
        _require(amountsIn.length == settingsParams.tokens.length, Errors.INPUT_LENGTH_MISMATCH);

        settingsParams.mustAllowlistLPs = false;
        uint256 minWeightChangeDuration = 100; // verificar com o keven

        poolController = new KassandraManagedPoolController(
            BasePoolController.BasePoolRights({ canTransferOwnership: true, canChangeSwapFee: true, canUpdateMetadata: true }),
            feesSettings,
            minWeightChangeDuration,
            msg.sender,
            _privateInvestors,
            isPrivatePool,
            _vault,
            _balancerQueries
        );


        // Let the base factory deploy the pool (owner is the controller)
        pool = ManagedPoolFactory(managedPoolFactory).create(params, settingsParams, address(poolController));

        for (uint256 i = 0; i < amountsIn.length; i++) {
            if (IERC20(settingsParams.tokens[i]).allowance(address(this), address(_vault)) < amountsIn[i]) {
                IERC20(settingsParams.tokens[i]).safeApprove(address(_vault), amountsIn[i]);
            }
            IERC20(settingsParams.tokens[i]).safeTransferFrom(msg.sender, address(this), amountsIn[i]);
        }

        uint256 size = amountsIn.length + 1;    
        IERC20[] memory assetsWithBPT = new IERC20[](size);
        uint256[] memory amountsInWithBPT = new uint256[](size);
        {
            uint256 j = 1;
            for (uint256 i = 0; i < amountsIn.length; i++) {
                assetsWithBPT[j] = settingsParams.tokens[i];
                amountsInWithBPT[j] = amountsIn[i];
                j++;
            }
        }
        assetsWithBPT[0] = IERC20(pool);
        amountsInWithBPT[0] = type(uint256).max;

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(assetsWithBPT),
            maxAmountsIn: amountsInWithBPT,
            userData: abi.encode(0, amountsIn),
            fromInternalBalance: false
        });

        _vault.joinPool(IManagedPool(pool).getPoolId(), address(this), msg.sender, request);

        // Finally, initialize the controller
        poolController.initialize(pool);

        _authorizedManagers.managerCreatedPool(msg.sender);
        _privateInvestors.setController(address(poolController));
        
        _isPoolFromFactory[pool] = true;
        emit ManagedPoolCreated(pool, address(poolController));
    }

    /**
     * @dev Returns true if `pool` was created by this factory.
     */
    function isPoolFromFactory(address pool) external view returns (bool) {
        return _isPoolFromFactory[pool];
    }
}
