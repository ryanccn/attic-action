# attic-action

Cache Nix derivations with [Attic](https://github.com/zhaofengli/attic).

## Usage

Configure your attic instance with an endpoint, a cache, and a token that can read from and write to the cache. Then, add this step to a workflow job after Nix is installed:

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

## Outputs

None

## License

MIT
