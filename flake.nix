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
          nodePackages.pnpm
        ];
      };
    });

    formatter = forAllSystems (p: p.alejandra);

    packages = forAllSystems (p: let
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
