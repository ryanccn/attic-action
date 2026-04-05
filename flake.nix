{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
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

      formatter = forAllSystems (p: p.nixfmt);
    };
}
