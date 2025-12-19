import {
  RaftNodeState,
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
  LogEntry,
  LogCommand,
  KVWriteCommand,
  Configuration,
  ServerInfo,
  ServerMode,
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

  // Node activation state (local only, not replicated)
  private isActive: boolean = true;

  // Configuration tracking
  private committedConfiguration: Configuration;
  private latestConfiguration: Configuration;
  private pendingConfigurationChange: boolean = false;

  constructor(
    private readonly store: IKVStore,
    private readonly logManager: ILogManager,
    private readonly peerClient: IPeerClient,
    private readonly logger: Logger
  ) {
    const initialServers: ServerInfo[] = [
      {
        id: config.node.id,
        address: `http://${config.node.host}:${config.node.port}`,
        mode: ServerMode.VOTER,
      },
      ...config.cluster.peers.map((peerUrl, idx) => ({
        id: config.cluster.peersIds[idx],
        address: peerUrl,
        mode: ServerMode.VOTER,
      })),
    ];

    this.committedConfiguration = {
      index: 0,
      servers: initialServers,
    };
    this.latestConfiguration = {
      index: 0,
      servers: initialServers,
    };
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

  getLeaderAddress(): string | null {
    if (!this.leaderId) {
      return null;
    }

    const leaderServer = this.latestConfiguration.servers.find(
      (s) => s.id === this.leaderId
    );

    return leaderServer ? `http://localhost:${leaderServer.id}` : null;
  }

  isLeader(): boolean {
    return this.state === RaftNodeState.LEADER;
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  start(): void {
    this.logger.info(`Starting Raft node ${config.node.id}`);

    this.becomeFollower(0);
    if (!config.node.initialActive) {
      this.logger.info(
        `Node ${config.node.id} is initially inactive, not starting Raft operations`
      );
    }
  }

  stop(): void {
    this.logger.info("Stopping Raft node");
    this.clearTimers();
  }

  processAppendEntries(request: AppendEntriesRequest): AppendEntriesResponse {
    // If node is inactive, simulate crash - return error
    if (!this.isActive) {
      // this.logger.warn("Node is inactive, rejecting AppendEntries");
      return { term: -1, success: false };
    }

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
        // Truncating may remove configuration entries
        const truncateIndex = insertIndex;
        this.logManager.truncateFrom(truncateIndex);

        // If truncation removed the latest configuration, find the new latest
        if (this.latestConfiguration.index >= truncateIndex) {
          this.latestConfiguration = this.findLatestConfigurationInLog();
          this.logger.info(
            `Configuration rolled back to index ${this.latestConfiguration.index} due to log truncation`
          );
        }

        this.logManager.appendEntry(entry);

        // Apply configuration immediately if this is a configuration entry
        if (entry.configuration) {
          this.latestConfiguration = {
            index: entry.index,
            servers: entry.configuration.servers,
          };
          this.logger.info(
            `Updated latest configuration at index ${entry.index}`
          );
        }
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
    // If node is inactive, simulate crash - return error
    if (!this.isActive) {
      // this.logger.warn("Node is inactive, rejecting RequestVote");
      return { term: -1, voteGranted: false };
    }

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

    // If votedFor is null or candidateId, and candidate’s log is at least as up-to-date as receiver’s log, grant vote
    const notVotedOrSame =
      this.votedFor === null || this.votedFor === request.candidateId;

    if (notVotedOrSame && candidateUpToDate) {
      this.votedFor = request.candidateId;
      this.logger.info(
        `Voted for candidate ${request.candidateId} in term ${request.term}`
      );
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
    const command: LogCommand =
      value === undefined ? { operation, key } : { operation, key, value };
    return this.handlePropose(command);
  }

  // Client propose batch entry to be appended to the log
  proposeTransaction(commands: KVWriteCommand[]): Promise<boolean> {
    return this.handlePropose({ operation: "transaction", commands });
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
    const majority = this.getMajorityCount();

    // Get voter addresses from configuration
    const voterAddresses = this.getVoterAddresses().filter(
      (addr) => addr !== `http://${config.node.host}:${config.node.port}`
    );

    // Issues RequestVote RPCs
    voterAddresses.forEach(async (peerUrl) => {
      try {
        const response = await this.peerClient.sendRequestVote(
          `${peerUrl}/api`,
          request
        );

        if (response.term === -1) {
          // Peer is inactive, treat as failure
          return;
        }

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

    // Replicate to both voters and staging nodes
    const replicationAddresses = this.getReplicationAddresses().filter(
      (addr) => addr !== `http://${config.node.host}:${config.node.port}`
    );

    replicationAddresses.forEach(async (peerUrl) => {
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
    // Handle configuration changes
    if (entry.configuration) {
      this.committedConfiguration = {
        index: entry.index,
        servers: entry.configuration.servers,
      };
      this.pendingConfigurationChange = false;
      this.logger.info(
        `Committed configuration at index ${entry.index}: ${entry.configuration.servers.length} servers`
      );
      return;
    }

    // Handle data commands
    if (!entry.command) return;

    const { command } = entry;
    const { operation, key, value } = command;
    this.logger.info(
      `Applying log entry: ${operation} ${key}${value ? " = " + value : ""}`
    );

    if (command.operation === "transaction") {
      command.commands.forEach((cmd) => this.applyWriteCommand(cmd));
      return;
    }

    this.applyWriteCommand(command);
  }

  private applyWriteCommand(command: KVWriteCommand): void {
    const { operation, key, value } = command;
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
    this.peerStates.clear();

    const nextIndex = this.logManager.getLastIndex() + 1;
    // Initialize peer states for both voters and staging nodes
    const replicationAddresses = this.getReplicationAddresses().filter(
      (addr) => addr !== `http://${config.node.host}:${config.node.port}`
    );
    replicationAddresses.forEach((peer) => {
      this.peerStates.set(peer, { nextIndex, matchIndex: -1 });
    });
  }

  private async replicateLogToPeer(peerUrl: string): Promise<boolean> {
    let state = this.peerStates.get(peerUrl);
    if (!state) {
      // Initialize peer state if not found (handles dynamic configuration changes)
      const nextIndex = this.logManager.getLastIndex() + 1;
      state = { nextIndex, matchIndex: -1 };
      this.peerStates.set(peerUrl, state);
      this.logger.info(`Initialized peer state for ${peerUrl}`);
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

        if (response.term === -1) {
          // Peer is inactive, treat as failure
          return false;
        }

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
      } catch (error) {
        const errorMsg = (error as Error).message;
        // Use debug for timeout/connection errors to reduce log noise
        if (errorMsg.includes("timeout") || errorMsg.includes("ECONNREFUSED")) {
          this.logger.debug(`Replicate to ${peerUrl} failed: ${errorMsg}`);
        } else {
          this.logger.warn(`Replicate to ${peerUrl} failed: ${errorMsg}`);
        }
        return false;
      }
    }
  }

  // A log entry is committed once the leader that created it has replicated it on a majority of servers
  private updateCommitIndex(): void {
    const lastIndex = this.logManager.getLastIndex();
    const oldCommitIndex = this.logManager.getCommitIndex();

    const voterAddresses = this.getVoterAddresses();

    for (let idx = lastIndex; idx > oldCommitIndex; idx--) {
      const replicated =
        1 +
        Array.from(this.peerStates.entries())
          .filter(([peerUrl, _]) => voterAddresses.includes(peerUrl))
          .filter(([_, state]) => state.matchIndex >= idx).length;
      if (replicated >= this.getMajorityCount()) {
        const entry = this.logManager.getEntry(idx);
        if (entry && entry.term === this.currentTerm) {
          this.logManager.setCommitIndex(idx);
          this.logger.info(`Commit index updated: ${oldCommitIndex} -> ${idx}`);
          this.applyCommittedEntries();
          break;
        }
      }
    }
  }

  private getMajorityCount(): number {
    const voterCount = this.getVoterCount();
    return Math.floor(voterCount / 2) + 1;
  }

  // Client propose entry to be appended to the log
  private async handlePropose(command: LogCommand): Promise<boolean> {
    if (!this.isLeader()) {
      this.logger.warn(`Propose rejected: not a leader`);
      return false;
    }

    if (command.operation === "transaction" && command.commands.length === 0) {
      this.logger.warn("Propose rejected: empty transaction");
      return false;
    }

    const entry: LogEntry = {
      index: this.logManager.getLastIndex() + 1,
      term: this.currentTerm,
      command,
      timestamp: Date.now(),
    };

    const { operation, key, value } = command;
    this.logger.info(
      `Proposed entry: ${operation} ${key}${value ? " = " + value : ""}`
    );
    this.logManager.appendEntry(entry);

    // Replicate to both voters and staging nodes
    const replicationAddresses = this.getReplicationAddresses().filter(
      (addr) => addr !== `http://${config.node.host}:${config.node.port}`
    );

    await Promise.all(
      replicationAddresses.map(async (peerUrl) => {
        try {
          await this.replicateLogToPeer(peerUrl);
        } catch (error) {
          const errorMsg = (error as Error).message;
          if (
            errorMsg.includes("timeout") ||
            errorMsg.includes("ECONNREFUSED")
          ) {
            this.logger.debug(`Replicate to ${peerUrl} failed: ${errorMsg}`);
          } else {
            this.logger.warn(`Replicate to ${peerUrl} failed: ${errorMsg}`);
          }
        }
      })
    );

    this.updateCommitIndex();
    return this.logManager.getCommitIndex() >= entry.index;
  }

  private describeCommand(command: LogCommand): string {
    if (command.operation === "transaction") {
      return `transaction (${command.commands.length} ops)`;
    }
    return `${command.operation} ${command.key}${
      command.value ? " = " + command.value : ""
    }`;
  }

  getLogs(): any[] {
    const logs = [];
    const commitIndex = this.logManager.getCommitIndex();

    for (let i = 0; i <= commitIndex; i++) {
      const entry = this.logManager.getEntry(i);
      if (entry) {
        logs.push({
          index: entry.index,
          term: entry.term,
          command: entry.command,
          configuration: entry.configuration,
          timestamp: entry.timestamp,
          isCommitted: true,
        });
      }
    }
    return logs;
  }

  // Membership change operations

  async addVoter(
    id: string,
    address: string
  ): Promise<{
    success: boolean;
    error?: string;
    configuration?: Configuration;
  }> {

    if (!this.isActive) {
      return {
        success: false,
        error: "Node is unreachable",
      };
    }

    if (!this.isLeader()) {
      return {
        success: false,
        error: "Not the leader",
      };
    }

    if (this.pendingConfigurationChange) {
      return {
        success: false,
        error: "Another configuration change is pending",
      };
    }

    // Check if server already exists
    const existingServer = this.latestConfiguration.servers.find(
      (s) => s.id === id
    );

    if (existingServer && existingServer.mode === ServerMode.VOTER) {
      return {
        success: true,
        configuration: this.latestConfiguration,
      };
    }

    // Create new configuration with the server as staging
    const newServers: ServerInfo[] = this.latestConfiguration.servers
      .filter((s) => s.id !== id)
      .concat([
        {
          id,
          address,
          mode: ServerMode.STAGING,
        },
      ]);

    const newConfiguration: Configuration = {
      index: this.logManager.getLastIndex() + 1,
      servers: newServers,
    };

    // Append configuration entry to log
    const entry: LogEntry = {
      index: newConfiguration.index,
      term: this.currentTerm,
      configuration: newConfiguration,
      timestamp: Date.now(),
    };

    this.logger.info(`Adding voter ${address} as staging at index ${entry.index}`);
    this.logManager.appendEntry(entry);
    this.latestConfiguration = newConfiguration;
    this.pendingConfigurationChange = true;

    // Automatically restart the node being added (without resetting state)
    try {
      await this.peerClient.sendRestartNode(`${address}/api`, false);
      this.logger.info(`Successfully restarted node ${id} at ${address}`);
    } catch (error) {
      this.logger.warn(
        `Failed to restart node ${id}: ${(error as Error).message}`
      );
    }

    // Replicate to both voters and staging nodes
    await Promise.all(
      this.getReplicationAddresses().map(async (peerUrl) => {
        if (peerUrl !== `http://${config.node.host}:${config.node.port}`) {
          try {
            await this.replicateLogToPeer(peerUrl);
          } catch (error) {
            const errorMsg = (error as Error).message;
            if (
              errorMsg.includes("timeout") ||
              errorMsg.includes("ECONNREFUSED")
            ) {
              this.logger.debug(`Replicate to ${peerUrl} failed: ${errorMsg}`);
            } else {
              this.logger.warn(`Replicate to ${peerUrl} failed: ${errorMsg}`);
            }
          }
        }
      })
    );

    this.updateCommitIndex();

    // Check if we should promote staging to voter
    this.checkAndPromoteStagingServers();

    return {
      success: true,
      configuration: newConfiguration,
    };
  }

  async removePeer(id: string): Promise<{
    success: boolean;
    error?: string;
    configuration?: Configuration;
  }> {

    if (!this.isActive) {
      return {
        success: false,
        error: "Node is unreachable",
      };
    }

    if (!this.isLeader()) {
      return {
        success: false,
        error: "Not the leader",
      };
    }

    if (this.pendingConfigurationChange) {
      return {
        success: false,
        error: "Another configuration change is pending",
      };
    }

    // Check if server exists
    const serverExists = this.latestConfiguration.servers.some(
      (s) => s.id === id
    );

    if (!serverExists) {
      return {
        success: true,
        configuration: this.latestConfiguration,
      };
    }

    // Create new configuration without the server
    const newServers = this.latestConfiguration.servers.filter(
      (s) => s.id !== id
    );

    if (newServers.length === 0) {
      return {
        success: false,
        error: "Cannot remove the last server",
      };
    }

    const newConfiguration: Configuration = {
      index: this.logManager.getLastIndex() + 1,
      servers: newServers,
    };

    // Append configuration entry to log
    const entry: LogEntry = {
      index: newConfiguration.index,
      term: this.currentTerm,
      configuration: newConfiguration,
      timestamp: Date.now(),
    };

    this.logger.info(`Removing peer ${id} at index ${entry.index}`);

    // Automatically stop the removed node
    const removedServer = this.latestConfiguration.servers.find(
      (s) => s.id === id
    );
    if (removedServer) {
      try {
        await this.peerClient.sendStopNode(`${removedServer.address}/api`);
        this.logger.info(
          `Successfully stopped removed node ${id} at ${removedServer.address}`
        );
      } catch (error) {
        this.logger.warn(
          `Failed to stop node ${id}: ${(error as Error).message}`
        );
        return {
          success: false,
          error: `Failed to stop removed node ${id}`,
        };
      }
    }

    this.logManager.appendEntry(entry);
    this.latestConfiguration = newConfiguration;
    this.pendingConfigurationChange = true;

    // Replicate to both voters and staging nodes
    await Promise.all(
      this.getReplicationAddresses().map(async (peerUrl) => {
        if (peerUrl !== `http://${config.node.host}:${config.node.port}`) {
          try {
            await this.replicateLogToPeer(peerUrl);
          } catch (error) {
            const errorMsg = (error as Error).message;
            this.logger.warn(`Replicate to ${peerUrl} failed: ${errorMsg}`);
          }
        }
      })
    );

    this.updateCommitIndex();

    return {
      success: true,
      configuration: newConfiguration,
    };
  }

  async getConfiguration(): Promise<Configuration> {
    // Wait for any pending configuration to commit
    if (this.pendingConfigurationChange) {
      // Simple polling wait - in production, use a promise-based approach
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.committedConfiguration;
  }

  private findLatestConfigurationInLog(): Configuration {
    for (let i = this.logManager.getLastIndex(); i >= 0; i--) {
      const entry = this.logManager.getEntry(i);
      if (entry && entry.configuration) {
        return {
          index: entry.index,
          servers: entry.configuration.servers,
        };
      }
    }
    return this.committedConfiguration;
  }

  private getVoterAddresses(): string[] {
    return this.latestConfiguration.servers
      .filter((s) => s.mode === ServerMode.VOTER)
      .map((s) => s.address);
  }

  private getReplicationAddresses(): string[] {
    // Include both voters and staging nodes for log replication
    return this.latestConfiguration.servers
      .filter(
        (s) => s.mode === ServerMode.VOTER || s.mode === ServerMode.STAGING
      )
      .map((s) => s.address);
  }

  private getVoterCount(): number {
    return this.latestConfiguration.servers.filter(
      (s) => s.mode === ServerMode.VOTER
    ).length;
  }

  private checkAndPromoteStagingServers(): void {
    if (!this.isLeader()) return;

    const commitIndex = this.logManager.getCommitIndex();
    const stagingServers = this.latestConfiguration.servers.filter(
      (s) => s.mode === ServerMode.STAGING
    );

    for (const stagingServer of stagingServers) {
      const peerState = this.peerStates.get(stagingServer.address);
      if (!peerState) continue;

      // Check if staging server has caught up (95% of commit index)
      const catchUpThreshold = Math.floor(commitIndex * 0.95);
      if (peerState.matchIndex >= catchUpThreshold) {
        this.promoteStagingToVoter(stagingServer.id);
      }
    }
  }

  private async promoteStagingToVoter(id: string): Promise<void> {
    if (this.pendingConfigurationChange) {
      return;
    }

    const newServers = this.latestConfiguration.servers.map((s) =>
      s.id === id ? { ...s, mode: ServerMode.VOTER } : s
    );

    const newConfiguration: Configuration = {
      index: this.logManager.getLastIndex() + 1,
      servers: newServers,
    };

    const entry: LogEntry = {
      index: newConfiguration.index,
      term: this.currentTerm,
      configuration: newConfiguration,
      timestamp: Date.now(),
    };

    this.logger.info(
      `Promoting staging server ${id} to voter at index ${entry.index}`
    );
    this.logManager.appendEntry(entry);
    this.latestConfiguration = newConfiguration;
    this.pendingConfigurationChange = true;

    // Replicate to both voters and staging nodes
    await Promise.all(
      this.getReplicationAddresses().map(async (peerUrl) => {
        if (peerUrl !== `http://${config.node.host}:${config.node.port}`) {
          try {
            await this.replicateLogToPeer(peerUrl);
          } catch (error) {
            const errorMsg = (error as Error).message;
            if (
              errorMsg.includes("timeout") ||
              errorMsg.includes("ECONNREFUSED")
            ) {
              this.logger.debug(`Replicate to ${peerUrl} failed: ${errorMsg}`);
            } else {
              this.logger.warn(`Replicate to ${peerUrl} failed: ${errorMsg}`);
            }
          }
        }
      })
    );

    this.updateCommitIndex();
  }

  // Node stop/restart (crash simulation)
  async stopNode(): Promise<{ success: boolean; error?: string }> {
    this.logger.info(`Stopping node ${config.node.id} (simulating crash)`);

    if (!this.isActive) {
      return { success: false, error: "Node is already stopped" };
    }

    // Simulate crash: stop all operations
    this.isActive = false;
    this.clearTimers();

    this.logger.info(`Node stopped successfully`);
    return { success: true };
  }

  async restartNode(
    resetState: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.info(
      `Restarting node ${config.node.id} (resetState=${resetState})`
    );

    if (this.isActive) {
      return { success: false, error: "Node is already running" };
    }

    // Reactivate the node
    this.isActive = true;

    if (resetState) {
      // Start from scratch (like a fresh boot)
      this.logger.info(`Resetting node state to initial values`);
      this.currentTerm = 0;
      this.votedFor = null;
      this.leaderId = null;
      this.becomeFollower(0);
    } else {
      // Keep current state but resume as follower
      this.logger.info(`Preserving node state, resuming as follower`);
      this.becomeFollower(this.currentTerm);
    }

    this.logger.info(`Node restarted successfully`);
    return { success: true };
  }
}
