# Ante md 安装文档

本文档介绍如何将 Ante md 安装为 Obsidian 插件。

Ante md 仅支持 Obsidian 桌面版。插件实际运行仍依赖本机 Ante Runtime，但现在不要求你在安装插件前手工安装 `ante`。

## 安装前请确认

请先确认以下条件全部满足：

- 你使用的是 Obsidian 桌面版
- Obsidian 版本不低于 `1.6.0`
- 你的电脑允许 Ante md 在设置页中检查、安装或升级本地 Ante Runtime
- 如果你不打算沿用 Ante 默认配置，请准备好所需 provider 的模型和凭据

仅仅把插件文件放进 Obsidian，并不代表 Ante md 已经可用。首次使用前，你仍需在 Ante md 设置页确认本地 Ante Runtime 状态。

## 方式一：通过 Obsidian 社区插件市场安装

当 Ante md 通过官方审核并进入 Obsidian Community Plugins 目录后，可以使用这种方式安装。

1. 打开 `Settings -> Community plugins`
2. 如有需要，关闭 `Restricted mode`
3. 点击 `Browse`
4. 搜索 `Ante md`
5. 安装插件
6. 启用插件
7. 打开 Ante md 设置，确认运行时状态、连接方式，以及 provider 和 model 配置

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
5. 打开 Ante md 设置，确认运行时状态、连接方式，以及 provider 和 model 配置

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
7. 打开 Ante md 设置，确认运行时状态、连接方式，以及 provider 和 model 配置

用于开发时，也可以直接把仓库放到插件目录中，再在原地重新构建。

## 安装后的配置

安装完成后，建议检查以下运行配置：

1. 打开 Ante md 设置
2. 查看 `Updates` 区域，确认插件和本地 Ante Runtime 的状态
3. 如果本机还没有安装 Ante，可以直接在设置页中使用 `Install`
4. 确认连接方式和所需的启动参数
5. 如果不打算沿用 Ante 默认配置，请确认 provider 和 model 设置
6. 如使用 Gemini，可按需填写 API Key 或环境变量名
7. 在测试笔记中尝试执行一次简单的 Ante md 操作

Ante md 仍然依赖本机可用的 Ante Runtime，但现在会固定使用标准 `ante` 可执行文件，并在设置页中提供检查、安装和升级入口。
默认情况下，Ante md 会尽量沿用 Ante 的本地配置。如果 Ante 本身无法正常工作，Ante md 也无法工作。

## 故障排查

### 插件装上了，但不能正常使用

最常见的原因包括：

- 没有安装 `ante`
- `ante` 不在系统 `PATH` 中
- Ante 本身没有完成模型提供方配置
- 插件设置中的连接方式或参数填写错误

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
