import * as fs from "fs";
import * as path from "path";
import { LogEntry } from "../types";
import { Snapshot, RaftPersistentState } from "../types/Snapshot";
import { Logger } from "../utils/Logger";

/**
 * Handles persistent storage of Raft state, logs, and snapshots to disk
 */
export class PersistentStorage {
  private readonly dataDir: string;
  private readonly logFile: string;
  private readonly snapshotFile: string;
  private readonly stateFile: string;

  constructor(
    baseDataDir: string,
    private readonly nodeId: string,
    private readonly logger: Logger
  ) {
    this.dataDir = path.join(baseDataDir, nodeId);
    this.logFile = path.join(this.dataDir, "log.json");
    this.snapshotFile = path.join(this.dataDir, "snapshot.json");
    this.stateFile = path.join(this.dataDir, "raft-state.json");

    this.ensureDataDir();
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.logger.info(`Created data directory: ${this.dataDir}`);
    }
  }

  // ============================================================
  // Log Persistence
  // ============================================================

  /**
   * Save entire log to disk (used for full rewrite after compaction)
   */
  saveLog(entries: LogEntry[]): void {
    try {
      const data = JSON.stringify(entries, null, 2);
      fs.writeFileSync(this.logFile, data, "utf-8");
      this.logger.debug(`Saved ${entries.length} log entries to disk`);
    } catch (error) {
      this.logger.error("Failed to save log", error as Error);
      throw error;
    }
  }

  /**
   * Load log from disk
   */
  loadLog(): LogEntry[] {
    try {
      if (!fs.existsSync(this.logFile)) {
        return [];
      }
      const data = fs.readFileSync(this.logFile, "utf-8");
      const entries = JSON.parse(data) as LogEntry[];
      this.logger.info(`Loaded ${entries.length} log entries from disk`);
      return entries;
    } catch (error) {
      this.logger.error("Failed to load log", error as Error);
      return [];
    }
  }

  /**
   * Append a single log entry (efficient incremental write)
   */
  appendLogEntry(entry: LogEntry): void {
    try {
      const entries = this.loadLog();
      entries.push(entry);
      this.saveLog(entries);
    } catch (error) {
      this.logger.error("Failed to append log entry", error as Error);
      throw error;
    }
  }

  /**
   * Truncate log from given index (used when resolving conflicts)
   */
  truncateLogFrom(index: number): void {
    try {
      const entries = this.loadLog();
      const truncated = entries.filter((e) => e.index < index);
      this.saveLog(truncated);
      this.logger.info(`Truncated log from index ${index}`);
    } catch (error) {
      this.logger.error("Failed to truncate log", error as Error);
      throw error;
    }
  }

  // ============================================================
  // Snapshot Persistence
  // ============================================================

  /**
   * Save snapshot to disk
   */
  saveSnapshot(snapshot: Snapshot): void {
    try {
      const data = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(this.snapshotFile, data, "utf-8");
      this.logger.info(
        `Saved snapshot (lastIncludedIndex: ${snapshot.lastIncludedIndex}, lastIncludedTerm: ${snapshot.lastIncludedTerm})`
      );
    } catch (error) {
      this.logger.error("Failed to save snapshot", error as Error);
      throw error;
    }
  }

  /**
   * Load snapshot from disk
   */
  loadSnapshot(): Snapshot | null {
    try {
      if (!fs.existsSync(this.snapshotFile)) {
        return null;
      }
      const data = fs.readFileSync(this.snapshotFile, "utf-8");
      const snapshot = JSON.parse(data) as Snapshot;
      this.logger.info(
        `Loaded snapshot (lastIncludedIndex: ${snapshot.lastIncludedIndex})`
      );
      return snapshot;
    } catch (error) {
      this.logger.error("Failed to load snapshot", error as Error);
      return null;
    }
  }

  // ============================================================
  // Raft State Persistence
  // ============================================================

  /**
   * Save Raft persistent state (currentTerm, votedFor)
   */
  saveRaftState(state: RaftPersistentState): void {
    try {
      const data = JSON.stringify(state, null, 2);
      fs.writeFileSync(this.stateFile, data, "utf-8");
      this.logger.debug(
        `Saved Raft state (term: ${state.currentTerm}, votedFor: ${state.votedFor})`
      );
    } catch (error) {
      this.logger.error("Failed to save Raft state", error as Error);
      throw error;
    }
  }

  /**
   * Load Raft persistent state
   */
  loadRaftState(): RaftPersistentState | null {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return null;
      }
      const data = fs.readFileSync(this.stateFile, "utf-8");
      const state = JSON.parse(data) as RaftPersistentState;
      this.logger.info(
        `Loaded Raft state (term: ${state.currentTerm}, votedFor: ${state.votedFor})`
      );
      return state;
    } catch (error) {
      this.logger.error("Failed to load Raft state", error as Error);
      return null;
    }
  }

  /**
   * Get the data directory path
   */
  getDataDir(): string {
    return this.dataDir;
  }
}
