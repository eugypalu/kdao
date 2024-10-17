const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOFactory", function () {
    let DAOFactory, daoFactory, DAOToken, DAO;
    let owner, addr1, addr2, addr3, addr4;
    const initialSupply = ethers.parseEther("1000000");
    const quorum = 51;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3, addr4] = await ethers.getSigners();

        DAOFactory = await ethers.getContractFactory("DAOFactory");
        daoFactory = await DAOFactory.deploy();
        await daoFactory.waitForDeployment();

        DAOToken = await ethers.getContractFactory("DAOToken");
        DAO = await ethers.getContractFactory("DAO");
    });

    describe("createDAO", function () {
        it("Should create a new DAO with a new token", async function () {
            const tx = await daoFactory.createDAO(
                "Test DAO",
                "TDT",
                [addr1.address, addr2.address],
                quorum,
                initialSupply,
                ethers.ZeroAddress,
                owner.address,
                true
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = daoFactory.interface.parseLog(log);
                    return decoded.name === 'DAOCreated';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = daoFactory.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [daoAddress, tokenAddress] = decodedEvent.args;

            const dao = DAO.attach(daoAddress);
            const token = DAOToken.attach(tokenAddress);

            expect(await dao.name()).to.equal("Test DAO");
            expect(await token.name()).to.equal("Test DAO");
            expect(await token.symbol()).to.equal("TDT");
            expect(await dao.quorum()).to.equal(quorum);
            expect(await dao.owner()).to.equal(owner.address);
            expect(await dao.acceptExternalProposals()).to.be.true;

            const memberShare = initialSupply / 2n;
            expect(await token.balanceOf(addr1.address)).to.equal(memberShare);
            expect(await token.balanceOf(addr2.address)).to.equal(memberShare);
        });

        it("Should create a new DAO with an existing token", async function () {
            const existingToken = await DAOToken.deploy("Existing Token", "ET", initialSupply, owner.address);
            await existingToken.waitForDeployment();

            const existingTokenAddress = await existingToken.getAddress();

            await existingToken.connect(owner).transfer(addr1.address, initialSupply / 2n);
            await existingToken.connect(owner).transfer(addr2.address, initialSupply / 2n);

            const tx = await daoFactory.createDAO(
                "Test DAO",
                "TDT",
                [addr1.address, addr2.address],
                quorum,
                initialSupply,
                existingTokenAddress,
                owner.address,
                false
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = daoFactory.interface.parseLog(log);
                    return decoded.name === 'DAOCreated';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = daoFactory.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [daoAddress, tokenAddress] = decodedEvent.args;

            const dao = DAO.attach(daoAddress);
            const token = DAOToken.attach(tokenAddress);

            expect(await dao.name()).to.equal("Test DAO");
            expect(await token.name()).to.equal("Existing Token");
            expect(await token.symbol()).to.equal("ET");
            expect(await dao.quorum()).to.equal(quorum);
            expect(await dao.owner()).to.equal(owner.address);
            expect(await dao.acceptExternalProposals()).to.be.false;
        });
    });

    describe("getDAOs", function () {
        it("Should return all created DAOs", async function () {
            await daoFactory.createDAO("DAO 1", "D1", [addr1.address], quorum, initialSupply, ethers.ZeroAddress, owner.address, true);
            await daoFactory.createDAO("DAO 2", "D2", [addr2.address], quorum, initialSupply, ethers.ZeroAddress, owner.address, false);

            const daos = await daoFactory.getDAOs();
            expect(daos.length).to.equal(2);
        });
    });

    describe("DAO Functionality", function () {
        let dao, daoToken;

        beforeEach(async function () {
            const tx = await daoFactory.createDAO(
                "Test DAO",
                "TDT",
                [addr1.address, addr2.address],
                quorum,
                initialSupply,
                ethers.ZeroAddress,
                owner.address,
                true
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = daoFactory.interface.parseLog(log);
                    return decoded.name === 'DAOCreated';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = daoFactory.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [daoAddress, tokenAddress] = decodedEvent.args;

            dao = DAO.attach(daoAddress);
            daoToken = DAOToken.attach(tokenAddress);
        });

        it("Should allow members to create and vote on proposals", async function () {
            await dao.connect(addr1).createProposal("Test Proposal", 100, ethers.ZeroAddress, 0, 0, false);
            expect(await dao.proposalCount()).to.equal(1);

            await dao.connect(addr1).vote(1, true);
            await dao.connect(addr2).vote(1, false);

            const proposal = await dao.proposals(1);
            expect(proposal.votesFor).to.be.gt(0);
            expect(proposal.votesAgainst).to.be.gt(0);
        });

        it("Should execute a passed withdrawproposal", async function () {
            const daoAddress = await dao.getAddress();

            await owner.sendTransaction({ to: daoAddress, value: ethers.parseEther("1") });

            await dao.connect(addr1).createProposal("Withdraw 0.5 ETH", 100, addr3.address, ethers.parseEther("0.5"), 0, false);
            await dao.connect(addr1).vote(1, true);
            await dao.connect(addr2).vote(1, true);

            await expect(dao.connect(addr3).executeProposal(1)).to.be.revertedWith("Not a DAO member");
            const tx = await dao.connect(addr2).executeProposal(1)
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = dao.interface.parseLog(log);
                    return decoded.name === 'ProposalExecuted';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = dao.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [proposalId, passed, votesFor, votesAgainst, proposalType, recipient, amount] = decodedEvent.args;

            expect(proposalId).to.equal(1);
            expect(passed).to.be.true;
            expect(votesFor).to.be.gt(0);
            expect(votesAgainst).to.equal(0);
            expect(proposalType).to.equal(1);
            expect(recipient).to.equal(addr3.address);
            expect(amount).to.equal(ethers.parseEther("0.5"));
        });

        it("Should execute a passed genericproposal", async function () {
            const daoAddress = await dao.getAddress();

            await owner.sendTransaction({ to: daoAddress, value: ethers.parseEther("1") });

            await dao.connect(addr1).createProposal("generic proposal", 100, ethers.ZeroAddress, ethers.parseEther("0"), 0, false);
            await dao.connect(addr1).vote(1, true);
            await dao.connect(addr2).vote(1, true);

            await expect(dao.connect(addr3).executeProposal(1)).to.be.revertedWith("Not a DAO member");
            const tx = await dao.connect(addr2).executeProposal(1)
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = dao.interface.parseLog(log);
                    return decoded.name === 'ProposalExecuted';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = dao.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [proposalId, passed, votesFor, votesAgainst, proposalType, recipient, amount] = decodedEvent.args;

            expect(proposalId).to.equal(1);
            expect(passed).to.be.true;
            expect(votesFor).to.be.gt(0);
            expect(votesAgainst).to.equal(0);
            expect(proposalType).to.equal(0);
            expect(recipient).to.equal(ethers.ZeroAddress);
            expect(amount).to.equal(ethers.parseEther("0"));
        });

        it("Should not execute a failed genericproposal", async function () {
            const daoAddress = await dao.getAddress();

            await owner.sendTransaction({ to: daoAddress, value: ethers.parseEther("1") });

            await dao.connect(addr1).createProposal("generic proposal", 100, ethers.ZeroAddress, ethers.parseEther("0"), 0, false);
            await dao.connect(addr1).vote(1, false);
            await dao.connect(addr2).vote(1, false);
            await expect(dao.connect(addr2).vote(1, true)).to.be.revertedWith("Already voted");

            await expect(dao.connect(addr3).executeProposal(1)).to.be.revertedWith("Not a DAO member");
            const tx = await dao.connect(addr2).executeProposal(1)
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = dao.interface.parseLog(log);
                    return decoded.name === 'ProposalExecuted';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = dao.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [proposalId, passed, votesFor, votesAgainst, proposalType, recipient, amount] = decodedEvent.args;

            expect(proposalId).to.equal(1);
            expect(passed).to.be.false;
            expect(votesFor).to.be.equal(0);
            expect(votesAgainst).to.be.gt(0);
            expect(proposalType).to.equal(0);
            expect(recipient).to.equal(ethers.ZeroAddress);
            expect(amount).to.equal(ethers.parseEther("0"));
        });

        it("Should not execute a failed withdrawproposal", async function () {
            const daoAddress = await dao.getAddress();

            await owner.sendTransaction({ to: daoAddress, value: ethers.parseEther("1") });

            await dao.connect(addr1).createProposal("Withdraw 0.5 ETH", 100, addr3.address, ethers.parseEther("0.5"), 0, false);
            await dao.connect(addr1).vote(1, false);
            await dao.connect(addr2).vote(1, true);

            await expect(dao.connect(addr3).executeProposal(1)).to.be.revertedWith("Not a DAO member");
            const tx = await dao.connect(addr2).executeProposal(1)
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const decoded = dao.interface.parseLog(log);
                    return decoded.name === 'ProposalExecuted';
                } catch (error) {
                    return false;
                }
            });

            const decodedEvent = dao.interface.parseLog(event);

            expect(decodedEvent).to.not.be.undefined;

            const [proposalId, passed] = decodedEvent.args;

            expect(proposalId).to.equal(1);
            expect(passed).to.be.false;
        });

        it("Should not allow voting on an expired proposal", async function () {
            await dao.connect(addr1).createProposal("Short-lived Proposal", 2, ethers.ZeroAddress, 0, 0, false);
            expect(await dao.proposalCount()).to.equal(1);

            for (let i = 0; i < 3; i++) {
                await ethers.provider.send("evm_mine");
            }

            await expect(dao.connect(addr1).vote(1, true))
                .to.be.revertedWith("Proposal has expired");

            const proposal = await dao.proposals(1);
            expect(proposal.votesFor).to.equal(0);
            expect(proposal.votesAgainst).to.equal(0);
        });

        it("should change quorum through a proposal", async function () {
            const newQuorum = 60;
            const duration = 100;

            // Create proposal
            await dao.connect(addr1).createProposal(
                "Change quorum to 60%",
                duration,
                ethers.ZeroAddress,
                0,
                newQuorum,
                false
            );

            await dao.connect(addr1).vote(1, true);
            await dao.connect(addr2).vote(1, true);

            await dao.connect(addr1).executeProposal(1);

            expect(await dao.quorum()).to.equal(newQuorum);
        });

        it("should allow external proposal after policy change", async function () {
            const duration = 100;
            await dao.connect(addr1).createProposal(
                "Allow external proposals",
                duration,
                ethers.ZeroAddress,
                0,
                0,
                true
            );
            await dao.connect(addr1).vote(1, true);
            await dao.connect(addr2).vote(1, true);

            await dao.connect(addr1).executeProposal(1);

            expect(await dao.acceptExternalProposals()).to.be.true;

            await dao.connect(addr4).createProposal(
                "External proposal",
                duration,
                ethers.ZeroAddress,
                0,
                0,
                false
            );
            const proposal = await dao.proposals(2);
            expect(proposal.description).to.equal("External proposal");
            await dao.connect(addr1).vote(2, true);
            await expect(dao.connect(addr4).vote(2, true)).to.be.revertedWith("Not a DAO member");
            await dao.connect(addr1).executeProposal(2);
        });
    });
});