#!/usr/bin/env bash
# Network policy for build nights. Run once on the host; re-run after `sbx reset`.
# Start from deny-all, then allow only what builds need. Check blocks with `sbx policy log`.
set -euo pipefail

sbx policy init deny-all

allow() { for h in "$@"; do sbx policy allow network "$h"; done; }

allow opencode.ai:443                                   # OpenCode Go
allow localhost:8080                                    # llama-server on the host (host.docker.internal)
allow github.com:443 api.github.com:443 codeload.github.com:443 objects.githubusercontent.com:443 raw.githubusercontent.com:443
allow registry.npmjs.org:443 pypi.org:443 files.pythonhosted.org:443 crates.io:443 static.crates.io:443 index.crates.io:443
allow deb.debian.org:443 archive.ubuntu.com:80 security.ubuntu.com:80
allow playwright.azureedge.net:443 cdn.playwright.dev:443   # browser downloads (or use the playwright kit)
allow api.cloudflare.com:443                            # preview deploys
# Android projects: uncomment
# allow dl.google.com:443 maven.google.com:443 repo.maven.apache.org:443 services.gradle.org:443 plugins.gradle.org:443

sbx policy ls
