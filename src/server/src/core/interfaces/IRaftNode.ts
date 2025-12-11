import { RaftNodeState } from "../../types";

/**
 * Interface for the main Raft consensus node
 * Manages state transitions, leader election, and log replication
 */
export interface IRaftNode {
  // Get current node state (follower, candidate, or leader)
  getState(): RaftNodeState;
  
  // Get current term number
  getCurrentTerm(): number;
  
  // Get ID of node this node voted for in current term (null if not voted)
  getVotedFor(): string | null;
  
  // Get ID of current cluster leader (null if no known leader)
  getLeaderId(): string | null;
  
  // Check if this node is currently the leader
  isLeader(): boolean;
  
  // Start the Raft node (begins as follower)
  start(): void;
  
  // Stop the Raft node and clean up timers
  stop(): void;
  
  // Process incoming AppendEntries RPC from leader
  processAppendEntries(request: any): any;
  
  // Process incoming RequestVote RPC from candidate
  processRequestVote(request: any): any;
  
  // Propose new entry for consensus (only leader can call this)
  proposeEntry(operation: 'set' | 'del' | 'append', key: string, value?: string): Promise<boolean>;

  // Get all logs from the node
  getLogs(): any[];
}
