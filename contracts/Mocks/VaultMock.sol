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

contract VaultMock {
    using SafeERC20 for IERC20;

    bytes32 private _savedPoolId;

    function mockSavePoolId(bytes32 poolId) external {
        _savedPoolId = poolId;
    }

    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request
    ) external payable {
        require(poolId == _savedPoolId, "Wrong poolId");
        require(request.assets.length == request.maxAmountsIn.length,
            "request.assets and request.maxAmountsIn lenghts mismatch");
        (WeightedPoolUserData.JoinKind joinKind, uint256[] memory amountsIn) = abi.decode(
            request.userData, (WeightedPoolUserData.JoinKind, uint256[])
        );
        require(joinKind == WeightedPoolUserData.JoinKind.INIT, "Wrong joinKind");
        require(amountsIn.length == request.assets.length - 1,
            "AmountsIn should have one element less than request.assets");
        require(!request.fromInternalBalance, "request.fromInternalBalance should be false");
        for (uint256 i = 0; i < request.assets.length; i++) {
            if (i > 0) {
                require(request.maxAmountsIn[i] == amountsIn[i - 1], "Amount values mismatch");
                IERC20(address(request.assets[i])).safeTransferFrom(sender, address(this), amountsIn[i - 1]);
            }
        }
    }
}
