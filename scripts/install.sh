#!/bin/bash
set -e

REPO="AntigmaLabs/ante-obsidian"
PLUGIN_ID="ante-obsidian"

show_help() {
  echo "Usage: $0 <path-to-your-obsidian-vault> [path-to-release-zip]"
  echo ""
  echo "Examples:"
  echo "  $0 ~/Documents/MyVault"
  echo "    (Downloads and installs the latest release from GitHub)"
  echo ""
  echo "  $0 ~/Documents/MyVault ~/Downloads/ante-obsidian-0.2.0.zip"
  echo "    (Installs from a locally downloaded release zip)"
}

if [ -z "$1" ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  show_help
  exit 1
fi

VAULT_PATH="$1"
LOCAL_ZIP="$2"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

if [ ! -d "$VAULT_PATH" ]; then
  echo "Error: Vault path '$VAULT_PATH' does not exist."
  exit 1
fi

if [ ! -d "$VAULT_PATH/.obsidian" ]; then
  echo "Error: '$VAULT_PATH' does not appear to be an Obsidian vault (missing .obsidian folder)."
  exit 1
fi

TMP_DIR=$(mktemp -d)
ZIP_FILE="$TMP_DIR/release.zip"

if [ -n "$LOCAL_ZIP" ]; then
  if [ ! -f "$LOCAL_ZIP" ]; then
    echo "Error: Local zip file '$LOCAL_ZIP' does not exist."
    rm -rf "$TMP_DIR"
    exit 1
  fi
  echo "Using local zip file: $LOCAL_ZIP"
  cp "$LOCAL_ZIP" "$ZIP_FILE"
else
  echo "Fetching latest release information for $REPO..."
  # Use GitHub CLI if available for better auth support with private repos
  if command -v gh &> /dev/null; then
    echo "Using GitHub CLI..."
    gh release download -R "$REPO" -p "${PLUGIN_ID}-*.zip" -D "$TMP_DIR" || {
      echo "Error: Failed to download release using gh CLI."
      echo "Check your gh auth status or ensure the release exists."
      rm -rf "$TMP_DIR"
      exit 1
    }
    # Find the downloaded zip
    DOWNLOADED_ZIP=$(find "$TMP_DIR" -name "${PLUGIN_ID}-*.zip" | head -n 1)
    if [ -n "$DOWNLOADED_ZIP" ]; then
      mv "$DOWNLOADED_ZIP" "$ZIP_FILE"
    else
      echo "Error: No plugin zip file found in release."
      rm -rf "$TMP_DIR"
      exit 1
    fi
  else
    echo "Using curl..."
    RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")
    
    if echo "$RELEASE_JSON" | grep -q '"message": "Not Found"'; then
      echo "Error: Could not find latest release."
      echo "If the repository is private or no release is published yet,"
      echo "either install 'gh' (GitHub CLI) or download the zip manually and run:"
      echo "  $0 \"$VAULT_PATH\" <path-to-downloaded-zip>"
      rm -rf "$TMP_DIR"
      exit 1
    fi
    
    ZIP_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*'"${PLUGIN_ID}"'-[^"]*\.zip"' | head -n 1 | cut -d '"' -f 4)
    
    if [ -z "$ZIP_URL" ]; then
      echo "Error: Could not find a zip file in the latest release."
      rm -rf "$TMP_DIR"
      exit 1
    fi
    
    echo "Downloading $ZIP_URL..."
    curl -sL "$ZIP_URL" -o "$ZIP_FILE"
  fi
fi

echo "Installing $PLUGIN_ID to: $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"

echo "Extracting..."
unzip -q -o "$ZIP_FILE" -d "$TMP_DIR/extracted"

# The zip contents might be directly in the zip, or inside a folder named `ante-obsidian`
if [ -d "$TMP_DIR/extracted/$PLUGIN_ID" ]; then
  cp -R "$TMP_DIR/extracted/$PLUGIN_ID/"* "$PLUGIN_DIR/"
else
  cp -R "$TMP_DIR/extracted/"* "$PLUGIN_DIR/"
fi

rm -rf "$TMP_DIR"

echo ""
echo "Installation complete!"
echo "Please restart Obsidian or reload your plugins, then enable '$PLUGIN_ID' in Settings -> Community plugins."
