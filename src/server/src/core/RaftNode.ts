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

  // TODO: Implement processAppendEntries - handle incoming AppendEntries RPCs
  // Should handle: log consistency checks, log replication, commit updates
  processAppendEntries(request: AppendEntriesRequest): AppendEntriesResponse {
    throw new Error("Method not implemented.");
  }

  processRequestVote(request: RequestVoteRequest): RequestVoteResponse {
    throw new Error("Method not implemented.");
  }

  proposeEntry(operation: "set" | "del" | "append", key: string, value?: string): Promise<boolean> {
    throw new Error("Method not implemented.");
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
    this.startHeartbeat();
  }

  private startElection(): void {
    // Implementation for starting election would go here
    this.resetElectionTimer();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // Send heartbeats to all peers
      this.sendHeartbeats();
    }, config.raft.heartbeatInterval);
  }

  private sendHeartbeats(): void {
    // Implementation for sending heartbeats would go here
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
    // Apply committed log entries to the state machine
    const commitIndex = this.logManager.getCommitIndex();
    for (let i = 0; i <= commitIndex; i++) {
      const entry = this.logManager.getEntry(i);
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
}
