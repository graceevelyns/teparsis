export interface Config {
  node: {
    id: string;
    host: string;
    port: number;
  };
  cluster: {
    peers: string[];
  };
  raft: {
    electionTimeoutMin: number;
    electionTimeoutMax: number;
    heartbeatInterval: number;
  };
}

const config: Config = {
  node: {
    id: process.env.NODE_ID || "node-1",
    host: process.env.NODE_HOST || "0.0.0.0",
    port: parseInt(process.env.NODE_PORT || "3000", 10),
  },
  cluster: {
    peers: process.env.CLUSTER_PEERS?.split(",") || [],
  },
  raft: {
    electionTimeoutMin: 150,
    electionTimeoutMax: 300,
    heartbeatInterval: 50,
  },
};

export default config;
