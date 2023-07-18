#!/usr/bin/env bash
# THIS FILE IS MODIFIED FROM https://github.com/cachix/cachix-action
# TO USE ATTIC INSTEAD OF CACHIX
# please see COPYING.md 
set -euo pipefail

attic=$1 cache=$2

pathsToPush=$(comm -13 <(sort /tmp/store-path-pre-build) <("$(dirname "$0")"/list-nix-store.sh))

echo "$pathsToPush" | "$attic" push "$cache"
