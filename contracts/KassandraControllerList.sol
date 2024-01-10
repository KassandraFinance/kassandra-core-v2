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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

import "./interfaces/IKassandraControllerList.sol";

contract KassandraControllerList is IKassandraControllerList, OwnableUpgradeable {
    mapping(address => bool) private _isKassandraController;
    mapping(address => bool) private _factories;

    function initialize() public initializer {
        __Ownable_init();

    }

    function setFactory(address factory, bool isAllowed) external onlyOwner {
        _factories[factory] = isAllowed;
    }

    function setControllers(address[] calldata controllers) external onlyOwner {
        uint256 length = controllers.length;
        for (uint i = 0; i < length; i++) {
            _isKassandraController[controllers[i]] = true;
        }
    }

    function setController(address controller) external override {
        _require(_factories[msg.sender], Errors.SENDER_NOT_ALLOWED);
        _isKassandraController[controller] = true;
    }

    function isKassandraController(address controller) external view override returns (bool) {
        return _isKassandraController[controller];
    }
}
