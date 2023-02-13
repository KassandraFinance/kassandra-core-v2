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

interface IPrivateInvestors {
    function setController(address controller) external;

    function isInvestorAllowed(address pool, address investor) external view returns (bool);

    function addPrivateInvestors(address[] calldata investors) external;

    function removePrivateInvestors(address[] calldata investors) external;

    event PrivateInvestorsAdded(bytes32 indexed poolId, address indexed poolAddress, address[] investor);

    event PrivateInvestorsRemoved(bytes32 indexed poolId, address indexed poolAddress, address[] investor);
}
