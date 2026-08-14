<a id="top"></a>

# Git 提交与合并实战技巧

本文面向主要在 **Linux 终端**中工作的 Git 初学者，整理常见的提交、分支更新、合并冲突、提交迁移和推送问题。核心原则是：**先确认当前状态，再执行修改；优先保留历史，避免直接覆盖远程。**

本文采用分层结构：第一部分提供可以直接照着练习的日常主流程；第二部分讲解常见场景；第三部分用于逐条查询命令、参数和风险。

## 文档导航

- [第一部分：Linux 日常操作快速入门](#part-1)
  - [A1. 日常工作流程](#quick-flow)
  - [⭐ A2. 每天开始工作](#quick-start-day)
  - [⭐ A3. 创建功能分支](#quick-create-branch)
  - [⭐ A4. 修改、检查和提交](#quick-commit)
  - [◇ A5. 接入主分支最新提交](#quick-sync)
  - [⭐ A6. 首次推送和后续推送](#quick-push)
  - [◇ A7. 处理 non-fast-forward](#quick-non-fast-forward)
  - [◇ A8. 取消选错的操作](#quick-abort)
  - [⭐ A9. 完整实战检查表](#quick-checklist)
- [第二部分：场景处理与命令目录](#part-2)
  - [命令目录](#command-index)
  - [初学者阅读指南](#beginner-guide)
  - [操作前检查](#manual-preflight)
  - [分支名称](#manual-branch-names)
  - [暂存与提交](#manual-staging)
  - [修改最近提交](#manual-amend)
  - [更新当前分支](#manual-update)
  - [处理合并冲突](#manual-conflicts)
  - [处理 non-fast-forward](#manual-non-fast-forward)
  - [迁移个人改动（进阶）](#manual-migrate)
  - [停止跟踪文件](#manual-gitignore)
  - [恢复和回退（进阶）](#manual-recovery)
  - [场景速查与安全流程](#manual-scenarios)
- [第三部分：命令逐条详解](#part-3)
  - [Linux 环境与基础配置](#cmd-linux)
  - [查看当前状态](#cmd-status)
  - [备份与临时保存](#cmd-backup)
  - [获取远程状态](#cmd-remote)
  - [暂存与提交](#cmd-commit)
  - [合并、变基与迁移](#cmd-integrate)
  - [继续或取消操作](#cmd-continue-abort)
  - [补丁命令](#cmd-patch)
  - [推送命令](#cmd-push)
  - [查找提交和文件](#cmd-search)
  - [停止跟踪文件](#cmd-untrack)
  - [恢复与高风险重置](#cmd-recovery)

第三部分的命令详解默认折叠。点击小标题即可展开，减少长网页的滚动距离。

## 标记说明

- ⭐ **高频常用**：日常开发中经常使用，初学者应优先掌握。
- ◇ **按需使用**：遇到对应场景时再使用，不需要一开始全部记住。
- ⚠ **进阶或高风险**：可能改写历史、覆盖内容或需要较强判断，执行前先阅读完整说明。

“常用程度”和“操作风险”是两个不同维度。即使标为常用，也要查看命令目录中的风险等级，并在执行后阅读终端输出。

<a id="part-1"></a>

# 第一部分：Linux 日常操作快速入门

<a id="quick-flow"></a>

## A1. 先记住日常工作流程

```text
进入正确仓库
    ↓
确认分支和状态
    ↓
获取远程最新信息
    ↓
创建或切换功能分支
    ↓
修改文件并检查差异
    ↓
选择性暂存并提交
    ↓
接入主分支最新提交
    ↓
测试并推送
```

最重要的习惯：

- 一次只执行一条命令，确认输出后再继续。
- 每次复杂操作前先运行 `git status`。
- 不确定当前分支时，先运行 `git branch --show-current`。
- 提交前使用 `git diff --staged` 检查真正要提交的内容。
- 不要用 `reset --hard` 或强制推送解决自己尚未理解的问题。

本部分示例假设项目目录为 `~/projects/vcore`，远程仓库为 `origin`，主分支为 `master`，功能分支为 `fix/VCOR-3130-g52`。如果你的实际名称不同，必须替换后再执行。

<a id="quick-start-day"></a>

## ⭐ A2. 每天开始工作

### 进入项目并确认位置

```bash
cd ~/projects/vcore
pwd
ls -la
```

- `cd`：切换到项目目录。
- `pwd`：显示当前目录的完整路径。
- `ls -la`：显示包括 `.git` 在内的隐藏文件和详细信息。

看到 `.git` 通常说明当前位置是仓库根目录。然后确认 Git 状态：

```bash
git status
git branch --show-current
git branch -vv
```

- `git status`：查看未提交修改，以及是否正在 merge 或 rebase。
- `git branch --show-current`：显示当前本地分支名。
- `git branch -vv`：显示本地分支的上游关系及领先、落后状态。

获取远程最新信息：

```bash
git fetch origin
```

`fetch` 只更新本地保存的远程信息，不会自动修改当前分支和工作区。

<a id="quick-create-branch"></a>

## ⭐ A3. 创建功能分支

先切换并更新主分支：

```bash
git switch master
git pull --ff-only
```

- `git switch master`：切换到本地主分支。
- `git pull --ff-only`：只允许以快进方式更新主分支；如果历史分叉则停止，不会自动制造合并提交。

创建功能分支：

```bash
git switch -c fix/VCOR-3130-g52
git branch --show-current
```

`-c` 表示创建并立即切换。第二条命令用于确认当前分支确实是刚创建的功能分支。

<a id="quick-commit"></a>

## ⭐ A4. 修改、检查和提交

完成文件修改后，先查看状态和具体差异：

```bash
git status
git diff
```

重点确认没有混入调试代码、构建产物、日志或与当前任务无关的修改。

按代码块选择需要提交的内容：

```bash
git add -p
```

交互提示中，`y` 表示暂存当前代码块，`n` 表示跳过，`s` 表示尝试拆分，`q` 表示退出。如果某个文件的全部修改都属于当前任务，也可以指定文件：

```bash
git add taskmgr/taskmgr_param.cc
```

检查下一次提交真正会包含的内容：

```bash
git diff --staged
```

发现文件暂存错误时，取消暂存但保留实际修改：

```bash
git restore --staged taskmgr/taskmgr_param.cc
```

确认无误后创建提交：

```bash
git commit -m "fix: VCOR-3130 修正G52局部坐标数据"
```

提交后检查仓库状态和最近历史：

```bash
git status
git log --oneline --graph --decorate -5
```

<a id="quick-sync"></a>

## ◇ A5. 接入主分支最新提交

推送前再次获取远程状态：

```bash
git fetch origin
```

如果功能分支只由你使用，可以把自己的提交重放到最新主分支之后：

```bash
git rebase origin/master
```

已经由多人共同使用的分支不要随意 rebase，应遵循团队约定使用 merge。

如果发生冲突，先查看：

```bash
git status
```

打开冲突文件，整理成最终正确内容并删除 `<<<<<<<`、`=======`、`>>>>>>>` 标记，然后执行：

```bash
git add <已解决的文件路径>
git rebase --continue
```

如果还有冲突，重复处理。发现目标错误或无法判断正确内容时，取消整个 rebase：

```bash
git rebase --abort
```

取消后再次运行 `git status` 确认状态。

<a id="quick-push"></a>

## ⭐ A6. 首次推送和后续推送

首次推送前确认：

```bash
git status
git branch --show-current
git log --oneline -5
```

首次推送并建立上游关系：

```bash
git push -u origin HEAD
```

- `-u`：记录本地与远程分支的跟踪关系。
- `origin`：远程仓库简称。
- `HEAD`：当前分支最新提交。

成功后，后续通常可以直接执行：

```bash
git push
```

只有已经 commit 的内容会上传；工作区中尚未提交的修改不会上传。

<a id="quick-non-fast-forward"></a>

## ◇ A7. 推送被 `non-fast-forward` 拒绝

这通常表示远程分支已有本地没有的新提交。不要直接强推，先获取并比较：

```bash
git fetch origin
git log --oneline --left-right --graph HEAD...origin/fix/VCOR-3130-g52
```

如果确认适合将本地提交重放到远程提交之后：

```bash
git rebase origin/fix/VCOR-3130-g52
```

完成冲突处理和测试后再推送：

```bash
git push
```

如果分支由多人共同使用，或者无法判断双方提交来源，应暂停并与维护者确认使用 merge 还是 rebase。

<a id="quick-abort"></a>

## ◇ A8. 选错操作时如何取消

先运行 `git status` 判断正在进行的操作，只执行对应的一条取消命令：

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```

- 正在 merge 时使用 `git merge --abort`。
- 正在 rebase 时使用 `git rebase --abort`。
- 正在 cherry-pick 时使用 `git cherry-pick --abort`。

不要把三条命令依次尝试。取消后再次运行 `git status`。

<a id="quick-checklist"></a>

## ⭐ A9. 完整实战检查表

下面展示个人功能分支的一次完整流程。它用于说明顺序，**不要整段一次性粘贴执行**。

```bash
# 进入项目并检查
cd ~/projects/vcore
git status
git branch --show-current

# 获取并更新主分支
git fetch origin
git switch master
git pull --ff-only

# 创建功能分支
git switch -c fix/VCOR-3130-g52

# 在编辑器中修改代码，然后检查和暂存
git status
git diff
git add -p
git diff --staged

# 提交修改
git commit -m "fix: VCOR-3130 修正G52局部坐标数据"

# 接入远程主分支最新变化
git fetch origin
git rebase origin/master

# 完成编译和测试后，首次推送
git push -u origin HEAD
```

逐条执行并阅读输出，是初学阶段最重要的习惯。下一部分会按具体场景展开，第三部分提供每条命令的完整参数和风险说明。

[返回顶部](#top)

---

<a id="part-2"></a>

# 第二部分：场景处理与命令目录

<a id="command-index"></a>

## 0. 命令目录

目录中的 `<文件路径>`、`<提交号>`、`<远程分支>` 等内容是占位符，执行时需要替换成真实值，不要连尖括号一起输入。

### ⭐ 高频常用命令

初学阶段优先掌握下面这些命令。完整命令目录和参数说明仍保留在后面。

| 使用场景 | 命令 | 简洁说明 |
| --- | --- | --- |
| 随时检查 | `git status` | 查看当前分支、修改、暂存和冲突状态 |
| 确认分支 | `git branch --show-current` | 显示当前本地分支名 |
| 查看改动 | `git diff` | 查看尚未暂存的代码变化 |
| 检查提交内容 | `git diff --staged` | 查看下一次提交将包含的变化 |
| 获取远程状态 | `git fetch origin` | 更新远程信息但不修改工作区 |
| 切换分支 | `git switch <分支>` | 切换到已有本地分支 |
| 创建功能分支 | `git switch -c <新分支>` | 创建并切换到新分支 |
| 更新主分支 | `git pull --ff-only` | 只允许快进更新，分叉时停止 |
| 选择性暂存 | `git add -p` | 按代码块选择要提交的内容 |
| 暂存文件 | `git add <文件路径>` | 暂存指定文件 |
| 创建提交 | `git commit -m "说明"` | 把暂存内容保存为本地提交 |
| 首次推送 | `git push -u origin HEAD` | 推送当前分支并建立上游关系 |
| 后续推送 | `git push` | 推送当前分支的新提交 |
| 查看历史 | `git log --oneline --graph --decorate -10` | 简洁查看提交和分支关系 |

| 命令 | 简洁说明 | 风险 |
| --- | --- | --- |
| `git --version` | 确认 Git 已安装并查看版本 | 只读 |
| `git config --global user.name "姓名"` | 设置全局提交作者姓名 | 低 |
| `git config --global user.email "邮箱"` | 设置全局提交作者邮箱 | 低 |
| `git help <子命令>` | 打开某个 Git 子命令的本机帮助 | 只读 |
| `git status` | 查看工作区、暂存区和当前 Git 操作状态 | 只读 |
| `git branch --show-current` | 显示当前本地分支名 | 只读 |
| `git branch -a` | 查看本地和远程跟踪分支 | 只读 |
| `git branch -vv` | 查看本地分支、上游分支和领先/落后关系 | 只读 |
| `git remote -v` | 查看远程仓库名及其地址 | 只读 |
| `git log --oneline --graph --decorate -10` | 图形化查看最近 10 个提交 | 只读 |
| `git diff` | 查看尚未暂存的修改 | 只读 |
| `git diff --staged` | 查看已经暂存、即将提交的修改 | 只读 |
| `git branch <备份分支>` | 在当前提交上创建备份分支 | 低 |
| `git switch <分支>` | 切换到已有本地分支 | 中 |
| `git switch -c <新分支> <起点>` | 从指定起点创建并切换到新分支 | 中 |
| `git branch --set-upstream-to=<远程分支>` | 为当前分支设置上游分支 | 中 |
| `git stash push -u -m "说明"` | 临时保存已跟踪和未跟踪的修改 | 中 |
| `git stash list` | 查看所有 stash 记录 | 只读 |
| `git stash apply` | 恢复 stash，但保留 stash 记录 | 中 |
| `git stash pop` | 恢复最近一次 stash 并尝试删除该 stash | 中 |
| `git fetch origin` | 下载远程最新引用，不修改工作区 | 低 |
| `git pull --ff-only` | 只允许快进方式更新当前分支，分叉时停止 | 低/中 |
| `git pull --rebase` | 拉取上游提交，并把本地提交变基到其后 | 中 |
| `git ls-remote --heads origin` | 查询服务器上的真实分支引用 | 只读 |
| `git push` | 推送当前分支到已配置的上游分支 | 中 |
| `git push -u origin HEAD` | 首次推送当前分支并建立上游关系 | 中 |
| `git push origin HEAD:refs/heads/<分支>` | 把当前提交明确推送到指定远程分支 | 中 |
| `git push --force-with-lease` | 带远程状态保护地强制推送 | 高 |
| `git add <文件路径>` | 暂存指定文件的修改 | 低 |
| `git add -A` | 暂存全部新增、修改和删除 | 中 |
| `git add -p` | 按代码块交互式暂存 | 低 |
| `git restore --staged <文件路径>` | 取消暂存但保留工作区修改 | 低 |
| `git commit -m "说明"` | 把暂存区保存成一个新提交 | 低 |
| `git commit --amend` | 重建最近一次提交 | 中 |
| `git merge origin/<分支>` | 把目标分支合并到当前分支 | 中 |
| `git merge --abort` | 取消尚未完成的 merge | 中 |
| `git rebase origin/<分支>` | 把当前分支提交重放到目标分支之后 | 中/高 |
| `git rebase --continue` | 解决冲突后继续 rebase | 中 |
| `git rebase --abort` | 取消当前 rebase | 中 |
| `git cherry-pick <提交号>` | 把指定提交复制到当前分支 | 中 |
| `git cherry-pick --continue` | 解决冲突后继续 cherry-pick | 中 |
| `git cherry-pick --abort` | 取消当前 cherry-pick | 中 |
| `git log --no-merges --author="作者"` | 筛选指定作者的非合并提交 | 只读 |
| `git log --left-right HEAD...<远程分支>` | 比较本地与远程各自独有的提交 | 只读 |
| `git restore --source=<分支> -- <文件>` | 从指定分支取出文件到当前工作区 | 中 |
| `git checkout <分支> -- <文件>` | 旧式按文件迁移命令 | 中 |
| `git format-patch -1 <提交号> -o <目录>` | 把一个提交导出为邮件补丁 | 低 |
| `git am <补丁文件>` | 应用补丁并保留原提交信息 | 中 |
| `git am --continue` | 解决冲突后继续应用补丁 | 中 |
| `git am --abort` | 取消当前补丁应用 | 中 |
| `git rm --cached <文件>` | 停止跟踪文件但保留本地副本 | 中 |
| `git rm -r --cached <目录>` | 递归停止跟踪目录但保留本地文件 | 中 |
| `git ls-files` | 列出 Git 当前跟踪的文件 | 只读 |
| `git reflog` | 查看本地引用移动记录，用于找回提交 | 只读 |
| `git show <提交或引用>` | 查看指定提交或引用的内容 | 只读 |
| `git show ORIG_HEAD` | 查看重要操作前 Git 保存的位置 | 只读 |
| `git reset --hard <目标>` | 强制对齐提交、暂存区和工作区 | 极高 |

详细解释见文末“13. 命令逐条详解”。

### 0.1 Linux 辅助命令目录

这些不是 Git 子命令，但会在 Linux 终端中配合 Git 使用。

| 命令或符号 | 简洁说明 | 风险 |
| --- | --- | --- |
| `pwd` | 显示当前所在目录的完整路径 | 只读 |
| `ls -la` | 显示当前目录中的全部文件及详细信息 | 只读 |
| `cd <目录>` | 切换当前终端所在目录 | 低 |
| `grep <关键词>` | 从文本或命令输出中筛选匹配行 | 只读 |
| `命令1 \| 命令2` | 把命令1的输出交给命令2继续处理 | 取决于两条命令 |

<a id="beginner-guide"></a>

## 初学者阅读指南

### 命令应该在哪里执行

除安装检查和全局配置外，本文的 Git 命令通常要在仓库目录中执行。先确认当前路径和文件：

```bash
pwd
ls -la
```

如果还没有进入项目目录，可以使用：

```bash
cd ~/projects/vcore
```

看到目录中存在 `.git` 后，才说明当前位置通常是 Git 仓库根目录。`.git` 是隐藏目录，所以普通 `ls` 可能看不到，`ls -la` 才会显示。

### 命令示例的阅读规则

- 本文代码块中没有显示终端提示符 `$`，可以复制命令本身。
- `<文件路径>`、`<分支>`、`<提交号>` 是占位符，必须替换成真实值。
- 一次只执行一条命令，先查看输出，再决定是否继续。
- 命令执行异常时，不要连续尝试多个回退或强制命令，先运行 `git status`。
- Linux 路径和文件名区分大小写，例如 `Readme.md` 与 `README.md` 可能是两个不同文件。
- 路径中包含空格时要使用引号，例如 `git add "docs/user guide.md"`。
- `main` 和 `master` 都可能是主分支名，应以 `git branch -a` 或团队约定为准，不要直接照抄示例。
- 正在运行的普通查看命令如果需要停止，可按 `Ctrl+C`；它是键盘操作，不是终端命令。

### 先理解七个核心概念

| 概念 | 初学者解释 |
| --- | --- |
| 仓库（repository） | 由 Git 管理的项目及其完整版本历史 |
| 工作区（working tree） | 当前磁盘上可以直接编辑的项目文件 |
| 暂存区（staging area） | 下一次提交准备包含的修改清单 |
| 提交（commit） | 一次有说明、有作者、有时间的版本快照 |
| 分支（branch） | 指向一条开发历史末端的可移动名称 |
| `HEAD` | 当前检出的分支或提交位置 |
| 远程/上游（remote/upstream） | 服务器仓库及当前本地分支默认对应的远程分支 |

最基本的数据流是：

```text
编辑文件 → git add → 暂存区 → git commit → 本地提交 → git push → 远程仓库
```

`git fetch` 只获取远程信息；`merge` 或 `rebase` 才会把获取到的历史整合进当前分支。

### 风险等级怎么理解

| 风险 | 含义 |
| --- | --- |
| 只读 | 不改变仓库，适合先执行以了解状态 |
| 低 | 通常容易撤销，但仍需确认路径和分支 |
| 中 | 会改变暂存区、工作区或提交历史，执行前先检查状态 |
| 高 | 可能改写提交或远程历史，需要明确影响范围 |
| 极高 | 可能直接丢弃本地修改或提交，必须先备份 |

### 推荐学习顺序

初学者建议先熟练以下安全闭环：

```bash
git status
git diff
git add -p
git diff --staged
git commit -m "说明"
git fetch origin
git push
```

随后再学习 `stash`、`merge` 和普通冲突处理。`rebase`、`cherry-pick`、`format-patch`、`reset --hard` 与强制推送属于进阶内容，理解提交历史后再使用。

<a id="manual-preflight"></a>

## ⭐ 1. 操作前先确认状态

遇到分支、合并或推送问题时，先执行：

```bash
git status
git branch --show-current
git branch -vv
git remote -v
git log --oneline --graph --decorate -10
```

重点确认：

- 当前所在的本地分支是否正确。
- 工作区是否有未提交修改。
- 是否正在进行 merge、rebase 或 cherry-pick。
- 当前分支跟踪的是哪个远程分支。
- 最近是否产生了意外的合并提交。

准备进行复杂操作前，可以创建备份分支：

```bash
git branch backup-before-operation
```

如果工作区有尚未提交的修改，可以临时保存，包括未跟踪文件：

```bash
git stash push -u -m "before branch operation"
```

恢复时使用：

```bash
git stash pop
```

<a id="manual-branch-names"></a>

## ◇ 2. 分清四种分支名称

很多推送错误来自把本地分支、远程仓库和远程跟踪分支混在一起。

| 名称 | 示例 | 含义 |
| --- | --- | --- |
| 本地分支 | `feature/g52` | 本机实际修改和提交所在的分支 |
| 远程仓库名 | `origin` | 本地为远程仓库设置的简称 |
| 服务器真实分支 | `refs/heads/feature/g52` | 远程服务器保存的分支引用 |
| 远程跟踪分支 | `origin/feature/g52` | 本地记录的远程分支状态 |

如果服务器上的分支本身就叫：

```text
origin/doc/vcor-1619-g50
```

那么本地看到的远程跟踪分支会是：

```text
origin/origin/doc/vcor-1619-g50
```

第一个 `origin` 是远程仓库名，后面的 `origin/doc/...` 才是服务器上的真实分支名。

不确定远程真实分支名时，不要猜，直接查询：

```bash
git ls-remote --heads origin | grep vcor-1619
```

如果输出为：

```text
<commit> refs/heads/origin/doc/vcor-1619-g50
```

明确推送到该分支的命令就是：

```bash
git push origin HEAD:refs/heads/origin/doc/vcor-1619-g50
```

<a id="manual-staging"></a>

## ⭐ 3. 提交前只暂存真正需要的改动

提交前依次检查：

```bash
git status
git diff
git diff --staged
```

不要习惯性执行 `git add -A`。当文件里混有别人的修改或临时代码时，使用交互式暂存：

```bash
git add -p
```

常用选择：

- `y`：暂存当前代码块。
- `n`：跳过当前代码块。
- `s`：继续拆分代码块。
- `e`：手动编辑要暂存的内容。
- `q`：退出。

暂存错了可以取消暂存，不丢失工作区修改：

```bash
git restore --staged <文件路径>
```

提交信息建议说明修改类型和目标：

```bash
git commit -m "fix: VCOR-3130 修正G52局部坐标数据"
git commit -m "feat: 增加主轴速度限制"
git commit -m "docs: 更新G50使用说明"
git commit -m "chore: 移除日志文件跟踪"
```

<a id="manual-amend"></a>

## ◇ 4. 修改最近一次提交

如果提交尚未推送，可以把遗漏内容补进最近一次提交：

```bash
git add <文件路径>
git commit --amend
```

如果提交已经推送到共享分支，优先新增一个修正提交：

```bash
git add <文件路径>
git commit -m "fix: 修正上一提交中的遗漏"
git push
```

这样不会重写其他人已经拉取的历史。

<a id="manual-update"></a>

## ⭐ 5. 更新当前分支

先更新远程引用：

```bash
git fetch origin
```

### 更新到当前分支自己的远程最新版

```bash
git pull --rebase
```

更明确的写法是：

```bash
git fetch origin
git rebase origin/<当前远程分支>
```

### 把最新主分支合入功能分支

使用 merge：

```bash
git fetch origin
git merge origin/master
```

或者使用 rebase：

```bash
git fetch origin
git rebase origin/master
```

| 方式 | 特点 | 适用情况 |
| --- | --- | --- |
| `merge` | 保留真实分叉历史，可能产生 merge commit | 分支已共享、团队允许合并提交 |
| `rebase` | 历史线性、便于审查，但会改写提交 | 个人功能分支，提交尚未被他人依赖 |

不要对多人共同使用、已经推送的提交随意 rebase。

<a id="manual-conflicts"></a>

## ⭐ 6. 合并冲突的标准处理流程

发生冲突后先看状态：

```bash
git status
```

冲突文件中通常会出现：

```text
<<<<<<< HEAD
当前分支内容
=======
合入分支内容
>>>>>>> other-branch
```

手动保留正确内容并删除冲突标记，然后根据当前操作继续。

### 继续 merge

```bash
git add <已解决的文件>
git commit
```

### 继续 rebase

```bash
git add <已解决的文件>
git rebase --continue
```

### 继续 cherry-pick

```bash
git add <已解决的文件>
git cherry-pick --continue
```

### 选错分支且尚未完成操作

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```

只执行与当前状态对应的一条命令。取消后再次运行 `git status`，确认工作区已恢复。

<a id="manual-non-fast-forward"></a>

## ◇ 7. 处理 `non-fast-forward`

出现 `non-fast-forward`，通常表示远程分支已有本地没有的新提交。Git 拒绝直接覆盖远程历史。

先检查两边的差异：

```bash
git fetch origin
git log --oneline --left-right --graph HEAD...origin/<远程分支>
```

一般使用 rebase 接上远程最新提交：

```bash
git rebase origin/<远程分支>
```

解决冲突并完成 rebase 后再推送：

```bash
git push
```

如果远程分支名特殊，可以明确指定目标：

```bash
git push origin HEAD:refs/heads/<服务器真实分支名>
```

> [!WARNING]
> 不要看到 `non-fast-forward` 就立即使用 `git push --force`。确实需要改写自己独占分支的远程历史时，也应优先使用 `git push --force-with-lease`，并先确认没有覆盖别人的新提交。

<a id="manual-migrate"></a>

<details>
<summary><strong>⚠ 8. 把自己的改动迁移到干净分支（进阶，点击展开）</strong></summary>


如果功能分支经过多次合并，已经混入主分支、别人代码和冲突解决提交，最稳的方法是从正确基线创建干净分支，只迁移自己的改动。

### 方法一：迁移干净的独立提交

先查找自己的非合并提交：

```bash
git log --oneline --no-merges --author="你的名字"
```

在干净分支中迁移指定提交：

```bash
git cherry-pick <提交号1>
git cherry-pick <提交号2>
```

避免直接 cherry-pick 这类合并提交：

```text
Merge remote-tracking branch 'origin/master' into feature/xxx
```

### 方法二：按文件迁移

如果明确知道自己修改了哪些文件：

```bash
git restore --source=<旧分支> -- <文件路径>
git diff
git add -p
git commit -m "fix: 迁移目标功能修改"
```

旧版 Git 也可以使用：

```bash
git checkout <旧分支> -- <文件路径>
```

### 方法三：手动迁移代码块

当提交历史和文件内容都混得很乱时：

```bash
git log --oneline --name-only --no-merges --author="你的名字"
```

找出自己修改过的文件，在新旧版本之间逐块对比，只复制确认属于自己的逻辑。提交前务必检查：

```bash
git diff
git add -p
git diff --staged
```

### 方法四：使用 patch

提交干净且需要跨目录或跨仓库迁移时，可以生成 patch：

```bash
git format-patch -1 <提交号> -o /tmp/my-patch
```

在目标仓库应用：

```bash
git am /tmp/my-patch/*.patch
```

发生冲突后：

```bash
git add <已解决的文件>
git am --continue
```

放弃本次应用：

```bash
git am --abort
```

如果原分支包含大量 merge commit 和无关提交，不要对整个分支直接执行 `format-patch`；应先选出真正需要的独立提交。

</details>

<a id="manual-gitignore"></a>

## ◇ 9. 已提交文件如何加入 `.gitignore`

仅修改 `.gitignore` 不会停止跟踪已经提交过的文件。需要先从 Git 索引移除，同时保留本地文件：

```bash
git rm --cached jlinklog.txt
```

在 `.gitignore` 中加入：

```gitignore
jlinklog.txt
```

然后提交：

```bash
git add .gitignore
git commit -m "chore: ignore jlinklog.txt"
git push
```

`git rm --cached` 会让 PR 显示该文件被删除，这是“远程仓库不再跟踪该文件”的正常结果，本地文件仍会保留。

Windows 文件系统通常不区分大小写，Linux 会区分。忽略规则应与真实路径大小写一致：

```bash
git ls-files | grep -i jlinklog
```

如果误提交的文件含有密码、Token 或密钥，仅删除文件不够。还需要立即作废并更换凭据，再评估是否重写仓库历史。

<a id="manual-recovery"></a>

<details>
<summary><strong>⚠ 10. 恢复和回退技巧（进阶，点击展开）</strong></summary>


查看 HEAD 最近移动过的位置：

```bash
git reflog
```

找回误删或 reset 前的提交：

```bash
git branch recovery-branch <reflog中的提交号>
```

查看合并前 Git 记录的位置：

```bash
git show ORIG_HEAD
```

> [!CAUTION]
> `git reset --hard <目标>` 会丢弃当前分支指向之后的提交以及已跟踪文件中的未提交修改。执行前必须确认目标提交，并优先创建备份分支或 stash。不要把它当作普通的“更新分支”命令。

</details>

<a id="manual-scenarios"></a>

## ⭐ 11. 常见场景速查

| 场景 | 推荐操作 |
| --- | --- |
| 当前修改还没提交，需要切分支 | `git stash push -u`，切换后 `git stash pop` |
| 只想提交部分代码 | `git add -p`，再用 `git diff --staged` 检查 |
| 合并了错误分支且尚未完成 | `git merge --abort` |
| rebase 进行不下去 | 解决后 `git rebase --continue`，或 `git rebase --abort` |
| 远程比本地新，推送被拒绝 | `git fetch` 后检查差异，再 rebase 或 merge |
| 想搬运一个干净提交 | `git cherry-pick <提交号>` |
| 分支已经混入大量无关代码 | 从干净基线新建分支，按提交、文件或代码块迁移 |
| 已提交日志文件需要停止跟踪 | `git rm --cached` 配合 `.gitignore`，再新增提交 |
| 不确定远程真实分支名 | `git ls-remote --heads origin` |
| 误操作后找不到提交 | `git reflog`，再创建恢复分支 |

## ⭐ 12. 推荐的日常安全流程

```bash
# 1. 确认位置和状态
git status
git branch --show-current
git branch -vv

# 2. 更新远程引用
git fetch origin

# 3. 查看实际改动
git diff

# 4. 只暂存需要的代码
git add -p
git diff --staged

# 5. 创建清晰提交
git commit -m "fix: 简要描述本次修改"

# 6. 接入远程最新提交
git rebase origin/<目标远程分支>

# 7. 验证后推送
git status
git log --oneline --graph --decorate -10
git push
```

遇到异常时不要连续尝试多个不确定的命令。先停止操作，保存 `git status`、当前分支和最近提交信息，再决定是继续、取消还是恢复。

[返回顶部](#top)

---

<a id="part-3"></a>

# 第三部分：命令逐条详解

## 13. 命令逐条详解

以下内容按主题折叠。点击标题展开，再次点击可收起。

<details>
<summary id="cmd-linux"><strong>◇ 13.0 Linux 环境与 Git 基础配置</strong></summary>


#### `pwd`

**作用：**输出当前终端所在目录的完整路径。

```bash
pwd
```

`pwd` 是 print working directory 的缩写。Git 命令会从当前位置向上查找 `.git`，所以先用它确认没有进入错误项目。该命令只读。

#### `ls -la`

**作用：**显示当前目录中的全部文件和详细信息，包括 `.git` 等隐藏项。

```bash
ls -la
```

参数含义：

- `-l`：以长格式显示权限、所有者、大小和修改时间。
- `-a`：显示名称以 `.` 开头的隐藏文件和目录。

它只列出目录内容，不修改文件。项目目录中看到 `.git`，通常表示当前目录是仓库根目录；在子目录中看不到 `.git` 也不一定代表已经离开仓库，可继续用 `git status` 验证。

#### `cd <目录>`

**作用：**切换当前终端的工作目录。

```bash
cd ~/projects/vcore
```

`~` 代表当前 Linux 用户的主目录。相对路径以当前位置为起点，绝对路径从 `/` 开始。`cd` 不修改项目文件，但进入错误仓库后继续执行 Git 命令会影响错误的项目，所以切换后应运行 `pwd` 和 `git status`。

#### `grep <关键词>` 与管道符 `|`

**作用：**`grep` 筛选包含关键词的文本行；管道符把左侧命令的标准输出传给右侧命令。

```bash
git ls-remote --heads origin | grep vcor-1619
```

这条命令的执行顺序是：先列出远程分支，再只显示包含 `vcor-1619` 的行。`grep -i` 表示忽略大小写。这里两边都是只读命令；管道本身的风险取决于左右命令，不能假设所有带管道的操作都安全。

#### `git --version`

**作用：**确认系统能够找到 Git，并显示安装版本。

```bash
git --version
```

正常输出类似 `git version 2.43.0`。如果提示 `git: command not found`，说明 Git 未安装或不在 `PATH` 中，应先通过系统包管理器安装，再继续本文操作。

#### `git config --global user.name` 与 `user.email`

**作用：**设置以后新提交默认使用的作者姓名和邮箱。

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

参数含义：

- `config`：读取或修改 Git 配置。
- `--global`：写入当前 Linux 用户的全局配置，影响该用户的所有仓库。
- `user.name`、`user.email`：提交作者身份字段。

它不会修改已有提交。公司仓库应使用组织要求的姓名和邮箱。只想为当前仓库设置时，去掉 `--global` 并在该仓库中执行。

查看当前配置而不修改：

```bash
git config --global user.name
git config --global user.email
```

#### `git help <子命令>`

**作用：**查看本机安装版本对应的 Git 官方手册。

```bash
git help status
git help rebase
```

把 `<子命令>` 换成 `status`、`merge`、`rebase` 等真实名称。Linux 终端通常通过手册阅读器打开帮助，按 `q` 退出。该命令只读，适合确认当前 Git 版本支持的参数。

</details>

<details>
<summary id="cmd-status"><strong>⭐ 13.1 查看当前状态</strong></summary>


#### `git status`

**作用：**显示当前分支、工作区修改、暂存内容、未跟踪文件，以及是否正在 merge、rebase、cherry-pick 或应用补丁。

```bash
git status
```

它是排查问题时最先执行的命令，不会修改文件。常见结果包括：

- `working tree clean`：没有未提交修改。
- `Changes not staged for commit`：文件已修改但尚未暂存。
- `Changes to be committed`：修改已进入暂存区，下一次 commit 会包含它们。
- `Unmerged paths`：仍有冲突没有解决。
- `You are currently rebasing`：当前处于 rebase 流程中。

#### `git branch --show-current`

**作用：**只输出当前本地分支名。

```bash
git branch --show-current
```

`branch` 是分支管理子命令，`--show-current` 表示仅显示当前分支。若当前处于 detached HEAD 状态，可能没有输出，此时应结合 `git status` 判断。

#### `git branch -a`

**作用：**同时列出本地分支和本地保存的远程跟踪分支。

```bash
git branch -a
```

`-a` 表示 all。没有 `remotes/` 前缀的通常是本地分支，带 `remotes/origin/...` 的是远程跟踪分支。它显示的是本地已知状态，所以希望看到服务器最新分支前应先执行 `git fetch origin`。

#### `git branch -vv`

**作用：**显示所有本地分支、各自最新提交、上游分支以及领先或落后状态。

```bash
git branch -vv
```

参数 `-v` 表示详细显示，两个 `v` 会额外显示上游关系。示例：

```text
* feature/g52 abc1234 [origin/feature/g52: ahead 1, behind 2] fix G52
```

这表示本地比远程多 1 个提交，同时缺少远程的 2 个提交，直接 push 很可能被拒绝。

#### `git remote -v`

**作用：**查看远程仓库简称和用于拉取、推送的地址。

```bash
git remote -v
```

`-v` 是 verbose，表示显示详细地址。通常会看到 `origin` 的 fetch 和 push 地址。该命令可用于确认是否正在操作正确仓库。

#### `git log --oneline --graph --decorate -10`

**作用：**用简洁图形查看最近 10 个提交以及分支指向。

```bash
git log --oneline --graph --decorate -10
```

参数含义：

- `--oneline`：每个提交显示一行，包含短提交号和标题。
- `--graph`：用字符线条展示分叉和合并关系。
- `--decorate`：显示分支名、标签和 `HEAD` 指向。
- `-10`：最多显示 10 个提交，可改为其他数量。

#### `git diff`

**作用：**查看工作区相对于暂存区的变化，也就是“已经改了但还没有 add”的内容。

```bash
git diff
```

它不会显示已经暂存的修改。指定文件时可写：

```bash
git diff -- <文件路径>
```

这里的独立 `--` 用于明确分隔选项和文件路径，避免路径被误认为分支或参数。

#### `git diff --staged`

**作用：**查看暂存区相对于当前提交的变化，也就是下一次 commit 实际会包含的内容。

```bash
git diff --staged
```

`--staged` 与 `--cached` 在此处含义相同。提交前检查这份差异，可以避免混入日志、调试代码或别人的修改。

</details>

<details>
<summary id="cmd-backup"><strong>◇ 13.2 创建备份与临时保存</strong></summary>


#### `git branch <备份分支>`

**作用：**在当前 `HEAD` 指向的提交上创建一个新分支，但不切换过去。

```bash
git branch backup-before-operation
```

该命令只创建一个额外引用，速度快且不会复制整个仓库。复杂 rebase、reset 或迁移前创建备份分支，后续可以随时切回或比较。

#### `git switch <分支>` 与 `git switch -c <新分支> <起点>`

**作用：**切换本地分支，或者从指定起点创建并切换到新分支。

```bash
git switch feature/g52
git switch -c clean-g52 origin/master
```

第一条命令切换到已经存在的 `feature/g52`。第二条命令中，`-c` 表示 create，会从 `origin/master` 创建本地分支 `clean-g52` 并立即切换。切换前如果工作区修改会被覆盖，Git 通常会拒绝；应先提交或 stash。

#### `git branch --set-upstream-to=<远程分支>`

**作用：**为当前本地分支指定默认的远程跟踪分支。

```bash
git branch --set-upstream-to=origin/feature/g52
```

设置后，`git pull`、`git push` 和 `git status` 才能自动判断对应的远程分支及领先、落后关系。该命令不拉取、不合并，也不推送代码；完成后应使用 `git branch -vv` 核对。

#### `git stash push -u -m "说明"`

**作用：**把当前未提交修改临时放入 stash，使工作区恢复干净。

```bash
git stash push -u -m "before branch operation"
```

参数含义：

- `push`：创建一条新的 stash 记录。
- `-u`：同时保存未跟踪文件；默认只保存已经被 Git 跟踪的文件。
- `-m`：为 stash 添加说明，方便以后辨认。

默认不会保存被 `.gitignore` 忽略的文件。需要确认保存结果时可运行 `git stash list`。

#### `git stash list`

**作用：**按新到旧列出当前仓库保存的 stash 记录。

```bash
git stash list
```

输出中的 `stash@{0}` 是最新记录，后面会显示创建它时的分支和 `-m` 说明。该命令只读，不会恢复或删除任何修改。

#### `git stash apply`

**作用：**把指定或最近一次 stash 应用到当前工作区，但保留原 stash 记录。

```bash
git stash apply
git stash apply stash@{1}
```

不带参数时默认应用 `stash@{0}`。与 `pop` 相比，`apply` 更适合风险较高的恢复，因为成功后仍保留备份；确认无误后再单独清理 stash。

#### `git stash pop`

**作用：**把最近一条 stash 应用到当前工作区，成功后删除该 stash 记录。

```bash
git stash pop
```

如果当前分支内容与 stash 冲突，Git 会保留冲突状态供手动解决，并通常不会删除对应 stash。希望先应用但保留备份时，可以使用 `git stash apply`。

</details>

<details>
<summary id="cmd-remote"><strong>⭐ 13.3 获取远程状态与更新分支</strong></summary>


#### `git fetch origin`

**作用：**从名为 `origin` 的远程仓库下载最新对象并更新远程跟踪分支。

```bash
git fetch origin
```

`fetch` 不会自动修改当前分支、暂存区或工作区，因此通常是检查远程变化的安全第一步。执行后再用 `git branch -vv` 或 `git log` 比较本地与远程。

#### `git pull --rebase`

**作用：**先 fetch 当前上游分支，再把本地尚未推送的提交重放到远程最新提交之后。

```bash
git pull --rebase
```

`pull` 相当于“获取远程变化并整合”，`--rebase` 指定用 rebase 代替 merge。它依赖当前分支已经配置正确的上游分支；执行前应使用 `git branch -vv` 核对。

如果冲突，解决后运行 `git rebase --continue`；想完全取消则运行 `git rebase --abort`。

#### `git pull --ff-only`

**作用：**获取当前上游分支并只允许 fast-forward（快进）更新；如果本地和远程已经分叉，则停止并报错。

```bash
git pull --ff-only
```

`--ff-only` 不会自动创建 merge commit，也不会重写本地提交，因此很适合更新本地不应包含个人提交的 `master` 或 `main`。它依赖正确的上游配置，可通过 `git branch -vv` 检查。若命令拒绝更新，应先查看本地为什么出现独有提交，不要立即 reset 或强推。

#### `git ls-remote --heads origin`

**作用：**直接查询远程服务器上的分支引用，不依赖本地远程跟踪分支是否最新。

```bash
git ls-remote --heads origin
```

参数含义：

- `ls-remote`：列出远程引用及其提交号。
- `--heads`：只显示分支，不显示标签等其他引用。
- `origin`：要查询的远程仓库简称。

配合 shell 的 `grep` 可以按关键词筛选：

```bash
git ls-remote --heads origin | grep vcor-1619
```

管道符 `|` 会把前一条命令的输出交给 `grep`；`grep vcor-1619` 只保留包含该关键词的行。

</details>

<details>
<summary id="cmd-commit"><strong>⭐ 13.4 暂存与提交</strong></summary>


#### `git add <文件路径>`

**作用：**把指定文件当前的新增、修改或删除状态写入暂存区。

```bash
git add taskmgr/taskmgr_param.cc
```

`add` 不会产生提交，也不会上传远程。它只决定下一次 commit 要记录哪些内容。文件之后再次修改时，新修改仍需重新 add。

#### `git add -A`

**作用：**暂存整个仓库中的新增、修改和删除。

```bash
git add -A
```

`-A` 表示 all。它适合已经确认全部变化都属于同一提交的情况。仓库中有日志、构建产物或无关改动时，应改用指定路径或 `git add -p`。

#### `git add -p`

**作用：**按差异块交互式选择要暂存的代码。

```bash
git add -p
```

`-p` 是 patch 模式。它特别适合一个文件同时包含“本次功能修改”和“临时调试修改”的场景。常用选择为 `y` 暂存、`n` 跳过、`s` 拆分、`e` 编辑、`q` 退出。

#### `git restore --staged <文件路径>`

**作用：**把指定文件从暂存区撤下，但保留文件中的实际修改。

```bash
git restore --staged taskmgr/taskmgr_param.cc
```

`restore` 是恢复命令，`--staged` 指定操作暂存区而不是工作区。这与删除文件或丢弃修改不同，适合纠正误 add。

#### `git commit -m "说明"`

**作用：**把当前暂存区内容保存为一个新提交。

```bash
git commit -m "fix: VCOR-3130 修正G52局部坐标数据"
```

`-m` 表示直接在命令行提供提交说明。commit 只写入本地仓库，不等于 push。提交前应使用 `git diff --staged` 确认内容。

不带 `-m` 时：

```bash
git commit
```

Git 会打开配置的文本编辑器填写提交说明。完成 merge 后常用这种方式确认或修改自动生成的合并提交说明。

#### `git commit --amend`

**作用：**使用当前暂存区重新创建最近一次提交，可修改内容或提交信息。

```bash
git add <遗漏文件>
git commit --amend
```

`--amend` 会生成新的提交号，即使提交信息没有改变，也属于重写历史。适合尚未推送的个人提交；已推送到共享分支后应优先新增修正提交。

</details>

<details>
<summary id="cmd-integrate"><strong>⚠ 13.5 合并、变基与提交迁移（进阶）</strong></summary>


#### `git merge origin/<分支>`

**作用：**把目标远程跟踪分支中的提交合入当前分支。

```bash
git fetch origin
git merge origin/master
```

执行对象永远是“当前分支”，所以合并前必须确认 `git branch --show-current`。如果双方都有独立提交，通常会产生 merge commit；如果当前分支可直接前进，Git 可能执行 fast-forward。

#### `git rebase origin/<分支>`

**作用：**暂时取下当前分支独有提交，把分支移动到目标提交，再按顺序重新应用这些提交。

```bash
git fetch origin
git rebase origin/master
```

它会改变被重放提交的提交号。适合整理个人功能分支，不适合随意改写已被多人使用的历史。冲突可能在多个提交处重复出现，需要逐次解决并继续。

#### `git cherry-pick <提交号>`

**作用：**把指定提交产生的差异复制到当前分支，并创建一个新的提交。

```bash
git cherry-pick a1b2c3d
```

`a1b2c3d` 是源提交的短提交号。新提交内容相同，但提交号通常不同。它适合从临时分支或混乱分支迁移少量独立提交。一般不要直接挑选 merge commit；合并提交需要主线参数，判断也更复杂。

#### `git restore --source=<分支> -- <文件路径>`

**作用：**从指定分支或提交读取某个文件，写入当前工作区。

```bash
git restore --source=feature/g52 -- taskmgr/taskmgr_param.cc
```

参数含义：

- `--source=feature/g52`：文件内容来源。
- 独立的 `--`：分隔版本引用和文件路径。
- 最后的路径：要迁移的文件。

该命令不是切换分支，而是把来源版本的文件内容带到当前分支。执行后应检查 `git diff`，避免整文件覆盖掉目标分支中的必要新代码。

#### `git checkout <分支> -- <文件路径>`

**作用：**旧版 Git 中按文件读取其他分支内容，与上述 `git restore --source` 用途相近。

```bash
git checkout feature/g52 -- taskmgr/taskmgr_param.cc
```

因为 `checkout` 同时承担切换分支和恢复文件等多种职责，容易混淆。新版 Git 更推荐使用 `git switch` 切分支、使用 `git restore` 恢复文件。

</details>

<details>
<summary id="cmd-continue-abort"><strong>◇ 13.6 继续或取消进行中的操作</strong></summary>


#### `git merge --abort`

**作用：**取消尚未完成的 merge，尽可能恢复到 merge 开始前的状态。

```bash
git merge --abort
```

仅在 `git status` 表明正在合并时使用。若合并前已有复杂的未提交修改，恢复可能不完整，所以开始合并前仍应先提交或 stash。

#### `git rebase --continue`

**作用：**在当前冲突全部解决并暂存后，继续 rebase 的下一个提交。

```bash
git add <已解决的文件>
git rebase --continue
```

如果还有未解决冲突，Git 会拒绝继续。rebase 可能包含多个提交，因此这组操作可能需要重复数次。

#### `git rebase --abort`

**作用：**取消整个 rebase，返回 rebase 开始前的分支状态。

```bash
git rebase --abort
```

当发现变基目标错误、冲突范围过大或操作思路不正确时使用。不要在已经完成 rebase 后使用，此时应通过 reflog 等方式恢复。

#### `git cherry-pick --continue`

**作用：**解决并暂存冲突后，继续创建当前 cherry-pick 提交。

```bash
git add <已解决的文件>
git cherry-pick --continue
```

如果一次 cherry-pick 了多个提交，完成一个后 Git 会继续处理下一个。

#### `git cherry-pick --abort`

**作用：**取消当前 cherry-pick 序列并恢复到开始前。

```bash
git cherry-pick --abort
```

适合选错提交或发现迁移内容不合适的情况。必须在 cherry-pick 尚未完成时执行。

</details>

<details>
<summary id="cmd-patch"><strong>⚠ 13.7 导出和应用补丁（进阶）</strong></summary>


#### `git format-patch -1 <提交号> -o <目录>`

**作用：**把指定提交导出为可传递的邮件格式 `.patch` 文件。

```bash
git format-patch -1 a1b2c3d -o /tmp/my-patch
```

参数含义：

- `-1`：只导出从指定位置开始的一个提交。
- `a1b2c3d`：需要导出的提交号。
- `-o /tmp/my-patch`：指定输出目录。

补丁通常包含作者、提交信息和文件差异。提交历史混乱时不要批量导出整个分支，应先确定需要的独立提交。

#### `git am <补丁文件>`

**作用：**按照补丁中的作者和提交信息应用差异，并生成提交。

```bash
git am /tmp/my-patch/*.patch
```

`*.patch` 由 shell 展开为目录中的补丁文件。多个文件通常按文件名顺序应用。执行前应确保工作区干净，并确认补丁顺序正确。

#### `git am --continue`

**作用：**补丁冲突解决并暂存后，继续应用当前或下一个补丁。

```bash
git add <已解决的文件>
git am --continue
```

必须先删除冲突标记、保留正确内容并 add。补丁序列中可能需要重复执行。

#### `git am --abort`

**作用：**取消本次 `git am` 操作并恢复到开始前。

```bash
git am --abort
```

适用于补丁基线不匹配、冲突过多或选错补丁的情况。

</details>

<details>
<summary id="cmd-push"><strong>⭐ 13.8 推送及 non-fast-forward（强推部分为高风险）</strong></summary>


#### `git push`

**作用：**把当前本地分支的新增提交推送到其上游远程分支。

```bash
git push
```

它依赖正确的 upstream 配置，可用 `git branch -vv` 检查。如果没有上游，Git 通常会给出带 `--set-upstream` 的建议命令。未提交的工作区修改不会被 push，只有提交对象会上传。

#### `git push -u origin HEAD`

**作用：**首次推送当前本地分支，并把创建或匹配的远程分支设置为以后默认的上游分支。

```bash
git push -u origin HEAD
```

参数含义：

- `-u`：`--set-upstream` 的简写，记录上游关系。
- `origin`：要推送到的远程仓库简称。
- `HEAD`：当前本地分支指向的提交；在普通分支状态下，远程通常使用相同分支名。

成功后，后续通常可以直接使用 `git push` 和 `git pull --rebase`。执行前应使用 `git branch --show-current` 检查分支名，避免把临时或命名错误的分支发布到远程。

#### `git push origin HEAD:refs/heads/<远程分支>`

**作用：**把当前 `HEAD` 明确推送到服务器上的指定分支，不依赖本地分支名。

```bash
git push origin HEAD:refs/heads/origin/doc/vcor-1619-g50
```

命令结构：

- `origin`：目标远程仓库。
- `HEAD`：本地来源，即当前检出的提交。
- 冒号 `:`：分隔本地来源和远程目标。
- `refs/heads/...`：服务器上的完整分支引用。

该命令适合远程分支名特殊或本地分支名与远程不同的情况。目标写错会创建或更新错误的远程分支，所以应先用 `git ls-remote --heads origin` 核对。

#### `git log --oneline --left-right --graph HEAD...origin/<分支>`

**作用：**在 non-fast-forward 时比较本地和远程各自独有的提交。

```bash
git log --oneline --left-right --graph HEAD...origin/feature/g52
```

参数含义：

- `HEAD...origin/feature/g52`：三点范围，显示两边从共同祖先之后各自独有的提交。
- `--left-right`：用 `<` 和 `>` 标出提交来自哪一边。
- `--graph`：展示分叉关系。
- `--oneline`：每个提交显示一行。

先看清双方提交，再决定 merge、rebase 或其他处理方式。

#### `git push --force-with-lease`

**作用：**在需要改写远程历史时进行带保护的强制推送。

```bash
git push --force-with-lease
```

与 `--force` 相比，它会检查远程分支是否仍是本地预期的状态；如果别人已经推送新提交，通常会拒绝覆盖。它仍然会改写远程历史，只应在明确独占的功能分支上使用，并提前通知协作者。

</details>

<details>
<summary id="cmd-search"><strong>◇ 13.9 查找提交和文件</strong></summary>


#### `git log --oneline --no-merges --author="你的名字"`

**作用：**按作者筛选非合并提交，帮助从混乱分支中找出自己的独立提交。

```bash
git log --oneline --no-merges --author="liuxin"
```

参数含义：

- `--oneline`：简洁显示提交号和标题。
- `--no-merges`：排除 merge commit。
- `--author`：按作者姓名或邮箱匹配，支持正则表达式。

作者信息可能因不同电脑的 Git 配置而变化，应结合提交内容复核，不能只凭名字判断归属。

#### `git show <提交或引用>`

**作用：**显示一个提交或引用的元数据和差异内容。

```bash
git show a1b2c3d
git show ORIG_HEAD
```

参数可以是完整或短提交号、分支名、标签，也可以是 `ORIG_HEAD` 等特殊引用。它是只读命令，适合在 cherry-pick、reset 或恢复前确认目标到底包含什么。

#### `git log --oneline --name-only --no-merges --author="你的名字"`

**作用：**在上述筛选基础上，同时列出每个提交修改过的文件。

```bash
git log --oneline --name-only --no-merges --author="liuxin"
```

`--name-only` 只显示文件路径，不显示具体差异。适合先建立“自己可能改过哪些文件”的清单，再使用 `git show <提交号>` 或文件对比确认。

#### `git ls-files`

**作用：**列出当前索引中被 Git 跟踪的文件。

```bash
git ls-files
```

筛选特定文件并忽略大小写：

```bash
git ls-files | grep -i jlinklog
```

`grep -i` 中的 `-i` 表示忽略大小写。该命令可确认文件的真实路径和大小写，也能判断文件是否已经被 Git 跟踪。

</details>

<details>
<summary id="cmd-untrack"><strong>◇ 13.10 停止跟踪文件</strong></summary>


#### `git rm --cached <文件路径>`

**作用：**从 Git 索引中移除文件，但保留工作目录中的本地文件。

```bash
git rm --cached jlinklog.txt
```

参数 `--cached` 表示只操作索引。下一次提交会记录该文件从仓库中删除，因此 PR 显示 `deleted` 是正常的。为防止以后重新 add，还应把对应路径加入 `.gitignore`。

目录需要递归移除时使用：

```bash
git rm -r --cached logs/
```

`-r` 表示递归处理目录。执行前应核对路径，避免把仍需版本控制的文件整体移出索引。

</details>

<details>
<summary id="cmd-recovery"><strong>⚠ 13.11 恢复与高风险重置</strong></summary>


#### `git reflog`

**作用：**查看本地 `HEAD` 和分支引用移动历史，常用于找回 reset、rebase、amend 或误删分支前的提交。

```bash
git reflog
```

reflog 是本地记录，不会从远程同步，也不会永久保留。找到目标提交后，优先创建恢复分支：

```bash
git branch recovery-branch <提交号>
```

这条 `branch` 命令会让新分支指向找到的提交，不修改当前工作区。

#### `git show ORIG_HEAD`

**作用：**查看 Git 在部分 merge、pull、rebase 或 reset 操作前保存的原始位置。

```bash
git show ORIG_HEAD
```

`show` 会展示该提交及其差异，不会执行回退。`ORIG_HEAD` 只保存一个重要旧位置，后续操作可能覆盖它，因此更可靠的恢复来源仍是 `git reflog`。

#### `git reset --hard <目标>`

**作用：**让当前分支、暂存区和已跟踪文件全部强制对齐到指定提交。

```bash
git reset --hard origin/feature/g52
```

影响分为三层：

- 移动当前分支指针到目标提交。
- 用目标提交覆盖暂存区。
- 用目标提交覆盖工作区中的已跟踪文件。

因此，尚未提交的已跟踪文件修改会丢失，当前分支上目标之后的提交会失去分支引用。执行前至少完成以下检查：

```bash
git status
git branch backup-before-hard-reset
git stash push -u -m "before hard reset"
```

只有明确需要让本地完全等同于某个已核实目标时才使用。不要在目标分支名不确定、工作区内容未备份或多人共享历史不清楚时执行。

</details>

[返回顶部](#top)
