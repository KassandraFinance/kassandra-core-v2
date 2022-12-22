// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;

interface IAuthorizedManagers {
    function canCreatePool(address manager) external view returns (bool);

    function managerCreatedPool(address manager) external;
}