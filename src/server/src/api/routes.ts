import { Router } from "express";
import { ClientController } from "./controllers/ClientController";
import { RaftController } from "./controllers/RaftController";

export interface RouteHandlers {
  clientController: ClientController;
  raftController: RaftController;
}

export function createRoutes(handlers: RouteHandlers): Router {
  const router = Router();

  // Client API routes
  router.get("/ping", handlers.clientController.ping);
  router.get("/kv/:key", handlers.clientController.get);
  router.post("/kv/:key", handlers.clientController.set);
  router.delete("/kv/:key", handlers.clientController.del);
  router.put("/kv/:key/append", handlers.clientController.append);
  router.get("/kv/:key/length", handlers.clientController.strlen);

  // Unified client interfaces
  router.post("/execute", handlers.clientController.execute);
  router.get("/request_log", handlers.clientController.requestLog);

  // Snapshot management
  router.post("/snapshot", handlers.clientController.triggerSnapshot);

  // Raft protocol routes
  router.post("/raft/append-entries", handlers.raftController.appendEntries);
  router.post("/raft/request-vote", handlers.raftController.requestVote);
  router.post("/raft/install-snapshot", handlers.raftController.installSnapshot);
  router.get("/raft/status", handlers.raftController.status);

  return router;
}

