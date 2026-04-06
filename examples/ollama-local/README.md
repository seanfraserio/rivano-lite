# Ollama Local — Zero API Keys

Run Rivano Lite with Ollama for a completely local AI setup. No API keys needed.

## Prerequisites

Install and start Ollama:

```bash
# Install Ollama (macOS)
brew install ollama

# Pull a model
ollama pull llama3.2

# Ollama runs automatically on localhost:11434
```

## Setup

```bash
# Copy this config
cp rivano.yaml ~/.rivano/rivano.yaml

# Start Rivano Lite
rivano start
```

## Usage

```bash
curl http://localhost:4000/api/chat -d '{
  "model": "llama3.2",
  "messages": [{"role": "user", "content": "Hello!"}]
}'
```

Everything runs on your machine — no data leaves your network.
