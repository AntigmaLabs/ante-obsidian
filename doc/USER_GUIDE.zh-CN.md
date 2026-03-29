# Ante md 用户使用文档

Ante md 是一个面向 Obsidian 桌面版的 Ante 驱动 Markdown 工作流插件。它把本地 Ante 运行时接入到笔记编辑、Diff 审阅、聊天和终端式交互流程中。

本文档面向普通用户，重点说明 Ante md 现在能做什么、从哪里触发、结果会出现在哪里。

## 插件能做什么

Ante md 当前主要提供 7 类用户可见功能：

1. 在笔记中通过 `@ante` 触发内联处理。
2. 通过编辑器右键菜单运行内置或自定义预设。
3. 在 `Results` 中查看文本结果和 Markdown Diff。
4. 在 `Chat with Ante` 中进行连续追问。
5. 在 `Ante Terminal` 中使用更接近终端的交互方式。
6. 在插件设置中配置本地 Ante 运行时、provider、model 和凭据。
7. 在插件设置中管理预设显示、排序以及自定义预设。

## 功能一：笔记内联触发

你可以直接在 Markdown 笔记里输入以下触发词：

- `@ante`

### 适合做什么

`@ante` 适合直接处理当前段落、当前选区，或当前笔记中的具体内容，例如润色、改写、补全和整理结构。

如果任务更适合固定模板，比如研究、计划或摘要，建议直接使用预设。

### 触发后的表现

- 如果你当前选中了文字，Ante md 会优先把选区作为处理上下文。
- 如果没有选区，Ante md 会自动抓取当前光标附近的段落作为上下文。
- 插件会先在笔记中插入一个“正在运行”的占位块。
- 如果 Ante 返回的是文本结果，占位块会被替换成最终内容。
- 如果 Ante 返回的是可直接内联应用的 Markdown 改动，插件会自动应用并给出成功提示。
- 如果 Ante 返回的是文件级改动或多文件改动，Ante md 也会直接应用；如果你想检查或回退 Diff，可以再手动打开 `Results`。

### 典型使用方式

- 在一段草稿后面输入 `@ante`，让它重写这一段。
- 选中一段待整理的清单或说明，让它压缩表达或改写结构。
- 对固定类型任务优先使用预设，而不是每次都临时描述。

## 功能二：右键菜单预设

在 Obsidian 编辑器中选中文本后右键，Ante md 会把当前可见预设加入菜单。

默认内置预设包括：

- `@ante`
- `@ante research`
- `@ante plan`
- `@ante summary`

如果你在设置里启用了自定义预设，它们也会出现在这里。

同一菜单里还包括：

- `Chat with Ante`
- `Open Ante Terminal`

### 这类入口的特点

- 不需要在正文里手动输入触发词。
- 内置预设覆盖了研究、计划、摘要等常见 Markdown 工作流。
- 自定义预设可以把你常用的一套说明固化下来。
- 菜单顺序会跟随你在设置里的预设排序。

## 功能三：命令面板入口

Ante md 注册了这些常用命令，可以从 Obsidian 命令面板直接调用：

- `Open Results`
- `Chat with Ante`
- `Open Ante Terminal`
- `Run @ante on current note`
- `Run @ante research on current note`
- `Run @ante plan on current note`
- `Run @ante summary on current note`

### 适用场景

- 你习惯用命令面板而不是右键菜单。
- 你希望快速打开结果面板、聊天面板或终端面板。
- 你想反复对当前笔记运行某个内置预设。

## 功能四：Results 结果面板

`Results` 是查看任务结果的核心面板。它既能展示纯文本输出，也能展示 Markdown Diff 和改动摘要。

### 你可以在这里看到什么

- 当前任务的状态
- 纯文本结果
- 每个改动项对应的文件位置
- 每个改动项的增删行数统计
- 统一 Diff 预览
- 对待应用改动的操作按钮

### 支持的改动类型

Ante md 当前支持以下 Markdown 变更操作：

- `replace-selection`
- `append-block`
- `replace-file`
- `create-file`

如果 Ante 一次返回多个 Markdown 改动，Ante md 也可以显示聚合后的 `changes` 结果。

### 为什么这个面板重要

当 Ante 返回的是结构化文档修改，而不是普通文本时，`Results` 就是你检查改动范围、目标位置和最终效果的主要界面。

## 功能五：Chat with Ante

`Chat with Ante` 是一个带上下文的多轮对话面板，适合先讨论、追问、查看生成结果，再决定是否修改笔记。

### Chat 的主要能力

- 从侧栏发起新对话
- 在已保存的会话之间切换
- 重命名或删除会话
- 自动复用当前笔记上下文
- 在同一会话中继续追问
- 渲染 Markdown 格式回复
- 展示运行进度、工具授权卡片和改动摘要

### 适合的使用方式

- 先问思路，再决定要不要改文档
- 对刚刚执行过的任务继续追问
- 结合当前笔记路径和 vault 路径讨论文档在整个知识库中的位置
- 在聊天流里直接查看生成的 Diff 摘要

### 上下文行为

- 当前笔记或选区会在合适时被自动捕获为聊天上下文。
- 会话可以保留自己的固定上下文。
- 最近的实现已经补充了更丰富的 vault 上下文，因此 Ante 在 Chat 中可以拿到笔记路径和 vault 路径。

## 功能六：Ante Terminal

`Ante Terminal` 提供一个更接近终端的交互面板。它会显示 prompt、流式输出、系统日志、运行状态和工具授权控件。

### Terminal 的主要能力

- 以终端风格连续发送 prompt
- 查看运行中的流式输出
- 检查系统消息和错误信息
- 在需要时批准或拒绝 Ante 的工具调用
- 当任务生成 Markdown 改动时跳转到 `Results`

### 工具授权

当 Ante 在执行过程中需要调用工具时，Terminal 里可能出现授权卡片。你可以选择：

- `Approve once`
- `Allow session`
- `Deny`

## 功能七：设置与预设管理

除了运行配置外，Ante md 现在还提供了单独的预设管理区域。

### 可配置项包括

- Ante 连接模式（`stdio` 或 `websocket`）
- Ante 可执行命令
- Ante 启动参数
- Ante WebSocket 地址
- 工作目录
- 是否自动批准 Ante 工具调用
- 是否沿用 `~/.ante/settings.json` 里的 provider 和 model
- 手动指定 provider 和 model
- Gemini API Key 或其环境变量名
- 是否开启 mention trigger 调试提示
- 预设显示开关
- 拖拽排序预设
- 新建、编辑和删除自定义预设

### 对用户的意义

- 你可以让 Ante md 复用已有的 Ante 配置。
- 你可以在本地标准输入输出和 WebSocket 两种连接方式之间切换。
- 也可以在插件内部单独指定模型和供应商。
- 可以把编辑器菜单精简成你真正常用的那几个预设。
- 还可以为团队或个人流程增加固定的自定义预设，而不需要改代码。

## 一个典型工作流

1. 打开一篇 Markdown 笔记。
2. 选中一段内容，或者把光标放到目标段落。
3. 通过 `@ante`、右键菜单预设或命令面板发起任务。
4. 如果结果是内联文本，它会直接出现在笔记中。
5. 如果结果是纯文本输出或文件级 Diff，就去 `Results` 查看。
6. 如需继续讨论，打开 `Chat with Ante` 继续追问。
7. 如需更偏运行态的交互方式，则使用 `Ante Terminal`。

## 使用前提

Ante md 本身不直接提供模型能力，它依赖你本机可用的 Ante 运行环境。

使用前请确认：

- 你使用的是 Obsidian 桌面版
- 已正确安装并启用 Ante md
- 本机可以运行 `ante`
- Ante 对应的 provider、model、API 凭据已经配置好

如果 Ante 本身不可用，Ante md 也无法正常工作。

## 总结

如果把 Ante md 的功能概括成一句话，它就是：

“把 Ante 驱动的 Markdown 工作流带进 Obsidian，让你能在笔记里触发 AI、审阅 Diff、管理可复用预设，并在聊天或终端视图里继续追问。”

对于日常使用，最值得优先掌握的是这几件事：

- 用 `@ante` 做快速内联编辑
- 用右键菜单里的内置或自定义预设执行固定任务
- 在 `Results` 中检查生成改动
- 在 `Chat with Ante` 中做带上下文的连续追问
