#!/usr/bin/env bash
# Install llama.cpp with ROCm for the Z13's Radeon 8060S (gfx1151, CachyOS) and run
# Qwen3.8-Flash-Next as a user service on :8080. Not general yet. Re-run to update.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$HOME/src/llama.cpp
export PATH="/opt/rocm/bin:$PATH" # hipconfig lives here; not on PATH outside login shells

sudo pacman -S --needed --noconfirm cmake ninja rocm-hip-sdk

if [ -d "$SRC/.git" ]; then git -C "$SRC" pull --ff-only; else git clone https://github.com/ggml-org/llama.cpp "$SRC"; fi
# Static build: one self-contained binary in ~/.local/bin, no shared libs to find at runtime.
HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
  cmake -S "$SRC" -B "$SRC/build" -G Ninja -DGGML_HIP=ON -DGPU_TARGETS=gfx1151 \
  -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build "$SRC/build"
cmake --install "$SRC/build" --prefix "$HOME/.local"

devices=$("$HOME/.local/bin/llama-server" --list-devices 2>&1)
echo "$devices"
grep -q ROCm <<<"$devices" || { echo "llama-server sees no ROCm GPU; see README (Vulkan fallback)" >&2; exit 1; }

# Ollama would compete for the same 128 GB.
sudo systemctl disable --now ollama 2>/dev/null || true

mkdir -p "$HOME/.config/systemd/user"
cp "$HERE/llama-server.service" "$HOME/.config/systemd/user/"
loginctl enable-linger "$USER" # keep it running without a login session, like the night unit
systemctl --user daemon-reload
systemctl --user enable llama-server
systemctl --user restart llama-server # starts it, or picks up a rebuilt binary on re-runs

echo "llama-server started. First start downloads ~94 GB: journalctl --user -u llama-server -f"
echo "Ready when this answers: curl -s localhost:8080/v1/models"
