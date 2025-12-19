import { KVStore } from "../../src/store/KVStore";

describe("KVStore", () => {
  let store: KVStore;

  beforeEach(() => {
    store = new KVStore();
  });

  describe("get()", () => {
    it("should return empty string for non-existent key", () => {
      expect(store.get("nonexistent")).toBe("");
    });

    it("should return the value for an existing key", () => {
      store.set("key1", "value1");
      expect(store.get("key1")).toBe("value1");
    });

    it("should return empty string after deleting a key", () => {
      store.set("key1", "value1");
      store.del("key1");
      expect(store.get("key1")).toBe("");
    });
  });

  describe("set()", () => {
    it("should store a new key-value pair", () => {
      store.set("key1", "value1");
      expect(store.get("key1")).toBe("value1");
    });

    it("should overwrite existing value for the same key", () => {
      store.set("key1", "value1");
      store.set("key1", "value2");
      expect(store.get("key1")).toBe("value2");
    });

    it("should handle empty string values", () => {
      store.set("key1", "");
      expect(store.get("key1")).toBe("");
    });

    it("should handle multiple different keys", () => {
      store.set("key1", "value1");
      store.set("key2", "value2");
      store.set("key3", "value3");
      expect(store.get("key1")).toBe("value1");
      expect(store.get("key2")).toBe("value2");
      expect(store.get("key3")).toBe("value3");
    });
  });

  describe("del()", () => {
    it("should return empty string when deleting non-existent key", () => {
      expect(store.del("nonexistent")).toBe("");
    });

    it("should return the deleted value and remove the key", () => {
      store.set("key1", "value1");
      expect(store.del("key1")).toBe("value1");
      expect(store.get("key1")).toBe("");
    });

    it("should only delete the specified key", () => {
      store.set("key1", "value1");
      store.set("key2", "value2");
      store.del("key1");
      expect(store.get("key1")).toBe("");
      expect(store.get("key2")).toBe("value2");
    });

    it("should handle deleting the same key multiple times", () => {
      store.set("key1", "value1");
      expect(store.del("key1")).toBe("value1");
      expect(store.del("key1")).toBe("");
      expect(store.del("key1")).toBe("");
    });
  });

  describe("append()", () => {
    it("should create a new key with the value if key does not exist", () => {
      const result = store.append("key1", "value1");
      expect(result).toBe("value1");
      expect(store.get("key1")).toBe("value1");
    });

    it("should append to an existing value", () => {
      store.set("key1", "hello");
      const result = store.append("key1", " world");
      expect(result).toBe("hello world");
      expect(store.get("key1")).toBe("hello world");
    });

    it("should handle multiple appends", () => {
      store.append("key1", "a");
      store.append("key1", "b");
      store.append("key1", "c");
      expect(store.get("key1")).toBe("abc");
    });

    it("should handle appending empty string", () => {
      store.set("key1", "value");
      const result = store.append("key1", "");
      expect(result).toBe("value");
      expect(store.get("key1")).toBe("value");
    });

    it("should return the new concatenated value", () => {
      store.set("key1", "foo");
      const result1 = store.append("key1", "bar");
      expect(result1).toBe("foobar");
      const result2 = store.append("key1", "baz");
      expect(result2).toBe("foobarbaz");
    });
  });

  describe("strlen()", () => {
    it("should return 0 for non-existent key", () => {
      expect(store.strlen("nonexistent")).toBe(0);
    });

    it("should return the length of an existing value", () => {
      store.set("key1", "hello");
      expect(store.strlen("key1")).toBe(5);
    });

    it("should return 0 for empty string value", () => {
      store.set("key1", "");
      expect(store.strlen("key1")).toBe(0);
    });

    it("should update after append operations", () => {
      store.set("key1", "hello");
      expect(store.strlen("key1")).toBe(5);
      store.append("key1", " world");
      expect(store.strlen("key1")).toBe(11);
    });

    it("should return 0 after deleting a key", () => {
      store.set("key1", "value");
      store.del("key1");
      expect(store.strlen("key1")).toBe(0);
    });
  });

  describe("ping()", () => {
    it("should return PONG", () => {
      expect(store.ping()).toBe("PONG");
    });

    it("should always return PONG regardless of store state", () => {
      expect(store.ping()).toBe("PONG");
      store.set("key1", "value1");
      expect(store.ping()).toBe("PONG");
      store.del("key1");
      expect(store.ping()).toBe("PONG");
    });
  });

  describe("Integration scenarios", () => {
    it("should handle a complex sequence of operations", () => {
      // Set multiple values
      store.set("user:1:name", "Alice");
      store.set("user:1:age", "30");
      store.set("user:2:name", "Bob");

      // Verify values
      expect(store.get("user:1:name")).toBe("Alice");
      expect(store.strlen("user:1:age")).toBe(2);

      // Append to a value
      store.append("user:1:name", " Smith");
      expect(store.get("user:1:name")).toBe("Alice Smith");

      // Delete one user
      store.del("user:2:name");
      expect(store.get("user:2:name")).toBe("");

      // Verify other users still exist
      expect(store.get("user:1:name")).toBe("Alice Smith");
    });

    it("should maintain data isolation between different keys", () => {
      store.set("key1", "value1");
      store.set("key2", "value2");
      store.append("key1", "-appended");

      expect(store.get("key1")).toBe("value1-appended");
      expect(store.get("key2")).toBe("value2");
      expect(store.strlen("key1")).toBe(15);
      expect(store.strlen("key2")).toBe(6);
    });
  });
});
