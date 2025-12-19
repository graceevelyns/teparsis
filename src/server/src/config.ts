export interface Config {
  node: {
    id: string;
    host: string;
    port: number;
    initialActive: boolean;
  };
  cluster: {
    peers: string[];
    peersIds: string[];
  };
  raft: {
    electionTimeoutMin: number;
    electionTimeoutMax: number;
    heartbeatInterval: number;
  };
}

const config: Config = {
  node: {
    id: process.env.NODE_ID || "3000",
    host: process.env.NODE_HOST || "0.0.0.0",
    port: parseInt(process.env.NODE_PORT || "3000", 10),
    initialActive: process.env.INITIAL_ACTIVE === "true",
  },
  cluster: {
    peers: process.env.CLUSTER_PEERS?.split(",") || [],
    peersIds: process.env.CLUSTER_PEERS_IDS?.split(",") || [],
  },
  raft: {
    electionTimeoutMin: 1000,
    electionTimeoutMax: 2000,
    heartbeatInterval: 100,
  },
};

export default config;
