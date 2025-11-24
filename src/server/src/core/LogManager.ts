import { LogEntry } from "../types";
import { ILogManager } from "./interfaces/ILogManager";

/**
 * Manages Raft log entries and commit tracking
 */
export class LogManager implements ILogManager {
  private log: LogEntry[] = [];
  private commitIndex: number = -1;

  appendEntry(entry: LogEntry): void {
    this.log.push(entry);
  }

  getEntry(index: number): LogEntry | undefined {
    return this.log[index];
  }

  getEntriesFrom(startIndex: number): LogEntry[] {
    return this.log.slice(startIndex);
  }

  getLastIndex(): number {
    return this.log.length - 1;
  }

  getLastTerm(): number {
    const lastEntry = this.log[this.log.length - 1];
    return lastEntry ? lastEntry.term : 0;
  }

  truncateFrom(index: number): void {
    this.log = this.log.slice(0, index);
  }

  getCommitIndex(): number {
    return this.commitIndex;
  }

  setCommitIndex(index: number): void {
    this.commitIndex = Math.min(index, this.getLastIndex());
  }
}
