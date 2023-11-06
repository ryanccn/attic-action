{
  description = "Github Action for caching Nix derivations with attic";

  inputs = {
    nixpkgs.url = "nixpkgs/nixos-unstable";
  };

  outputs = {nixpkgs, ...}: let
    systems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];

    forAllSystems = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
  in {
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          actionlint
          nodejs_20
          (nodePackages_latest.pnpm.override {nodejs = nodejs_20;})
        ];
      };
    });

    formatter = forAllSystems (p: p.alejandra);
  };
}
