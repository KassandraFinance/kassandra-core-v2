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

contract ManagedPoolMock {
    address private _owner;

    function setOwner(address owner) external {
        _owner = owner;
    }

    function getOwner() external view returns (address) {
        return _owner;
    }

    function getPoolId() external pure returns (bytes32) {
        return bytes32("0x");
    }

    function setMustAllowlistLPs(bool mustAllowlistLPs) external {

    }
    
    function addAllowedAddress(address member) external {

    }
}
