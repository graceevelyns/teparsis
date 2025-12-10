import {
  RaftNodeState,
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
  LogEntry,
} from "../types";
import { IRaftNode } from "./interfaces/IRaftNode";
import { IKVStore } from "../store/IKVStore";
import { ILogManager } from "./interfaces/ILogManager";
import { IPeerClient } from "../network/IPeerClient";
import { Logger } from "../utils/Logger";
import config from "../config";

/**
 * Core Raft consensus node implementation
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
    private readonly logger: Logger
  ) {}

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
    this.becomeFollower(0);
  }

  stop(): void {
    this.logger.info("Stopping Raft node");
    this.clearTimers();
  }

  processAppendEntries(request: AppendEntriesRequest): AppendEntriesResponse {
    // Reply false if term < currentTerm
    if (request.term < this.currentTerm) {
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
    this.resetElectionTimer();

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

    // If votedFor is null or candidateId, and candidate’s log is at least as up-to-date as receiver’s log, grant vote
    const notVotedOrSame =
      this.votedFor === null || this.votedFor === request.candidateId;

    if (notVotedOrSame && candidateUpToDate) {
      this.votedFor = request.candidateId;
      this.resetElectionTimer();
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  // Client propose entry to be appended to the log
  proposeEntry(
    operation: "set" | "del" | "append",
    key: string,
    value?: string
  ): Promise<boolean> {
    return this.handlePropose(operation, key, value);
  }

  private becomeFollower(term: number): void {
    this.state = RaftNodeState.FOLLOWER;
    this.currentTerm = term;
    this.votedFor = null;
    this.leaderId = null;
    this.clearTimers();
    this.resetElectionTimer();
    this.logger.info(`Became follower for term ${term}`);
  }

  private becomeCandidate(): void {
    this.state = RaftNodeState.CANDIDATE;
    this.currentTerm++;
    this.votedFor = config.node.id;
    this.leaderId = null;
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
  }

  private applyLogEntry(entry: LogEntry): void {
    const { operation, key, value } = entry.command;

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
          this.updateCommitIndex();
          return true;
        }

        // If follower log inconsistent, decrement nextIndex and retry
        state.nextIndex = Math.max(0, state.nextIndex - 1);
      } catch (error) {
        this.logger.warn(
          `Replicate to ${peerUrl} failed: ${(error as Error).message}`
        );
        return false;
      }
    }
  }

  // A log entry is committed once the leader that created it has replicated it on a majority of servers
  private updateCommitIndex(): void {
    const lastIndex = this.logManager.getLastIndex();
    for (let idx = lastIndex; idx > this.logManager.getCommitIndex(); idx--) {
      const replicated =
        1 +
        Array.from(this.peerStates.values()).filter((p) => p.matchIndex >= idx)
          .length;
      if (replicated >= this.getMajorityCount()) {
        const entry = this.logManager.getEntry(idx);
        if (entry && entry.term === this.currentTerm) {
          this.logManager.setCommitIndex(idx);
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
    for (let i = 0; i <= this.logManager.getLastIndex(); i++) {
      const entry = this.logManager.getEntry(i);
      if (entry) {
        logs.push({
          index: entry.index,
          term: entry.term,
          command: entry.command,
          timestamp: entry.timestamp,
          isCommitted: i <= this.logManager.getCommitIndex(),
        });
      }
    }
    return logs;
  }
}
