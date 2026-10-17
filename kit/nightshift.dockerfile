# syntax=docker/dockerfile:1
# Build everything into /out, then ship only /out as the mixin layer.
# Build-time downloads use the builder's network, not the sandbox policy.
FROM node:22-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends fd-find && rm -rf /var/lib/apt/lists/*

# Node tools: installed under /opt/nightshift, linked into /usr/local/bin.
# They run on the workload's own node (the OpenCode workload ships one).
RUN npm install -g --no-fund --no-audit --prefix /out/opt/nightshift @ast-grep/cli @playwright/cli \
 && mkdir -p /out/usr/local/bin \
 && for b in ast-grep sg playwright-cli; do ln -s /opt/nightshift/bin/$b /out/usr/local/bin/$b; done \
 && cp /usr/bin/fdfind /out/usr/local/bin/fd

# rtk: compacts shell output before the agent reads it.
RUN curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | HOME=/tmp/rtk sh \
 && cp /tmp/rtk/.local/bin/rtk /out/usr/local/bin/rtk \
 && /out/usr/local/bin/rtk --version

# Nightshift's OpenCode config, agents and skills.
COPY opencode /out/opt/nightshift/opencode

# rtk's OpenCode plugin: rtk writes it into a fake home, we keep whatever it wrote.
# SPIKE: non-fatal until confirmed that the plugin loads from OPENCODE_CONFIG_DIR.
RUN mkdir -p /tmp/h && HOME=/tmp/h /out/usr/local/bin/rtk init -g --opencode </dev/null \
 && cp -r /tmp/h/.config/opencode/plugin* /out/opt/nightshift/opencode/ \
 || echo "WARN: rtk OpenCode plugin not installed"

RUN chown -R 0:0 /out && chmod -R a+rX /out/opt/nightshift

FROM scratch
COPY --from=build /out /
