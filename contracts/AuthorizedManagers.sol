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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IAuthorizedManagers.sol";
import "./lib/KacyErrors.sol";

contract AuthorizedManagers is IAuthorizedManagers, OwnableUpgradeable {
    address private _factory;
    mapping(address => uint8) private _manager;

    function initialize(address factory) public initializer {
        __Ownable_init();
        _factory = factory;
    }

    function setFactory(address factory) external onlyOwner {
        _factory = factory;
    }

    function getAllowedPoolsToCreate(address manager) external view returns (uint8) {
        return _manager[manager];
    }

    function canCreatePool(address manager) external view override returns (bool) {
        return _manager[manager] > 0;
    }

    function setManager(address manager, uint8 qtdApproved) external onlyOwner {
        require(manager != address(0), KacyErrors.ZERO_ADDRESS);
        _manager[manager] = qtdApproved;
    }

    function managerCreatedPool(address manager) external override {
        _require(msg.sender == _factory && _manager[manager] > 0, Errors.SENDER_NOT_ALLOWED);

        _manager[manager]--;
    }
}
