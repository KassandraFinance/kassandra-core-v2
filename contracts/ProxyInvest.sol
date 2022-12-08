//SPDX-License-Identifier: GPL-3-or-later
pragma solidity >=0.7.0 <0.9.0;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

contract ProxyInvest {
    using SafeERC20 for IERC20;

    IVault public vault;

    constructor(IVault _vault) {
        vault = _vault;
    }
}