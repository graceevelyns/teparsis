import {
  RaftNodeState,
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
  LogEntry,
} from "../types";
import { 
  Snapshot, 
  InstallSnapshotRequest, 
  InstallSnapshotResponse,
  RaftPersistentState 
} from "../types/Snapshot";
import { IRaftNode } from "./interfaces/IRaftNode";
import { IKVStore } from "../store/IKVStore";
import { ILogManager } from "./interfaces/ILogManager";
import { IPeerClient } from "../network/IPeerClient";
import { PersistentStorage } from "./PersistentStorage";
import { Logger } from "../utils/Logger";
import config from "../config";

/**
 * Core Raft consensus node implementation with snapshot support
 */
export class RaftNode implements IRaftNode {
  private state: RaftNodeState = RaftNodeState.FOLLOWER;
  private currentTerm: number = 0;
  private votedFor: string | null = null;
  private leaderId: string | null = null;
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastApplied: number = -1;
  private readonly peerStates: Map<
    string,
    { nextIndex: number; matchIndex: number }
  > = new Map();

  constructor(
    private readonly store: IKVStore,
    private readonly logManager: ILogManager,
    private readonly peerClient: IPeerClient,
    private readonly logger: Logger,
    private readonly storage?: PersistentStorage
  ) {
    this.loadPersistedState();
  }

  /**
   * Load persisted state from storage
   */
  private loadPersistedState(): void {
    // Load Raft state (currentTerm, votedFor)
    if (this.storage) {
      const state = this.storage.loadRaftState();
      if (state) {
        this.currentTerm = state.currentTerm;
        this.votedFor = state.votedFor;
        this.logger.info(
          `Loaded persisted state: term=${this.currentTerm}, votedFor=${this.votedFor}`
        );
      }
    }

    // Apply snapshot to state machine if exists
    const snapshot = this.logManager.getLatestSnapshot();
    if (snapshot) {
      this.store.restoreState(snapshot.data);
      this.lastApplied = snapshot.lastIncludedIndex;
      this.logger.info(
        `Restored state from snapshot at index ${snapshot.lastIncludedIndex}`
      );
    }

    // Replay log entries after snapshot
    this.replayLogEntries();
  }

  /**
   * Replay committed log entries to state machine
   */
  private replayLogEntries(): void {
    const commitIndex = this.logManager.getCommitIndex();
    while (this.lastApplied < commitIndex) {
      this.lastApplied++;
      const entry = this.logManager.getEntry(this.lastApplied);
      if (entry) {
        this.applyLogEntry(entry);
      }
    }
  }

  /**
   * Persist Raft state to storage
   */
  private persistState(): void {
    if (this.storage) {
      const state: RaftPersistentState = {
        currentTerm: this.currentTerm,
        votedFor: this.votedFor,
      };
      this.storage.saveRaftState(state);
    }
  }

  getState(): RaftNodeState {
    return this.state;
  }

  getCurrentTerm(): number {
    return this.currentTerm;
  }

  getVotedFor(): string | null {
    return this.votedFor;
  }

  getLeaderId(): string | null {
    return this.leaderId;
  }

  isLeader(): boolean {
    return this.state === RaftNodeState.LEADER;
  }

  start(): void {
    this.logger.info(`Starting Raft node ${config.node.id}`);
    this.becomeFollower(this.currentTerm);
  }

  stop(): void {
    this.logger.info("Stopping Raft node");
    this.clearTimers();
  }

  processAppendEntries(request: AppendEntriesRequest): AppendEntriesResponse {
    // Reply false if term < currentTerm
    if (request.term < this.currentTerm) {
      this.logger.warn(
        `AppendEntries rejected: term ${request.term} < currentTerm ${this.currentTerm}`
      );
      return { term: this.currentTerm, success: false };
    }

    // Step down if there is a higher term or if not follower
    if (
      request.term > this.currentTerm ||
      this.state !== RaftNodeState.FOLLOWER
    ) {
      this.becomeFollower(request.term);
    }
    this.leaderId = request.leaderId;
    
    if (request.entries.length > 0) {
      this.logger.info(
        `Received AppendEntries from leader ${request.leaderId}, term ${request.term}, entries: ${request.entries.length}`
      );
    }
    
    this.resetElectionTimer();

    // Check if prevLogIndex is within snapshot
    const firstIndex = this.logManager.getFirstIndex();
    if (request.prevLogIndex < firstIndex - 1) {
      // Leader is behind our snapshot, reject and let leader catch up
      return { term: this.currentTerm, success: false };
    }

    // Reply false if log doesn't contain an entry at prevLogIndex whose term matches prevLogTerm
    const prevEntry = this.logManager.getEntry(request.prevLogIndex);
    const prevTerm = prevEntry ? prevEntry.term : 0;
    if (request.prevLogIndex >= 0 && prevTerm !== request.prevLogTerm) {
      return { term: this.currentTerm, success: false };
    }

    //  If an existing entry conflicts with a new one (same index but different terms), delete the existing entry and all that follow it
    let insertIndex = request.prevLogIndex + 1;
    for (const entry of request.entries) {
      const existing = this.logManager.getEntry(insertIndex);
      if (!existing || existing.term !== entry.term) {
        this.logManager.truncateFrom(insertIndex);
        this.logManager.appendEntry(entry);
      }
      insertIndex++;
    }

    //  If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
    if (request.leaderCommit > this.logManager.getCommitIndex()) {
      const newCommit = Math.min(
        request.leaderCommit,
        this.logManager.getLastIndex()
      );
      this.logManager.setCommitIndex(newCommit);
      this.applyCommittedEntries();
    }

    return {
      term: this.currentTerm,
      success: true,
      matchIndex: this.logManager.getLastIndex(),
    };
  }

  processRequestVote(request: RequestVoteRequest): RequestVoteResponse {
    // Reply false if term < currentTerm
    if (request.term < this.currentTerm) {
      this.logger.warn(
        `RequestVote rejected: term ${request.term} < currentTerm ${this.currentTerm}`
      );
      return { term: this.currentTerm, voteGranted: false };
    }

    // Step down if newer term discovered
    if (request.term > this.currentTerm) {
      this.becomeFollower(request.term);
    }

    const candidateUpToDate = this.isCandidateLogUpToDate(
      request.lastLogIndex,
      request.lastLogTerm
    );

    // If votedFor is null or candidateId, and candidate's log is at least as up-to-date as receiver's log, grant vote
    const notVotedOrSame =
      this.votedFor === null || this.votedFor === request.candidateId;

    if (notVotedOrSame && candidateUpToDate) {
      this.votedFor = request.candidateId;
      this.persistState();
      this.logger.info(
        `Voted for candidate ${request.candidateId} in term ${request.term}`
      );
      this.resetElectionTimer();
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  /**
   * Process InstallSnapshot RPC from leader
   */
  processInstallSnapshot(request: InstallSnapshotRequest): InstallSnapshotResponse {
    // Reply immediately if term < currentTerm
    if (request.term < this.currentTerm) {
      this.logger.warn(
        `InstallSnapshot rejected: term ${request.term} < currentTerm ${this.currentTerm}`
      );
      return { term: this.currentTerm };
    }

    // Step down if newer term
    if (request.term > this.currentTerm) {
      this.becomeFollower(request.term);
    }

    this.leaderId = request.leaderId;
    this.resetElectionTimer();

    // Create snapshot from request
    const snapshot: Snapshot = {
      lastIncludedIndex: request.lastIncludedIndex,
      lastIncludedTerm: request.lastIncludedTerm,
      data: request.data,
      timestamp: Date.now(),
    };

    // Install snapshot
    this.logManager.installSnapshot(snapshot);

    // Restore state machine from snapshot
    this.store.restoreState(snapshot.data);
    this.lastApplied = snapshot.lastIncludedIndex;

    this.logger.info(
      `Installed snapshot from leader at index ${request.lastIncludedIndex}`
    );

    return { term: this.currentTerm };
  }

  // Client propose entry to be appended to the log
  proposeEntry(
    operation: "set" | "del" | "append",
    key: string,
    value?: string
  ): Promise<boolean> {
    return this.handlePropose(operation, key, value);
  }

  /**
   * Trigger snapshot creation if log is large enough
   */
  triggerSnapshot(): boolean {
    const threshold = config.storage?.snapshotThreshold || 100;
    
    // Check if we have enough committed entries to snapshot
    const commitIndex = this.logManager.getCommitIndex();
    const firstIndex = this.logManager.getFirstIndex();
    const entriesCount = commitIndex - firstIndex + 1;

    if (entriesCount < threshold / 2) {
      this.logger.info(
        `Snapshot not needed: only ${entriesCount} entries (threshold: ${threshold})`
      );
      return false;
    }

    // Create snapshot at current commitIndex
    const state = this.store.getState();
    const snapshot = this.logManager.createSnapshot(commitIndex, state);

    // Compact log
    this.logManager.compactLog(commitIndex);

    this.logger.info(
      `Created snapshot at index ${snapshot.lastIncludedIndex}, compacted log`
    );
    return true;
  }

  private becomeFollower(term: number): void {
    this.state = RaftNodeState.FOLLOWER;
    this.currentTerm = term;
    this.votedFor = null;
    this.leaderId = null;
    this.persistState();
    this.clearTimers();
    this.resetElectionTimer();
    this.logger.info(`Became follower for term ${term}`);
  }

  private becomeCandidate(): void {
    this.state = RaftNodeState.CANDIDATE;
    this.currentTerm++;
    this.votedFor = config.node.id;
    this.leaderId = null;
    this.persistState();
    this.clearTimers();
    this.logger.info(`Became candidate for term ${this.currentTerm}`);
    this.startElection();
  }

  private becomeLeader(): void {
    this.state = RaftNodeState.LEADER;
    this.leaderId = config.node.id;
    this.clearTimers();
    this.logger.info(`Became leader for term ${this.currentTerm}`);
    this.initializePeerStates();
    this.updateCommitIndex();
    this.sendHeartbeats();
    this.startHeartbeat();
  }

  private startElection(): void {
    this.resetElectionTimer();

    // Send RequestVote RPCs to all other servers
    const request: RequestVoteRequest = {
      term: this.currentTerm,
      candidateId: config.node.id,
      lastLogIndex: this.logManager.getLastIndex(),
      lastLogTerm: this.logManager.getLastTerm(),
    };

    // Votes for itself
    let votes = 1;
    const majority = Math.floor((config.cluster.peers.length + 1) / 2) + 1;

    // Issues RequestVote RPCs
    config.cluster.peers.forEach(async (peerUrl) => {
      try {
        const response = await this.peerClient.sendRequestVote(
          `${peerUrl}/api`,
          request
        );

        if (response.term > this.currentTerm) {
          this.becomeFollower(response.term);
          return;
        }

        if (response.voteGranted && this.state === RaftNodeState.CANDIDATE) {
          votes++;
          if (votes >= majority) {
            this.becomeLeader();
          }
        }
      } catch (error) {
        this.logger.warn(
          `RequestVote to ${peerUrl} failed: ${(error as Error).message}`
        );
      }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, config.raft.heartbeatInterval);
  }

  private sendHeartbeats(): void {
    if (!this.isLeader()) return;

    config.cluster.peers.forEach(async (peerUrl) => {
      try {
        await this.replicateLogToPeer(peerUrl);
      } catch (error) {
        this.logger.warn(
          `Heartbeat to ${peerUrl} failed: ${(error as Error).message}`
        );
      }
    });
  }

  private resetElectionTimer(): void {
    this.clearElectionTimer();
    const timeout = this.getRandomElectionTimeout();
    this.electionTimer = setTimeout(() => {
      if (this.state !== RaftNodeState.LEADER) {
        this.becomeCandidate();
      }
    }, timeout);
  }

  private getRandomElectionTimeout(): number {
    const min = config.raft.electionTimeoutMin;
    const max = config.raft.electionTimeoutMax;
    return Math.random() * (max - min) + min;
  }

  private clearTimers(): void {
    this.clearElectionTimer();
    this.clearHeartbeatTimer();
  }

  private clearElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private applyCommittedEntries(): void {
    const commitIndex = this.logManager.getCommitIndex();
    while (this.lastApplied < commitIndex) {
      this.lastApplied++;
      const entry = this.logManager.getEntry(this.lastApplied);
      if (entry) {
        this.applyLogEntry(entry);
      }
    }

    // Check if we should trigger snapshot (auto-compaction)
    if (config.storage?.snapshotThreshold) {
      const firstIndex = this.logManager.getFirstIndex();
      if (commitIndex - firstIndex + 1 >= config.storage.snapshotThreshold) {
        this.triggerSnapshot();
      }
    }
  }

  private applyLogEntry(entry: LogEntry): void {
    const { operation, key, value } = entry.command;
    this.logger.info(
      `Applying log entry: ${operation} ${key}${value ? ' = ' + value : ''}`
    );

    switch (operation) {
      case "set":
        if (value !== undefined) {
          this.store.set(key, value);
        }
        break;
      case "del":
        this.store.del(key);
        break;
      case "append":
        if (value !== undefined) {
          this.store.append(key, value);
        }
        break;
    }
  }

  private isCandidateLogUpToDate(
    lastLogIndex: number,
    lastLogTerm: number
  ): boolean {
    const myLastTerm = this.logManager.getLastTerm();
    if (lastLogTerm !== myLastTerm) {
      return lastLogTerm > myLastTerm;
    }
    return lastLogIndex >= this.logManager.getLastIndex();
  }

  private initializePeerStates(): void {
    const nextIndex = this.logManager.getLastIndex() + 1;
    config.cluster.peers.forEach((peer) => {
      this.peerStates.set(peer, { nextIndex, matchIndex: -1 });
    });
  }

  private async replicateLogToPeer(peerUrl: string): Promise<boolean> {
    const state = this.peerStates.get(peerUrl);
    if (!state) return false;

    // Check if peer needs snapshot
    const firstIndex = this.logManager.getFirstIndex();
    if (state.nextIndex < firstIndex) {
      // Peer is behind snapshot, send InstallSnapshot
      return await this.sendSnapshotToPeer(peerUrl);
    }

    // Simple backoff loop using decrease nextIndex on failure
    while (true) {
      const nextIndex = state.nextIndex;
      const prevLogIndex = nextIndex - 1;
      const prevLogTerm =
        prevLogIndex >= 0
          ? this.logManager.getEntry(prevLogIndex)?.term || 0
          : 0;
      const entries = this.logManager.getEntriesFrom(nextIndex);

      const request: AppendEntriesRequest = {
        term: this.currentTerm,
        leaderId: config.node.id,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.logManager.getCommitIndex(),
      };

      try {
        const response = await this.peerClient.sendAppendEntries(
          `${peerUrl}/api`,
          request
        );

        if (response.term > this.currentTerm) {
          this.becomeFollower(response.term);
          return false;
        }

        if (response.success) {
          const matchIndex = prevLogIndex + entries.length;
          state.matchIndex = matchIndex;
          state.nextIndex = matchIndex + 1;
          
          if (entries.length > 0) {
            this.logger.info(
              `Replicated ${entries.length} entries to ${peerUrl}`
            );
          }
          
          this.updateCommitIndex();
          return true;
        }

        // If follower log inconsistent, decrement nextIndex and retry
        state.nextIndex = Math.max(0, state.nextIndex - 1);

        // Check if we need to send snapshot instead
        if (state.nextIndex < firstIndex) {
          return await this.sendSnapshotToPeer(peerUrl);
        }
      } catch (error) {
        this.logger.warn(
          `Replicate to ${peerUrl} failed: ${(error as Error).message}`
        );
        return false;
      }
    }
  }

  /**
   * Send snapshot to a peer that is behind
   */
  private async sendSnapshotToPeer(peerUrl: string): Promise<boolean> {
    const snapshot = this.logManager.getLatestSnapshot();
    if (!snapshot) {
      this.logger.warn(`No snapshot available to send to ${peerUrl}`);
      return false;
    }

    const request: InstallSnapshotRequest = {
      term: this.currentTerm,
      leaderId: config.node.id,
      lastIncludedIndex: snapshot.lastIncludedIndex,
      lastIncludedTerm: snapshot.lastIncludedTerm,
      data: snapshot.data,
    };

    try {
      const response = await this.peerClient.sendInstallSnapshot(
        `${peerUrl}/api`,
        request
      );

      if (response.term > this.currentTerm) {
        this.becomeFollower(response.term);
        return false;
      }

      // Update peer state after successful snapshot install
      const state = this.peerStates.get(peerUrl);
      if (state) {
        state.nextIndex = snapshot.lastIncludedIndex + 1;
        state.matchIndex = snapshot.lastIncludedIndex;
      }

      this.logger.info(
        `Sent snapshot to ${peerUrl} (lastIncludedIndex: ${snapshot.lastIncludedIndex})`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send snapshot to ${peerUrl}`,
        error as Error
      );
      return false;
    }
  }

  // A log entry is committed once the leader that created it has replicated it on a majority of servers
  private updateCommitIndex(): void {
    const lastIndex = this.logManager.getLastIndex();
    const oldCommitIndex = this.logManager.getCommitIndex();
    for (let idx = lastIndex; idx > oldCommitIndex; idx--) {
      const replicated =
        1 +
        Array.from(this.peerStates.values()).filter((p) => p.matchIndex >= idx)
          .length;
      if (replicated >= this.getMajorityCount()) {
        const entry = this.logManager.getEntry(idx);
        if (entry && entry.term === this.currentTerm) {
          this.logManager.setCommitIndex(idx);
          this.logger.info(
            `Commit index updated: ${oldCommitIndex} -> ${idx}`
          );
          this.applyCommittedEntries();
          break;
        }
      }
    }
  }

  private getMajorityCount(): number {
    return Math.floor((config.cluster.peers.length + 1) / 2) + 1;
  }

  // Client propose entry to be appended to the log
  private async handlePropose(
    operation: "set" | "del" | "append",
    key: string,
    value?: string
  ): Promise<boolean> {
    if (!this.isLeader()) {
      this.logger.warn(`Propose rejected: not a leader`);
      return false;
    }

    const command =
      value === undefined ? { operation, key } : { operation, key, value };
    const entry: LogEntry = {
      index: this.logManager.getLastIndex() + 1,
      term: this.currentTerm,
      command,
      timestamp: Date.now(),
    };

    this.logger.info(
      `Proposed entry: ${operation} ${key}${value ? ' = ' + value : ''}`
    );
    this.logManager.appendEntry(entry);

    await Promise.all(
      config.cluster.peers.map(async (peerUrl) => {
        try {
          await this.replicateLogToPeer(peerUrl);
        } catch (error) {
          this.logger.warn(
            `Replicate to ${peerUrl} failed: ${(error as Error).message}`
          );
        }
      })
    );

    this.updateCommitIndex();
    return this.logManager.getCommitIndex() >= entry.index;
  }

  getLogs(): any[] {
    const logs = [];
    const commitIndex = this.logManager.getCommitIndex();
    const firstIndex = this.logManager.getFirstIndex();
    
    // Add info about snapshot if exists
    const snapshot = this.logManager.getLatestSnapshot();
    if (snapshot) {
      logs.push({
        type: "snapshot",
        lastIncludedIndex: snapshot.lastIncludedIndex,
        lastIncludedTerm: snapshot.lastIncludedTerm,
        timestamp: snapshot.timestamp,
      });
    }
    
    for (let i = firstIndex; i <= commitIndex; i++) {
      const entry = this.logManager.getEntry(i);
      if (entry) {
        logs.push({
          index: entry.index,
          term: entry.term,
          command: entry.command,
          timestamp: entry.timestamp,
          isCommitted: true,
        });
      }
    }
    return logs;
  }
}
