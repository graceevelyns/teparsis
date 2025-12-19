import { LogEntry } from "../types";
import { Snapshot } from "../types/Snapshot";
import { ILogManager } from "./interfaces/ILogManager";
import { PersistentStorage } from "./PersistentStorage";

/**
 * Manages Raft log entries with persistent storage and snapshot support
 */
export class LogManager implements ILogManager {
  private log: LogEntry[] = [];
  private commitIndex: number = -1;
  private snapshot: Snapshot | null = null;
  
  // Offset due to log compaction - entries before this index are in snapshot
  private snapshotOffset: number = 0;

  constructor(private readonly storage?: PersistentStorage) {
    if (storage) {
      this.loadFromStorage();
    }
  }

  /**
   * Load log and snapshot from persistent storage
   */
  private loadFromStorage(): void {
    if (!this.storage) return;

    // Load snapshot first
    this.snapshot = this.storage.loadSnapshot();
    if (this.snapshot) {
      this.snapshotOffset = this.snapshot.lastIncludedIndex + 1;
    }

    // Load log entries
    this.log = this.storage.loadLog();
  }

  /**
   * Convert actual log array index to logical Raft index
   */
  private toLogicalIndex(arrayIndex: number): number {
    return arrayIndex + this.snapshotOffset;
  }

  /**
   * Convert logical Raft index to actual log array index
   */
  private toArrayIndex(logicalIndex: number): number {
    return logicalIndex - this.snapshotOffset;
  }

  appendEntry(entry: LogEntry): void {
    this.log.push(entry);
    if (this.storage) {
      this.storage.appendLogEntry(entry);
    }
  }

  getEntry(index: number): LogEntry | undefined {
    // If index is within snapshot, we can't access individual entries
    if (this.snapshot && index <= this.snapshot.lastIncludedIndex) {
      // Return a synthetic entry for the last snapshot entry
      if (index === this.snapshot.lastIncludedIndex) {
        return {
          index: this.snapshot.lastIncludedIndex,
          term: this.snapshot.lastIncludedTerm,
          command: { operation: "set", key: "__snapshot__", value: "" },
          timestamp: this.snapshot.timestamp,
        };
      }
      return undefined;
    }
    
    const arrayIndex = this.toArrayIndex(index);
    return this.log[arrayIndex];
  }

  getEntriesFrom(startIndex: number): LogEntry[] {
    const arrayIndex = this.toArrayIndex(startIndex);
    if (arrayIndex < 0) {
      // Some entries are in snapshot, return what we have
      return this.log.slice(0);
    }
    return this.log.slice(arrayIndex);
  }

  getLastIndex(): number {
    if (this.log.length === 0) {
      return this.snapshot ? this.snapshot.lastIncludedIndex : -1;
    }
    return this.toLogicalIndex(this.log.length - 1);
  }

  getLastTerm(): number {
    if (this.log.length > 0) {
      return this.log[this.log.length - 1].term;
    }
    return this.snapshot ? this.snapshot.lastIncludedTerm : 0;
  }

  getFirstIndex(): number {
    if (this.snapshot) {
      return this.snapshot.lastIncludedIndex + 1;
    }
    return 0;
  }

  truncateFrom(index: number): void {
    const arrayIndex = this.toArrayIndex(index);
    if (arrayIndex >= 0) {
      this.log = this.log.slice(0, arrayIndex);
      if (this.storage) {
        this.storage.saveLog(this.log);
      }
    }
  }

  getCommitIndex(): number {
    return this.commitIndex;
  }

  setCommitIndex(index: number): void {
    this.commitIndex = Math.min(index, this.getLastIndex());
  }

  // ============================================================
  // Snapshot Support
  // ============================================================

  /**
   * Create a new snapshot containing state machine data up to given index
   */
  createSnapshot(lastIncludedIndex: number, state: Record<string, string>): Snapshot {
    const entry = this.getEntry(lastIncludedIndex);
    const lastIncludedTerm = entry ? entry.term : (this.snapshot?.lastIncludedTerm || 0);

    const newSnapshot: Snapshot = {
      lastIncludedIndex,
      lastIncludedTerm,
      data: { ...state },
      timestamp: Date.now(),
    };

    this.snapshot = newSnapshot;
    
    if (this.storage) {
      this.storage.saveSnapshot(newSnapshot);
    }

    return newSnapshot;
  }

  /**
   * Install a snapshot received from leader
   */
  installSnapshot(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.snapshotOffset = snapshot.lastIncludedIndex + 1;
    
    // Discard all log entries before or at snapshot index
    this.log = this.log.filter((entry) => entry.index > snapshot.lastIncludedIndex);
    
    // Update commit index if snapshot is more recent
    if (snapshot.lastIncludedIndex > this.commitIndex) {
      this.commitIndex = snapshot.lastIncludedIndex;
    }

    if (this.storage) {
      this.storage.saveSnapshot(snapshot);
      this.storage.saveLog(this.log);
    }
  }

  /**
   * Get the latest snapshot
   */
  getLatestSnapshot(): Snapshot | null {
    return this.snapshot;
  }

  /**
   * Compact log by removing entries before the given index
   * This should only be called after a snapshot has been created
   */
  compactLog(upToIndex: number): void {
    if (!this.snapshot || upToIndex > this.snapshot.lastIncludedIndex) {
      return; // Can only compact entries that are in snapshot
    }

    const arrayIndex = this.toArrayIndex(upToIndex + 1);
    if (arrayIndex > 0) {
      this.log = this.log.slice(arrayIndex);
      this.snapshotOffset = upToIndex + 1;
      
      if (this.storage) {
        this.storage.saveLog(this.log);
      }
    }
  }

  /**
   * Check if we need a snapshot based on log size
   */
  needsSnapshot(threshold: number): boolean {
    return this.log.length >= threshold;
  }

  /**
   * Get all log entries (for debugging)
   */
  getAllEntries(): LogEntry[] {
    return [...this.log];
  }
}
