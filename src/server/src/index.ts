import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import config from "./config";
import { Logger } from "./utils/Logger";
import { KVStore } from "./store/KVStore";
import { LogManager } from "./core/LogManager";
import { PeerClient } from "./network/PeerClient";
import { RaftNode } from "./core/RaftNode";
import { PersistentStorage } from "./core/PersistentStorage";
import { ClientController } from "./api/controllers/ClientController";
import { RaftController } from "./api/controllers/RaftController";
import { createRoutes } from "./api/routes";

class Application {
  private readonly logger: Logger;
  private readonly store: KVStore;
  private readonly storage: PersistentStorage;
  private readonly logManager: LogManager;
  private readonly peerClient: PeerClient;
  private readonly raftNode: RaftNode;
  private readonly clientController: ClientController;
  private readonly raftController: RaftController;
  private readonly app: express.Application;

  constructor() {
    this.logger = new Logger("RaftNode");

    // Initialize persistent storage
    this.storage = new PersistentStorage(
      config.storage.dataDir,
      config.node.id,
      this.logger
    );

    this.store = new KVStore();

    // Initialize log manager with persistent storage
    this.logManager = new LogManager(this.storage);
    this.peerClient = new PeerClient(this.logger);

    // Initialize RaftNode with persistent storage
    this.raftNode = new RaftNode(
      this.store,
      this.logManager,
      this.peerClient,
      this.logger,
      this.storage
    );

    this.clientController = new ClientController(
      this.raftNode,
      this.store,
      this.logger
    );

    this.raftController = new RaftController(this.raftNode, this.logger);

    this.app = this.createExpressApp();
  }

  private createExpressApp(): express.Application {
    const app = express();

    // Middleware
    app.use(helmet());
    app.use(cors());
    app.use(express.json());

    // Routes
    const routes = createRoutes({
      clientController: this.clientController,
      raftController: this.raftController,
    });

    app.use("/api", routes);

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        nodeId: config.node.id,
        timestamp: new Date().toISOString(),
      });
    });

    // Error handling middleware
    app.use(
      (
        err: Error,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        this.logger.error("Unhandled error", err);
        res.status(500).json({ error: "Internal server error" });
      }
    );

    return app;
  }

  public async start(): Promise<void> {
    try {
      // Start the Raft node
      this.raftNode.start();

      // Start the HTTP server
      const server = this.app.listen(config.node.port, config.node.host, () => {
        this.logger.info(
          `Server started on ${config.node.host}:${config.node.port}`
        );
        this.logger.info(`Node ID: ${config.node.id}`);
        this.logger.info(`Peers: ${config.cluster.peers.join(", ")}`);
      });

      // Graceful shutdown handling
      process.on("SIGTERM", () => {
        this.logger.info("Received SIGTERM, shutting down gracefully");
        this.raftNode.stop();
        server.close(() => {
          this.logger.info("Server closed");
          process.exit(0);
        });
      });

      process.on("SIGINT", () => {
        this.logger.info("Received SIGINT, shutting down gracefully");
        this.raftNode.stop();
        server.close(() => {
          this.logger.info("Server closed");
          process.exit(0);
        });
      });
    } catch (error) {
      this.logger.error("Failed to start application", error as Error);
      process.exit(1);
    }
  }
}

const app = new Application();
app.start().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
