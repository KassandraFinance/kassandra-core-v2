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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IKacyAssetManager.sol";
import "./interfaces/IPoolController.sol";
import "./lib/KacyErrors.sol";

contract KacyAssetManager is IKacyAssetManager, OwnableUpgradeable {
    /**
     * @dev Only the controller contract is allowed to modify its own pool
     */
    modifier onlyController(bytes32 vaultPoolId) {
        bytes32 requesterVaultPoolId = IManagedPool(IPoolController(msg.sender).pool()).getPoolId();
        _require(vaultPoolId == requesterVaultPoolId, Errors.SENDER_NOT_ALLOWED);
        _;
    }

    function initialize() public initializer {
        __Ownable_init();
    }

    function addToken(
        IERC20 tokenToAdd,
        uint256 tokenToAddBalance,
        IVault vault,
        bytes32 vaultPoolId
     ) external override onlyController(vaultPoolId) {
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0].kind = IVault.PoolBalanceOpKind.DEPOSIT;
        ops[0].poolId = vaultPoolId;
        ops[0].token = tokenToAdd;
        ops[0].amount = tokenToAddBalance;
        vault.managePoolBalance(ops);
    }

    function removeToken(
        IERC20 tokenToRemove,
        uint256 tokenToRemoveBalance,
        IVault vault,
        bytes32 vaultPoolId
     ) external override onlyController(vaultPoolId) {
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0].kind = IVault.PoolBalanceOpKind.WITHDRAW;
        ops[0].poolId = vaultPoolId;
        ops[0].token = tokenToRemove;
        ops[0].amount = tokenToRemoveBalance;
        vault.managePoolBalance(ops);
    }
}
