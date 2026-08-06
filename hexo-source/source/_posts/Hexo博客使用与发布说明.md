---
title: Hexo 博客使用与发布说明
date: 2026-08-06 23:30:00
tags:
  - Hexo
  - GitHub Pages
  - 博客搭建
categories:
  - 使用说明
description: 记录本博客从新建文章、本地预览、Git 提交到 GitHub Pages 自动部署的完整操作流程。
---

本文记录 Leo's Blog 的日常使用方法，适用于当前使用的 Hexo、Butterfly 和 GitHub Pages 自动部署方案。以后更换电脑、发布文章或排查部署问题时，可以直接按照本文操作。

## 一、博客基本信息

| 项目 | 当前配置 |
| --- | --- |
| 博客地址 | <https://littlestar1128.github.io/> |
| 首页完整地址 | <https://littlestar1128.github.io/index.html> |
| GitHub 仓库 | <https://github.com/littlestar1128/littlestar1128.github.io> |
| 部署记录 | <https://github.com/littlestar1128/littlestar1128.github.io/actions> |
| 本地仓库目录 | `D:\web\littlestar` |
| Hexo 工程目录 | `D:\web\littlestar\hexo-source` |
| 文章目录 | `D:\web\littlestar\hexo-source\source\_posts` |
| 图片目录 | `D:\web\littlestar\hexo-source\source\image` |
| Hexo 版本 | 8.1.2 |
| Butterfly 主题 | 5.7.0 |
| 发布方式 | GitHub Actions |
| 发布分支 | `master` |

整个发布流程如下：

```text
编写 Markdown
    ↓
本地生成和预览
    ↓
Git 提交并推送
    ↓
代码进入 master 分支
    ↓
GitHub Actions 自动构建 Hexo
    ↓
GitHub Pages 发布网站
```

## 二、新电脑第一次使用

### 1. 安装必要软件

需要安装以下软件：

- Git
- Node.js 20.19 或更高版本，推荐使用 Node.js 24
- GitHub CLI，可选但推荐安装

安装 GitHub CLI：

```powershell
winget install --id GitHub.cli
```

如果安装后输入 `gh` 提示找不到命令，请关闭当前 PowerShell，再重新打开一个窗口。

检查软件版本：

```powershell
git --version
node --version
npm.cmd --version
gh --version
```

### 2. 下载博客源码

如果新电脑还没有项目：

```powershell
cd D:\web
git clone https://github.com/littlestar1128/littlestar1128.github.io.git littlestar
```

进入 Hexo 工程并安装依赖：

```powershell
cd D:\web\littlestar\hexo-source
npm.cmd ci
```

项目使用本地安装的 Hexo，不需要再全局安装 `hexo-cli`。

### 3. 登录 GitHub CLI

```powershell
gh auth login
```

依次选择：

```text
GitHub.com
HTTPS
Yes
Login with a web browser
```

如果当前窗口仍然找不到 `gh`，可以使用完整路径：

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login
```

登录完成后检查：

```powershell
gh auth status
```

## 三、创建一篇新文章

### 1. 先同步远程仓库

开始写文章前先更新本地 `master`，可以减少后续推送冲突：

```powershell
cd D:\web\littlestar
git switch master
git pull --rebase origin master
```

如果 Git 提示存在未提交修改，应先运行 `git status`，确认这些修改属于哪篇文章，不要直接强制覆盖。

### 2. 使用 Hexo 创建文章

```powershell
cd D:\web\littlestar\hexo-source
npm.cmd run new -- "文章标题"
```

例如：

```powershell
npm.cmd run new -- "本周学习总结"
```

新文件会生成在：

```text
D:\web\littlestar\hexo-source\source\_posts
```

也可以直接在 `_posts` 文件夹中新建 `.md` 文件，但必须注意使用 UTF-8 编码。

### 3. 填写文章头部信息

推荐格式：

```yaml
---
title: 本周学习总结
date: 2026-08-06 21:30:00
tags:
  - 工作
  - 周总结
categories:
  - 学习
description: 记录这一周学到的内容和遇到的问题
---
```

注意事项：

- `title` 是网页显示的文章标题。
- `date` 建议使用 `年-月-日 时:分:秒` 格式。
- 多个标签要写成 YAML 列表，不要写成 `工作, 周总结`。
- `categories` 也建议使用列表格式。
- 文件保存编码应为 UTF-8。
- `---` 必须成对出现。

正文写在第二个 `---` 之后：

```markdown
## 本周完成内容

这里开始写文章正文。
```

## 四、在文章中使用图片

建议按年份或主题管理图片，例如：

```text
hexo-source/source/image/2026/weekly-study-cover.jpg
hexo-source/source/image/cat/sanhua.jpg
```

文章中引用：

```markdown
![本周学习封面](/image/2026/weekly-study-cover.jpg)
```

如果需要文章封面，可以在文章头部增加：

```yaml
cover: /image/2026/weekly-study-cover.jpg
```

注意：

- 图片必须真实存在，否则网页会显示破图。
- 路径中的大小写应与文件名完全一致。
- 建议使用英文、数字和短横线命名图片。
- 图片路径从 `/image/` 开始，不要填写本机的 `D:\...` 路径。

## 五、本地生成和预览

进入 Hexo 工程：

```powershell
cd D:\web\littlestar\hexo-source
```

清理旧的生成结果：

```powershell
npm.cmd run clean
```

生成静态网页：

```powershell
npm.cmd run build
```

如果最后显示类似下面的信息，说明生成成功：

```text
INFO  Generated: index.html
INFO  Generated: 2026/08/06/文章名称/index.html
INFO  45 files generated
```

启动本地预览：

```powershell
npm.cmd run server
```

浏览器打开：

<http://localhost:4000/>

检查以下内容：

- 首页能否显示新文章。
- 文章标题和日期是否正确。
- 中文是否正常显示。
- 图片是否能正常加载。
- 代码块、表格和目录是否正常。
- 标签和分类是否正确。

预览结束后，在 PowerShell 中按 `Ctrl+C` 停止服务。

## 六、提交并发布文章

### 方法一：直接推送到 master

个人博客需要快速发布时，可以直接提交到 `master`。

先回到仓库根目录：

```powershell
cd D:\web\littlestar
git status
```

只添加本次文章和相关图片：

```powershell
git add -- "hexo-source/source/_posts/文章文件名.md"
git add -- "hexo-source/source/image/2026/图片文件名.jpg"
```

不要直接照抄“文章文件名.md”，必须换成真实文件名。例如：

```powershell
git add -- "hexo-source/source/_posts/综合界面.md"
```

检查准备提交的内容：

```powershell
git status
git diff --cached --stat
```

创建提交：

```powershell
git commit -m "post: 发布文章标题"
```

同步远程更新并推送：

```powershell
git pull --rebase origin master
git push origin master
```

推送成功后，GitHub Actions 会自动开始构建和部署。

### 方法二：通过分支和 Pull Request 发布

文章较长或希望上线前再检查一次时，推荐使用独立分支：

```powershell
cd D:\web\littlestar
git switch master
git pull --rebase origin master
git switch -c post/文章简称
```

添加并提交文章：

```powershell
git add -- "hexo-source/source/_posts/文章文件名.md"
git commit -m "post: 发布文章标题"
git push -u origin post/文章简称
```

然后在 GitHub 创建 Pull Request，检查文件列表无误后合并到 `master`。只有代码进入 `master` 后，当前自动部署工作流才会触发。

## 七、查看自动部署进度

打开：

<https://github.com/littlestar1128/littlestar1128.github.io/actions>

工作流名称为：

```text
Build and Deploy Hexo
```

一次正常部署包含两个阶段：

### build

负责：

- 下载仓库代码。
- 安装 Node.js。
- 执行 `npm ci`。
- 执行 Hexo 构建。
- 上传 GitHub Pages 网页产物。

### deploy

负责把已经生成的网页发布到 GitHub Pages。

只有 `build` 和 `deploy` 都变成绿色，最新文章才算正式上线。

部署完成后访问：

<https://littlestar1128.github.io/>

## 八、常见问题

### 1. `nothing to commit, working tree clean`

这不是错误，表示当前没有新的文件或修改需要提交。

检查：

```powershell
git status
```

如果文章已经提交并推送，就不需要重复执行 `git commit`。

### 2. `pathspec ... did not match any files`

表示 `git add` 后面的路径不存在。最常见原因是把示例中的“你的文章.md”原样复制了。

先查看真实文件名：

```powershell
Get-ChildItem D:\web\littlestar\hexo-source\source\_posts
```

然后使用真实路径：

```powershell
git add -- "hexo-source/source/_posts/真实文件名.md"
```

### 3. 推送提示 `non-fast-forward`

表示远程仓库有本地尚未同步的提交。

如果本地修改已经提交，执行：

```powershell
git pull --rebase origin master
git push origin master
```

不要使用 `git push --force`，否则可能覆盖远程内容。

### 4. 推送提示连接被重置

网络中断不一定代表推送失败。再次执行：

```powershell
git push origin master
```

如果显示：

```text
Everything up-to-date
```

通常表示前一次推送实际已经成功，只是成功响应没有正常返回。

### 5. 安装 GitHub CLI 后找不到 `gh`

关闭 PowerShell 并重新打开。如果仍然无法识别：

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" --version
```

### 6. `build` 成功但 `deploy` 失败

如果日志持续显示：

```text
Current status: deployment_in_progress
Timeout reached, aborting!
```

表示 Hexo 网页已经成功生成并上传，但 GitHub Pages 发布服务没有在等待时间内完成处理。这通常不是 Markdown 内容错误。

可以稍后打开失败记录，点击：

```text
Re-run jobs
Re-run failed jobs
```

也可以检查 GitHub 服务状态：

<https://www.githubstatus.com/>

### 7. `/index.html` 能打开，但根地址异常

以下两个地址本质上都是首页：

```text
https://littlestar1128.github.io/
https://littlestar1128.github.io/index.html
```

如果只有 `index.html` 能正常打开，通常是 GitHub Pages CDN 仍保留旧缓存。等待缓存更新后，根地址会恢复。

### 8. 新文章出现 404

依次检查：

1. Markdown 是否已经提交。
2. 提交是否已经推送到 GitHub。
3. 代码是否已经进入 `master`。
4. GitHub Actions 的 `build` 是否成功。
5. GitHub Actions 的 `deploy` 是否成功。
6. 文章日期和生成路径是否与访问地址一致。

文章的默认地址格式为：

```text
https://littlestar1128.github.io/年/月/日/文件名/
```

### 9. Git 状态显示某篇旧文章被删除

例如：

```text
D hexo-source/source/_posts/2024-05-01-hello-world.md
```

在确认是否真的需要删除前，不要使用 `git add -A`，否则这个删除也会被一起提交。应只添加本次需要发布的文件。

如果确定是误删，先确认没有需要保留的未保存内容，再恢复文件：

```powershell
git restore -- "hexo-source/source/_posts/2024-05-01-hello-world.md"
```

## 九、推荐的日常发布清单

每次发布前，可以按下面的顺序检查：

```text
[ ] 已经从远程更新 master
[ ] Markdown 使用 UTF-8 编码
[ ] 文章头部的 title、date、tags、categories 正确
[ ] 图片文件已经放入 source/image
[ ] npm.cmd run build 成功
[ ] localhost:4000 预览正常
[ ] git status 中没有意外删除或无关修改
[ ] 只暂存本次文章和图片
[ ] 提交信息清楚
[ ] 推送或 PR 合并到 master
[ ] GitHub Actions 的 build 和 deploy 均成功
[ ] 线上文章可以正常打开
```

## 十、常用命令速查

```powershell
# 进入 Hexo 工程
cd D:\web\littlestar\hexo-source

# 安装依赖
npm.cmd ci

# 创建文章
npm.cmd run new -- "文章标题"

# 清理并生成网站
npm.cmd run clean
npm.cmd run build

# 本地预览
npm.cmd run server

# 返回仓库根目录
cd D:\web\littlestar

# 查看状态
git status

# 添加指定文章
git add -- "hexo-source/source/_posts/文章文件名.md"

# 提交
git commit -m "post: 发布文章标题"

# 同步远程
git pull --rebase origin master

# 推送并触发自动部署
git push origin master
```

## 十一、最重要的原则

1. 写文章前先同步远程仓库。
2. 发布前一定先本地构建和预览。
3. `git add` 使用真实文件名，不要照抄示例占位符。
4. 工作区有无关修改时，只暂存本次需要发布的文件。
5. 不使用强制推送覆盖远程仓库。
6. `build` 成功只代表网页生成成功，`deploy` 成功才代表正式上线。
7. 遇到问题先查看 `git status` 和 GitHub Actions 日志。

按照这套流程操作，平时只需要专注于 Markdown 内容，其余生成和部署工作都会由 Hexo 与 GitHub Actions 自动完成。
