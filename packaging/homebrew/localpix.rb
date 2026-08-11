# Homebrew cask for LocalPix. Lives in the tap repo
# (zingiber96/homebrew-localpix → Casks/localpix.rb); this copy is the
# source of truth in-repo, synced there on each release.
#
# Users install with:
#   brew tap zingiber96/localpix
#   brew install --cask localpix
#
# Release checklist: bump `version`, recompute `sha256` for the new DMG
# (shasum -a 256 LocalPix-<version>-arm64.dmg), push to the tap.
cask "localpix" do
  version "1.4.2"
  sha256 "686c370c87a39b05efb25571bc7b8633e50ec64b1a35673308e4f20c59dabc64"

  url "https://github.com/zingiber96/LocalPix/releases/download/v#{version}/LocalPix-#{version}-arm64.dmg"
  name "LocalPix"
  desc "Free, offline image converter — nothing leaves your machine"
  homepage "https://github.com/zingiber96/LocalPix"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The default release ships Apple Silicon only; Intel users build from
  # source (see the repo README).
  depends_on arch: :arm64

  app "LocalPix.app"

  zap trash: [
    "~/Library/Application Support/LocalPix",
    "~/Library/Preferences/com.local.localpix.plist",
    "~/Library/Saved Application State/com.local.localpix.savedState",
  ]
end
