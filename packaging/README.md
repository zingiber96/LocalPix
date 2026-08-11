# Packaging manifests

Package-manager delivery for LocalPix — the zero-phone-home update tier:
the app itself never checks anything; the user's package manager handles
updates. Manifests here are pinned to **v1.4.2** and need their `version`
+ `sha256` bumped on each release (checksums via `shasum -a 256 <file>`).

## Homebrew (macOS)

`homebrew/localpix.rb` is a cask for a personal tap. One-time setup:

1. Create a public repo named **`homebrew-localpix`** under the
   `zingiber96` account (the `homebrew-` prefix is what makes
   `brew tap zingiber96/localpix` resolve).
2. Copy `homebrew/localpix.rb` to `Casks/localpix.rb` in that repo.

Users then install with:

```bash
brew tap zingiber96/localpix
brew install --cask localpix
```

`brew upgrade` picks up new versions whenever the tap's cask file is
bumped. (Graduating to the official `homebrew/cask` repo is possible
later, but they require notability thresholds — the personal tap works
today.)

## winget (Windows)

`winget/` holds the three-file manifest set winget expects. To publish:

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
2. Copy the three files to
   `manifests/l/LocalPix/LocalPix/1.4.2/` in the fork.
3. Validate locally: `winget validate --manifest <that folder>`
   (Windows machine or VM required).
4. Open a PR; their bot runs installer checks against the release URL.

Note: the installer is currently unsigned, so SmartScreen warnings
appear during winget's automated validation — reviewers generally allow
it for open-source projects, but code-signing (see ROADMAP non-feature
track) would smooth this.
