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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../balancer-v2-submodule/pkg/pool-weighted/contracts/managed/ManagedPool.sol";

import "./interfaces/IPrivateInvestors.sol";

import "./BasePoolController.sol";

contract PrivateInvestors is IPrivateInvestors, OwnableUpgradeable {
    // pool address -> investor -> bool
    mapping(address => mapping(address => bool)) private _allowedInvestors;
    mapping(address => bool) internal _controllers;
    mapping(address => bool) private _factories;

    function initialize() public initializer {
        __Ownable_init();
    }

    function setFactory(address factory) external onlyOwner {
        _require(!_factories[factory], Errors.ADDRESS_ALREADY_ALLOWLISTED);
        _factories[factory] = true;
    }

    function removeFactory(address factory) external onlyOwner {
        _require(_factories[factory], Errors.ADDRESS_NOT_ALLOWLISTED);
        _factories[factory] = false;
    }

    function setController(address controller) external override {
        _require(_factories[msg.sender], Errors.SENDER_NOT_ALLOWED);
        _require(!_controllers[controller], Errors.ADDRESS_ALREADY_ALLOWLISTED);
        _controllers[controller] = true;
    }

    function isInvestorAllowed(address pool, address investor) external view override returns (bool) {
        return _allowedInvestors[pool][investor];
    }

    function addPrivateInvestor(address investor) external override {
        _require(_controllers[msg.sender], Errors.SENDER_NOT_ALLOWED);

        address pool = BasePoolController(msg.sender).pool();
        address owner = ManagedPool(pool).getOwner();

        _require(owner == msg.sender, Errors.CALLER_IS_NOT_OWNER);
        _require(_allowedInvestors[pool][investor] != true, Errors.ADDRESS_ALREADY_ALLOWLISTED);

        _allowedInvestors[pool][investor] = true;

        emit PrivateInvestorAdded(ManagedPool(pool).getPoolId(), pool, investor);
    }

    function removePrivateInvestor(address investor) external override {
        _require(_controllers[msg.sender], Errors.SENDER_NOT_ALLOWED);

        address pool = BasePoolController(msg.sender).pool();
        address owner = ManagedPool(pool).getOwner();

        _require(owner == msg.sender, Errors.CALLER_IS_NOT_OWNER);
        _require(_allowedInvestors[pool][investor] != false, Errors.ADDRESS_NOT_ALLOWLISTED);

        _allowedInvestors[pool][investor] = false;

        emit PrivateInvestorRemoved(ManagedPool(pool).getPoolId(), pool, investor);
    }
}
