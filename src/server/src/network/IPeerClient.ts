import {
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
} from "../types";

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

  // Send StopNode RPC to another node (for crash simulation)
  sendStopNode(nodeUrl: string): Promise<{ success: boolean; error?: string }>;

  // Send RestartNode RPC to another node (for recovery simulation)
  sendRestartNode(
    nodeUrl: string,
    resetState: boolean
  ): Promise<{ success: boolean; error?: string }>;
}
