// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "./DAO.sol";
import "./DAOToken.sol";

contract DAOFactory {
    address[] public daos;

    event DAOCreated(address daoAddress, address tokenAddress);

    function createDAO(
        string memory name,
        string memory symbol,
        address[] memory initialMembers,
        uint256 quorum,
        uint256 initialSupply,
        address tokenAddress,
        address owner,
        bool acceptExternalProposals
    ) public {
        DAOToken daoToken;
        if (tokenAddress == address(0)) {
            // Create a new token if no address is provided
            daoToken = new DAOToken(name, symbol, initialSupply, owner);
            // Distribute tokens to initial members (fairly or custom)
            uint256 memberShare = initialSupply / initialMembers.length;
            for (uint256 i = 0; i < initialMembers.length; i++) {
                daoToken.transfer(initialMembers[i], memberShare);
            }
        } else {
            // Use the existing token if an address is provided
            daoToken = DAOToken(tokenAddress);
        }
        DAO newDAO = new DAO(
            name,
            quorum,
            address(daoToken),
            owner,
            acceptExternalProposals
        );
        daos.push(address(newDAO));
        emit DAOCreated(address(newDAO), address(daoToken));
    }

    function getDAOs() public view returns (address[] memory) {
        return daos;
    }
}
