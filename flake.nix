{
  description = "";

  inputs = {
    nixpkgs.url = "nixpkgs/nixos-unstable";
  };

  outputs = {nixpkgs, ...}: let
    mkSystems = sys: builtins.map (arch: "${arch}-${sys}") ["x86_64" "aarch64"];
    systems =
      mkSystems "linux"
      ++ mkSystems "darwin";

    forAllSystems = nixpkgs.lib.genAttrs systems;
    nixpkgsFor = forAllSystems (system: import nixpkgs {inherit system;});

    forEachSystem = fn:
      forAllSystems (s: fn nixpkgsFor.${s});
  in {
    devShells = forEachSystem (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          actionlint
          nodePackages.pnpm
        ];
      };
    });

    formatter = forEachSystem (p: p.nixpkgs-fmt);
  };
}
