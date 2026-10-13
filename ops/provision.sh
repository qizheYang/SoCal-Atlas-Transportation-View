#!/usr/bin/env bash
# Run as root once on the existing Nginx host; pass this project's deploy public key.
set -euo pipefail
umask 077
[[ "$EUID" -eq 0 && "$#" -eq 1 ]] || { echo 'Usage: sudo bash ops/provision.sh PUBLIC_KEY_FILE' >&2; exit 1; }
ops_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
public_key=$(readlink -f -- "$1")
ssh-keygen -lf "$public_key" >/dev/null
grep -q '^ssh-ed25519 ' "$public_key" || { echo 'Expected one ED25519 public key' >&2; exit 1; }
[[ "$(wc -l < "$public_key")" -eq 1 ]] || { echo 'Expected one public key' >&2; exit 1; }
site_config=$(readlink -f /etc/nginx/sites-enabled/rehydratedwater.com)
[[ -f "$site_config" ]] || { echo 'Existing domain configuration is required' >&2; exit 1; }
nginx -t
mkdir -p /var/backups/yangqizhe
backup_dir=$(mktemp -d "/var/backups/yangqizhe/socalmap-setup-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
cp -a "$site_config" "$backup_dir/nginx-site.conf"
cp -a /srv/README.md "$backup_dir/server-README.md"
for path in /etc/nginx/snippets/socalmap.conf /etc/socalmap-deploy.json /usr/local/libexec/socalmap-deploy /var/lib/socalmap-deploy/.ssh/authorized_keys; do
  if [[ -f "$path" ]]; then cp -a --parents "$path" "$backup_dir/"; fi
done

if getent passwd socalmap-deploy >/dev/null; then
  [[ "$(getent passwd socalmap-deploy | cut -d: -f6)" == '/var/lib/socalmap-deploy' ]] || { echo 'Unexpected existing deployment account' >&2; exit 1; }
else
  useradd --system --user-group --create-home --home-dir /var/lib/socalmap-deploy --shell /bin/sh socalmap-deploy
fi
# The deploy account cannot change its own SSH authorization or forced command.
chown root:root /var/lib/socalmap-deploy
chmod 755 /var/lib/socalmap-deploy
install -d -o root -g root -m 755 /var/lib/socalmap-deploy/.ssh /usr/local/libexec
install -o root -g root -m 755 "$ops_dir/server/socalmap-deploy.py" /usr/local/libexec/socalmap-deploy
install -o root -g root -m 644 "$ops_dir/server/socalmap-deploy.json" /etc/socalmap-deploy.json
python3 - "$public_key" <<'PY'
from pathlib import Path
import sys
key = Path(sys.argv[1]).read_text().strip()
authorization = Path('/var/lib/socalmap-deploy/.ssh/authorized_keys')
line = 'restrict,command="/usr/local/libexec/socalmap-deploy" ' + key
existing = authorization.read_text().splitlines() if authorization.exists() else []
if line not in existing:
    authorization.write_text('\n'.join([*existing, line]) + '\n')
authorization.chmod(0o644)
PY
chown root:root /var/lib/socalmap-deploy/.ssh/authorized_keys
install -d -o socalmap-deploy -g socalmap-deploy -m 755 /srv/www/socalmap /srv/www/socalmap/releases /srv/www/socalmap/assets

install -o root -g root -m 644 "$ops_dir/server/socalmap.nginx.conf" /etc/nginx/snippets/socalmap.conf
python3 - "$site_config" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
include = '    include /etc/nginx/snippets/socalmap.conf;'
if include not in text:
    anchor = '    root /srv/www/rehydratedwater.com/current;'
    if text.count(anchor) != 1:
        raise SystemExit('Expected one existing domain root; refusing an ambiguous edit')
    path.write_text(text.replace(anchor, anchor + '\n' + include, 1))
PY
if ! nginx -t; then
  cp -a "$backup_dir/nginx-site.conf" "$site_config"
  if [[ -f "$backup_dir/etc/nginx/snippets/socalmap.conf" ]]; then
    cp -a "$backup_dir/etc/nginx/snippets/socalmap.conf" /etc/nginx/snippets/socalmap.conf
  fi
  echo "Nginx validation failed; restored original domain config. Backup: $backup_dir" >&2
  exit 1
fi
if ! systemctl reload nginx; then
  cp -a "$backup_dir/nginx-site.conf" "$site_config"
  if [[ -f "$backup_dir/etc/nginx/snippets/socalmap.conf" ]]; then
    cp -a "$backup_dir/etc/nginx/snippets/socalmap.conf" /etc/nginx/snippets/socalmap.conf
  fi
  echo "Nginx reload failed; restored previous on-disk configuration. Backup: $backup_dir" >&2
  exit 1
fi
python3 - <<'PY'
from pathlib import Path
path = Path('/srv/README.md')
marker = '## SoCal Atlas continuous deployment'
text = path.read_text()
if marker not in text:
    path.write_text(text + '\n\n' + marker + '\n\n'
        'The public map at https://rehydratedwater.com/socalmap/ is built and tested by\n'
        'qizheYang/SoCal-Atlas-Transportation-View GitHub Actions on main. Its production\n'
        'environment connects over pinned SSH as socalmap-deploy; the key can invoke\n'
        'only /usr/local/libexec/socalmap-deploy (deploy/status/rollback), without sudo.\n'
        'Releases, current/previous symlinks, and shared hashed assets live under\n'
        '/srv/www/socalmap. Nginx includes /etc/nginx/snippets/socalmap.conf.\n'
        'Receiver configuration: /etc/socalmap-deploy.json. Release health failures\n'
        'restore the preceding current symlink; releases are retained for rollback.\n'
        'Provisioning backups: /var/backups/yangqizhe/socalmap-setup-*.\n')
PY
printf 'SOCALMAP_PROVISIONED backup=%s\n' "$backup_dir"
