import { LogManager } from "../../src/core/LogManager";
import { LogEntry } from "../../src/types";

describe("LogManager", () => {
  let logManager: LogManager;

  beforeEach(() => {
    logManager = new LogManager();
  });

  const createLogEntry = (
    index: number,
    term: number,
    operation: "set" | "del" | "append" = "set",
    key: string = "key",
    value?: string
  ): LogEntry => ({
    index,
    term,
    command:
      value !== undefined ? { operation, key, value } : { operation, key },
    timestamp: Date.now(),
  });

  describe("Initial state", () => {
    it("should have no entries initially", () => {
      expect(logManager.getLastIndex()).toBe(-1);
    });

    it("should have last term 0 initially", () => {
      expect(logManager.getLastTerm()).toBe(0);
    });

    it("should have commit index -1 initially", () => {
      expect(logManager.getCommitIndex()).toBe(-1);
    });
  });

  describe("appendEntry()", () => {
    it("should append a single entry", () => {
      const entry = createLogEntry(0, 1, "set", "key1", "value1");
      logManager.appendEntry(entry);

      expect(logManager.getLastIndex()).toBe(0);
      expect(logManager.getEntry(0)).toEqual(entry);
    });

    it("should append multiple entries in order", () => {
      const entry1 = createLogEntry(0, 1, "set", "key1", "value1");
      const entry2 = createLogEntry(1, 1, "set", "key2", "value2");
      const entry3 = createLogEntry(2, 2, "del", "key1");

      logManager.appendEntry(entry1);
      logManager.appendEntry(entry2);
      logManager.appendEntry(entry3);

      expect(logManager.getLastIndex()).toBe(2);
      expect(logManager.getEntry(0)).toEqual(entry1);
      expect(logManager.getEntry(1)).toEqual(entry2);
      expect(logManager.getEntry(2)).toEqual(entry3);
    });

    it("should update last term when appending entries", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      expect(logManager.getLastTerm()).toBe(1);

      logManager.appendEntry(createLogEntry(1, 2));
      expect(logManager.getLastTerm()).toBe(2);
    });
  });

  describe("getEntry()", () => {
    it("should return undefined for non-existent index", () => {
      expect(logManager.getEntry(0)).toBeUndefined();
      expect(logManager.getEntry(10)).toBeUndefined();
    });

    it("should return the correct entry at a given index", () => {
      const entry1 = createLogEntry(0, 1, "set", "key1", "value1");
      const entry2 = createLogEntry(1, 1, "set", "key2", "value2");

      logManager.appendEntry(entry1);
      logManager.appendEntry(entry2);

      expect(logManager.getEntry(0)).toEqual(entry1);
      expect(logManager.getEntry(1)).toEqual(entry2);
    });

    it("should return undefined for negative index", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      expect(logManager.getEntry(-1)).toBeUndefined();
    });
  });

  describe("getEntriesFrom()", () => {
    beforeEach(() => {
      logManager.appendEntry(createLogEntry(0, 1, "set", "key1", "value1"));
      logManager.appendEntry(createLogEntry(1, 1, "set", "key2", "value2"));
      logManager.appendEntry(createLogEntry(2, 2, "del", "key1"));
      logManager.appendEntry(createLogEntry(3, 2, "append", "key3", "value3"));
    });

    it("should return all entries from start index to end", () => {
      const entries = logManager.getEntriesFrom(2);
      expect(entries).toHaveLength(2);
      expect(entries[0].index).toBe(2);
      expect(entries[1].index).toBe(3);
    });

    it("should return all entries when start index is 0", () => {
      const entries = logManager.getEntriesFrom(0);
      expect(entries).toHaveLength(4);
    });

    it("should return empty array when start index is beyond last index", () => {
      const entries = logManager.getEntriesFrom(10);
      expect(entries).toHaveLength(0);
    });

    it("should return only the last entry when start index is last index", () => {
      const entries = logManager.getEntriesFrom(3);
      expect(entries).toHaveLength(1);
      expect(entries[0].index).toBe(3);
    });
  });

  describe("getLastIndex()", () => {
    it("should return -1 for empty log", () => {
      expect(logManager.getLastIndex()).toBe(-1);
    });

    it("should return 0 for log with one entry", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      expect(logManager.getLastIndex()).toBe(0);
    });

    it("should return the index of the last appended entry", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      logManager.appendEntry(createLogEntry(1, 1));
      logManager.appendEntry(createLogEntry(2, 2));
      expect(logManager.getLastIndex()).toBe(2);
    });

    it("should update after truncation", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      logManager.appendEntry(createLogEntry(1, 1));
      logManager.appendEntry(createLogEntry(2, 2));
      logManager.truncateFrom(1);
      expect(logManager.getLastIndex()).toBe(0);
    });
  });

  describe("getLastTerm()", () => {
    it("should return 0 for empty log", () => {
      expect(logManager.getLastTerm()).toBe(0);
    });

    it("should return the term of the last entry", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      expect(logManager.getLastTerm()).toBe(1);

      logManager.appendEntry(createLogEntry(1, 2));
      expect(logManager.getLastTerm()).toBe(2);

      logManager.appendEntry(createLogEntry(2, 2));
      expect(logManager.getLastTerm()).toBe(2);
    });

    it("should update after truncation", () => {
      logManager.appendEntry(createLogEntry(0, 1));
      logManager.appendEntry(createLogEntry(1, 2));
      logManager.appendEntry(createLogEntry(2, 3));

      logManager.truncateFrom(2);
      expect(logManager.getLastTerm()).toBe(2);

      logManager.truncateFrom(1);
      expect(logManager.getLastTerm()).toBe(1);
    });
  });

  describe("truncateFrom()", () => {
    beforeEach(() => {
      logManager.appendEntry(createLogEntry(0, 1, "set", "key1", "value1"));
      logManager.appendEntry(createLogEntry(1, 1, "set", "key2", "value2"));
      logManager.appendEntry(createLogEntry(2, 2, "del", "key1"));
      logManager.appendEntry(createLogEntry(3, 2, "append", "key3", "value3"));
    });

    it("should remove all entries from the specified index onwards", () => {
      logManager.truncateFrom(2);
      expect(logManager.getLastIndex()).toBe(1);
      expect(logManager.getEntry(0)).toBeDefined();
      expect(logManager.getEntry(1)).toBeDefined();
      expect(logManager.getEntry(2)).toBeUndefined();
      expect(logManager.getEntry(3)).toBeUndefined();
    });

    it("should remove all entries when truncating from 0", () => {
      logManager.truncateFrom(0);
      expect(logManager.getLastIndex()).toBe(-1);
      expect(logManager.getEntry(0)).toBeUndefined();
    });

    it("should do nothing when truncating from beyond last index", () => {
      logManager.truncateFrom(10);
      expect(logManager.getLastIndex()).toBe(3);
    });

    it("should handle truncating entire log", () => {
      logManager.truncateFrom(0);
      expect(logManager.getLastIndex()).toBe(-1);
      expect(logManager.getLastTerm()).toBe(0);
      expect(logManager.getEntriesFrom(0)).toHaveLength(0);
    });

    it("should allow appending after truncation", () => {
      logManager.truncateFrom(2);
      const newEntry = createLogEntry(2, 3, "set", "key4", "value4");
      logManager.appendEntry(newEntry);

      expect(logManager.getLastIndex()).toBe(2);
      expect(logManager.getEntry(2)).toEqual(newEntry);
    });
  });

  describe("getCommitIndex()", () => {
    it("should return -1 initially", () => {
      expect(logManager.getCommitIndex()).toBe(-1);
    });

    it("should return the commit index after setting it", () => {
      // Need to have entries in log first (setCommitIndex caps at lastIndex)
      for (let i = 0; i < 6; i++) {
        logManager.appendEntry(createLogEntry(i, 1));
      }
      logManager.setCommitIndex(5);
      expect(logManager.getCommitIndex()).toBe(5);
    });
  });

  describe("setCommitIndex()", () => {
    beforeEach(() => {
      logManager.appendEntry(createLogEntry(0, 1));
      logManager.appendEntry(createLogEntry(1, 1));
      logManager.appendEntry(createLogEntry(2, 2));
      logManager.appendEntry(createLogEntry(3, 2));
    });

    it("should set commit index to the specified value", () => {
      logManager.setCommitIndex(2);
      expect(logManager.getCommitIndex()).toBe(2);
    });

    it("should cap commit index at last index if higher value provided", () => {
      logManager.setCommitIndex(10);
      expect(logManager.getCommitIndex()).toBe(3); // Last index is 3
    });

    it("should allow setting commit index to 0", () => {
      logManager.setCommitIndex(0);
      expect(logManager.getCommitIndex()).toBe(0);
    });

    it("should allow updating commit index multiple times", () => {
      logManager.setCommitIndex(1);
      expect(logManager.getCommitIndex()).toBe(1);

      logManager.setCommitIndex(2);
      expect(logManager.getCommitIndex()).toBe(2);

      logManager.setCommitIndex(3);
      expect(logManager.getCommitIndex()).toBe(3);
    });

    it("should cap at last index even with empty log after truncation", () => {
      logManager.truncateFrom(0);
      logManager.setCommitIndex(5);
      expect(logManager.getCommitIndex()).toBe(-1);
    });

    it("should handle commit index after log truncation", () => {
      logManager.setCommitIndex(3);
      logManager.truncateFrom(2);
      // Note: setCommitIndex caps at lastIndex, which is now 1
      logManager.setCommitIndex(5);
      expect(logManager.getCommitIndex()).toBe(1);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle a typical Raft log replication scenario", () => {
      // Leader appends entries
      logManager.appendEntry(createLogEntry(0, 1, "set", "x", "1"));
      logManager.appendEntry(createLogEntry(1, 1, "set", "y", "2"));
      logManager.appendEntry(createLogEntry(2, 1, "set", "z", "3"));

      expect(logManager.getLastIndex()).toBe(2);
      expect(logManager.getLastTerm()).toBe(1);

      // Commit first two entries
      logManager.setCommitIndex(1);
      expect(logManager.getCommitIndex()).toBe(1);

      // Get uncommitted entries for replication
      const uncommitted = logManager.getEntriesFrom(2);
      expect(uncommitted).toHaveLength(1);
      expect(uncommitted[0].index).toBe(2);
    });

    it("should handle log conflict resolution", () => {
      // Initial log
      logManager.appendEntry(createLogEntry(0, 1, "set", "a", "1"));
      logManager.appendEntry(createLogEntry(1, 1, "set", "b", "2"));
      logManager.appendEntry(createLogEntry(2, 2, "set", "c", "3"));

      // Conflict at index 2, truncate and append new entry
      logManager.truncateFrom(2);
      logManager.appendEntry(createLogEntry(2, 3, "set", "c", "4"));

      expect(logManager.getLastIndex()).toBe(2);
      expect(logManager.getLastTerm()).toBe(3);
      expect(logManager.getEntry(2)?.term).toBe(3);
      expect(logManager.getEntry(2)?.command?.value).toBe("4");
    });

    it("should maintain consistency after multiple operations", () => {
      // Append entries
      for (let i = 0; i < 5; i++) {
        logManager.appendEntry(
          createLogEntry(i, 1, "set", `key${i}`, `value${i}`)
        );
      }

      // Commit some entries
      logManager.setCommitIndex(2);

      // Truncate uncommitted entries
      logManager.truncateFrom(3);
      expect(logManager.getLastIndex()).toBe(2);

      // Append new entries with higher term
      logManager.appendEntry(createLogEntry(3, 2, "set", "newKey", "newValue"));

      expect(logManager.getLastIndex()).toBe(3);
      expect(logManager.getLastTerm()).toBe(2);
      expect(logManager.getCommitIndex()).toBe(2);
    });
  });
});
