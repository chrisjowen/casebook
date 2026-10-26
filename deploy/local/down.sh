#!/usr/bin/env bash
# `pnpm deploy:local:down`: deletes the casebook-local k3d cluster and everything in it, its
# database and case files included. No other cluster is touched.
set -euo pipefail
# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"

need k3d
if cluster_exists; then
	say "Deleting the $CLUSTER cluster"
	k3d cluster delete "$CLUSTER"
else
	say "There is no $CLUSTER cluster; nothing to delete."
fi
