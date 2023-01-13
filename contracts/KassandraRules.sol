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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
// import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./interfaces/IKassandraRules.sol";
import "./lib/KacyErrors.sol";

contract KassandraRules is IKassandraRules, /*Initializable,*/ Ownable/*, UUPSUpgradeable*/ {
    address internal _upgrader;
    address internal _addressKCUPE;
    uint256 internal _maxWeightChangePerSecond;
    uint256 internal _minWeightChangeDuration;

    /**
     * @dev Emitted when the implementation returned by the beacon is changed.
     */
    event Upgraded(address indexed implementation);

    // function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(
        address addressKCUPE,
        uint256 maximumWeightChangePerSecond,
        uint256 minimumWeightChangeDuration
     ) external /*initializer*/ {
        _addressKCUPE = addressKCUPE;
        _maxWeightChangePerSecond = maximumWeightChangePerSecond;
        _minWeightChangeDuration = minimumWeightChangeDuration;
    }

    function controllerExtender() external view override returns(address) {
        return _addressKCUPE;
    }

    function maxWeightChangePerSecond() external view override returns(uint256) {
        return _maxWeightChangePerSecond;
    }

    function minWeightChangeDuration() external view override returns(uint256) {
        return _minWeightChangeDuration;
    }

    function setControllerExtender(address addressKCUPE) external onlyOwner {
        require(addressKCUPE != address(0), KacyErrors.ZERO_ADDRESS);
        _addressKCUPE = addressKCUPE;
        emit Upgraded(addressKCUPE);
    }

    function setMaxWeightChangePerSecond(uint256 maximumWeightChangePerSecond) external onlyOwner {
        require(maximumWeightChangePerSecond > 0, KacyErrors.ZERO_VALUE);
        _maxWeightChangePerSecond = maximumWeightChangePerSecond;
    }

    function setMinWeightChangeDuration(uint256 minimumWeightChangeDuration) external onlyOwner {
        require(minimumWeightChangeDuration > 0, KacyErrors.ZERO_VALUE);
        _minWeightChangeDuration = minimumWeightChangeDuration;
    }
}
