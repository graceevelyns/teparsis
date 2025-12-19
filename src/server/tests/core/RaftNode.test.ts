import { RaftNode } from "../../src/core/RaftNode";
import { IKVStore } from "../../src/store/IKVStore";
import { ILogManager } from "../../src/core/interfaces/ILogManager";
import { IPeerClient } from "../../src/network/IPeerClient";
import { Logger } from "../../src/utils/Logger";
import {
  RaftNodeState,
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
  LogEntry,
  ServerMode,
} from "../../src/types";

// Mock config module
jest.mock("../../src/config", () => ({
  __esModule: true,
  default: {
    node: {
      id: "node1",
      host: "localhost",
      port: 3000,
      initialActive: true,
    },
    cluster: {
      peers: ["http://localhost:3001", "http://localhost:3002"],
      peersIds: ["node2", "node3"],
    },
    raft: {
      electionTimeoutMin: 150,
      electionTimeoutMax: 300,
      heartbeatInterval: 50,
    },
  },
}));

describe("RaftNode", () => {
  let raftNode: RaftNode;
  let mockStore: jest.Mocked<IKVStore>;
  let mockLogManager: jest.Mocked<ILogManager>;
  let mockPeerClient: jest.Mocked<IPeerClient>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create mock implementations
    mockStore = {
      get: jest.fn().mockReturnValue(""),
      set: jest.fn(),
      del: jest.fn().mockReturnValue(""),
      append: jest.fn().mockReturnValue(""),
      strlen: jest.fn().mockReturnValue(0),
      ping: jest.fn().mockReturnValue("PONG"),
    };

    mockLogManager = {
      appendEntry: jest.fn(),
      getEntry: jest.fn().mockReturnValue(undefined),
      getEntriesFrom: jest.fn().mockReturnValue([]),
      getLastIndex: jest.fn().mockReturnValue(-1),
      getLastTerm: jest.fn().mockReturnValue(0),
      truncateFrom: jest.fn(),
      getCommitIndex: jest.fn().mockReturnValue(-1),
      setCommitIndex: jest.fn(),
    };

    mockPeerClient = {
      sendAppendEntries: jest.fn(),
      sendRequestVote: jest.fn(),
      sendStopNode: jest.fn(),
      sendRestartNode: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create RaftNode instance with mocks
    raftNode = new RaftNode(
      mockStore,
      mockLogManager,
      mockPeerClient,
      mockLogger
    );
  });

  afterEach(() => {
    raftNode.stop();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe("Initialization", () => {
    it("should start as a follower", () => {
      expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);
    });

    it("should initialize with term 0", () => {
      expect(raftNode.getCurrentTerm()).toBe(0);
    });

    it("should not have voted for anyone initially", () => {
      expect(raftNode.getVotedFor()).toBeNull();
    });

    it("should not have a leader initially", () => {
      expect(raftNode.getLeaderId()).toBeNull();
    });

    it("should not be a leader initially", () => {
      expect(raftNode.isLeader()).toBe(false);
    });

    it("should be active initially", () => {
      expect(raftNode.getIsActive()).toBe(true);
    });
  });

  describe("Leader Election", () => {
    describe("startElection()", () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("should increment term when starting election", () => {
        raftNode.start();

        // Fast-forward to trigger election (just past max timeout)
        jest.advanceTimersByTime(310);

        expect(raftNode.getCurrentTerm()).toBe(1);
      });

      it("should vote for itself when starting election", () => {
        raftNode.start();

        // Fast-forward to trigger election
        jest.advanceTimersByTime(400);

        expect(raftNode.getVotedFor()).toBe("node1");
      });

      it("should become candidate when election starts", () => {
        raftNode.start();

        // Fast-forward to trigger election
        jest.advanceTimersByTime(400);

        expect(raftNode.getState()).toBe(RaftNodeState.CANDIDATE);
      });

      it("should send RequestVote RPCs to all peers", () => {
        raftNode.start();

        // Fast-forward to trigger election (just past max timeout)
        jest.advanceTimersByTime(310);

        // Should send to 2 peers
        expect(mockPeerClient.sendRequestVote).toHaveBeenCalledTimes(2);
      });
    });

    describe("Becoming Leader", () => {
      it("should become leader when receiving majority votes", async () => {
        jest.useFakeTimers();

        mockPeerClient.sendRequestVote.mockResolvedValue({
          term: 1,
          voteGranted: true,
        });

        raftNode.start();

        // Fast-forward to trigger election
        jest.advanceTimersByTime(400);

        // Use real timers for promise resolution
        jest.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(raftNode.getState()).toBe(RaftNodeState.LEADER);
      });

      it("should set itself as leader ID when becoming leader", async () => {
        jest.useFakeTimers();

        mockPeerClient.sendRequestVote.mockResolvedValue({
          term: 1,
          voteGranted: true,
        });

        raftNode.start();
        jest.advanceTimersByTime(400);

        jest.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(raftNode.getLeaderId()).toBe("node1");
      });

      it("should be identified as leader after winning election", async () => {
        jest.useFakeTimers();

        mockPeerClient.sendRequestVote.mockResolvedValue({
          term: 1,
          voteGranted: true,
        });

        raftNode.start();
        jest.advanceTimersByTime(400);

        jest.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(raftNode.isLeader()).toBe(true);
      });
    });

    describe("Election Failures", () => {
      it("should step down if higher term is seen during election", async () => {
        jest.useFakeTimers();

        mockPeerClient.sendRequestVote.mockResolvedValue({
          term: 5,
          voteGranted: false,
        });

        raftNode.start();
        jest.advanceTimersByTime(400);

        jest.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(raftNode.getCurrentTerm()).toBe(5);
        expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);
      });

      it("should remain candidate if not enough votes received", async () => {
        jest.useFakeTimers();

        mockPeerClient.sendRequestVote.mockResolvedValue({
          term: 1,
          voteGranted: false,
        });

        raftNode.start();
        jest.advanceTimersByTime(400);

        jest.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should remain candidate (not become leader)
        expect(raftNode.getState()).toBe(RaftNodeState.CANDIDATE);
      });

      it("should handle vote request failures gracefully", async () => {
        jest.useFakeTimers();

        mockPeerClient.sendRequestVote.mockRejectedValue(
          new Error("Network error")
        );

        raftNode.start();
        jest.advanceTimersByTime(400);

        jest.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should still be candidate
        expect(raftNode.getState()).toBe(RaftNodeState.CANDIDATE);
      });
    });
  });

  describe("Log Replication - processAppendEntries()", () => {
    const createAppendEntriesRequest = (
      term: number,
      prevLogIndex: number,
      prevLogTerm: number,
      entries: LogEntry[] = [],
      leaderCommit: number = -1
    ): AppendEntriesRequest => ({
      term,
      leaderId: "leader",
      prevLogIndex,
      prevLogTerm,
      entries,
      leaderCommit,
    });

    describe("Basic validation", () => {
      it("should reject request with lower term", () => {
        raftNode["currentTerm"] = 5;

        const request = createAppendEntriesRequest(3, -1, 0);
        const response = raftNode.processAppendEntries(request);

        expect(response.success).toBe(false);
        expect(response.term).toBe(5);
      });

      it("should accept request with same term", () => {
        raftNode["currentTerm"] = 5;
        mockLogManager.getEntry.mockReturnValue(undefined);

        const request = createAppendEntriesRequest(5, -1, 0);
        const response = raftNode.processAppendEntries(request);

        expect(response.success).toBe(true);
        expect(response.term).toBe(5);
      });

      it("should update term and become follower if higher term received", () => {
        raftNode["currentTerm"] = 3;
        mockLogManager.getEntry.mockReturnValue(undefined);

        const request = createAppendEntriesRequest(5, -1, 0);
        raftNode.processAppendEntries(request);

        expect(raftNode.getCurrentTerm()).toBe(5);
        expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);
      });

      it("should update leader ID from request", () => {
        mockLogManager.getEntry.mockReturnValue(undefined);

        const request = createAppendEntriesRequest(1, -1, 0);
        raftNode.processAppendEntries(request);

        expect(raftNode.getLeaderId()).toBe("leader");
      });
    });

    describe("Log consistency check", () => {
      it("should reject if log does not contain entry at prevLogIndex with matching term", () => {
        mockLogManager.getEntry.mockReturnValue({
          index: 0,
          term: 1,
          timestamp: Date.now(),
        });

        const request = createAppendEntriesRequest(2, 0, 2); // Expects term 2 at index 0, but we have term 1
        const response = raftNode.processAppendEntries(request);

        expect(response.success).toBe(false);
      });

      it("should accept if prevLogIndex is -1 (empty log)", () => {
        mockLogManager.getEntry.mockReturnValue(undefined);

        const request = createAppendEntriesRequest(1, -1, 0);
        const response = raftNode.processAppendEntries(request);

        expect(response.success).toBe(true);
      });

      it("should accept if log contains matching entry at prevLogIndex", () => {
        mockLogManager.getEntry.mockReturnValue({
          index: 2,
          term: 3,
          timestamp: Date.now(),
        });

        const request = createAppendEntriesRequest(3, 2, 3);
        const response = raftNode.processAppendEntries(request);

        expect(response.success).toBe(true);
      });
    });

    describe("Appending entries", () => {
      it("should append new entries to the log", () => {
        mockLogManager.getEntry.mockReturnValue(undefined);
        mockLogManager.getLastIndex.mockReturnValue(0);

        const newEntry: LogEntry = {
          index: 0,
          term: 1,
          command: { operation: "set", key: "x", value: "1" },
          timestamp: Date.now(),
        };

        const request = createAppendEntriesRequest(1, -1, 0, [newEntry]);
        raftNode.processAppendEntries(request);

        expect(mockLogManager.appendEntry).toHaveBeenCalledWith(newEntry);
      });

      it("should truncate conflicting entries", () => {
        // First call for prevLogIndex check
        mockLogManager.getEntry
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce({ index: 1, term: 1, timestamp: Date.now() }); // Conflict at index 1

        const newEntry: LogEntry = {
          index: 1,
          term: 2,
          command: { operation: "set", key: "y", value: "2" },
          timestamp: Date.now(),
        };

        const request = createAppendEntriesRequest(2, -1, 0, [newEntry]);
        raftNode.processAppendEntries(request);

        expect(mockLogManager.truncateFrom).toHaveBeenCalledWith(0);
        expect(mockLogManager.appendEntry).toHaveBeenCalledWith(newEntry);
      });
    });

    describe("Commit index updates", () => {
      it("should update commit index if leaderCommit is higher", () => {
        mockLogManager.getEntry.mockReturnValue(undefined);
        mockLogManager.getCommitIndex.mockReturnValue(0);
        mockLogManager.getLastIndex.mockReturnValue(5);

        const request = createAppendEntriesRequest(1, -1, 0, [], 3);
        raftNode.processAppendEntries(request);

        expect(mockLogManager.setCommitIndex).toHaveBeenCalledWith(3);
      });

      it("should not update commit index if leaderCommit is lower", () => {
        mockLogManager.getEntry.mockReturnValue(undefined);
        mockLogManager.getCommitIndex.mockReturnValue(5);

        const request = createAppendEntriesRequest(1, -1, 0, [], 3);
        raftNode.processAppendEntries(request);

        expect(mockLogManager.setCommitIndex).not.toHaveBeenCalled();
      });

      it("should cap commit index at last new entry", () => {
        mockLogManager.getEntry.mockReturnValue(undefined);
        mockLogManager.getCommitIndex.mockReturnValue(0);
        mockLogManager.getLastIndex.mockReturnValue(3);

        const request = createAppendEntriesRequest(1, -1, 0, [], 10);
        raftNode.processAppendEntries(request);

        expect(mockLogManager.setCommitIndex).toHaveBeenCalledWith(3);
      });
    });
  });

  describe("RequestVote Processing", () => {
    const createRequestVoteRequest = (
      term: number,
      candidateId: string,
      lastLogIndex: number,
      lastLogTerm: number
    ): RequestVoteRequest => ({
      term,
      candidateId,
      lastLogIndex,
      lastLogTerm,
    });

    it("should reject vote if candidate term is lower", () => {
      raftNode["currentTerm"] = 5;

      const request = createRequestVoteRequest(3, "candidate1", 0, 1);
      const response = raftNode.processRequestVote(request);

      expect(response.voteGranted).toBe(false);
      expect(response.term).toBe(5);
    });

    it("should grant vote if candidate log is up-to-date and not voted yet", () => {
      mockLogManager.getLastTerm.mockReturnValue(1);
      mockLogManager.getLastIndex.mockReturnValue(2);

      const request = createRequestVoteRequest(1, "candidate1", 2, 1);
      const response = raftNode.processRequestVote(request);

      expect(response.voteGranted).toBe(true);
      expect(raftNode.getVotedFor()).toBe("candidate1");
    });

    it("should reject vote if already voted for different candidate", () => {
      raftNode["currentTerm"] = 1;
      raftNode["votedFor"] = "candidate1";
      mockLogManager.getLastTerm.mockReturnValue(1);
      mockLogManager.getLastIndex.mockReturnValue(2);

      const request = createRequestVoteRequest(1, "candidate2", 2, 1);
      const response = raftNode.processRequestVote(request);

      expect(response.voteGranted).toBe(false);
    });

    it("should grant vote to same candidate if already voted for them", () => {
      raftNode["votedFor"] = "candidate1";
      mockLogManager.getLastTerm.mockReturnValue(1);
      mockLogManager.getLastIndex.mockReturnValue(2);

      const request = createRequestVoteRequest(1, "candidate1", 2, 1);
      const response = raftNode.processRequestVote(request);

      expect(response.voteGranted).toBe(true);
    });

    it("should reject vote if candidate log is not up-to-date (lower term)", () => {
      mockLogManager.getLastTerm.mockReturnValue(3);
      mockLogManager.getLastIndex.mockReturnValue(2);

      const request = createRequestVoteRequest(1, "candidate1", 5, 2);
      const response = raftNode.processRequestVote(request);

      expect(response.voteGranted).toBe(false);
    });

    it("should reject vote if candidate log is not up-to-date (same term, shorter log)", () => {
      mockLogManager.getLastTerm.mockReturnValue(2);
      mockLogManager.getLastIndex.mockReturnValue(5);

      const request = createRequestVoteRequest(1, "candidate1", 3, 2);
      const response = raftNode.processRequestVote(request);

      expect(response.voteGranted).toBe(false);
    });

    it("should update term and become follower if higher term in vote request", () => {
      raftNode["currentTerm"] = 2;
      mockLogManager.getLastTerm.mockReturnValue(1);
      mockLogManager.getLastIndex.mockReturnValue(0);

      const request = createRequestVoteRequest(5, "candidate1", 0, 1);
      raftNode.processRequestVote(request);

      expect(raftNode.getCurrentTerm()).toBe(5);
      expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);
    });
  });

  describe("Membership Changes", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // Make node a leader
      raftNode["state"] = RaftNodeState.LEADER;
      raftNode["leaderId"] = "node1";
      raftNode["currentTerm"] = 1;
      mockLogManager.getLastIndex.mockReturnValue(5);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe("addVoter()", () => {
      it("should add a new voter as staging mode", async () => {
        mockPeerClient.sendRestartNode.mockResolvedValue({ success: true });

        const result = await raftNode.addVoter(
          "node4",
          "http://localhost:3003"
        );

        expect(result.success).toBe(true);
        expect(mockLogManager.appendEntry).toHaveBeenCalled();

        // Verify configuration entry was appended
        const call = mockLogManager.appendEntry.mock.calls[0][0];
        expect(call.configuration).toBeDefined();
        expect(call.configuration?.servers).toContainEqual({
          id: "node4",
          address: "http://localhost:3003",
          mode: ServerMode.STAGING,
        });
      });

      it("should reject if not the leader", async () => {
        raftNode["state"] = RaftNodeState.FOLLOWER;

        const result = await raftNode.addVoter(
          "node4",
          "http://localhost:3003"
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Not the leader");
      });

      it("should reject if another configuration change is pending", async () => {
        raftNode["pendingConfigurationChange"] = true;

        const result = await raftNode.addVoter(
          "node4",
          "http://localhost:3003"
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Another configuration change is pending");
      });

      it("should reject if node is inactive", async () => {
        raftNode["isActive"] = false;

        const result = await raftNode.addVoter(
          "node4",
          "http://localhost:3003"
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Node is unreachable");
      });
    });

    describe("removePeer()", () => {
      it("should remove a peer from configuration", async () => {
        mockPeerClient.sendStopNode.mockResolvedValue({ success: true });

        const result = await raftNode.removePeer("node2");

        expect(result.success).toBe(true);
        expect(mockLogManager.appendEntry).toHaveBeenCalled();

        // Verify stop was sent to removed node
        expect(mockPeerClient.sendStopNode).toHaveBeenCalled();
      });

      it("should reject if not the leader", async () => {
        raftNode["state"] = RaftNodeState.FOLLOWER;

        const result = await raftNode.removePeer("node2");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Not the leader");
      });

      it("should reject if another configuration change is pending", async () => {
        raftNode["pendingConfigurationChange"] = true;

        const result = await raftNode.removePeer("node2");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Another configuration change is pending");
      });

      it("should handle failure to stop removed node", async () => {
        mockPeerClient.sendStopNode.mockRejectedValue(
          new Error("Network error")
        );

        const result = await raftNode.removePeer("node2");

        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to stop removed node");
      });
    });
  });

  describe("Fault Simulation (isActive logic)", () => {
    describe("stopNode()", () => {
      beforeEach(() => {
        jest.useFakeTimers();
        raftNode.start();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("should set isActive to false", async () => {
        const result = await raftNode.stopNode();

        expect(result.success).toBe(true);
        expect(raftNode.getIsActive()).toBe(false);
      });

      it("should clear all timers when stopped", async () => {
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
        const clearIntervalSpy = jest.spyOn(global, "clearInterval");

        await raftNode.stopNode();

        expect(clearTimeoutSpy).toHaveBeenCalled();
      });

      it("should reject if already stopped", async () => {
        await raftNode.stopNode();
        const result = await raftNode.stopNode();

        expect(result.success).toBe(false);
        expect(result.error).toBe("Node is already stopped");
      });
    });

    describe("Behavior when inactive", () => {
      beforeEach(async () => {
        await raftNode.stopNode();
      });

      it("should reject AppendEntries when inactive", () => {
        const request: AppendEntriesRequest = {
          term: 1,
          leaderId: "leader",
          prevLogIndex: -1,
          prevLogTerm: 0,
          entries: [],
          leaderCommit: -1,
        };

        const response = raftNode.processAppendEntries(request);

        expect(response.term).toBe(-1);
        expect(response.success).toBe(false);
      });

      it("should reject RequestVote when inactive", () => {
        const request: RequestVoteRequest = {
          term: 1,
          candidateId: "candidate",
          lastLogIndex: 0,
          lastLogTerm: 0,
        };

        const response = raftNode.processRequestVote(request);

        expect(response.term).toBe(-1);
        expect(response.voteGranted).toBe(false);
      });

      it("should reject addVoter when inactive", async () => {
        raftNode["state"] = RaftNodeState.LEADER;
        const result = await raftNode.addVoter(
          "node4",
          "http://localhost:3003"
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Node is unreachable");
      });

      it("should reject removePeer when inactive", async () => {
        raftNode["state"] = RaftNodeState.LEADER;
        const result = await raftNode.removePeer("node2");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Node is unreachable");
      });
    });

    describe("restartNode()", () => {
      beforeEach(async () => {
        await raftNode.stopNode();
      });

      it("should reactivate the node", async () => {
        const result = await raftNode.restartNode(false);

        expect(result.success).toBe(true);
        expect(raftNode.getIsActive()).toBe(true);
      });

      it("should reset to follower state when restarting", async () => {
        raftNode["state"] = RaftNodeState.LEADER;
        await raftNode.restartNode(false);

        expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);
      });

      it("should preserve state when resetState is false", async () => {
        raftNode["currentTerm"] = 5;
        raftNode["votedFor"] = "node2";

        await raftNode.restartNode(false);

        expect(raftNode.getCurrentTerm()).toBe(5);
      });

      it("should reset state when resetState is true", async () => {
        raftNode["currentTerm"] = 5;
        raftNode["votedFor"] = "node2";

        await raftNode.restartNode(true);

        expect(raftNode.getCurrentTerm()).toBe(0);
        expect(raftNode.getVotedFor()).toBeNull();
      });

      it("should reject if node is already running", async () => {
        await raftNode.restartNode(false);
        const result = await raftNode.restartNode(false);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Node is already running");
      });
    });
  });

  describe("Client Proposal (proposeEntry)", () => {
    beforeEach(() => {
      raftNode["state"] = RaftNodeState.LEADER;
      raftNode["leaderId"] = "node1";
      raftNode["currentTerm"] = 2;
      mockLogManager.getLastIndex.mockReturnValue(5);
      mockLogManager.getLastTerm.mockReturnValue(2);
      mockLogManager.getCommitIndex.mockReturnValue(3);
      mockPeerClient.sendAppendEntries.mockResolvedValue({
        term: 2,
        success: true,
        matchIndex: 6,
      });
    });

    afterEach(() => {
      // No timer cleanup needed
    });

    it("should reject proposal if not a leader", async () => {
      raftNode["state"] = RaftNodeState.FOLLOWER;

      const result = await raftNode.proposeEntry("set", "key1", "value1");

      expect(result).toBe(false);
    });

    it("should append entry to log when leader", async () => {
      await raftNode.proposeEntry("set", "key1", "value1");

      expect(mockLogManager.appendEntry).toHaveBeenCalled();
      const appendedEntry = mockLogManager.appendEntry.mock.calls[0][0];
      expect(appendedEntry.command?.operation).toBe("set");
      expect(appendedEntry.command?.key).toBe("key1");
      expect(appendedEntry.command?.value).toBe("value1");
    });

    it("should replicate entry to peers", async () => {
      await raftNode.proposeEntry("set", "key1", "value1");

      // Wait for async replication
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockPeerClient.sendAppendEntries).toHaveBeenCalled();
    });

    it("should handle del operation without value", async () => {
      await raftNode.proposeEntry("del", "key1");

      expect(mockLogManager.appendEntry).toHaveBeenCalled();
      const appendedEntry = mockLogManager.appendEntry.mock.calls[0][0];
      expect(appendedEntry.command?.operation).toBe("del");
      expect(appendedEntry.command?.value).toBeUndefined();
    });
  });

  describe("Additional Edge Cases", () => {
    it("should handle multiple rapid term updates", () => {
      mockLogManager.getEntry.mockReturnValue(undefined);

      const request1 = {
        term: 3,
        leaderId: "leader1",
        prevLogIndex: -1,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: -1,
      };

      raftNode.processAppendEntries(request1);
      expect(raftNode.getCurrentTerm()).toBe(3);

      const request2 = {
        term: 7,
        leaderId: "leader2",
        prevLogIndex: -1,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: -1,
      };

      raftNode.processAppendEntries(request2);
      expect(raftNode.getCurrentTerm()).toBe(7);
      expect(raftNode.getLeaderId()).toBe("leader2");
    });

    it("should maintain consistency across state transitions", () => {
      // Start as follower
      expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);

      // Transition to candidate would happen via timer, simulate directly
      raftNode["state"] = RaftNodeState.CANDIDATE;
      raftNode["currentTerm"] = 1;

      // Receive AppendEntries from valid leader
      mockLogManager.getEntry.mockReturnValue(undefined);
      const request = {
        term: 1,
        leaderId: "validLeader",
        prevLogIndex: -1,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: -1,
      };

      raftNode.processAppendEntries(request);

      // Should revert to follower
      expect(raftNode.getState()).toBe(RaftNodeState.FOLLOWER);
      expect(raftNode.getLeaderId()).toBe("validLeader");
    });

    it("should clear voted for when term changes", () => {
      raftNode["votedFor"] = "node2";
      raftNode["currentTerm"] = 2;

      mockLogManager.getEntry.mockReturnValue(undefined);
      const request = {
        term: 5,
        leaderId: "leader",
        prevLogIndex: -1,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: -1,
      };

      raftNode.processAppendEntries(request);

      expect(raftNode.getVotedFor()).toBeNull();
    });
  });

  describe("getLogs()", () => {
    it("should return only committed log entries", () => {
      const entry1: LogEntry = {
        index: 0,
        term: 1,
        command: { operation: "set", key: "a", value: "1" },
        timestamp: Date.now(),
      };
      const entry2: LogEntry = {
        index: 1,
        term: 1,
        command: { operation: "set", key: "b", value: "2" },
        timestamp: Date.now(),
      };

      mockLogManager.getCommitIndex.mockReturnValue(1);
      mockLogManager.getEntry
        .mockReturnValueOnce(entry1)
        .mockReturnValueOnce(entry2);

      const logs = raftNode.getLogs();

      expect(logs).toHaveLength(2);
      expect(logs[0].index).toBe(0);
      expect(logs[1].index).toBe(1);
    });

    it("should return empty array when no entries are committed", () => {
      mockLogManager.getCommitIndex.mockReturnValue(-1);

      const logs = raftNode.getLogs();

      expect(logs).toHaveLength(0);
    });
  });
});
