# Shared by up.sh and down.sh. Everything here acts on one local k3d cluster, casebook-local, and
# never on the current kubectl context: kubectl reads only that cluster's own kubeconfig file and
# is pinned to its context on every call.

CLUSTER=casebook-local
CONTEXT=k3d-casebook-local
NAMESPACE=casebook
# Where k3d keeps a cluster's own kubeconfig, which deleting the cluster removes.
CLUSTER_KUBECONFIG="$HOME/.config/k3d/kubeconfig-$CLUSTER.yaml"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Never fall back to the default kubeconfig or whatever context it points at.
unset KUBECONFIG

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() {
	printf 'casebook local deploy: %s\n' "$*" >&2
	exit 1
}

need() {
	for tool in "$@"; do
		command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed."
	done
}

cluster_exists() {
	k3d cluster list "$CLUSTER" >/dev/null 2>&1
}

# kubectl against casebook-local only. It refuses to run unless the kubeconfig file names exactly
# that one context, pointing at a server on this machine.
kube() {
	[ -f "$CLUSTER_KUBECONFIG" ] || die "no kubeconfig for $CLUSTER at $CLUSTER_KUBECONFIG."
	local contexts server
	contexts="$(kubectl --kubeconfig "$CLUSTER_KUBECONFIG" config get-contexts -o name)"
	[ "$contexts" = "$CONTEXT" ] || die "refusing to run: $CLUSTER_KUBECONFIG must hold only the $CONTEXT context."
	server="$(kubectl --kubeconfig "$CLUSTER_KUBECONFIG" --context "$CONTEXT" config view --minify \
		-o jsonpath='{.clusters[0].cluster.server}')"
	case "$server" in
	https://0.0.0.0:* | https://127.0.0.1:* | https://localhost:* | https://host.docker.internal:*) ;;
	*) die "refusing to run: $CONTEXT points at $server, which is not on this machine." ;;
	esac
	kubectl --kubeconfig "$CLUSTER_KUBECONFIG" --context "$CONTEXT" "$@"
}
