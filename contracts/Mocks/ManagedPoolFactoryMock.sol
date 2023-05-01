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

import "../../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPool.sol";
import "./ManagedPoolMock.sol";
import "./VaultMock.sol";

contract ManagedPoolFactoryMock {
    VaultMock private _vault;
    address private _assetManager;

    constructor(VaultMock vault, address assetManager) {
        _vault = vault;
        _assetManager = assetManager;
    }

    function create(
        ManagedPool.ManagedPoolParams memory params,
        ManagedPoolSettings.ManagedPoolSettingsParams memory settingsParams,
        address owner,
        bytes32
    ) external returns (address pool) {
        for (uint256 i = 0; i < params.assetManagers.length; i++) {
            require(params.assetManagers[i] == _assetManager, "Wrong asset manager");
        }

        require(!settingsParams.mustAllowlistLPs, "Pool must be set as private");
        ManagedPoolMock pool = new ManagedPoolMock(owner, settingsParams.managementAumFeePercentage);
        _vault.mockSavePoolId(pool.getPoolId());
        return address(pool);
    }
}
