#!/usr/bin/env bash
# `pnpm deploy:local`: builds casebook's image and runs it on a local k3d cluster, casebook-local,
# creating the cluster when it is missing (README, "Local Kubernetes").
set -euo pipefail
# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"

need docker k3d kubectl curl sed
docker info >/dev/null 2>&1 || die "Docker is not running."

if ! cluster_exists; then
	port="${CASEBOOK_LOCAL_PORT:-8480}"
	say "Creating the $CLUSTER cluster on port $port"
	k3d cluster create "$CLUSTER" --servers 1 --agents 0 \
		--port "127.0.0.1:$port:80@loadbalancer" \
		--kubeconfig-update-default=false --kubeconfig-switch-context=false --wait
fi
mkdir -p "$(dirname "$CLUSTER_KUBECONFIG")"
k3d kubeconfig write "$CLUSTER" --output "$CLUSTER_KUBECONFIG" --overwrite \
	--kubeconfig-merge-default=false >/dev/null
kube get --raw /readyz >/dev/null || die "the $CLUSTER cluster is not ready; is it stopped? Run k3d cluster start $CLUSTER."

# The port chosen when the cluster was created, which an existing cluster keeps.
port="$(docker port "k3d-$CLUSTER-serverlb" 80/tcp | head -n 1 | sed 's/.*://')"
[ -n "$port" ] || die "cannot find the port the $CLUSTER cluster serves on."
url="http://localhost:$port"

# Loads an image from this machine's Docker into the cluster, unless the cluster already has it.
import_image() {
	if ! docker exec "k3d-$CLUSTER-server-0" crictl inspecti "$1" >/dev/null 2>&1; then
		k3d image import "$1" --cluster "$CLUSTER"
	fi
}

say "Building the casebook image"
docker build --tag casebook:local "$ROOT"
tag="local-$(docker image inspect --format '{{.Id}}' casebook:local | sed 's/^sha256://' | cut -c1-12)"
docker tag casebook:local "casebook:$tag"
docker image inspect postgres:17 >/dev/null 2>&1 || docker pull postgres:17
say "Loading the images into the cluster"
import_image "casebook:$tag"
import_image postgres:17

say "Applying the manifests"
# A job's pod template cannot change, so the setup job is re-created on every deploy.
kube --namespace "$NAMESPACE" delete job setup --ignore-not-found --wait=true
kube kustomize "$ROOT/deploy/k8s" |
	sed -e "s#image: casebook:local#image: casebook:$tag#" -e "s#http://localhost:8480#$url#g" |
	kube apply -f -

say "Waiting for Postgres"
kube --namespace "$NAMESPACE" rollout status statefulset/postgres --timeout=300s

say "Migrating the database and loading the demo data"
for _ in $(seq 1 150); do
	state="$(kube --namespace "$NAMESPACE" get job setup \
		-o jsonpath='{.status.conditions[?(@.status=="True")].type}')"
	case " $state " in
	*" Complete "*) break ;;
	*" Failed "*)
		kube --namespace "$NAMESPACE" logs job/setup --container setup || true
		die "the database setup job failed."
		;;
	esac
	sleep 2
done
case " $state " in *" Complete "*) ;; *) die "the database setup job did not finish in 5 minutes." ;; esac
# The seed's own hints are about Docker Compose and `pnpm dev`, so say what happened here instead.
if kube --namespace "$NAMESPACE" logs job/setup --container setup | grep -q 'nothing was seeded'; then
	echo "The demo data was already loaded, and is kept."
else
	echo "Loaded the demo accounts, users, processes and cases."
fi

say "Waiting for the web app and the MCP server"
kube --namespace "$NAMESPACE" rollout status deployment/web --timeout=300s
kube --namespace "$NAMESPACE" rollout status deployment/mcp --timeout=300s
for _ in $(seq 1 30); do
	curl --fail --silent --output /dev/null "$url/signin" && break
	sleep 2
done
curl --fail --silent --output /dev/null "$url/signin" || die "$url/signin does not answer."

cat <<EOF

casebook is running on $url
  Sign in there as one of the demo users, such as Alex Example.
  Agents connect to the MCP server at $url/mcp
  Run pnpm deploy:local:down to delete the cluster, its database and case files.
EOF
