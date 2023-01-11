// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";

import "./managed/ManagedPool.sol";
import "./BasePoolController.sol";
import "./interfaces/IPrivateInvestors.sol";

contract PrivateInvestors is IPrivateInvestors, Ownable {
    // pool address -> investor -> bool
    mapping(address => mapping(address => bool)) private _allowedInvestors;
    mapping(address => bool) private _controllers;
    mapping(address => bool) private _factories;

    function setFactory(address factory) external onlyOwner {
        _factories[factory] = true;
    }

    function setController(address controller) external {
        require(_factories[msg.sender], "ERR_NOT_AUTHORIZED");
        _controllers[controller] = true;
    }

    function isInvestorAllowed(address pool, address investor) external view override returns (bool) {
        return _allowedInvestors[pool][investor];
    }

    function addPrivateInvestor(address investor) external override {
        require(_controllers[msg.sender], "ERR_NOT_AUTHORIZED");

        address pool = BasePoolController(msg.sender).pool();
        address owner = ManagedPool(pool).getOwner();

        require(owner == msg.sender, "ERR_INVALID_OWNER");
        require(_allowedInvestors[pool][investor] != true, "ADDRESS_ALREADY_ALLOWLISTED");

        _allowedInvestors[pool][investor] = true;

        emit PrivateInvestorAdded(ManagedPool(pool).getPoolId(), pool, investor);
    }

    function removePrivateInvestor(address investor) external override {
        require(_controllers[msg.sender], "ERR_NOT_AUTHORIZED");

        address pool = BasePoolController(msg.sender).pool();
        address owner = ManagedPool(pool).getOwner();

        require(owner == msg.sender, "ERR_INVALID_OWNER");
        require(_allowedInvestors[pool][investor] != false, "ADDRESS_NOT_ALLOWLISTED");

        _allowedInvestors[pool][investor] = false;

        emit PrivateInvestorRemoved(ManagedPool(pool).getPoolId(), pool, investor);
    }
}