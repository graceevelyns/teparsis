# Raft

### Implementation

- `KVStore` - Key-value storage operations
- `LogManager` - Raft log management
- `RaftNode` - Core Raft consensus algorithm
- `PeerClient` - Network communication between nodes
- `Logger` - Logging functionality
- API Controllers - Request handling logic

## Project Structure

```
server/
├── src/
│   ├── api/                   # REST API layer
│   │   ├── routes.ts          # Route definitions
│   │   └── controllers/       # Request handlers
│   ├── core/                  # Raft algorithm implementation
│   │   ├── RaftNode.ts        # Main Raft logic
│   │   ├── LogManager.ts      # Log management
│   │   └── interfaces/        # Interfaces
│   ├── store/                 # Key-value storage
│   │   ├── KVStore.ts         # In-memory storage implementation
│   │   └── IKVStore.ts        # Storage interface
│   ├── network/               # Peer communication
│   │   ├── PeerClient.ts      # HTTP client for peer communication
│   │   └── IPeerClient.ts     # Network interface
│   ├── types/                 # Type definitions
│   ├── utils/                 # Utility classes
│   ├── config.ts              # Configuration management
│   └── index.ts               # Composition root
├── package.json
└── tsconfig.json
```

## System Flo

### **Client Request Flow (Read/Write Operations)**

```
Client Request → Express Server → Router → Controller → RaftNode → KVStore/LogManager
     ↓
1. Client sends HTTP request (GET/POST/DELETE) to any node
2. Express middleware processes request
3. Router matches URL pattern (/api/client/get/:key, /api/client/set, etc.)
4. ClientController method is called (get, set, del, etc.)
5. Controller checks: Is this node the leader?
   - If NOT leader → Redirect to leader node (HTTP 302)
   - If IS leader → Process the request
6. For READS: RaftNode → KVStore.get() → Return value
7. For WRITES: RaftNode creates LogEntry → LogManager → Replicate to followers
8. Once majority confirms → Commit to KVStore → Return success
```

### **Leader Election Flow**

```
Election Timeout → Become Candidate → Request Votes → Count Votes → Become Leader
     ↓
1. Follower State: Node starts as follower, waits for heartbeats
2. Election Timeout: If no heartbeat received within timeout (150-300ms)
   → Node becomes CANDIDATE
3. Start Election:
   - Increment current term
   - Vote for self
   - Reset election timer
   - Send RequestVote RPCs to ALL peers simultaneously
4. Collect Votes:
   - Wait for responses from other nodes
   - Count votes (need majority: >50% of cluster)
5. Election Results:
   - If MAJORITY votes received → Become LEADER
   - If another node becomes leader → Become FOLLOWER
   - If election timeout → Start new election (increment term)
6. New Leader Actions:
   - Send immediate heartbeat to all followers
   - Start periodic heartbeat timer (50ms interval)
```

### **Heartbeat Flow (Leader → Followers)**

```
Leader Timer → Create AppendEntries → Send to All Followers → Receive Responses
     ↓
1. Leader Heartbeat Timer: Fires every 50ms
2. Create AppendEntries RPC:
   - term: current term
   - leaderId: this node's ID
   - prevLogIndex & prevLogTerm: for log consistency
   - entries: [] (empty for heartbeat, or actual log entries)
   - leaderCommit: leader's commit index
3. Send to All Followers:
   - PeerClient sends HTTP POST to each follower
   - URL: http://follower:port/api/raft/append-entries
4. Follower Response:
   - success: true (if term is valid and log consistent)
   - term: follower's current term
5. Leader Processes Responses:
   - If majority responds → Continue as leader
   - If higher term discovered → Step down to follower
   - If log inconsistency → Send missing log entries
```

### **Log Replication Flow (Write Operations)**

```
Client Write → Leader Log → Replicate → Majority Confirm → Commit → Apply → Response
     ↓
1. Client Sends Write: POST /api/client/set {key: "x", value: "y"}
2. Leader Receives Request:
   - ClientController.set() called
   - Check if this node is leader (redirect if not)
3. Create Log Entry:
   - LogEntry: {term, index, command: "SET x y"}
   - LogManager.appendEntry(entry)
4. Replicate to Followers:
   - Send AppendEntries RPC with new entry to ALL followers
   - Include previous log info for consistency check
5. Followers Process:
   - Check term and log consistency
   - If valid: append entry, return success
   - If invalid: return failure with details
6. Leader Waits for Majority:
   - Count successful responses
   - Need >50% of cluster to confirm
7. Commit and Apply:
   - If majority confirms → update commitIndex
   - Apply entry to KVStore: store.set("x", "y")
   - Send commit info in next heartbeat
8. Return to Client: HTTP 200 with success response
```

### **Peer-to-Peer Communication Flow**

```
RaftNode → PeerClient → HTTP Request → Peer RaftController → RaftNode → Response
     ↓
1. Outgoing RPC (This Node → Peer):
   - RaftNode calls peerClient.sendAppendEntries(peerId, request)
   - PeerClient creates HTTP POST request
   - URL: http://peer-host:peer-port/api/raft/append-entries
   - Body: AppendEntriesRequest JSON
2. Incoming RPC (Peer → This Node):
   - Express server receives POST /api/raft/append-entries
   - Router directs to RaftController.appendEntries()
   - RaftController calls raftNode.handleAppendEntries()
   - RaftNode processes and returns AppendEntriesResponse
3. Response Handling:
   - HTTP response sent back to calling peer
   - Calling peer's PeerClient receives response
   - Response passed back to calling RaftNode
```

### **State Transitions**

```
FOLLOWER ←→ CANDIDATE ←→ LEADER
     ↓
FOLLOWER → CANDIDATE:
- Trigger: Election timeout (no heartbeat received)
- Actions: Increment term, vote for self, request votes

CANDIDATE → LEADER:
- Trigger: Receive majority votes
- Actions: Send heartbeats, stop election timer

CANDIDATE → FOLLOWER:
- Trigger: Receive heartbeat from valid leader OR higher term
- Actions: Reset election timer, clear vote

LEADER → FOLLOWER:
- Trigger: Receive higher term from any RPC
- Actions: Step down, reset state, start election timer
```

## Understanding Raft Consensus

### Core Concepts

1. **Leader Election**: Nodes elect a leader to handle client requests
2. **Log Replication**: Leader replicates log entries to followers
3. **Safety**: Ensures consistency across the cluster

### Key Algorithms to Implement

#### Leader Election Process

1. All nodes start as followers
2. If election timeout expires → become candidate
3. Candidate votes for itself and requests votes from others
4. If majority votes received → become leader
5. Leader sends heartbeats to maintain leadership

#### Log Replication Process

1. Client sends request to leader
2. Leader appends entry to its log
3. Leader replicates entry to followers via AppendEntries
4. Once majority acknowledges → leader commits entry
5. Leader applies entry to state machine and responds to client
