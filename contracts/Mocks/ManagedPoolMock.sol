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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

contract ManagedPoolMock is ERC20 {
    address private _owner;
    uint256[] private _normalizedWeights;
    uint256  private _aumFee;

    constructor(address owner, uint256 aumFee) ERC20("Managed Pool", "KMP") {
        _owner = owner;
        _aumFee = aumFee;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }

    function setOwner(address owner) external {
        _owner = owner;
    }

    function setNormalizedWeights(uint256[] memory weights) external {
        _normalizedWeights = weights;
    }

    function getOwner() external view returns (address) {
        return _owner;
    }

    function getPoolId() external pure returns (bytes32) {
        return bytes32("KassandraMockedPool");
    }

    function getNormalizedWeights() external view returns(uint256[] memory) {
        return _normalizedWeights;
    }

    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        IERC20[] calldata tokens,
        uint256[] calldata endWeights
    ) external {
        require(tokens.length == endWeights.length, "Tokens and weights mismatch");
        for (uint256 i = 0; i < endWeights.length; i++) {
            require(endWeights[i] > 0, "No weight should be zero");
        }
    }

    function setMustAllowlistLPs(bool mustAllowlistLPs) external {

    }

    function addAllowedAddress(address member) external {

    }

    function getManagementAumFeeParams() external view returns (uint256, uint256) {
        return (_aumFee, block.timestamp);
    }
}
