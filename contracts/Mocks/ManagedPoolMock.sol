// SPDX-License-Identifier: SEE LICENSE IN LICENSE
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
}