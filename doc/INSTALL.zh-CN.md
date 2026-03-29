# Ante md 安装文档

本文档介绍如何将 Ante md 安装为 Obsidian 插件。

Ante md 仅支持 Obsidian 桌面版。同时，插件安装完成后还依赖本机可用的 `ante` 命令才能真正工作。

## 安装前请确认

请先确认以下条件全部满足：

- 你使用的是 Obsidian 桌面版
- Obsidian 版本不低于 `1.6.0`
- 你的电脑上已经安装了可运行的 `ante`
- 如果 Ante 使用的是远程模型提供方，对应配置已经在 Ante 中完成

仅仅把插件文件放进 Obsidian，并不代表 Ante md 已经可用。本地 Ante 运行环境也必须正常。

## 方式一：通过 Obsidian 社区插件市场安装

当 Ante md 通过官方审核并进入 Obsidian Community Plugins 目录后，可以使用这种方式安装。

1. 打开 `Settings -> Community plugins`
2. 如有需要，关闭 `Restricted mode`
3. 点击 `Browse`
4. 搜索 `Ante md`
5. 安装插件
6. 启用插件
7. 打开 Ante md 设置，确认 Ante 命令、provider 和 model 配置

这是最适合大多数用户的安装方式，但前提是插件已经通过 Obsidian 官方审核。

## 方式二：从 GitHub Release 手动安装

如果已有发布版本，可以手动安装。

1. 打开 Ante md 在 GitHub 上的最新 Release 页面
2. 下载插件发布压缩包，例如 `ante-md-0.2.0.zip`
   不要下载 GitHub 自动生成的 `Source code` 压缩包
3. 解压压缩包，并将得到的 `ante-md/` 文件夹放到：

```text
<your-vault>/.obsidian/plugins/
```

最终路径应为：

```text
<your-vault>/.obsidian/plugins/ante-md/
```

4. 打开 Obsidian，在 `Settings -> Community plugins` 中启用 `Ante md`
5. 打开 Ante md 设置，确认 Ante 命令、provider 和 model 配置

如果插件没有显示，请确认目录名与 `manifest.json` 中的插件 id 一致。本项目的 id 是 `ante-md`。

## 方式三：从源码本地安装

如果你希望自己构建插件，可以使用这种方式。

1. 克隆仓库
2. 安装依赖：

```bash
npm install
```

3. 构建插件：

```bash
npm run build
```

4. 在你的 vault 中创建以下目录：

```text
<your-vault>/.obsidian/plugins/ante-md/
```

5. 将仓库根目录中的这些文件复制到该目录：
- `manifest.json`
- `main.js`
- `styles.css`
6. 打开 Obsidian，在 `Settings -> Community plugins` 中启用 `Ante md`
7. 打开 Ante md 设置，确认 Ante 命令、provider 和 model 配置

用于开发时，也可以直接把仓库放到插件目录中，再在原地重新构建。

## 安装后的配置

安装完成后，建议检查以下运行配置：

1. 打开 Ante md 设置
2. 确认 Ante 命令，默认值是 `ante`
3. 确认所需的启动参数
4. 如果不打算沿用 Ante 默认配置，请确认 provider 和 model 设置
5. 在测试笔记中尝试执行一次简单的 Ante md 操作

默认情况下，Ante md 会尽量沿用 Ante 的本地配置。如果 Ante 本身无法正常工作，Ante md 也无法工作。

## 故障排查

### 插件装上了，但不能正常使用

最常见的原因包括：

- 没有安装 `ante`
- `ante` 不在系统 `PATH` 中
- Ante 本身没有完成模型提供方配置
- 插件设置中的命令或参数填写错误

### 插件没有在 Obsidian 中出现

请检查以下项目：

- 目录路径是否正确：`<vault>/.obsidian/plugins/ante-md/`
- 该目录下是否存在 `manifest.json`
- 该目录下是否存在 `main.js`
- Obsidian 社区插件功能是否已启用
- 是否已经重新加载插件或重启 Obsidian

## 我应该选择哪种安装方式？

- 如果 Ante md 已经上架官方插件市场，优先使用社区插件市场安装
- 如果你想手动控制安装文件，选择 GitHub Release 手动安装
- 如果你熟悉开发流程并愿意自己构建，选择源码安装
