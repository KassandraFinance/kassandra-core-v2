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

import "./interfaces/IKassandraManagedPoolController.sol";

contract ProxyInvest is Ownable {
    using SafeERC20 for IERC20;

    uint8 public constant EXACT_TOKENS_IN_FOR_BPT_OUT = 1;

    IVault private _vault;
    address private _swapProvider;

    struct ProxyParams {
        address recipient;
        address referrer;
        address controller;
        IERC20 tokenIn;
        uint256 tokenAmountIn;
        IERC20 tokenExchange;
        uint256 minTokenAmountOut;
    }

    constructor(IVault vault, address swapProvider) {
        _vault = vault;
        _swapProvider = swapProvider;
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
            userData: abi.encode(EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, params.minTokenAmountOut),
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
        for (uint i = 0; i < request.assets.length; i++) {
            address tokenIn = address(request.assets[i]);
            uint256 tokenAmountIn = request.maxAmountsIn[i];

            if (tokenAmountIn == 0 || tokenIn == address(0)) continue;

            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), tokenAmountIn);
            if (IERC20(tokenIn).allowance(address(this), controller) < request.maxAmountsIn[i]) {
                IERC20(tokenIn).safeApprove(controller, type(uint256).max);
            }
        }

        return IKassandraManagedPoolController(controller).joinPool(recipient, referrer, request);
    }
}
