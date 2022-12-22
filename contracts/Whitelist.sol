// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "./interfaces/IWhitelist.sol";
import "hardhat/console.sol";

contract KassandraWhitelist is IWhitelist, Ownable {
    bool internal constant _IS_BLACKLIST = false;

    address[] private _tokens;
    mapping(address => uint256) private _indexToken;
    mapping(address => bool) private _tokenList;

    event TokenAdded(address indexed token);

    function isTokenWhitelisted(address token) external view override returns (bool) {
        return _tokenList[token];
    }

    function getTokens(uint256 skip, uint256 take) external view override returns (address[] memory) {
        uint256 size = _tokens.length;
        uint256 _skip = skip > size ? size : skip;
        uint256 _take = take + _skip;
        _take = _take > size ? size : _take;

        address[] memory tokens = new address[](_take - _skip);
        for (uint i = skip; i < _take; i++) {
            tokens[i - skip] = _tokens[i];
        }

        return tokens;
    }

    function isBlacklist() external pure override returns (bool) {
        return _IS_BLACKLIST;
    }

    function addTokenToList(address token, bool allowance) external onlyOwner {
        require(token != address(0), "ERR_ZERO_ADDRESS");
        require(_tokenList[token] != allowance, "ERR_ALREADY_INCLUDED");

        _tokenList[token] = allowance;

        if (allowance) {
            _tokens.push(token);
            _indexToken[token] = _tokens.length;
        } else {
            uint256 index = _indexToken[token];
            _tokens[index - 1] = _tokens[_tokens.length - 1];
            _indexToken[_tokens[_tokens.length - 1]] = index;
            _indexToken[token] = 0;
            _tokens.pop();
        }

        emit TokenAdded(token);
    }

    // criar remove removetokenfromlist e evendo token removed
}
