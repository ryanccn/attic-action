{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      inherit (nixpkgs) lib;

      forAllSystems =
        fn: lib.genAttrs lib.systems.flakeExposed (system: fn nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            actionlint
            nodejs_24
            (nodePackages_latest.pnpm.override { nodejs = nodejs_24; })
          ];
        };
      });

      packages = forAllSystems (pkgs: {
        impure-test = pkgs.runCommand "impure-test" { } ''
          echo ${toString builtins.currentTime} > $out
        '';
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
