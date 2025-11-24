import { IKVStore } from "./IKVStore";

export class KVStore implements IKVStore {
  private store: Map<string, string> = new Map();

  get(key: string): string | null {
    return this.store.get(key) || null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  del(key: string): boolean {
    return this.store.delete(key);
  }

  append(key: string, value: string): number {
    const existingValue = this.store.get(key) || "";
    const newValue = existingValue + value;
    this.store.set(key, newValue);
    return newValue.length;
  }

  strlen(key: string): number {
    const value = this.store.get(key);
    return value ? value.length : 0;
  }

  ping(): string {
    return "PONG";
  }
}
