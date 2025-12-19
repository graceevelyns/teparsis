import {
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
} from "../types";
import { InstallSnapshotRequest, InstallSnapshotResponse } from "../types/Snapshot";

/**
 * Interface for communicating with other Raft nodes
 * Handles JSON-RPC over HTTP requests
 */
export interface IPeerClient {
  // Send AppendEntries RPC to another node (for heartbeats and log replication)
  sendAppendEntries(
    nodeUrl: string,
    request: AppendEntriesRequest
  ): Promise<AppendEntriesResponse>;
  
  // Send RequestVote RPC to another node (for leader election)
  sendRequestVote(
    nodeUrl: string,
    request: RequestVoteRequest
  ): Promise<RequestVoteResponse>;

  // Send InstallSnapshot RPC to another node (for log compaction)
  sendInstallSnapshot(
    nodeUrl: string,
    request: InstallSnapshotRequest
  ): Promise<InstallSnapshotResponse>;
}

