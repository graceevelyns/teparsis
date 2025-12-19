import { IKVStore } from "./IKVStore";

export class KVStore implements IKVStore {
  private store: Map<string, string> = new Map();

  get(key: string): string {
    const value = this.store.get(key);
    return value !== undefined ? value : "";
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  del(key: string): string {
    const existingValue = this.store.get(key);
    if (existingValue === undefined) {
      return "";
    }

    this.store.delete(key);
    return existingValue;
  }

  append(key: string, value: string): string {
    const existingValue = this.store.get(key) || "";
    const newValue = existingValue + value;
    this.store.set(key, newValue);
    return newValue;
  }

  strlen(key: string): number {
    const value = this.store.get(key);
    return value ? value.length : 0;
  }

  ping(): string {
    return "PONG";
  }

  // Snapshot support

  /**
   * Get entire state for snapshot
   */
  getState(): Record<string, string> {
    const state: Record<string, string> = {};
    this.store.forEach((value, key) => {
      state[key] = value;
    });
    return state;
  }

  /**
   * Restore state from snapshot
   */
  restoreState(state: Record<string, string>): void {
    this.store.clear();
    for (const [key, value] of Object.entries(state)) {
      this.store.set(key, value);
    }
  }
}

