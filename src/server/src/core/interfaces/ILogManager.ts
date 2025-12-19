import { LogEntry } from '../../types';
import { Snapshot } from '../../types/Snapshot';

export interface ILogManager {
  appendEntry(entry: LogEntry): void;
  getEntry(index: number): LogEntry | undefined;
  getEntriesFrom(startIndex: number): LogEntry[];
  getLastIndex(): number;
  getLastTerm(): number;
  truncateFrom(index: number): void;
  getCommitIndex(): number;
  setCommitIndex(index: number): void;

  // Snapshot support
  getFirstIndex(): number;
  createSnapshot(lastIncludedIndex: number, state: Record<string, string>): Snapshot;
  installSnapshot(snapshot: Snapshot): void;
  getLatestSnapshot(): Snapshot | null;
  compactLog(upToIndex: number): void;
}

