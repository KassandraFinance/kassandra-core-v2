// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;

interface IPrivateInvestors {
    function isInvestorAllowed(address pool, address investor) external view returns (bool);

    function addPrivateInvestor(address investor) external;

    function removePrivateInvestor(address investor) external;

    event PrivateInvestorAdded(bytes32 indexed poolId, address indexed poolAddress, address indexed investor);

    event PrivateInvestorRemoved(bytes32 indexed poolId, address indexed poolAddress, address indexed investor);
}