{
  description = "Github Action for caching Nix derivations with attic";

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

    formatter = forEachSystem (p: p.alejandra);

    packages = forEachSystem (p: let
      time = toString builtins.currentTime;
      test = p.runCommand "test-${time}" {} ''
        echo ${time} > $out
      '';
    in {
      inherit test;
      default = test;
    });
  };
}
