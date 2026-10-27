FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and Eclipse Temurin OpenJDK 21
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  curl \
  jq \
  gnupg \
  ca-certificates \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" > /etc/apt/sources.list.d/adoptium.list \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
  temurin-21-jdk \
  gh \
  dbus \
  dbus-x11 \
  gnome-keyring \
  libsecret-tools \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Install Antigravity CLI
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

# Configure safe directories for container execution
RUN git config --global --add safe.directory '*'

# Configure Antigravity CLI to use clean consumer OAuth defaults
RUN mkdir -p /home/agent/.gemini/antigravity-cli && \
    echo '{}' > /home/agent/.gemini/antigravity-cli/settings.json

# Add Antigravity CLI and local binaries to PATH, configure headless Java and D-Bus session
ENV PATH="/home/agent/.local/bin:$PATH"
ENV JAVA_TOOL_OPTIONS="-Djava.awt.headless=true"
ENV DBUS_SESSION_BUS_ADDRESS="unix:path=/tmp/dbus-session.sock"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]
