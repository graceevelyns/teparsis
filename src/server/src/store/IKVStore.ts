export interface IKVStore {
  // Retrieve value for given key, returns null if key doesn't exist
  get(key: string): string | null;
  
  // Store key-value pair
  set(key: string, value: string): void;
  
  // Delete key, returns true if key existed and was deleted
  del(key: string): boolean;
  
  // Append value to existing key, returns new length of value
  append(key: string, value: string): number;
  
  // Get length of string stored at key
  strlen(key: string): number;
  
  // Health check method, should return "PONG"
  ping(): string;
}
