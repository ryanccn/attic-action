#!/usr/bin/env bash
# Modified from https://github.com/cachix/install-nix-action/blob/9280e7aca88deada44c930f1e2c78e21c3ae3edd/install-nix.sh

set -euo pipefail

if nix_path="$(type -p nix)" ; then
    echo "Aborting: Nix is already installed at ${nix_path}"
    exit
fi

if [[ ($OSTYPE =~ linux) ]]; then
    enable_kvm() {
        echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-install-nix-action-kvm.rules
        sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
    }

    echo '::group::Enabling KVM support'
    enable_kvm && echo 'Enabled KVM' || echo 'KVM is not available'
    echo '::endgroup::'
fi

echo "::group::Installing Nix"

nix_installer_url="https://artifacts.nixos.org/experimental-installer"
if [[ "${LIX:-}" == '1' ]]; then
    nix_installer_url="https://install.lix.systems/lix"
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

extra_conf=(
    "experimental-features = nix-command flakes"
    "show-trace = true"
    "max-jobs = auto"
    "trusted-users = root ${USER:-}"
)

if [[ -n "${GITHUB_TOKEN:-}" && "${GITHUB_SERVER_URL:-}" == "https://github.com" ]]; then
    echo "::debug::Using the default GITHUB_TOKEN for github.com"
    extra_conf+=("access-tokens = github.com=$GITHUB_TOKEN")
else
    echo "::debug::Continuing without a GitHub access token"
fi

# Nix installer flags
installer_args=(install)

case "$OSTYPE" in
    linux*)   installer_args+=(linux) ;;
    darwin*)  installer_args+=(macos) ;;
    *)        echo "Aborting: unsupported OSTYPE $OSTYPE"; exit 1 ;;
esac

if [[ ! ($OSTYPE =~ darwin || -e /run/systemd/system) ]]; then
    installer_args+=(--init none)
fi

installer_args+=(
    --no-confirm
    --extra-conf "$(printf $'%s\n' "${extra_conf[@]}")"
)

echo "installer args: ${installer_args[*]}"

# There is --retry-on-errors, but only newer curl versions support that
curl_retries=5
while ! curl -o "$workdir/install" --proto '=https' --fail --tlsv1.2 -sSf -L "$nix_installer_url"
do
    sleep 1
    ((curl_retries--))
    if [[ $curl_retries -le 0 ]]; then
        echo "curl retries failed" >&2
        exit 1
    fi
done

sh "$workdir/install" "${installer_args[@]}"

{
    echo "/nix/var/nix/profiles/default/bin"
    echo "${XDG_STATE_HOME:-"$HOME/.local/state"}/nix/profile"
    echo "$HOME/.nix-profile/bin"
} >> "$GITHUB_PATH"

# Close the log message group which was opened above
echo "::endgroup::"
