import { Request, Response } from "express";
import { RaftNode } from "../../core/RaftNode";
import { IKVStore } from "../../store/IKVStore";
import { ClientResponse, KVWriteCommand } from "../../types";
import { Logger } from "../../utils/Logger";

export class ClientController {
  private requestHistory: Array<{
    index: number;
    term: number;
    command: any;
    timestamp: number;
    isCommitted: boolean;
  }> = [];
  private requestIndex = 0;

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
      this.recordRequest("get", key, value, true);
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
      const success = await this.raftNode.proposeEntry("set", key, value);

      if (success) {
        const response: ClientResponse = {
          success: true,
          value: "OK",
        };
        this.recordRequest("set", key, value, true);
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
      const success = await this.raftNode.proposeEntry("del", key);

      if (success) {
        const response: ClientResponse = {
          success: true,
          value: deletedValue,
        };
        this.recordRequest("del", key, deletedValue, true);
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
      const success = await this.raftNode.proposeEntry("append", key, value);

      if (success) {
        const response: ClientResponse = {
          success: true,
          value: "OK",
        };
        this.recordRequest("append", key, value, true);
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
      this.recordRequest("strlen", key, length, true);
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
      this.recordRequest("ping", undefined, pong, true);
      res.json(response);
    } catch (error) {
      this.logger.error("Error in PING operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  execute = async (req: Request, res: Response): Promise<void> => {
    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    const { operation, key, value } = req.body;

    if (!operation || !key) {
      this.sendError(res, "operation and key are required");
      return;
    }

    try {
      let result: any;

      switch (operation.toLowerCase()) {
        case "ping":
          result = this.store.ping();
          this.recordRequest("ping", undefined, result, true);
          break;

        case "get":
          result = this.store.get(key);
          this.recordRequest("get", key, result, true);
          break;

        case "set":
          if (value === undefined) {
            this.sendError(res, "value is required for SET operation");
            return;
          }
          const setSuccess = await this.raftNode.proposeEntry(
            "set",
            key,
            value
          );
          if (!setSuccess) {
            this.sendError(res, "Failed to reach consensus");
            return;
          }
          this.recordRequest("set", key, value, true);
          result = "OK";
          break;

        case "del":
          const delValue = this.store.get(key);
          const delSuccess = await this.raftNode.proposeEntry("del", key);
          if (!delSuccess) {
            this.sendError(res, "Failed to reach consensus");
            return;
          }
          this.recordRequest("del", key, delValue, true);
          result = delValue;
          break;

        case "append":
          if (value === undefined) {
            this.sendError(res, "value is required for APPEND operation");
            return;
          }
          const appendSuccess = await this.raftNode.proposeEntry(
            "append",
            key,
            value
          );
          if (!appendSuccess) {
            this.sendError(res, "Failed to reach consensus");
            return;
          }
          this.recordRequest("append", key, value, true);
          result = "OK";
          break;

        case "strlen":
          result = this.store.strlen(key);
          this.recordRequest("strlen", key, result, true);
          break;

        default:
          this.sendError(res, `Unknown operation: ${operation}`);
          return;
      }

      const response: ClientResponse = {
        success: true,
        value: result,
      };
      res.json(response);
    } catch (error) {
      this.logger.error(
        `Error in EXECUTE operation (${operation})`,
        error as Error
      );
      this.sendError(res, "Internal server error");
    }
  };

  executeTransaction = async (req: Request, res: Response): Promise<void> => {
    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    const { commands } = req.body;

    if (!Array.isArray(commands) || commands.length === 0) {
      this.sendError(res, "commands array is required");
      return;
    }

    const parsedWrites: KVWriteCommand[] = [];
    const parsedAll: Array<{
      operation: "set" | "del" | "append" | "get" | "strlen";
      key: string;
      value?: string;
    }> = [];

    for (const raw of commands) {
      const operation = typeof raw?.operation === "string" ? raw.operation.toLowerCase() : null;
      const key = raw?.key;
      const value = raw?.value;

      if (
        operation !== "set" &&
        operation !== "del" &&
        operation !== "append" &&
        operation !== "get" &&
        operation !== "strlen"
      ) {
        this.sendError(res, `Unsupported operation: ${operation}`);
        return;
      }

      if (!key) {
        this.sendError(res, "key is required for all commands");
        return;
      }

      if ((operation === "set" || operation === "append") && value === undefined) {
        this.sendError(res, `value is required for ${operation.toUpperCase()} operation`);
        return;
      }

      parsedAll.push({ operation, key, value });
      if (operation === "set" || operation === "del" || operation === "append") {
        parsedWrites.push({ operation, key, value });
      }
    }

    try {
      const results = this.simulateTransaction(parsedAll);

      if (parsedWrites.length === 0) {
        const response: ClientResponse = {
          success: true,
          value: results,
        };
        this.recordRequest("transaction", undefined, parsedAll, true);
        res.json(response);
        return;
      }

      const success = await this.raftNode.proposeTransaction(parsedWrites);

      if (!success) {
        this.sendError(res, "Failed to reach consensus");
        return;
      }

      const response: ClientResponse = {
        success: true,
        value: results,
      };
      this.recordRequest("transaction", undefined, parsedAll, true);
      res.json(response);
    } catch (error) {
      this.logger.error("Error in transaction operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  private simulateTransaction(
    commands: Array<{ operation: "set" | "del" | "append" | "get" | "strlen"; key: string; value?: string }>
  ): any[] {
    const DELETED = Symbol("deleted");
    const buffer = new Map<string, string | typeof DELETED>();
    const results: any[] = [];

    const readValue = (key: string): string => {
      if (buffer.has(key)) {
        const value = buffer.get(key);
        return value === DELETED ? "" : (value as string);
      }
      return this.store.get(key);
    };

    for (const cmd of commands) {
      const current = readValue(cmd.key);

      switch (cmd.operation) {
        case "set": {
          buffer.set(cmd.key, cmd.value ?? "");
          results.push("OK");
          break;
        }
        case "del": {
          buffer.set(cmd.key, DELETED);
          results.push(current);
          break;
        }
        case "append": {
          const newVal = current + (cmd.value ?? "");
          buffer.set(cmd.key, newVal);
          results.push(newVal);
          break;
        }
        case "get": {
          results.push(current);
          break;
        }
        case "strlen": {
          results.push(current.length);
          break;
        }
      }
    }

    return results;
  }

  requestLog = (req: Request, res: Response): void => {
    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    try {
      const response: ClientResponse = {
        success: true,
        value: this.requestHistory,
      };
      this.recordRequest("request_log", undefined, this.requestHistory.length, true);
      res.json(response);
    } catch (error) {
      this.logger.error("Error in REQUEST_LOG operation", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  private recordRequest(
    operation: string,
    key?: string,
    value?: any,
    isCommitted: boolean = true
  ): void {
    this.requestHistory.push({
      index: this.requestIndex++,
      term: this.raftNode.getCurrentTerm(),
      command:
        value === undefined ? { operation, key } : { operation, key, value },
      timestamp: Date.now(),
      isCommitted,
    });
  }

  // Membership change operations

  addVoter = async (req: Request, res: Response): Promise<void> => {
    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    const { id, address } = req.body;

    if (!id || !address) {
      this.sendError(res, "id and address are required");
      return;
    }

    try {
      const result = await this.raftNode.addVoter(id, address);

      if (result.success) {
        res.json(result);
      } else {
        this.sendError(res, result.error || "Failed to add voter");
      }
    } catch (error) {
      this.logger.error("Error adding voter", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  removePeer = async (req: Request, res: Response): Promise<void> => {
    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    const { id } = req.body;

    if (!id) {
      this.sendError(res, "id is required");
      return;
    }

    try {
      const result = await this.raftNode.removePeer(id);

      if (result.success) {
        res.json(result);
      } else {
        this.sendError(res, result.error || "Failed to remove peer");
      }
    } catch (error) {
      this.logger.error("Error removing peer", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  getConfiguration = async (req: Request, res: Response): Promise<void> => {
    if (!this.raftNode.isLeader()) {
      this.redirectToLeader(res);
      return;
    }

    try {
      const configuration = await this.raftNode.getConfiguration();
      const response: ClientResponse = {
        success: true,
        value: configuration,
      };
      res.json(response);
    } catch (error) {
      this.logger.error("Error getting configuration", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  // Node stop/restart endpoints
  stopNode = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.raftNode.stopNode();

      if (result.success) {
        res.json(result);
      } else {
        this.sendError(res, result.error || "Failed to stop node");
      }
    } catch (error) {
      this.logger.error("Error stopping node", error as Error);
      this.sendError(res, "Internal server error");
    }
  };

  restartNode = async (req: Request, res: Response): Promise<void> => {
    const { resetState } = req.body;

    try {
      const result = await this.raftNode.restartNode(resetState === true);

      if (result.success) {
        res.json(result);
      } else {
        this.sendError(res, result.error || "Failed to restart node");
      }
    } catch (error) {
      this.logger.error("Error restarting node", error as Error);
      this.sendError(res, "Internal server error");
    }
  }

  private redirectToLeader(res: Response): void {
    const response: ClientResponse = {
      success: false,
      error: "Not the leader",
      isLeader: false,
      leaderId: this.raftNode.getLeaderId(),
      leaderAddress: this.raftNode.getLeaderAddress(),
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
