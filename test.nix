let
  lock = builtins.fromJSON (builtins.readFile ./flake.lock);
  pkgs = import (fetchTarball {
    url =
      lock.nodes.nixpkgs.locked.url
        or "https://github.com/NixOS/nixpkgs/archive/${lock.nodes.nixpkgs.locked.rev}.tar.gz";
    sha256 = lock.nodes.nixpkgs.locked.narHash;
  }) { };
in
pkgs.runCommand "non-reproducible-test" { } ''
  echo ${toString builtins.currentTime} > $out
''
