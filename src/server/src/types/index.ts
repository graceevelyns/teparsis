export enum RaftNodeState {
  FOLLOWER = "follower",
  CANDIDATE = "candidate",
  LEADER = "leader",
}

export enum ServerMode {
  VOTER = "voter",
  STAGING = "staging",
}

export interface ServerInfo {
  id: string;
  address: string;
  mode: ServerMode;
}

export interface Configuration {
  index: number;
  servers: ServerInfo[];
}

export interface LogEntry {
  index: number;
  term: number;
  command?: {
    operation: "set" | "del" | "append";
    key: string;
    value?: string;
  };
  configuration?: Configuration;
  timestamp: number;
}

export interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
  matchIndex?: number;
}

export interface RequestVoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResponse {
  term: number;
  voteGranted: boolean;
}

export interface NodeConfig {
  id: string;
  host: string;
  port: number;
  peers: string[];
}

export interface KVOperation {
  operation: "get" | "set" | "del" | "append" | "strlen" | "ping";
  key?: string;
  value?: string;
}

export interface ClientResponse {
  success: boolean;
  value?: string | number | null | any;
  error?: string;
  isLeader?: boolean;
  leaderId?: string | null;
  leaderAddress?: string | null;
}

export interface AddVoterRequest {
  id: string;
  address: string;
}

export interface RemovePeerRequest {
  id: string;
}

export interface MembershipChangeResponse {
  success: boolean;
  error?: string;
  configuration?: Configuration;
}
