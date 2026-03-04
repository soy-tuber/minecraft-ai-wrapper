# Nemobot: A Lightweight Minecraft AI Agent Powered by Local LLM

A minimal architecture for controlling a Minecraft bot through natural language, using a locally-hosted LLM (Nemotron 9B) served via vLLM. The system translates free-form player instructions into structured game actions without cloud API dependencies.

## Architecture

```
┌─────────────┐     chat      ┌─────────────┐    POST /ask   ┌─────────────┐   OpenAI API   ┌─────────────┐
│  Minecraft   │◄────────────►│     Bot      │──────────────►│    Brain     │──────────────►│    vLLM      │
│   Server     │  mineflayer  │  (Node.js)   │◄──────────────│   (Flask)    │◄──────────────│  (Nemotron)  │
└─────────────┘              └──────┬────────┘   action+val  └─────────────┘   completion   └─────────────┘
                                    │
                              Express API
                                    │
                             ┌──────┴────────┐
                             │   Chat UI     │
                             │ (Static HTML) │
                             └───────────────┘
```

### Components

| Component | Role | Technology |
|-----------|------|------------|
| **Bot** | Connects to Minecraft server, executes game actions, serves Chat UI | Node.js, Mineflayer, Express |
| **Brain** | Receives player messages, queries LLM, extracts structured commands | Python, Flask |
| **vLLM** | Serves the language model with OpenAI-compatible API | vLLM, NVIDIA Nemotron 9B |
| **Chat UI** | Web interface for sending commands outside the game | Static HTML, vanilla JS |

### Request Flow

1. Player sends a chat message in Minecraft (or via Web UI)
2. **Bot** forwards the message to **Brain** (`POST /ask`)
3. **Brain** constructs a prompt with system instructions + conversation history
4. **Brain** queries **vLLM** (OpenAI-compatible `/v1/chat/completions`)
5. LLM responds in structured format: `[思考] ... [実行] COMMAND("arg")`
6. **Brain** extracts the command via regex and returns `{action, value}` to **Bot**
7. **Bot** executes the corresponding Mineflayer function

### Supported Actions

| Command | Description |
|---------|-------------|
| `CHAT("msg")` | Send a chat message |
| `FOLLOW()` | Follow the player |
| `STOP()` | Stop all actions |
| `ATTACK("mob")` | Attack a single entity |
| `HUNT("mob")` | Hunt all nearby entities of a type |
| `DIG_TREE()` | Chop down the nearest tree |
| `DIG_DOWN("n")` | Dig a staircase n blocks deep |
| `GUARD()` | Bodyguard mode (follow + auto-attack hostiles) |
| `DANCE()` | Perform a dance animation |
| `LOOK_AROUND()` | Report nearby entities and position |
| `GO_TO("x y z")` | Navigate to coordinates |
| `DROP_ITEMS()` | Drop all inventory items (keeps axes) |
| `COLLECT()` | Pick up nearby dropped items |
| `GIVE()` | Walk to the player and hand over items |

## Design Decisions

**Structured output via prompt engineering.** Rather than fine-tuning or using function calling, the system relies on a constrained prompt format (`[思考]`/`[実行]`) with regex extraction. This keeps the architecture simple and model-agnostic.

**Local-first.** All inference runs on a single consumer GPU (RTX 5090, 32GB VRAM). No cloud API keys required. The vLLM server provides OpenAI-compatible endpoints, making it easy to swap models.

**Stateless Brain.** The Brain server maintains per-player conversation history in memory (capped at 5 turns) but has no persistent state. This simplifies deployment and restart behavior.

**Thinking model support.** Nemotron produces `<think>` tags by default. The Brain strips these before extracting actions, keeping the output clean while allowing the model to reason.

## Setup

### GPU Requirements

The Brain communicates with any OpenAI-compatible API, so the model and backend are your choice.

| GPU | VRAM | Recommended Models |
|-----|------|--------------------|
| RTX 3060 / 4060 | 12GB | Gemma 2 2B, Qwen2.5 3B, Llama 3.2 3B |
| RTX 4070 Ti Super | 16GB | Nemotron 9B (INT4), Qwen2.5 7B |
| RTX 4090 / 5090 | 24-32GB | Nemotron 9B (FP16), any 7-9B model |

2-3B models are sufficient for command extraction. Larger models improve chat quality.

### Prerequisites

- Minecraft Java Edition
- Node.js
- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- One of the following LLM backends:
  - [vLLM](https://docs.vllm.ai/) (recommended for NVIDIA GPUs)
  - [Ollama](https://ollama.com/) (easiest setup)
  - [LM Studio](https://lmstudio.ai/) (GUI)

### Installation

```bash
git clone https://github.com/soy-tuber/minecraft-ai-wrapper.git
cd minecraft-ai-wrapper

# Bot dependencies
cd bot && npm install && cd ..

# Brain dependencies
cd brain && uv sync && cd ..

# Minecraft server
cd server
# Download server.jar (Minecraft 1.21.x) and place it here
# Copy server.properties.example to server.properties and configure
# Accept EULA: echo "eula=true" > eula.txt
cd ..
```

### Starting (3 terminals)

```bash
# Terminal 1: Minecraft Server
cd server && ./start.sh

# Terminal 2: vLLM (after connecting to server with Minecraft client)
cd /path/to/vllm-environment && uv run vllm serve nvidia/NVIDIA-Nemotron-Nano-9B-v2-Japanese \
    --max-model-len 32768 --gpu-memory-utilization 0.9 --trust-remote-code

# Terminal 3: Bot + Brain (after vLLM is ready)
./start.sh
```

### Configuration

Edit `brain/brain.py` to switch LLM backends. Only two variables need to change:

#### vLLM (default)

```python
VLLM_URL = "http://localhost:8000/v1/chat/completions"
MODEL_NAME = "nvidia/NVIDIA-Nemotron-Nano-9B-v2-Japanese"
```

```bash
uv run vllm serve nvidia/NVIDIA-Nemotron-Nano-9B-v2-Japanese \
    --max-model-len 32768 --gpu-memory-utilization 0.9 --trust-remote-code
```

#### Ollama

```python
VLLM_URL = "http://localhost:11434/v1/chat/completions"
MODEL_NAME = "gemma2:2b"
```

```bash
ollama pull gemma2:2b
ollama serve
```

#### LM Studio

```python
VLLM_URL = "http://localhost:1234/v1/chat/completions"
MODEL_NAME = "your-loaded-model-name"
```

Start the server from LM Studio GUI.

#### Other settings

- `SYSTEM_PROMPT` — Action definitions and behavioral instructions
- `MAX_HISTORY` — Conversation history length per player

The Bot (`bot/bot.js`) can be configured by editing:

- `host` / `port` — Minecraft server address
- `username` — Bot's in-game name
- `version` — Minecraft version
- `BRAIN_URL` — Brain endpoint

## Related Work

This project draws on a growing body of research on LLM-powered agents in Minecraft:

- **Voyager** (Wang et al., 2023) — The first LLM-powered embodied lifelong learning agent. Uses GPT-4 with an automatic curriculum and a skill library of executable code. [[paper](https://arxiv.org/abs/2305.16291)] [[project](https://voyager.minedojo.org/)]

- **Odyssey** (IJCAI 2025) — Extends the skill-based approach with 40 primitive + 183 compositional skills, fine-tuning LLaMA-3 on 390K Minecraft Wiki Q&A entries. [[paper](https://arxiv.org/abs/2407.15325)]

- **Mindcraft** (2025) — Multi-agent collaboration framework supporting multiple LLM backends including Ollama and vLLM. Closest in spirit to this project. [[code](https://github.com/mindcraft-bots/mindcraft)]

**Key difference:** Nemobot prioritizes minimalism and local inference. The entire system is ~500 lines of code across two files, runs on a single consumer GPU, and requires no cloud APIs or fine-tuning.

## Limitations

- **No visual perception.** The bot operates on game state (entity positions, block types) via Mineflayer, not screen pixels or multimodal input.
- **Fixed action set.** New actions require adding both prompt examples and handler code.
- **No long-term memory.** Conversation history is capped and in-memory only.
- **Prompt sensitivity.** Smaller models may not follow the `[思考]`/`[実行]` format consistently. Adjust few-shot examples if needed.

## License

MIT
