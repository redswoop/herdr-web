# stormer — the box you are dressing the stage for

Ubuntu 26.04, single user (armen), reached over Tailscale as
`stormer.tail93d23c.ts.net` (100.119.251.97). Dual-boot with Windows; the old
Windows data drive is NTFS at `/mnt/data` (1.8 T). Root is a 339 G NVMe.

## Hardware
- CPU: AMD Ryzen, 32 threads. `sensors -j` → `k10temp-pci-00c3.Tctl.temp1_input`
  is the CPU die temp (Tctl; Tccd1/Tccd2 are per-CCD). Motherboard chip is
  `nct6798-isa-0290` (fans `fan1_input`…, voltages `in0`…). NVMe temps under
  `nvme-pci-0100` / `nvme-pci-0500` (`Composite.temp1_input`).
- RAM: 92 G. `free -g`.
- GPU: NVIDIA RTX 5090 (32 G VRAM, Blackwell). `nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader`.
  A second worker box holds the old RTX 4080.
- `uptime`, `cat /proc/loadavg`, `df -h / /mnt/data`.

## Services (systemd --user unless noted)
- `herdr.service` — the agent-pane multiplexer every TUI runs inside. Its
  socket is `~/.config/herdr/herdr.sock`.
- `herdr-web.service` — production herdr-web on :7683. The rail/scene
  instance you are driving is a *separate* process on :7693 (not a unit).
- `comfyui.service` — ComfyUI on :8188 (image/video gen; Nunchaku SVDQuant
  Flux/Klein batches, Wan video). `cg-desk.service`, `cg-mcp-http.service`
  belong to comfy-grok (`cg` CLI, ~/src/comfy-grok).
- `qwen.service` — a local Qwen model server (~/src/qwen).
- `syncthing.service`, `ttyd-herdr.service` (:7682, legacy).
- System units: `docker.service`, `ollama.service` (:11434),
  `tailscaled.service`, `ssh.service`, `cups.service`.
- Docker containers: `homarr` (dashboard, ~/src/homarr), `searxng`,
  minecraft servers (`mc-java-6`, `mc-nuclear-*`, `map-index`).
- Status one-liners: `systemctl --user is-active <unit>`,
  `systemctl --user show <unit> -p ActiveState,SubState,ExecMainStartTimestamp --value`,
  `journalctl --user -u <unit> -n 20 --no-pager`, `docker ps --format '{{.Names}}\t{{.Status}}'`.

## Repos under ~/src
herdr-web (this UI; also herdr-web2 for the mobile branch), comfy-grok,
lora-training (LoRA dataset/training tooling), stability (the stormer
stability-tuning project: temps, clocks, stress runs), homarr, qwen,
llama.cpp, decklistgen, fluxgate, hex, unciv, minecraft-java, arr, ac.
`git -C <repo> status --short | wc -l`, `git -C <repo> log --oneline -5`.

## Conventions
- Node 22 / npm workspaces here; vite dev servers on :5174 (prod UI) and
  :5194 (rail instance). Playwright e2e lives in e2e/.
- Armen is a senior infra/devtools engineer with a UX background. He wants
  dense, honest, devtools-grade panels: numbers, states, thresholds. He
  makes every aesthetic call himself; you make the mechanical ones.
