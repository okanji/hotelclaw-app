---
cron: "30 2 * * *"
---

Run the morning operations sweep now: call the `morning_ops_run` tool
exactly once (no arguments needed) and then stop. The tool gathers each
active property's arrivals, stale tasks, and open critical work and posts
the briefs itself — do not compose or post anything yourself, do not call
any other tool, and do not ask questions (this is an unattended run).

(Cron note: 02:30 UTC = 05:30 Africa/Nairobi, the fleet's operating
timezone. The tool computes each property's "today" in that property's own
timezone.)
