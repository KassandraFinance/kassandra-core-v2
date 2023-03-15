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
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./interfaces/IKassandraRules.sol";
import "./lib/KacyErrors.sol";

contract KassandraRules is IKassandraRulesImp, Initializable, OwnableUpgradeable {
    address internal _addressKCUPE;
    uint256 internal _maxWeightChangePerSecond;
    uint256 internal _minWeightChangeDuration;
    uint256 internal _kassandraAumFee;

    /**
     * @dev Emitted when the implementation returned by the beacon is changed.
     */
    event Upgraded(address indexed implementation);
    event WeightChangeDurationUpdated(uint256 oldMinimumDuration, uint256 newMinimumDuration);
    event WeightChangePerSecondUpdated(uint256 oldMaxChangePerSecond, uint256 newMaxChangePerSecond);
    event KassandraAumFeePercentageUpdated(uint256 newKassandraAumFee);

    // function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(
        address addressKCUPE,
        uint256 maximumWeightChangePerSecond,
        uint256 minimumWeightChangeDuration,
        uint256 kassandraAumFee
     ) external initializer {
        __Ownable_init();
        setKassandraAumFeePercentage(kassandraAumFee);
        setControllerExtender(addressKCUPE);
        setMaxWeightChangePerSecond(maximumWeightChangePerSecond);
        setMinWeightChangeDuration(minimumWeightChangeDuration);
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

    function kassandraAumFeePercentage() external view override returns(uint256) {
        return _kassandraAumFee;
    }

    function setKassandraAumFeePercentage(uint256 kassandraAumFee) public onlyOwner {
        _kassandraAumFee = kassandraAumFee;
        emit KassandraAumFeePercentageUpdated(_kassandraAumFee);
    }

    function setControllerExtender(address addressKCUPE) public onlyOwner {
        require(addressKCUPE != address(0), KacyErrors.ZERO_ADDRESS);
        _addressKCUPE = addressKCUPE;
        emit Upgraded(addressKCUPE);
    }

    function setMaxWeightChangePerSecond(uint256 maximumWeightChangePerSecond) public onlyOwner {
        require(maximumWeightChangePerSecond > 0, KacyErrors.ZERO_VALUE);
        emit WeightChangePerSecondUpdated(_maxWeightChangePerSecond, maximumWeightChangePerSecond);
        _maxWeightChangePerSecond = maximumWeightChangePerSecond;
    }

    function setMinWeightChangeDuration(uint256 minimumWeightChangeDuration) public onlyOwner {
        require(minimumWeightChangeDuration > 0, KacyErrors.ZERO_VALUE);
        emit WeightChangeDurationUpdated(_minWeightChangeDuration, minimumWeightChangeDuration);
        _minWeightChangeDuration = minimumWeightChangeDuration;
    }
}
