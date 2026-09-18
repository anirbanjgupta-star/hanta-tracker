#!/bin/bash
# Stop Relay: the daemon (5182) and the dashboard dev server (5183).
lsof -ti:5182 | xargs kill -9 2>/dev/null
lsof -ti:5183 | xargs kill -9 2>/dev/null
echo "✓ Relay stopped."
