#!/bin/bash
# Nemobot - Brain + Bot 起動
# 前提: Minecraft Server と vLLM は起動済み
# Usage: ./start.sh       → 起動
#        ./start.sh stop  → 停止
# Ctrl+C で全停止

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
    echo ""
    echo "Stopping..."
    pkill -f "brain.py" 2>/dev/null
    pkill -f "node bot.js" 2>/dev/null
    exit 0
}
trap cleanup INT TERM

if [ "$1" = "stop" ]; then
    pkill -f "brain.py" 2>/dev/null && echo "Killed brain"
    pkill -f "node bot.js" 2>/dev/null && echo "Killed bot"
    exit 0
fi

# vLLM チェック
if ! curl -s http://localhost:8000/v1/models > /dev/null 2>&1; then
    echo "vLLM が起動していません。先に起動してください:"
    echo "  vllm serve nvidia/NVIDIA-Nemotron-Nano-9B-v2-Japanese --max-model-len 32768 --gpu-memory-utilization 0.9"
    exit 1
fi

echo "=== Nemobot ==="

# Brain
echo "[Brain] Starting..."
cd "$BASE_DIR/brain"
uv run brain.py &
sleep 3

# Bot (foreground)
echo "[Bot] Starting..."
cd "$BASE_DIR/bot"
node bot.js
