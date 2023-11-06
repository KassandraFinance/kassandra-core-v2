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

import "./BaseControllerMock.sol";

contract ControllerMock is BaseControllerMock {
    struct FeesPercentages {
        uint64 feesToManager;
        uint64 feesToReferral;
    }
    
    address private _owner;
    address private _member;
    FeesPercentages private _fees;

    constructor(address owner, address pool) BaseControllerMock(pool) {
        _owner = owner;
    }

    function setMember(address member) external {
        _member = member;
    }

    function removeMember() external {
        _member = address(0);
    }

    function setPool(address _pool) external {
        pool = _pool;
    }

    function setFees(uint64 feeManager, uint64 feeReferral) external {
        _fees.feesToManager = feeManager;
        _fees.feesToReferral = feeReferral;
    }

    function isAllowedAddress(address member) external view returns (bool) {
        return _member == member;
    }

    function getManager() external view returns (address) {
        return _owner;
    }

    function getJoinFees() external view returns (uint64 feesToManager, uint64 feesToReferral) {
        return (_fees.feesToManager, _fees.feesToReferral);
    }
}