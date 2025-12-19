import { LogEntry } from "./index";

/**
 * Snapshot of the state machine for log compaction
 */
export interface Snapshot {
  /** Index of the last log entry included in this snapshot */
  lastIncludedIndex: number;
  /** Term of the last log entry included in this snapshot */
  lastIncludedTerm: number;
  /** State machine data (key-value pairs) */
  data: Record<string, string>;
  /** Timestamp when snapshot was created */
  timestamp: number;
}

/**
 * InstallSnapshot RPC request from leader to follower
 */
export interface InstallSnapshotRequest {
  term: number;
  leaderId: string;
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  data: Record<string, string>;
}

/**
 * InstallSnapshot RPC response
 */
export interface InstallSnapshotResponse {
  term: number;
}

/**
 * Persistent Raft state that must survive restarts
 */
export interface RaftPersistentState {
  currentTerm: number;
  votedFor: string | null;
}
