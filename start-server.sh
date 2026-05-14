#!/bin/bash

cd /Users/aj/Desktop/Claude/.claude/worktrees/lucid-rosalind-5306f4/hanta-tracker

echo "Starting Hantavirus Tracker API Server..."
echo "API will be available at http://localhost:3456"
echo "Frontend will be available at http://localhost:5174"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

node server.js
