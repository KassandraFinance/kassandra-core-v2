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
import "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./ManagedPoolMock.sol";

contract VaultMock {
    using SafeERC20 for IERC20;

    struct ExitPoolRequest {
        IAsset[] assets;
        uint256[] minAmountsOut;
        bytes userData;
        bool toInternalBalance;
    }

    bytes32 private _savedPoolId;
    WeightedPoolUserData.JoinKind private _joinKind = WeightedPoolUserData.JoinKind.INIT;
    uint256 private _amountOut;
    address private _pool;
    IERC20[] private _tokens;
    uint256[] private _amoutTokensOut;

    function mockSavePoolId(bytes32 poolId) external {
        _savedPoolId = poolId;
    }

    function mockJoinKind(WeightedPoolUserData.JoinKind kind) external {
        _joinKind = kind;
    }

    function mockPoolAddress(address pool) external {
        _pool = pool;
    }

    function mockPoolTokens(IERC20[] calldata tokens) external {
        _tokens = tokens;
    }

    function mockPoolTokensAmountOut(uint256[] calldata amounts) external {
        _amoutTokensOut = amounts;
    }

    function mockAmountOut(uint256 poolAmountOut) external {
        _amountOut = poolAmountOut;
    }

    function getPoolTokens(
        bytes32
    ) external view returns (IERC20[] memory tokens, uint256[] memory balances, uint256 lastChangeBlock) {
        return (_tokens, balances, lastChangeBlock);
    }

    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request
    ) external payable {
        require(poolId == _savedPoolId, "Wrong poolId");
        require(
            request.assets.length == request.maxAmountsIn.length,
            "request.assets and request.maxAmountsIn lenghts mismatch"
        );
        WeightedPoolUserData.JoinKind joinKind;
        uint256[] memory amountsIn = new uint256[](request.maxAmountsIn.length - 1);
        if (uint256(_joinKind) == 2 || uint256(_joinKind) == 3) {
            (joinKind) = abi.decode(request.userData, (WeightedPoolUserData.JoinKind));
            for (uint i = 1; i < request.maxAmountsIn.length; i++) {
                amountsIn[i - 1] = request.maxAmountsIn[i];
            }
        } else {
            (joinKind, amountsIn) = abi.decode(request.userData, (WeightedPoolUserData.JoinKind, uint256[]));
        }
        require(joinKind == _joinKind, "Wrong joinKind");
        require(
            amountsIn.length == request.assets.length - 1,
            "AmountsIn should have one element less than request.assets"
        );

        require(!request.fromInternalBalance, "request.fromInternalBalance should be false");
        for (uint256 i = 0; i < request.assets.length; i++) {
            if (i > 0) {
                require(request.maxAmountsIn[i] == amountsIn[i - 1], "Amount values mismatch");
                IERC20(address(request.assets[i])).safeTransferFrom(sender, address(this), amountsIn[i - 1]);
            }
        }
        if (uint256(_joinKind) != 0) {
            ManagedPoolMock(_pool).mint(sender, _amountOut);
        }
    }

    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        ExitPoolRequest memory request
    ) external {
        (, uint256 amountBptIn) = abi.decode(request.userData, (WeightedPoolUserData.ExitKind, uint256));
        ManagedPoolMock(_pool).burn(recipient, amountBptIn);
        for (uint i = 1; i < _tokens.length; i++) {
            IERC20(_tokens[i]).transfer(recipient, _amoutTokensOut[i]);
        }
    }
}
