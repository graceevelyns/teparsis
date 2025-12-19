#!/bin/sh

# Generate config.js from environment variables
cat > config.js << EOF
window.CLUSTER_CONFIG = {
  nodes: [
    { id: "3000", address: "${NODE_1_URL:-http://localhost:3000}" },
    { id: "3001", address: "${NODE_2_URL:-http://localhost:3001}" },
    { id: "3002", address: "${NODE_3_URL:-http://localhost:3002}" },
    { id: "3003", address: "${NODE_4_URL:-http://localhost:3003}" },
    { id: "3004", address: "${NODE_5_URL:-http://localhost:3004}" },
    { id: "3005", address: "${NODE_6_URL:-http://localhost:3005}" }
  ]
};
EOF

echo "Generated config.js with cluster configuration"
