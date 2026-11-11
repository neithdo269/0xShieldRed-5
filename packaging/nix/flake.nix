{
  description = "ShieldRed 5 multi-boot USB preparation utility and Plugson web configurator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          runtimeInputs = with pkgs; [ bash python3 xz ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              parted
              dosfstools
              exfatprogs
              util-linux
              coreutils
            ];
        in
        {
          default = pkgs.stdenv.mkDerivation {
            pname = "shieldred5";
            version = "1.1.2";
            src = ../..;

            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              runHook preInstall
              bash ./install.sh --prefix "$out"
              wrapProgram "$out/bin/shieldred5" \
                --prefix PATH : "${pkgs.lib.makeBinPath runtimeInputs}"
              wrapProgram "$out/bin/shieldred5-plugson" \
                --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.nodejs_20 pkgs.gnutar pkgs.xz python3 ]}"
              runHook postInstall
            '';

            meta = with pkgs.lib; {
              description = "ShieldRed 5 multi-boot USB preparation utility";
              license = licenses.gpl3Only;
              platforms = systems;
            };
          };
        });

      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [ bash python3 nodejs_20 ]
              ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ parted dosfstools exfatprogs xz util-linux ];
          };
        });
    };
}

