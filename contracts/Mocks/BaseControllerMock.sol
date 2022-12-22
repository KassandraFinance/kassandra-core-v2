// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;

import "../interfaces/IPrivateInvestors.sol";

contract BaseControllerMock {
    address public pool;

    constructor(address _pool) {
        pool = _pool;
    }

    function addAllowedInvestor(address investor, address privateInvestorContract) external {
        IPrivateInvestors(privateInvestorContract).addPrivateInvestor(investor);
    }

    function removeAllowedInvestor(address investor, address privateInvestorContract) external {
        IPrivateInvestors(privateInvestorContract).removePrivateInvestor(investor);
    }
}
