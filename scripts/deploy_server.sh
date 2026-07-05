#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Deploy the current checkout to a remote Docker Compose server.

Required environment variables:
  DSA_DEPLOY_HOST       Remote host or IP.
  DSA_DEPLOY_USER       SSH user.
  DSA_DEPLOY_PATH       Remote project path, for example /opt/daily_stock_analysis.

Optional environment variables:
  DSA_DEPLOY_KEY        SSH private key path. If omitted, SSH uses its default config/agent.
  DSA_DEPLOY_SERVICE    Compose service to rebuild. Default: server.
  DSA_DEPLOY_COMPOSE_FILE
                        Compose file path relative to the remote project path.
                        Default: docker/docker-compose.yml.
  DSA_REMOTE_COMPOSE_CMD
                        Remote compose command. Default: docker compose.
                        Use "sudo docker compose" if your remote user needs sudo.
  DSA_DEPLOY_SYNC_ENV   Set true only when you intentionally want to sync local .env.
                        Default: false.
  DSA_DEPLOY_SYNC_COMPOSE
                        Set true only when you intentionally want to overwrite the
                        remote Compose file. Default: false.
  DSA_DEPLOY_DRY_RUN    Set true to preview rsync changes without rebuilding. Default: false.
  DSA_SSH_EXTRA_OPTS    Extra SSH options, space-separated.

Example:
  DSA_DEPLOY_HOST=example.com \
  DSA_DEPLOY_USER=root \
  DSA_DEPLOY_KEY=~/.ssh/deploy_key \
  DSA_DEPLOY_PATH=/opt/daily_stock_analysis \
  scripts/deploy_server.sh
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    echo >&2
    usage >&2
    exit 2
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Required command not found: ${name}" >&2
    exit 2
  fi
}

shell_quote() {
  printf "%q" "$1"
}

require_env DSA_DEPLOY_HOST
require_env DSA_DEPLOY_USER
require_env DSA_DEPLOY_PATH
require_cmd rsync
require_cmd ssh

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="${DSA_DEPLOY_USER}@${DSA_DEPLOY_HOST}"
deploy_path="${DSA_DEPLOY_PATH}"
compose_file="${DSA_DEPLOY_COMPOSE_FILE:-docker/docker-compose.yml}"
compose_service="${DSA_DEPLOY_SERVICE:-server}"
remote_compose_cmd="${DSA_REMOTE_COMPOSE_CMD:-docker compose}"
sync_env="${DSA_DEPLOY_SYNC_ENV:-false}"
sync_compose="${DSA_DEPLOY_SYNC_COMPOSE:-false}"
dry_run="${DSA_DEPLOY_DRY_RUN:-false}"

ssh_opts=(-o BatchMode=yes)
if [[ -n "${DSA_DEPLOY_KEY:-}" ]]; then
  ssh_opts+=(-i "$DSA_DEPLOY_KEY")
fi
if [[ -n "${DSA_SSH_EXTRA_OPTS:-}" ]]; then
  # shellcheck disable=SC2206
  extra_opts=(${DSA_SSH_EXTRA_OPTS})
  ssh_opts+=("${extra_opts[@]}")
fi

rsync_args=(
  -az
  --delete
  --stats
  --exclude ".git/"
  --exclude "node_modules/"
  --exclude "apps/dsa-web/node_modules/"
  --exclude "apps/dsa-desktop/node_modules/"
  --exclude ".venv/"
  --exclude "venv/"
  --exclude "__pycache__/"
  --exclude ".pytest_cache/"
  --exclude ".mypy_cache/"
  --exclude "logs/"
  --exclude "reports/"
  --exclude "data/*.db*"
  --exclude "data/cache/"
  --exclude "data/*.lock*"
  --exclude "data/.admin_*"
  --exclude "data/.session_secret"
)

if [[ "$sync_env" != "true" ]]; then
  rsync_args+=(--exclude ".env")
fi
if [[ "$sync_compose" != "true" ]]; then
  rsync_args+=(--exclude "$compose_file")
fi

if [[ "$dry_run" == "true" ]]; then
  rsync_args+=(--dry-run --itemize-changes)
fi

remote_deploy_path="$(shell_quote "$deploy_path")"
remote_compose_file="$(shell_quote "$compose_file")"
remote_compose_service="$(shell_quote "$compose_service")"

echo "Deploying ${repo_root} -> ${remote}:${deploy_path}"
if [[ "$sync_env" != "true" ]]; then
  echo "Runtime config is protected: .env will not be synced."
fi
if [[ "$sync_compose" != "true" ]]; then
  echo "Remote Compose file is protected: ${compose_file} will not be synced."
fi
echo "Runtime data is protected: database, auth state, logs, reports, and cache are excluded."

ssh "${ssh_opts[@]}" "$remote" "mkdir -p ${remote_deploy_path}"

rsync "${rsync_args[@]}" \
  -e "ssh ${ssh_opts[*]}" \
  "${repo_root}/" \
  "${remote}:${deploy_path}/"

if [[ "$dry_run" == "true" ]]; then
  echo "Dry run complete. Remote service was not rebuilt."
  exit 0
fi

ssh "${ssh_opts[@]}" "$remote" "bash -se" <<REMOTE
set -euo pipefail
cd ${remote_deploy_path}
if [[ ! -f .env ]]; then
  echo "Remote .env is missing. Create it on the server, or rerun with DSA_DEPLOY_SYNC_ENV=true for initial deployment." >&2
  exit 2
fi
chmod 600 .env 2>/dev/null || true
chown 1000:1000 .env 2>/dev/null || true
if [[ -d data ]]; then
  find data -maxdepth 1 \\( -name '.admin_*' -o -name '.session_secret' \\) -exec chmod 600 {} \\; 2>/dev/null || true
  find data -maxdepth 1 \\( -name '.admin_*' -o -name '.session_secret' \\) -exec chown 1000:1000 {} \\; 2>/dev/null || true
fi
${remote_compose_cmd} -f ${remote_compose_file} up -d --build ${remote_compose_service}
${remote_compose_cmd} -f ${remote_compose_file} ps
REMOTE
