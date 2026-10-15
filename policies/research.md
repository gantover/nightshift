# Research profile (not wired yet)

Research and job-search nights read pages written by strangers, so they run in a separate sandbox that:

- may reach the open web (per-sandbox allow, not the global build policy);
- holds only the Go key and a read-only search key: no GitHub, Cloudflare or other token that can publish;
- hands its results to the build sandbox as files, which the reviewer reads.

Wire this after the website nights work (rollout step 4 in the design doc).
