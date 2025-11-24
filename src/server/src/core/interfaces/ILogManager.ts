import { LogEntry } from '../../types';

export interface ILogManager {
  appendEntry(entry: LogEntry): void;
  getEntry(index: number): LogEntry | undefined;
  getEntriesFrom(startIndex: number): LogEntry[];
  getLastIndex(): number;
  getLastTerm(): number;
  truncateFrom(index: number): void;
  getCommitIndex(): number;
  setCommitIndex(index: number): void;
}
