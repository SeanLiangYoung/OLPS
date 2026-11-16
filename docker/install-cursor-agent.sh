set -euo pipefail

case "$(uname -m)" in
  x86_64|amd64) agent_arch=x64 ;;
  aarch64|arm64) agent_arch=arm64 ;;
  *) echo '不支持当前 CPU 架构' >&2; exit 1 ;;
esac

agent_version="${CURSOR_AGENT_VERSION:?必须指定 Cursor Agent 版本}"
agent_directory=/opt/cursor-agent
mkdir -p "$agent_directory"
aria2c --check-certificate=true --continue=true --auto-file-renaming=false \
  --allow-overwrite=true --file-allocation=none --split=8 \
  --max-connection-per-server=8 --min-split-size=1M \
  --connect-timeout=20 --timeout=30 --max-tries=3 --retry-wait=2 \
  --summary-interval=15 --download-result=hide \
  --dir=/opt --out=cursor-agent.tar.gz \
  "https://downloads.cursor.com/lab/${agent_version}/linux/${agent_arch}/agent-cli-package.tar.gz"
tar -xzf /opt/cursor-agent.tar.gz --strip-components=1 -C "$agent_directory"
rm /opt/cursor-agent.tar.gz
ln -s "$agent_directory/cursor-agent" /usr/local/bin/cursor-agent
cursor-agent --version
