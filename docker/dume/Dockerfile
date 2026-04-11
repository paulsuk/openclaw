ARG OPENCLAW_BASE_IMAGE
FROM ${OPENCLAW_BASE_IMAGE}

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY docker/dume/hydrate-managed-repos.sh /usr/local/bin/hydrate-managed-repos.sh
RUN chmod 755 /usr/local/bin/hydrate-managed-repos.sh

USER node
