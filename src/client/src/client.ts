export interface RaftClientOptions {
  nodeUrls?: string[];
}

export interface StatusResponse {
  nodeUrl: string;
  state: string;
  isActive?: boolean;
  term?: number;
  isLeader?: boolean;
  leaderId?: string;
  votedFor?: string;
  error?: string;
}

export interface ApiResponse {
  success?: boolean;
  value?: any;
  leaderId?: string;
  leaderAddress?: string;
  error?: string;
}

export class RaftClient {
  private currentLeaderIndex: number = 0;
  private selectedNodeUrl: string | null = null;

  constructor(private options?: RaftClientOptions) {}

  setSelectedNode(nodeUrl: string | null): void {
    this.selectedNodeUrl = nodeUrl;
  }

  getSelectedNode(): string | null {
    return this.selectedNodeUrl;
  }

  getNodes(): string[] {
    if (this.options?.nodeUrls) {
      return this.options.nodeUrls;
    }
    const nodeUrlsElement = document.getElementById(
      "nodeUrls"
    ) as HTMLTextAreaElement;
    if (!nodeUrlsElement) {
      return [];
    }
    return nodeUrlsElement.value
      .split("\n")
      .map((url) => url.trim())
      .filter((url) => url);
  }

  async executeRequest(
    method: string,
    path: string,
    data: any = null
  ): Promise<ApiResponse> {
    const nodes = this.getNodes();
    if (nodes.length === 0) {
      throw new Error("No nodes configured");
    }

    // If a node is selected, start with that node
    let tryOrder: string[];
    if (this.selectedNodeUrl) {
      // Try selected node first, then follow leader redirect
      tryOrder = [this.selectedNodeUrl];
    } else {
      // Try current leader first, then others
      tryOrder = [
        ...nodes.slice(this.currentLeaderIndex),
        ...nodes.slice(0, this.currentLeaderIndex),
      ];
    }

    let lastError: Error | null = null;
    let redirectCount = 0;
    const maxRedirects = 5;

    for (const node of tryOrder) {
      try {
        const url = `${node}${path}`;
        const options: RequestInit = {
          method: method,
          headers: {
            "Content-Type": "application/json",
          },
        };

        if (data) {
          options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);

        if (response.status === 302) {
          // Not leader, redirect to actual leader
          const responseData = await response.json();
          if (responseData.leaderAddress && redirectCount < maxRedirects) {
            redirectCount++;

            // Use the leader address directly from the response
            const leaderUrl = responseData.leaderAddress;

            try {
              const leaderResponse = await fetch(
                `${leaderUrl}${path}`,
                options
              );
              if (leaderResponse.ok) {
                // Update current leader index if the URL is in our node list
                const leaderIndex = nodes.indexOf(leaderUrl);
                if (leaderIndex !== -1) {
                  this.currentLeaderIndex = leaderIndex;
                }
                return await leaderResponse.json();
              } else if (leaderResponse.status === 302) {
                // Leader changed again, parse and retry
                const newLeaderData = await leaderResponse.json();
                if (
                  newLeaderData.leaderAddress &&
                  redirectCount < maxRedirects
                ) {
                  // Try the new leader
                  redirectCount++;
                  const newLeaderResponse = await fetch(
                    `${newLeaderData.leaderAddress}${path}`,
                    options
                  );
                  if (newLeaderResponse.ok) {
                    return await newLeaderResponse.json();
                  }
                }
              }
            } catch (error) {
              // Leader redirect failed, continue with next node
              lastError = error as Error;
            }
          }
          continue;
        }

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Request failed");
        }

        // Success! Update leader index
        this.currentLeaderIndex = nodes.indexOf(node);
        return await response.json();
      } catch (error) {
        lastError = error as Error;
        if (this.selectedNodeUrl) {
          // If selected node failed, don't try others for this request
          throw error;
        }
        continue;
      }
    }

    throw lastError || new Error("All nodes failed");
  }

  async ping(): Promise<ApiResponse> {
    return await this.executeRequest("GET", "/api/ping");
  }

  async get(key: string): Promise<ApiResponse> {
    return await this.executeRequest(
      "GET",
      `/api/kv/${encodeURIComponent(key)}`
    );
  }

  async set(key: string, value: string): Promise<ApiResponse> {
    return await this.executeRequest(
      "POST",
      `/api/kv/${encodeURIComponent(key)}`,
      { value }
    );
  }

  async del(key: string): Promise<ApiResponse> {
    return await this.executeRequest(
      "DELETE",
      `/api/kv/${encodeURIComponent(key)}`
    );
  }

  async append(key: string, value: string): Promise<ApiResponse> {
    return await this.executeRequest(
      "PUT",
      `/api/kv/${encodeURIComponent(key)}/append`,
      { value }
    );
  }

  async strlen(key: string): Promise<ApiResponse> {
    return await this.executeRequest(
      "GET",
      `/api/kv/${encodeURIComponent(key)}/length`
    );
  }

  async status(): Promise<StatusResponse[]> {
    const nodes = this.getNodes();
    const statuses: StatusResponse[] = [];

    for (const node of nodes) {
      console.log("Fetching status from node:", node);
      try {
        const response = await fetch(`${node}/api/raft/status`);
        const data = await response.json();
        statuses.push({
          ...data,
          nodeUrl: node,
        });
      } catch (error) {
        statuses.push({
          nodeUrl: node,
          state: "unreachable",
          error: (error as Error).message,
        });
      }
    }

    return statuses;
  }

  async requestLog(): Promise<ApiResponse> {
    return await this.executeRequest("GET", "/api/request_log");
  }

  async addVoter(id: string, address: string): Promise<ApiResponse> {
    return await this.executeRequest("POST", "/api/add-voter", { id, address });
  }

  async removePeer(id: string): Promise<ApiResponse> {
    return await this.executeRequest("POST", "/api/remove-peer", { id });
  }

  async getConfiguration(): Promise<ApiResponse> {
    return await this.executeRequest("GET", "/api/configuration");
  }

  async stopNode(): Promise<ApiResponse> {
    return await this.executeRequest("POST", "/api/stop-node");
  }

  async restartNode(resetState: boolean = false): Promise<ApiResponse> {
    return await this.executeRequest("POST", "/api/restart-node", {
      resetState,
    });
  }
}
