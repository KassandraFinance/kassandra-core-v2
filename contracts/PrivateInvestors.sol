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
    // pool address -> investor -> index
    mapping(address => mapping(address => uint32)) private _investorIndexInPoolByAddress;
    // pool address -> index -> investor
    mapping(address => mapping(uint32 => address)) private _investorAddressInPoolByIndex;
    // pool address -> length
    mapping(address => uint32) private _numAllowedInvestors;

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
        return _investorIndexInPoolByAddress[pool][investor] > 0;
    }

    function addPrivateInvestors(address[] calldata investors) external override {
        _require(_controllers[msg.sender], Errors.SENDER_NOT_ALLOWED);

        address pool = BasePoolController(msg.sender).pool();
        address owner = ManagedPool(pool).getOwner();

        _require(owner == msg.sender, Errors.CALLER_IS_NOT_OWNER);

        uint256 size = investors.length;
        uint32 numInvestors = _numAllowedInvestors[pool];
        for (uint256 i = 0; i < size; i++) {
            _require(_investorIndexInPoolByAddress[pool][investors[i]] == 0, Errors.ADDRESS_ALREADY_ALLOWLISTED);
            numInvestors++;
            _investorIndexInPoolByAddress[pool][investors[i]] = numInvestors;
            _investorAddressInPoolByIndex[pool][numInvestors] = investors[i];
        }
        _numAllowedInvestors[pool] = numInvestors;

        emit PrivateInvestorsAdded(ManagedPool(pool).getPoolId(), pool, investors);
    }

    function removePrivateInvestors(address[] calldata investors) external override {
        _require(_controllers[msg.sender], Errors.SENDER_NOT_ALLOWED);

        address pool = BasePoolController(msg.sender).pool();
        address owner = ManagedPool(pool).getOwner();

        _require(owner == msg.sender, Errors.CALLER_IS_NOT_OWNER);

        uint256 size = investors.length;
        uint32 numInvestors = _numAllowedInvestors[pool];
        for (uint256 i = 0; i < size; i++) {
            uint32 index = _investorIndexInPoolByAddress[pool][investors[i]];
            _require(index > 0, Errors.ADDRESS_NOT_ALLOWLISTED);

            address lastInvestor = _investorAddressInPoolByIndex[pool][numInvestors];
            _investorIndexInPoolByAddress[pool][lastInvestor] = index;
            delete _investorIndexInPoolByAddress[pool][investors[i]];

            delete _investorAddressInPoolByIndex[pool][index];
            _investorAddressInPoolByIndex[pool][index] = _investorAddressInPoolByIndex[pool][numInvestors];

            numInvestors--;
        }
        _numAllowedInvestors[pool] = numInvestors;

        emit PrivateInvestorsRemoved(ManagedPool(pool).getPoolId(), pool, investors);
    }

    function countAllowedInvestors(address pool) external view returns (uint32) {
        return _numAllowedInvestors[pool];
    }

    function getInvestors(address pool, uint256 skip, uint256 take) external view returns (address[] memory) {
        uint256 size = _numAllowedInvestors[pool];
        uint256 _skip = skip > size ? size : skip;
        uint256 _take = take + _skip;
        _take = _take > size ? size : _take;

        address[] memory investors = new address[](_take - _skip);
        for (uint256 i = skip; i < _take; i++) {
            investors[i - skip] = _investorAddressInPoolByIndex[pool][uint32(i + 1)];
        }

        return investors;
    }
}
