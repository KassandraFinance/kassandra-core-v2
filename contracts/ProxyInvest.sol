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

pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./interfaces/IKassandraManagedPoolController.sol";
import "./interfaces/IPrivateInvestors.sol";

import "hardhat/console.sol";

contract ProxyInvest is Ownable {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;
    using FixedPoint for uint64;

    event JoinedPool(
        address indexed recipient,
        address indexed manager,
        address indexed referrer,
        uint256         amountToRecipient,
        uint256         amountToManager,
        uint256         amountToReferrer
    );

    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT }
    
    IPrivateInvestors private _privateInvestors;
    address           private _swapProvider;
    IVault            private _vault;


    struct ProxyParams {
        address recipient;
        address referrer;
        address controller;
        IERC20 tokenIn;
        uint256 tokenAmountIn;
        IERC20 tokenExchange;
        uint256 minTokenAmountOut;
    }

    constructor(IVault vault, address swapProvider, IPrivateInvestors privateInvestors) {
        _vault = vault;
        _swapProvider = swapProvider;
        _privateInvestors = privateInvestors;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getSwapProvider() external view returns (address) {
        return _swapProvider;
    }

    function setSwapProvider(address swapProvider) external onlyOwner {
        _swapProvider = swapProvider;
    }

    function setVault(IVault vault) external onlyOwner {
        _vault = vault;
    }

    function joinPoolExactTokenInWithSwap(
        ProxyParams calldata params,
        bytes calldata data
    )
        external
        payable
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        _require(IKassandraManagedPoolController(params.controller).pool() != address(0), Errors.UNINITIALIZED_POOL_CONTROLLER);
        
        if (msg.value == 0) {
            params.tokenIn.safeTransferFrom(msg.sender, address(this), params.tokenAmountIn);
            if (params.tokenIn.allowance(address(this), _swapProvider) < params.tokenAmountIn) {
                params.tokenIn.safeApprove(_swapProvider, type(uint256).max);
            }
        }

        {
            (bool success, bytes memory response) = address(_swapProvider).call{ value: msg.value }(data);
            require(success, string(response));
        }

        uint256[] memory maxAmountsInWithBPT;
        uint256[] memory maxAmountsIn;
        IERC20[] memory tokens;
        {
            (tokens, , ) = _vault.getPoolTokens(IManagedPool(IKassandraManagedPoolController(params.controller).pool()).getPoolId());
            uint256 size = tokens.length;
            maxAmountsInWithBPT = new uint256[](size);
            maxAmountsIn = new uint256[](size - 1);

            for (uint i = 1; i < size; i++) {
                if (tokens[i] == params.tokenExchange) {
                    maxAmountsInWithBPT[i] = params.tokenExchange.balanceOf(address(this));
                    maxAmountsIn[i - 1] = maxAmountsInWithBPT[i];
                    if (params.tokenExchange.allowance(address(this), params.controller) < maxAmountsInWithBPT[i]) {
                        params.tokenExchange.safeApprove(params.controller, type(uint256).max);
                    }
                }
            }
        }

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: maxAmountsInWithBPT,
            userData: abi.encode(JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, params.minTokenAmountOut),
            fromInternalBalance: false
        });

        return IKassandraManagedPoolController(params.controller).joinPool(params.recipient, params.referrer, request);
    }

    function joinPool(
        address recipient,
        address referrer,
        address controller,
        IVault.JoinPoolRequest memory request
    )
        external
        payable
        returns (
            uint256 amountToRecipient,
            uint256 amountToReferrer,
            uint256 amountToManager,
            uint256[] memory amountsIn
        )
    {
        address _pool = IKassandraManagedPoolController(controller).pool();
        _require(_pool != address(0), Errors.UNINITIALIZED_POOL_CONTROLLER);
        _require(
            !IKassandraManagedPoolController(controller).isPrivatePool() || 
            _privateInvestors.isInvestorAllowed(_pool, recipient), Errors.SENDER_NOT_ALLOWED
        );

        for (uint i = 0; i < request.assets.length; i++) {
            address tokenIn = address(request.assets[i]);
            uint256 tokenAmountIn = request.maxAmountsIn[i];

            if (tokenAmountIn == 0 || tokenIn == address(0)) continue;

            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), tokenAmountIn);
            if (IERC20(tokenIn).allowance(address(this), address(_vault)) < request.maxAmountsIn[i]) {
                IERC20(tokenIn).safeApprove(address(_vault), type(uint256).max);
            }

            console.log(IERC20(tokenIn).balanceOf(address(this)));
        }

        (uint64 feesToManager, uint64 feesToReferral) = IKassandraManagedPoolController(controller).getJoinFees();
        address manager = IKassandraManagedPoolController(controller).getManager();
        IKassandraManagedPoolController.FeesPercentages memory investFees = IKassandraManagedPoolController.FeesPercentages(feesToManager, feesToReferral);
        
        return _joinPool(recipient, referrer, manager, _pool, investFees, request);
    }


     function _joinPool(
        address recipient,
        address referrer,
        address manager,
        address pool,
        IKassandraManagedPoolController.FeesPercentages memory investFees,
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
        JoinKind joinKind = abi.decode(request.userData, (JoinKind));
        bytes32 poolId = IManagedPool(pool).getPoolId();
        IERC20 poolToken = IERC20(pool);

        if (joinKind == JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _joinPoolExactIn(poolId, recipient, referrer, manager, poolToken, investFees, request);
        } else if (joinKind == JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return _joinPoolExactOut(poolId, recipient, referrer, manager, poolToken, investFees, request);
        } else if (joinKind == JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return _joinPoolAllTokensExactOut(poolId, recipient, referrer, manager, poolToken, investFees, request);
        }
    }

    function _joinPoolExactIn(
        bytes32 poolId,
        address recipient,
        address referrer,
        address manager,
        IERC20 poolToken,
        IKassandraManagedPoolController.FeesPercentages memory investFees,
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

        _vault.joinPool(poolId, address(this), address(this), request);

        uint256 amountOutBPT = poolToken.balanceOf(address(this));
        amountToManager = amountOutBPT.mulDown(investFees.feesToManager);
        amountToReferrer = amountOutBPT.mulDown(investFees.feesToReferral);
        amountToRecipient = amountOutBPT.sub(amountToManager).sub(amountToReferrer);
        _require(amountToRecipient >= minBPTAmountOut, Errors.BPT_OUT_MIN_AMOUNT);

        if (referrer == address(0)) {
            referrer = manager;
        }

        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);

        emit JoinedPool(recipient, manager, referrer, amountToRecipient, amountToManager, amountToReferrer);

        amountsIn = request.maxAmountsIn;
    }

    function _joinPoolExactOut(
        bytes32 poolId,
        address recipient,
        address referrer,
        address manager,
        IERC20 poolToken,
        IKassandraManagedPoolController.FeesPercentages memory investFees,
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
        ( , amountToRecipient, indexToken) = abi.decode(request.userData, (uint256, uint256, uint256));
        uint256 bptAmount = amountToRecipient.divDown(
            FixedPoint.ONE.sub(investFees.feesToManager).sub(investFees.feesToReferral)
        );

        IERC20 tokenIn = IERC20(address(request.assets[indexToken + 1]));

        request.userData = abi.encode(JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT, bptAmount, indexToken);

        _vault.joinPool(poolId, address(this), address(this), request);

        if (referrer == address(0)) {
            referrer = manager;
        }

        amountToReferrer = bptAmount.mulDown(investFees.feesToReferral);
        amountToManager = bptAmount.sub(amountToReferrer).sub(amountToRecipient);

        poolToken.safeTransfer(recipient, amountToRecipient);
        poolToken.safeTransfer(manager, amountToManager);
        poolToken.safeTransfer(referrer, amountToReferrer);

        emit JoinedPool(recipient, manager, referrer, amountToRecipient, amountToManager, amountToReferrer);

        uint256 amountGiveBack = tokenIn.balanceOf(address(this));
        amountsIn = new uint256[](request.maxAmountsIn.length);
        amountsIn[indexToken + 1] = request.maxAmountsIn[indexToken + 1].sub(amountGiveBack);
        tokenIn.safeTransfer(recipient, amountGiveBack);
    }

    function _joinPoolAllTokensExactOut(
        bytes32 poolId,
        address recipient,
        address referrer,
        address manager,
        IERC20 poolToken,
        IKassandraManagedPoolController.FeesPercentages memory investFees,
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
            FixedPoint.ONE.sub(investFees.feesToManager).sub(investFees.feesToReferral)
        );

        request.userData = abi.encode(JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, bptAmount);

        _vault.joinPool(poolId, address(this), address(this), request);

        if (referrer == address(0)) {
            referrer = manager;
        }

        amountToReferrer = bptAmount.mulDown(investFees.feesToReferral);
        amountToManager = bptAmount.sub(amountToReferrer).sub(amountToRecipient);

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
}
