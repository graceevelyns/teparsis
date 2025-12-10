export interface IKVStore {
  // Retrieve value for given key, returns empty string if key doesn't exist
  get(key: string): string;
  
  // Store key-value pair
  set(key: string, value: string): void;
  
  // Delete key, returns deleted value or empty string if key didn't exist
  del(key: string): string;
  
  // Append value to existing key (creates key if missing), returns new value
  append(key: string, value: string): string;
  
  // Get length of string stored at key
  strlen(key: string): number;
  
  // Health check method, should return "PONG"
  ping(): string;
}
