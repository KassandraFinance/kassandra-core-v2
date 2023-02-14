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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPoolFactory.sol";
import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPool.sol";

import "./interfaces/IAuthorizedManagers.sol";
import "./lib/KacyErrors.sol";

import "./KassandraManagedPoolController.sol";

/**
 * @dev Deploys a new `ManagedPool` owned by a ManagedPoolController with the specified rights.
 * It uses the ManagedPoolFactory to deploy the pool.
 */
contract KassandraControlledManagedPoolFactory is Ownable {
    using SafeERC20 for IERC20;

    // The address of the ManagedPoolFactory used to deploy the ManagedPool
    address public immutable managedPoolFactory;
    address public immutable kassandraRules;
    address public immutable assetManager;
    IVault private immutable _vault;
    IPrivateInvestors private immutable _privateInvestors;
    IAuthorizedManagers public authorizedManagers;
    mapping(address => bool) private _isPoolFromFactory;

    event KassandraPoolCreated(
        address indexed caller,
        address indexed pool,
        address indexed poolController,
        bytes32         vaultPoolId
    );

    constructor(
        address factory,
        IPrivateInvestors privateInvestors,
        IAuthorizedManagers authorizationContract,
        IVault vault,
        address rules,
        address assetManagerAddress
    ) {
        managedPoolFactory = factory;
        kassandraRules = rules;
        assetManager = assetManagerAddress;
        _vault = vault;
        authorizedManagers = authorizationContract;
        _privateInvestors = privateInvestors;
    }

    /**
     * @dev Deploys a new `ManagedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        bool isPrivatePool,
        IWhitelist whitelist,
        uint256[] memory amountsIn,
        ManagedPoolSettings.ManagedPoolSettingsParams memory settingsParams,
        KassandraManagedPoolController.FeesPercentages memory feesSettings
    ) external returns (address pool, KassandraManagedPoolController poolController) {
        _require(authorizedManagers.canCreatePool(msg.sender), Errors.SENDER_NOT_ALLOWED);
        _require(amountsIn.length == settingsParams.tokens.length, Errors.INPUT_LENGTH_MISMATCH);

        poolController = new KassandraManagedPoolController(
            BasePoolController.BasePoolRights({
                canTransferOwnership: true,
                canChangeSwapFee: true,
                canUpdateMetadata: true
            }),
            feesSettings,
            kassandraRules,
            msg.sender,
            _privateInvestors,
            isPrivatePool,
            _vault,
            assetManager,
            whitelist
        );

        settingsParams.mustAllowlistLPs = false;

        for (uint256 i = 0; i < amountsIn.length; i++) {
            IERC20 tokenIn = IERC20(settingsParams.tokens[i]);
            _require(whitelist.isTokenWhitelisted(address(tokenIn)), Errors.INVALID_TOKEN);
            if (tokenIn.allowance(address(this), address(_vault)) < amountsIn[i]) {
                tokenIn.safeApprove(address(_vault), type(uint256).max);
            }
            tokenIn.safeTransferFrom(msg.sender, address(this), amountsIn[i]);
        }

        ManagedPool.ManagedPoolParams memory params;
        params.name = name;
        params.symbol = symbol;
        params.assetManagers = new address[](amountsIn.length);

        uint256 size = amountsIn.length + 1;
        IERC20[] memory assetsWithBPT = new IERC20[](size);
        uint256[] memory amountsInWithBPT = new uint256[](size);
        {
            uint256 j = 1;
            for (uint256 i = 0; i < amountsIn.length; i++) {
                assetsWithBPT[j] = settingsParams.tokens[i];
                amountsInWithBPT[j] = amountsIn[i];
                params.assetManagers[i] = assetManager;
                j++;
            }
        }

        // Let the base factory deploy the pool (owner is the controller)
        pool = ManagedPoolFactory(managedPoolFactory).create(params, settingsParams, address(poolController));
        assetsWithBPT[0] = IERC20(pool);
        amountsInWithBPT[0] = type(uint256).max;

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(assetsWithBPT),
            maxAmountsIn: amountsInWithBPT,
            userData: abi.encode(0, amountsIn),
            fromInternalBalance: false
        });

        bytes32 poolId = IManagedPool(pool).getPoolId();
        emit KassandraPoolCreated(msg.sender, pool, address(poolController), poolId);
        _vault.joinPool(poolId, address(this), msg.sender, request);

        // Finally, initialize the controller
        poolController.initialize(pool);

        authorizedManagers.managerCreatedPool(msg.sender);
        _privateInvestors.setController(address(poolController));

        _isPoolFromFactory[pool] = true;
    }

    /**
     * @dev Returns true if `pool` was created by this factory.
     */
    function isPoolFromFactory(address pool) external view returns (bool) {
        return _isPoolFromFactory[pool];
    }

    function setAuthorizedManagers(IAuthorizedManagers authorizationContract) external onlyOwner {
        authorizedManagers = authorizationContract;
    }
}
