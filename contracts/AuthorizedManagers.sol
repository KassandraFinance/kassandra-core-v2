// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "./interfaces/IAuthorizedManagers.sol";

contract AuthorizedManagers is IAuthorizedManagers, Ownable {
    address private _factory;
    mapping(address => uint8) private _manager;

    constructor(address factory) {
        _factory = factory;
    }

    function setFactory(address factory) external onlyOwner {
        _factory = factory;
    }

    function getAllowedPoolsToCreate(address manager) external view returns (uint8) {
        return _manager[manager];
    }

    function canCreatePool(address manager) external view override returns (bool) {
        return _manager[manager] > 0;
    }

    function setManager(address manager, uint8 qtdApproved) external onlyOwner {
        require(manager != address(0), "ERR_ZERO_ADDRESS");
        _manager[manager] = qtdApproved;
    }

    function managerCreatedPool(address manager) external override {
        require(msg.sender == _factory && _manager[manager] > 0, "ERR_NOT_ALLOWED");

        _manager[manager]--;
    }
}