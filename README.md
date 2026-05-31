# attic-action

Cache Nix derivations with [Attic](https://github.com/zhaofengli/attic).

## Usage

Configure your Attic instance with an endpoint, a cache, and a token that can read from and write to the cache. Then, add this step to a workflow job after Nix is installed:

```yaml
- name: Setup Attic cache
  uses: ryanccn/attic-action@v0
  with:
    endpoint: ${{ secrets.ATTIC_ENDPOINT }}
    cache: ${{ secrets.ATTIC_CACHE }}
    token: ${{ secrets.ATTIC_TOKEN }}
```

## Inputs

### `endpoint`

The Attic endpoint. This is the URL without the cache name.

### `cache`

The name of the Attic cache.

### `token`

The authorization token to provide to Attic (**optional**).

### `skip-push`

Disable pushing new derivations to the cache automatically at the end of the job (**default is false**).

This requires you to invoke `attic push <cache>` with the paths you want to push to the cache manually.

### `path-discovery-mode`

How to discover store paths to push automatically (**default is `store-scan`**).

- `store-scan` snapshots `/nix/store` before and after the job and pushes the difference. This is the existing behavior and captures paths that were substituted during the job.
- `post-build-hook` installs a Nix post-build hook and pushes only paths Nix built locally via `OUT_PATHS`. This avoids paths that were merely substituted from another cache, but requires the workflow user to be allowed to set Nix's `post-build-hook` option.

When using `post-build-hook`, ordering matters. Run `attic-action` after any other action that installs a Nix `post-build-hook` (for example `cachix/cachix-action`) and before the `nix build` steps you want to cache. Nix has a single effective `post-build-hook`; this action can only compose with hooks that already exist when it runs. If a later action overwrites the hook, Attic path discovery will be bypassed.

## Outputs

None

## License

MIT
