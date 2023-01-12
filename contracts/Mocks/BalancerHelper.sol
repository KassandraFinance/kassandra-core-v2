// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

abstract contract BalancerHelperMock {
    function queryJoin(
        bytes32 poolId,
        address sender,
        address recipient,
        JoinPoolRequest calldata request
    ) virtual external returns (uint256 bptOut, uint256[] memory amountsIn);

    struct JoinPoolRequest {
        address[] assets;
        uint256[] maxAmountsIn;
        bytes userData;
        bool fromInternalBalance;
    }

    function queryExit(
        bytes32 poolId, 
        address sender, 
        address recipient, 
        ExitPoolRequest calldata request
        )  external virtual returns (uint256 bptIn, uint256[] memory amountsOut);

    struct ExitPoolRequest {
        address[] assets;
        uint256[] minAmountsOut;
        bytes userData;
        bool toInternalBalance;
    }
}
