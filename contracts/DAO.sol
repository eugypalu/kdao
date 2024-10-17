// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import "./DAOToken.sol";

contract DAO {
    string public name;
    address public owner;
    uint256 public quorum; // Quorum %
    DAOToken public daoToken;
    uint256 public proposalCount;
    bool public acceptExternalProposals;

    struct Proposal {
        uint256 id;
        string description;
        uint256 votesFor;
        uint256 votesAgainst;
        bool executed;
        uint256 endBlock;
        ProposalType proposalType;
        address payable recipient;
        uint256 amount;
        uint256 newQuorum;
        bool changeAcceptExternalProposals;
        mapping(address => bool) voted;
    }

    enum ProposalType {
        Generic,
        WithdrawFunds,
        ChangeDaoSettings
    }

    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 proposalId, string description);
    event Voted(
        uint256 proposalId,
        address voter,
        bool inFavor,
        uint256 weight
    );
    event ProposalExecuted(
        uint256 proposalId,
        bool passed,
        uint256 votesFor,
        uint256 votesAgainst,
        ProposalType proposalType,
        address recipient,
        uint256 amount
    );
    event FundsReceived(address indexed from, uint256 amount);
    event FundsWithdrawn(address indexed to, uint256 amount);

    modifier onlyMembers() {
        require(daoToken.balanceOf(msg.sender) > 0, "Not a DAO member");
        _;
    }

    constructor(
        string memory _name,
        uint256 _quorum,
        address tokenAddress,
        address _owner,
        bool _acceptExternalProposals
    ) {
        name = _name;
        quorum = _quorum;
        daoToken = DAOToken(tokenAddress);
        owner = _owner;
        acceptExternalProposals = _acceptExternalProposals;
    }

    function createProposal(
        string memory description,
        uint256 duration,
        address payable recipient,
        uint256 amount,
        uint256 newQuorum,
        bool changeAcceptExternalProposals
    ) public {
        require(
            acceptExternalProposals || daoToken.balanceOf(msg.sender) > 0,
            "Not authorized to create proposal"
        );
        require(duration > 0, "Duration must be greater than 0");
        proposalCount++;
        Proposal storage newProposal = proposals[proposalCount];
        newProposal.id = proposalCount;
        newProposal.description = description;
        newProposal.endBlock = block.number + duration;
        if (recipient != address(0) && amount > 0)
            newProposal.proposalType = ProposalType.WithdrawFunds;
        else if (newQuorum != 0 || changeAcceptExternalProposals == true)
            newProposal.proposalType = ProposalType.ChangeDaoSettings;
        else newProposal.proposalType = ProposalType.Generic;
        newProposal.recipient = recipient;
        newProposal.amount = amount;
        newProposal.newQuorum = newQuorum;
        newProposal
            .changeAcceptExternalProposals = changeAcceptExternalProposals;
        emit ProposalCreated(proposalCount, description);
    }

    function vote(uint256 proposalId, bool inFavor) public onlyMembers {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.voted[msg.sender], "Already voted");
        require(!proposal.executed, "Proposal already executed");
        require(block.number <= proposal.endBlock, "Proposal has expired");

        uint256 voterWeight = daoToken.balanceOf(msg.sender); // The voting power is weighted based on the tokens owned

        proposal.voted[msg.sender] = true;
        if (inFavor) {
            proposal.votesFor += voterWeight;
        } else {
            proposal.votesAgainst += voterWeight;
        }

        emit Voted(proposalId, msg.sender, inFavor, voterWeight);
    }

    function executeProposal(uint256 proposalId) public onlyMembers {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "Proposal already executed");

        uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;
        uint256 totalSupply = daoToken.totalSupply();
        require(totalVotes >= (totalSupply * quorum) / 100, "Not enough votes");

        if (proposal.votesFor > proposal.votesAgainst) {
            if (proposal.proposalType == ProposalType.WithdrawFunds) {
                require(
                    proposal.recipient != address(0) && proposal.amount > 0
                );
                proposal.executed = true;
                withdrawFunds(proposal.recipient, proposal.amount);
            } else if (
                proposal.proposalType == ProposalType.ChangeDaoSettings
            ) {
                proposal.executed = true;
                setAcceptExternalProposals(
                    proposal.changeAcceptExternalProposals
                );
                quorum = proposal.newQuorum;
            }
        } else {
            proposal.executed = true;
        }

        emit ProposalExecuted(
            proposalId,
            proposal.votesFor > proposal.votesAgainst,
            proposal.votesFor,
            proposal.votesAgainst,
            proposal.proposalType,
            proposal.recipient,
            proposal.amount
        );
    }

    function setAcceptExternalProposals(
        bool _acceptExternalProposals
    ) internal {
        acceptExternalProposals = _acceptExternalProposals;
    }

    function getContractBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function withdrawFunds(address payable to, uint256 amount) internal {
        require(
            amount <= address(this).balance,
            "Insufficient funds in treasury"
        );
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
        emit FundsWithdrawn(to, amount);
    }

    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }
}
