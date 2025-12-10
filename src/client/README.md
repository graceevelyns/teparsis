# Raft KV Store - Web Client

A modern web-based client for interacting with the Raft distributed key-value store cluster. Built with TypeScript for type safety and maintainability.

## Features

- 🎨 **Modern UI** - Clean, responsive web interface with gradient design
- 🔄 **Real-time Updates** - Live cluster status monitoring
- 🔐 **Type Safety** - Built with TypeScript
- 🚀 **Leader Discovery** - Automatic leader node detection and failover
- 📊 **Cluster Monitoring** - Visual status display for all nodes
- ⚡ **Fast Operations** - Optimized request routing to cluster leader

## Project Structure

```
src/client/
├── index.html          # Main HTML page
├── src/
│   ├── app.ts         # UI logic and event handlers
│   ├── client.ts      # Raft client API implementation
│   └── styles.css     # Application styles
├── dist/              # Compiled output (generated)
│   ├── app.js
│   ├── client.js
│   └── styles.css
├── package.json
├── tsconfig.json
└── .gitignore
```

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Start the web server:**
   ```bash
   npm start
   ```
   This will open your browser at `http://localhost:8080`

4. **For development** (without opening browser):
   ```bash
   npm run dev
   ```

## Available Operations

### Key-Value Operations
- **SET** - Set a key-value pair
- **GET** - Retrieve value for a key
- **DELETE** - Remove a key
- **APPEND** - Append text to a value
- **STRLEN** - Get length of value

### Cluster Operations
- **PING** - Check cluster health
- **STATUS** - View detailed cluster status

## Configuration

By default, the client connects to:
- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`

You can modify the node URLs in the web interface or by editing the default values in `index.html`.

## Development

### Build Scripts
- `npm run build` - Compile TypeScript and copy assets
- `npm run watch` - Watch mode for TypeScript compilation
- `npm start` - Build and start server (opens browser)
- `npm run dev` - Build and start server (no browser)

### TypeScript Configuration
The project uses ES2020 modules with strict type checking. Configuration is in `tsconfig.json`:
- Target: ES2020
- Module: ES2020
- Strict mode enabled
- Source maps for debugging

## Architecture

### Client (client.ts)
Handles all API communication with the Raft cluster:
- Automatic leader discovery
- Retry logic with failover
- Type-safe API methods

### App (app.ts)
Manages the web interface:
- DOM manipulation
- Event handling
- Result display
- Status updates

### Styles (styles.css)
Modern, responsive CSS with:
- Gradient backgrounds
- Card-based layout
- State-based node coloring
- Mobile-friendly design

## Browser Compatibility

Requires a modern browser with support for:
- ES2020 JavaScript features
- ES Modules
- Fetch API
- CSS Grid & Flexbox

## Troubleshooting

**Issue:** Cannot connect to cluster nodes

**Solution:** 
- Make sure the Raft server nodes are running
- Verify the node URLs are correct in the configuration panel
- Check that CORS is enabled on the server

**Issue:** Operations fail with "All nodes failed"

**Solution:**
- Check if at least one node in the cluster is functioning
- Verify network connectivity to the nodes
- Ensure the cluster has elected a leader

## Notes

- The client automatically discovers the cluster leader
- Failed requests are retried against other nodes
- Node status is color-coded (Leader: green, Follower: blue, Unreachable: red)
- All operations show real-time feedback

## License

Part of the Raft Consensus Algorithm implementation project.
