FROM oven/bun:1
RUN apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Pin to the exact gbrain commit (keep in step with VERSIONS.md, the
# brain-maintenance MAINTENANCE_SCRIPT env var, and the local CLI install).
# 1f319e6 = master 2026-07-24, includes /admin/api/rescope-client (69bc37f7)
# which the app's HTTP provisioning path requires.
RUN bun add gbrain@github:garrytan/gbrain#1f319e6d5aff7674d8f48f289768ff75911a9ea8
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENV GBRAIN_HOME=/data
CMD ["/app/entrypoint.sh"]
