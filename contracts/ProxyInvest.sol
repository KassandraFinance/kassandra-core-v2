//SPDX-License-Identifier: GPL-3-or-later
pragma solidity >=0.7.0 <0.9.0;

pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-standalone-utils/contracts/BalancerHelpers.sol";

import "hardhat/console.sol";

contract ProxyInvest is Ownable {
    using SafeERC20 for IERC20;

    uint8 public constant EXACT_TOKENS_IN_FOR_BPT_OUT = 1; 
    
    IVault public vault;
    address public swapProvider;

    constructor(IVault _vault, address _swapProvider) {
        vault = _vault;
        swapProvider = _swapProvider;
    }

    function setSwapProvider(address _swapProvider) external onlyOwner {
        swapProvider = _swapProvider;
    }

    function setVault(IVault _vault) external onlyOwner {
        vault = _vault;
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
            if (tokenIn.allowance(address(this), swapProvider) < tokenAmountIn) {
                tokenIn.safeApprove(swapProvider, type(uint256).max);
            }
        }

        (bool success, bytes memory response) = address(swapProvider).call{ value: msg.value }(data);
        require(success, string(response));

        (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);

        uint256 size = tokens.length;
        uint256[] memory maxAmountsIn = new uint256[](size);
        IAsset[] memory assets;
        
        assembly {
            assets := tokens
        }

        for (uint i = 0; i < size; i++) {
            if(tokens[i] == tokenExchange) {
                maxAmountsIn[i] = tokenExchange.balanceOf(address(this));
                if (tokenExchange.allowance(address(this), address(vault)) < maxAmountsIn[i]) {
                    tokenExchange.safeApprove(address(vault), type(uint256).max);
                }
            } else {
                maxAmountsIn[i] = 0;
            }
        }

        require(assets.length == tokens.length, "INVALID_TOKEN_EXCHANGE");

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: assets,
            maxAmountsIn: maxAmountsIn,
            userData: abi.encode(EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, minTokenAmountOut),
            fromInternalBalance: false
        });

        vault.joinPool(poolId, address(this), msg.sender, request);
    }

    function joinPool(bytes32 poolId, IVault.JoinPoolRequest memory request) external payable {
        for (uint i = 0; i < request.assets.length; i++) {
            address tokenIn = address(request.assets[i]);
            uint256 tokenAmountIn = request.maxAmountsIn[i];
            
            if(tokenAmountIn == 0 || tokenIn == address(0)) continue;

            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), tokenAmountIn);

            if (IERC20(tokenIn).allowance(address(this), address(vault)) < request.maxAmountsIn[i]) {
                IERC20(tokenIn).safeApprove(address(vault), type(uint256).max);
            }
        }

        vault.joinPool(poolId, address(this), msg.sender, request);
    }

    function exitPoolExactInForTokensOut(bytes32 poolId, IVault.ExitPoolRequest memory request) external payable {
        (, uint tokenInAmount) = abi.decode(request.userData, (uint256, uint256));
        (address pool, ) = vault.getPool(poolId);

        console.log(tokenInAmount);

        IERC20(pool).safeTransferFrom(msg.sender, address(this), tokenInAmount);
        if (IERC20(pool).allowance(address(this), address(vault)) < tokenInAmount) {
            IERC20(pool).safeApprove(address(vault), type(uint256).max);
        }
        
        vault.exitPool(poolId, address(this), msg.sender, request);
    }

    function exitPoolExactInForTokenOut(bytes32 poolId, IVault.ExitPoolRequest memory request) external payable {
        (, uint tokenInAmount, ) = abi.decode(request.userData, (uint256, uint256, uint256));
        (address pool, ) = vault.getPool(poolId);

        IERC20(pool).safeTransferFrom(msg.sender, address(this), tokenInAmount);
        if (IERC20(pool).allowance(address(this), address(vault)) < tokenInAmount) {
            IERC20(pool).safeApprove(address(vault), type(uint256).max);
        }
        
        vault.exitPool(poolId, address(this), msg.sender, request);
    }
}
