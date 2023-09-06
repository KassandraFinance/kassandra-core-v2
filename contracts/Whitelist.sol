// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IWhitelist.sol";
import "./lib/KacyErrors.sol";

contract KassandraWhitelist is IWhitelist, OwnableUpgradeable {
    bool internal constant _IS_BLACKLIST = false;

    address[] private _tokens;
    mapping(address => uint256) private _indexToken;
    mapping(address => bool) private _tokenList;

    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);

    function initialize() public initializer {
        __Ownable_init();
    }

    function isTokenWhitelisted(address token) external view override returns (bool) {
        return _tokenList[token];
    }

    function countTokens() external view override returns (uint256) {
        return _tokens.length;
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

    function addTokensToList(address[] calldata tokens) external onlyOwner {
        uint256 length = tokens.length;
        for (uint i = 0; i < length; i++) {
            address token = tokens[i];
            require(token != address(0), KacyErrors.ZERO_ADDRESS);
            _require(_tokenList[token] == false, Errors.TOKEN_ALREADY_REGISTERED);

            _tokenList[token] = true;

            _tokens.push(token);
            _indexToken[token] = _tokens.length;

            emit TokenAdded(token);
        }
    }

    function addTokenToList(address token) external onlyOwner {
        require(token != address(0), KacyErrors.ZERO_ADDRESS);
        _require(_tokenList[token] == false, Errors.TOKEN_ALREADY_REGISTERED);

        _tokenList[token] = true;

        _tokens.push(token);
        _indexToken[token] = _tokens.length;

        emit TokenAdded(token);
    }

    function removeTokenFromList(address token) external onlyOwner {
        _require(_tokenList[token] == true, Errors.TOKEN_NOT_REGISTERED);

        _tokenList[token] = false;

        uint256 index = _indexToken[token];
        _tokens[index - 1] = _tokens[_tokens.length - 1];
        _indexToken[_tokens[_tokens.length - 1]] = index;
        _indexToken[token] = 0;
        _tokens.pop();

        emit TokenRemoved(token);
    }
}
