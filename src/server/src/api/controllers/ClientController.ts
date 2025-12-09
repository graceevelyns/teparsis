import { Request, Response } from "express";
import { RaftNode } from "../../core/RaftNode";
import { IKVStore } from "../../store/IKVStore";
import { ClientResponse } from "../../types";
import { Logger } from "../../utils/Logger";

export class ClientController {
  constructor(
    private readonly raftNode: RaftNode,
    private readonly store: IKVStore,
    private readonly logger: Logger
  ) {}

  get = (req: Request, res: Response): void => {
    const { key } = req.params;

    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    try {
      const value = this.store.get(key);
      const response: ClientResponse = {
        success: true,
        value: value,
      };
      res.json(response);
    } catch (error) {
      this.logger.error("Error in GET operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  set = async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;
    const { value } = req.body;

    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    if (value === undefined) {
      this.sendError(res, "Value is required");
      return;
    }

    try {
      const success = await this.raftNode.proposeEntry('set', key, value);
      
      if (success) {
        const response: ClientResponse = {
          success: true,
          value: "OK",
        };
        res.json(response);
      } else {
        this.sendError(res, "Failed to reach consensus");
      }
    } catch (error) {
      this.logger.error("Error in SET operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  del = async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;

    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    const deletedValue = this.store.get(key);

    try {
      const success = await this.raftNode.proposeEntry('del', key);
      
      if (success) {
        const response: ClientResponse = {
          success: true,
          value: deletedValue,
        };
        res.json(response);
      } else {
        this.sendError(res, "Failed to reach consensus");
      }
    } catch (error) {
      this.logger.error("Error in DEL operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  append = async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;
    const { value } = req.body;

    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    if (value === undefined) {
      this.sendError(res, "Value is required");
      return;
    }

    try {
      const success = await this.raftNode.proposeEntry('append', key, value);
      
      if (success) {
        const response: ClientResponse = {
          success: true,
          value: "OK",
        };
        res.json(response);
      } else {
        this.sendError(res, "Failed to reach consensus");
      }
    } catch (error) {
      this.logger.error("Error in APPEND operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  strlen = (req: Request, res: Response): void => {
    const { key } = req.params;

    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    try {
      const length = this.store.strlen(key);
      const response: ClientResponse = {
        success: true,
        value: length,
      };
      res.json(response);
    } catch (error) {
      this.logger.error("Error in STRLEN operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  ping = (req: Request, res: Response): void => {
    try {
      const pong = this.store.ping();
      const response: ClientResponse = {
        success: true,
        value: pong,
      };
      res.json(response);
    } catch (error) {
      this.logger.error("Error in PING operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  private redirectToLeader(res: Response): void {
    const response: ClientResponse = {
      success: false,
      error: "Not the leader",
      isLeader: false,
      leaderId: this.raftNode.getLeaderId(),
    };
    res.status(302).json(response);
  }

  private sendError(res: Response, message: string): void {
    const response: ClientResponse = {
      success: false,
      error: message,
    };
    res.status(400).json(response);
  }
}
