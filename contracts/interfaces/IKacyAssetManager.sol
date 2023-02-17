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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

interface IKacyAssetManager {
    function addToken(
        IERC20 tokenToAdd,
        uint256 tokenToAddBalance,
        IVault vault,
        bytes32 vaultPoolId
        ) external;
    function removeToken(
        IERC20 tokenToRemove,
        uint256 tokenToRemoveBalance,
        IVault vault,
        bytes32 vaultPoolId,
        address recipient
        ) external;
}
