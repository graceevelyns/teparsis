import { Request, Response } from "express";
import { RaftNode } from "../../core/RaftNode";
import { AppendEntriesRequest, RequestVoteRequest } from "../../types";
import { InstallSnapshotRequest } from "../../types/Snapshot";
import { Logger } from "../../utils/Logger";

export class RaftController {
  constructor(
    private readonly raftNode: RaftNode,
    private readonly logger: Logger
  ) {}

  appendEntries = (req: Request, res: Response): void => {
    try {
      const request: AppendEntriesRequest = req.body;
      const response = this.raftNode.processAppendEntries(request);
      res.json(response);
    } catch (error) {
      this.logger.error("Error processing AppendEntries", error as Error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  requestVote = (req: Request, res: Response): void => {
    try {
      const request: RequestVoteRequest = req.body;
      const response = this.raftNode.processRequestVote(request);
      res.json(response);
    } catch (error) {
      this.logger.error("Error processing RequestVote", error as Error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  installSnapshot = (req: Request, res: Response): void => {
    try {
      const request: InstallSnapshotRequest = req.body;
      const response = this.raftNode.processInstallSnapshot(request);
      res.json(response);
    } catch (error) {
      this.logger.error("Error processing InstallSnapshot", error as Error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  status = (req: Request, res: Response): void => {
    try {
      const status = {
        state: this.raftNode.getState(),
        term: this.raftNode.getCurrentTerm(),
        isLeader: this.raftNode.isLeader(),
        leaderId: this.raftNode.getLeaderId(),
        votedFor: this.raftNode.getVotedFor(),
      };
      res.json(status);
    } catch (error) {
      this.logger.error("Error getting node status", error as Error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

