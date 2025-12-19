import * as http from "http";
import * as https from "https";
import {
  AppendEntriesRequest,
  AppendEntriesResponse,
  RequestVoteRequest,
  RequestVoteResponse,
} from "../types";
import { IPeerClient } from "./IPeerClient";
import { Logger } from "../utils/Logger";

export class PeerClient implements IPeerClient {
  constructor(private readonly logger: Logger) {}

  async sendAppendEntries(
    nodeUrl: string,
    request: AppendEntriesRequest
  ): Promise<AppendEntriesResponse> {
    try {
      return await this.makeHttpRequest<AppendEntriesResponse>(
        `${nodeUrl}/raft/append-entries`,
        request
      );
    } catch (error) {
      // Use debug for timeout errors to reduce log noise
      const errorMsg = (error as Error).message;
      if (errorMsg.includes("timeout") || errorMsg.includes("ECONNREFUSED")) {
        this.logger.debug(
          `Failed to send AppendEntries to ${nodeUrl}: ${errorMsg}`
        );
      } else {
        this.logger.error(
          `Failed to send AppendEntries to ${nodeUrl}`,
          error as Error
        );
      }
      throw error;
    }
  }

  async sendRequestVote(
    nodeUrl: string,
    request: RequestVoteRequest
  ): Promise<RequestVoteResponse> {
    try {
      return await this.makeHttpRequest<RequestVoteResponse>(
        `${nodeUrl}/raft/request-vote`,
        request
      );
    } catch (error) {
      // Use debug for timeout errors to reduce log noise
      const errorMsg = (error as Error).message;
      if (errorMsg.includes("timeout") || errorMsg.includes("ECONNREFUSED")) {
        this.logger.debug(
          `Failed to send RequestVote to ${nodeUrl}: ${errorMsg}`
        );
      } else {
        this.logger.error(
          `Failed to send RequestVote to ${nodeUrl}`,
          error as Error
        );
      }
      throw error;
    }
  }

  async sendStopNode(
    nodeUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await this.makeHttpRequest<{ success: boolean; error?: string }>(
        `${nodeUrl}/stop-node`,
        {}
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send StopNode to ${nodeUrl}: ${(error as Error).message}`
      );
      throw error;
    }
  }

  async sendRestartNode(
    nodeUrl: string,
    resetState: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await this.makeHttpRequest<{ success: boolean; error?: string }>(
        `${nodeUrl}/restart-node`,
        { resetState }
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send RestartNode to ${nodeUrl}: ${(error as Error).message}`
      );
      throw error;
    }
  }

  private async makeHttpRequest<T>(url: string, data: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === "https:";
      const client = isHttps ? https : http;

      const postData = JSON.stringify(data);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 5000,
      };

      const req = client.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              const jsonResponse = JSON.parse(responseData);
              resolve(jsonResponse);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse JSON response: ${error}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.write(postData);
      req.end();
    });
  }
}
