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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";
import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPoolFactory.sol";
import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPool.sol";

import "./interfaces/IAuthorizedManagers.sol";
import "./lib/KacyErrors.sol";

import "./KassandraManagedPoolController.sol";

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @dev Deploys a new `ManagedPool` owned by a ManagedPoolController with the specified rights.
 * It uses the ManagedPoolFactory to deploy the pool.
 */
contract KassandraControlledManagedPoolFactory is OwnableUpgradeable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct PoolParams {
        string name;
        string symbol;
        bool isPrivatePool;
        IWhitelist whitelist;
        uint256[] amountsIn;
    }

    struct JoinParams {
        IERC20 tokenIn;
        uint256 amountIn;
        bytes[] datas;
    }

    address private _managedPoolFactory;
    address private _kassandraRules;
    address private _assetManager;
    address private _proxyInvest;
    address private _swapProvider;
    address private _proxyProviderTransfer;
    IWETH private _WETH;

    IVault private _vault;
    IPrivateInvestors private _privateInvestors;
    IAuthorizedManagers private _authorizedManagers;

    mapping(address => bool) private _isPoolFromFactory;

    event KassandraPoolCreated(
        address indexed caller,
        bytes32 indexed vaultPoolId,
        address indexed pool,
        address poolController,
        address whitelist,
        bool isPrivatePool
    );

    event KassandraPoolCreatedTokens(
        bytes32 indexed vaultPoolId,
        string tokenName,
        string tokenSymbol,
        IERC20[] tokens
    );

    function initialize(
        address factory,
        IPrivateInvestors privateInvestors,
        IAuthorizedManagers authorizationContract,
        IVault vault,
        address rules,
        address assetManagerAddress,
        address proxyInvest,
        address swapProvider,
        address proxyProviderTransfer,
        IWETH weth
    ) public initializer {
        __Ownable_init();
        _managedPoolFactory = factory;
        _privateInvestors = privateInvestors;
        _authorizedManagers = authorizationContract;
        _vault = vault;
        _kassandraRules = rules;
        _assetManager = assetManagerAddress;
        _proxyInvest = proxyInvest;
        _swapProvider = swapProvider;
        _proxyProviderTransfer = proxyProviderTransfer;
        _WETH = weth;
    }

    /**
     * @dev Deploys a new `ManagedPool`.
     */
    function create(
        PoolParams memory poolParams,
        ManagedPoolSettings.ManagedPoolSettingsParams memory settingsParams,
        KassandraManagedPoolController.FeesPercentages calldata feesSettings,
        JoinParams calldata joinParams,
        bytes32 salt
    ) external payable returns (address pool, KassandraManagedPoolController poolController) {
        _require(_authorizedManagers.canCreatePool(msg.sender), Errors.SENDER_NOT_ALLOWED);
        _require(poolParams.amountsIn.length == settingsParams.tokens.length, Errors.INPUT_LENGTH_MISMATCH);

        {
            uint256 kassandraAumFee = IKassandraRules(_kassandraRules).kassandraAumFeePercentage();
            settingsParams.managementAumFeePercentage = settingsParams.managementAumFeePercentage.add(kassandraAumFee);

            poolController = new KassandraManagedPoolController(
                BasePoolController.BasePoolRights({
                    canTransferOwnership: true,
                    canChangeSwapFee: true,
                    canUpdateMetadata: true
                }),
                _kassandraRules,
                msg.sender,
                _privateInvestors,
                poolParams.isPrivatePool,
                _vault,
                _assetManager,
                poolParams.whitelist,
                kassandraAumFee
            );
        }

        settingsParams.mustAllowlistLPs = false;

        _receiveTokens(joinParams, settingsParams, poolParams);

        IVault.JoinPoolRequest memory request;

        {
            ManagedPool.ManagedPoolParams memory managedParams;
            managedParams.name = poolParams.name;
            managedParams.symbol = poolParams.symbol;
            managedParams.assetManagers = new address[](poolParams.amountsIn.length);

            uint256 size = poolParams.amountsIn.length + 1;
            IERC20[] memory assetsWithBPT = new IERC20[](size);
            uint256[] memory amountsInWithBPT = new uint256[](size);
            {
                uint256 j = 1;
                for (uint256 i = 0; i < poolParams.amountsIn.length; i++) {
                    assetsWithBPT[j] = settingsParams.tokens[i];
                    amountsInWithBPT[j] = poolParams.amountsIn[i];
                    managedParams.assetManagers[i] = _assetManager;
                    j++;
                }
            }

            // Let the base factory deploy the pool (owner is the controller)
            pool = ManagedPoolFactory(_managedPoolFactory).create(
                managedParams,
                settingsParams,
                address(poolController),
                salt
            );
            assetsWithBPT[0] = IERC20(pool);
            amountsInWithBPT[0] = type(uint256).max;

            request = IVault.JoinPoolRequest({
                assets: _asIAsset(assetsWithBPT),
                maxAmountsIn: amountsInWithBPT,
                userData: abi.encode(0, poolParams.amountsIn),
                fromInternalBalance: false
            });
        }

        bytes32 poolId = IManagedPool(pool).getPoolId();
        emit KassandraPoolCreated(
            msg.sender,
            poolId,
            pool,
            address(poolController),
            address(poolParams.whitelist),
            poolParams.isPrivatePool
        );
        emit KassandraPoolCreatedTokens(poolId, poolParams.name, poolParams.symbol, settingsParams.tokens);

        _vault.joinPool(poolId, address(this), msg.sender, request);

        // Finally, initialize the controller
        poolController.initialize(pool, _proxyInvest, feesSettings);

        _authorizedManagers.managerCreatedPool(msg.sender);
        _privateInvestors.setController(address(poolController));

        _isPoolFromFactory[pool] = true;
    }

    /**
     * @dev Returns true if `pool` was created by this factory.
     */
    function isPoolFromFactory(address pool) external view returns (bool) {
        return _isPoolFromFactory[pool];
    }

    function kassandraAumFeePercentage() external view returns (uint256) {
        return IKassandraRules(_kassandraRules).kassandraAumFeePercentage();
    }

    function getManagedPoolFactory() public view returns (address) {
        return _managedPoolFactory;
    }

    function getKassandraRules() public view returns (address) {
        return _kassandraRules;
    }

    function getAssetManager() public view returns (address) {
        return _assetManager;
    }

    function getProxyInvest() public view returns (address) {
        return _proxyInvest;
    }

    function getSwapProvider() public view returns (address) {
        return _swapProvider;
    }

    function getProxyProviderTransfer() public view returns (address) {
        return _proxyProviderTransfer;
    }

    function getWETH() public view returns (address) {
        return address(_WETH);
    }

    function getVault() public view returns (address) {
        return address(_vault);
    }

    function getPrivateInvestors() public view returns (address) {
        return address(_privateInvestors);
    }

    function getAuthorizedManagers() public view returns (address) {
        return address(_authorizedManagers);
    }

    function _receiveTokens(
        JoinParams calldata joinParams,
        ManagedPoolSettings.ManagedPoolSettingsParams memory settingsParams,
        PoolParams memory poolParams
    ) private {
        if (joinParams.tokenIn != IERC20(0) && joinParams.datas.length > 0) {
            if (msg.value > 0) {
                _WETH.deposit{ value: msg.value }();
            } else {
                joinParams.tokenIn.safeTransferFrom(msg.sender, address(this), joinParams.amountIn);
            }

            if (joinParams.tokenIn.allowance(address(this), _proxyProviderTransfer) < joinParams.amountIn) {
                joinParams.tokenIn.safeApprove(_proxyProviderTransfer, type(uint256).max);
            }

            bool success;
            bytes memory response;
            uint256 size = joinParams.datas.length;
            for (uint i = 0; i < size; i++) {
                (success, response) = address(_swapProvider).call(joinParams.datas[i]);
                require(success, string(response));
            }

            size = settingsParams.tokens.length;
            for (uint i = 0; i < size; i++) {
                IERC20 tokenIn = IERC20(settingsParams.tokens[i]);
                poolParams.amountsIn[i] = tokenIn.balanceOf(address(this));
                _require(poolParams.whitelist.isTokenWhitelisted(address(tokenIn)), Errors.INVALID_TOKEN);
                if (tokenIn.allowance(address(this), address(_vault)) < poolParams.amountsIn[i]) {
                    tokenIn.safeApprove(address(_vault), type(uint256).max);
                }
            }
        } else {
            for (uint256 i = 0; i < poolParams.amountsIn.length; i++) {
                IERC20 tokenIn = IERC20(settingsParams.tokens[i]);
                _require(poolParams.whitelist.isTokenWhitelisted(address(tokenIn)), Errors.INVALID_TOKEN);
                if (tokenIn.allowance(address(this), address(_vault)) < poolParams.amountsIn[i]) {
                    tokenIn.safeApprove(address(_vault), type(uint256).max);
                }
                tokenIn.safeTransferFrom(msg.sender, address(this), poolParams.amountsIn[i]);
            }
        }
    }
}
