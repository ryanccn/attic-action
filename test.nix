let
  pkgs = import <nixpkgs> { };
  time = with builtins; toString currentTime;
in
pkgs.runCommand "${time}-test" { } ''
  echo "${time}" > $out
''
