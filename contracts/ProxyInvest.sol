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

contract ProxyInvest is Ownable {
    using SafeERC20 for IERC20;

    uint8 public constant EXACT_TOKENS_IN_FOR_BPT_OUT = 1; 
    
    IVault private _vault;
    address private _swapProvider;

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
        bytes32 poolId,
        IERC20 tokenIn,
        uint256 tokenAmountIn,
        IERC20 tokenExchange,
        uint256 minTokenAmountOut,
        bytes calldata data
    ) external payable {
        if(msg.value == 0) {
            tokenIn.safeTransferFrom(msg.sender, address(this), tokenAmountIn);
            if (tokenIn.allowance(address(this), _swapProvider) < tokenAmountIn) {
                tokenIn.safeApprove(_swapProvider, type(uint256).max);
            }
        }

        /* solhint-disable-next-line avoid-low-level-calls */
        (bool success, bytes memory response) = address(_swapProvider).call{ value: msg.value }(data);
        require(success, string(response));

        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(poolId);

        uint256 size = tokens.length;
        uint256[] memory maxAmountsIn = new uint256[](size);
        IAsset[] memory assets = _asIAsset(tokens);

        for (uint i = 0; i < size; i++) {
            if(tokens[i] == tokenExchange) {
                maxAmountsIn[i] = tokenExchange.balanceOf(address(this));
                if (tokenExchange.allowance(address(this), address(_vault)) < maxAmountsIn[i]) {
                    tokenExchange.safeApprove(address(_vault), type(uint256).max);
                }
            } else {
                maxAmountsIn[i] = 0;
            }
        }
        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: assets,
            maxAmountsIn: maxAmountsIn,
            userData: abi.encode(EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, minTokenAmountOut),
            fromInternalBalance: false
        });

        _vault.joinPool(poolId, address(this), msg.sender, request);
    }

    function joinPool(bytes32 poolId, IVault.JoinPoolRequest memory request) external payable {
        for (uint i = 0; i < request.assets.length; i++) {
            address tokenIn = address(request.assets[i]);
            uint256 tokenAmountIn = request.maxAmountsIn[i];
            
            if(tokenAmountIn == 0 || tokenIn == address(0)) continue;

            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), tokenAmountIn);

            if (IERC20(tokenIn).allowance(address(this), address(_vault)) < request.maxAmountsIn[i]) {
                IERC20(tokenIn).safeApprove(address(_vault), type(uint256).max);
            }
        }

        _vault.joinPool(poolId, address(this), msg.sender, request);
    }

    function exitPoolExactIn(bytes32 poolId, IVault.ExitPoolRequest memory request) external payable {
        (, uint tokenInAmount) = abi.decode(request.userData, (uint256, uint256));
        (address pool, ) = _vault.getPool(poolId);

        IERC20(pool).safeTransferFrom(msg.sender, address(this), tokenInAmount);
        if (IERC20(pool).allowance(address(this), address(_vault)) < tokenInAmount) {
            IERC20(pool).safeApprove(address(_vault), type(uint256).max);
        }
        
        _vault.exitPool(poolId, address(this), msg.sender, request);
    }
}
