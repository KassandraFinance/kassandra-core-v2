//SPDX-License-Identifier: GPL-3-or-later
pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

interface IWhitelist {
    function isTokenWhitelisted(address token) external view returns (bool);

    function isBlacklist() external pure returns (bool);

    function getTokens(uint256 skip, uint256 take) external view returns (address[] memory);
}