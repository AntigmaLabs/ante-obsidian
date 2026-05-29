# Ante Obsidian 安装文档

本文档介绍如何将 Ante Obsidian 安装为 Obsidian 插件。

Ante Obsidian 仅支持 Obsidian 桌面版。插件实际运行依赖本机 Ante Runtime，但你可以在安装插件后，直接从设置页完成 `ante` 的安装。

## 方式一：从 GitHub Release 安装

### 自动安装（推荐）

你可以使用提供的安装脚本来自动下载并解压最新版本。在你的终端中运行以下命令，将 `/path/to/your/vault` 替换为你的实际 Vault 路径：

```bash
curl -sS https://raw.githubusercontent.com/AntigmaLabs/ante-obsidian/main/scripts/install.sh | bash -s -- /path/to/your/vault
```

对同一个 Vault 再次运行该命令即可更新现有手动安装版本。脚本会用最新 release 压缩包覆盖 `ante/` 插件目录。更新后请重启 Obsidian 或重新加载社区插件。

### 手动解压

1. 打开 Ante Obsidian 在 GitHub 上的最新 Release 页面。
2. 下载插件发布压缩包（例如 `ante-0.6.3.zip`），请勿下载源码包。
3. 解压后将得到的 `ante/` 文件夹放到你的 Vault 插件目录下：
   `<your-vault>/.obsidian/plugins/`
4. 打开 Obsidian，在 `Settings -> Community plugins` 中启用 `Ante Obsidian`。

## 方式二：通过 Obsidian 社区插件市场安装

当 Ante Obsidian 通过官方审核后可使用此方式。

1. 打开 `Settings -> Community plugins`。
2. 点击 `Browse`，搜索 `Ante` 并安装。
3. 启用插件。

## 方式三：从源码本地安装

1. 克隆仓库，依次运行 `npm install` 和 `npm run build`。
2. 在你的 vault 中创建 `<your-vault>/.obsidian/plugins/ante/` 目录。
3. 将根目录的 `manifest.json`、`main.js` 和 `styles.css` 复制到该目录。
4. 打开 Obsidian，在 `Settings -> Community plugins` 中启用 `Ante Obsidian`。

## 安装后的配置

安装完成后，请检查运行配置：

1. 打开 Ante Obsidian 设置页。
2. 查看 `Runtime` 面板，确认插件和本地 Ante Runtime 的状态。
3. 如果本机还没有安装 Ante，可直接在设置页中点击 `Install` 安装。
4. 确认并配置你的 provider 和 model 设置。
