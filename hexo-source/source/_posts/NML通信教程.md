---
title: VCore NML 通信教程：从消息定义到 UI 状态回传
date: "2026-10-19 00:30:42"
permalink: /2026/10/19/NML通信教程/
tags:
  - NML
  - C++
  - CNC
  - 进程通信
categories:
  - 技术笔记
cover: /image/covers/nml-communication.jpg
description: 结合 VCore 消息源码，梳理 NML 消息定义、format 与 update、通道绑定及 Auto 到 UI 的状态回传链路，并说明新增字段的接入与验证方法。
---

# VCore NML 通信教程：从消息定义到 UI 状态回传

> **主线：Auto 产生执行结果 → 共享状态 → taskmgr 获取并分类填充 → NML 消息 → UI。**
>
> 架构部分依据项目讲解和学习笔记；消息库部分依据附录收录的七份源码；共享状态读取部分使用学习资料 `nml.md` 中的 `homing_active` 源码摘录。`EMC_*` 参考代码与 `VCORE_*` 项目代码分别保留，不直接互换名称。本文中的“接入示意”不是已经实施的工程补丁。

<!-- more -->

## 阅读导航

| 要弄清的问题 | 阅读位置 |
| --- | --- |
| 各模块怎样连接 | [1. 整体通信架构](#architecture) |
| 每个文件负责什么，type 有哪些 | [2. 文件与消息定义](#messages) |
| 类、继承、format、update 怎样配合 | [3. 消息处理机制](#mechanism) |
| 参数命令里的数据怎样传 | [4. 参数消息](#parameter) |
| vcoresvr 如何绑定消息和通道 | [5. 通道与服务进程](#server) |
| emcmotStatus 的数据从哪里来 | [6. 共享状态与本地副本](#snapshot) |
| 一个字段怎样走完整条状态链路 | [7. homing_active 源码实例](#homing) |
| 怎样添加 IsXRadiusPrg 并验证 | [8. 新增字段与验证](#new-field) |
| 阅读原代码时有哪些检查点 | [9. 代码检查与速查](#check) |
| 需要查看本文收录的完整代码 | [附录：七份源码](#original-source) |

---

<a id="architecture"></a>
## 1. 整体通信架构：先分清两段边界

### 1.1 taskmgr 与 Auto 各自负责什么

按项目讲解，该版本将 Interpreter 与 taskmgr 放在一起，由 taskmgr 进行应用层管理并获取 Auto 的执行状态。

| 模块 | 与通信有关的工作 |
| --- | --- |
| UI／上层应用 | 发送控制命令，读取对外状态并使用这些状态 |
| taskmgr | 接收 NML 命令，协调 Interpreter／Planner，向 Auto 下发需要执行的命令，取得执行结果并更新对外状态 |
| Interpreter／Planner | 解析、规划，与 taskmgr 同步数据并下发程序段相关内容 |
| Auto | 执行指令，维护执行状态，并把状态反馈给 taskmgr |
| nml_msg 库 | 定义消息类型、字段和消息格式处理函数 |
| vcoresvr | 构造相应 NML 通道对象，并调用 NML 服务运行接口 |

**内部状态交换与对外消息交换不是同一层：**

```text
Auto  ←→  taskmgr             内部命令／程序段／共享状态路径

taskmgr  ←→  UI               NML 命令与状态路径
```

`emcmot_status_t` 是内部状态结构，`VCORE_STAT` 等是对外状态的组织形式；不能因为字段同名，就把它们当成同一份对象。

### 1.2 命令下发路径

按照架构中的命令方向：

```text
UI 构造命令并填写字段
    ↓
NML 命令通道
    ↓
taskmgr：task_issue_command
    ↓ 需要 Auto 执行时进行转换
SendCommand
    ↓
cmd_code_t / emcmot_command_t
    ↓
Auto：Motion Command Handler
```

“创建命令后发送”只是发送端的动作。消息是否被识别、业务是否允许执行、Auto 是否执行完成，是后续环节，不能用一次发送动作代替执行结果验证。

架构中还存在另一条**解析后程序段下发路径**：Interpreter／Planner → taskinterp 的同步和转发 → 程序段缓冲 → Auto。它与上面的控制命令缓冲用途不同。

### 1.3 状态回传路径

```text
Auto 当前执行结果
    ↓ 发布
共享状态区
    ↓ VCoreAutoUpdate 获取
应用层 emcmotStatus
    ↓ 分类填充
VCORE_STAT
    ├── task
    └── motion
         ├── 插补状态
         ├── joint 状态
         └── axis 状态
    ↓ NML 状态写出
UI 读取并使用
```

项目讲解中的状态分类如下。这是职责和包含关系，不是已经展开的完整 C++ 类定义。

| 状态名称 | 项目讲解中的含义 |
| --- | --- |
| `VCORE_STAT` | taskmgr 的总体状态 |
| `VCORE_TASK_STAT` | 解释器解析出的命令执行后的结果状态 |
| `VCORE_MOTION_STAT` | 运动相关状态 |
| `VCORE_TRAL_STAT` | 插补时的数据状态；此处沿用笔记拼写 |
| `VCOREJOINT_STAT` | joint 节点物理状态；此处沿用笔记拼写 |
| `VCORE_AXIS_STAT` | 笛卡尔坐标系下的轴状态；笔记说明该分支当时未使用 |

插补、joint、axis 是 motion 的细分状态；`VCORE_STAT` 是外层总体状态。实际类名和成员名仍需以当前工程声明为准。

### 1.4 状态更新函数分工

| 函数名 | 项目笔记说明的职责 |
| --- | --- |
| `VCoreTaskmgrUpdate()` | 组织、汇总状态更新，更新 `VCORE_STAT` |
| `VCoreAutoUpdate()` | 获取 Auto 状态，更新应用层 `emcmotStatus` |
| `VCoreMotionUpdate()` | 从 `emcmotStatus` 填充 motion 状态 |
| `VCoreTaskUpdate()` | 从 `emcmotStatus` 填充 task 状态 |
| `VCoreJointUpdate()` | 从 `emcmotStatus` 填充对应 joint 状态 |

**“获取状态”与“分类填充状态”是两种工作。**要找 `emcmotStatus` 的来源，先看 `VCoreAutoUpdate()`；要找对外字段的赋值，再看对应的分类更新函数。

原始学习笔记中还出现过 `VCoreAutoUpdata()` 这一名称。现有资料不足以证明它与上表某个函数完全相同，定位代码时应同时看函数签名、参数类型和调用者。

> **阅读范围提醒：**下面七份源码中能直接看到的是一个独立的 `VCORE_TASK_STAT` 消息及其 type＝301；并没有完整 `VCORE_STAT` 类定义及其写出函数。两种资料可以用来对照职责，但不能据此断言当前 UI 收到的顶层对象一定是哪一个。最终看实际 `write()`、format 分派和接收端类型。

---

<a id="messages"></a>
## 2. 文件与消息定义：先知道“有哪些消息”

### 2.1 目录与源码范围

```text
nml_msg/
├── include/
│   ├── nml_msg.hh             已有代码：消息编号、格式函数声明、示例消息类
│   ├── task_subtype.hh        已有代码：Task 命令与状态类
│   ├── param_nml_msg.hh       已有代码：参数命令与状态类
│   ├── plc_nml_msg.hh         尚无源码正文
│   └── plc_subtype.h          尚无源码正文
├── src/
│   ├── nml_msg.cc             已有代码：FRAME 示例消息 update
│   ├── task.cc                已有代码：Task format 和 update
│   ├── param_msg.cc           已有代码：参数 format 和 update
│   └── plc_nml_msg.cc         尚无源码正文
├── config/
│   └── vcore_cfg.nml          尚无配置正文
└── vcoresvr/
    └── vcoresvr.cc            已有代码：通道构造与服务入口
```

这七份源码的全文保留在附录。正文只选取说明当前环节所需的部分，不把后面建议新增的字段写进原始代码。

### 2.2 `nml_msg.hh`：统一定义消息 type

该文件先引入 `rcs.hh`、`cms.hh`、`nml.hh`、`nmlmsg.hh`、`cmd_msg.hh`、`stat_msg.hh`，再定义消息编号、格式函数声明和两个示例消息类。

例如：

```cpp
#define VCORE_TASK_CMD_BASE_TYPE        ((NMLTYPE)200)
#define VCORE_TASK_CMD_SET_MODE_TYPE    (VCORE_TASK_CMD_BASE_TYPE + 1)
#define VCORE_TASK_CMD_START_TYPE       (VCORE_TASK_CMD_BASE_TYPE + 4)
```

因此，在这份代码中：

```text
201 → Task 模式切换消息
204 → Task 启动消息
```

`type` 标识消息类型，不是通道号、主轴号，也不是一次请求的序号。

下表按原始宏和注释整理：

| type | 宏名 | 代码中的用途 |
| ---: | --- | --- |
| 101 | `VCORE_FRAME_CMD_1_TYPE` | 框架命令示例 |
| 102 | `VCORE_FRAME_STAT_1_TYPE` | 框架状态示例 |
| 201 | `VCORE_TASK_CMD_SET_MODE_TYPE` | 模式切换 |
| 202 | `VCORE_TASK_CMD_RESET_TYPE` | RESET 命令；原宏旁注释重复写了“模式切换” |
| 203 | `VCORE_TASK_CMD_LOAD_TYPE` | 载入加工文件 |
| 204 | `VCORE_TASK_CMD_START_TYPE` | 开始 |
| 205 | `VCORE_TASK_CMD_PAUSE_TYPE` | 暂停 |
| 206 | `VCORE_TASK_CMD_STEP_TYPE` | 单段 |
| 207 | `VCORE_TASK_CMD_HWGUIDANCE_TYPE` | 手轮引导 |
| 301 | `VCORE_TASK_STAT_TYPE` | 所列代码中的 Task 状态消息 |
| 401 | `VCORE_PLC_CMD_DOWNLOAD_TYPE` | 梯形图下载 |
| 402 | `VCORE_PLC_CMD_PARAM_TYPE` | 参数设置 |
| 403 | `VCORE_PLC_CMD_RUN_TYPE` | 梯形图执行 |
| 501 | `VCORE_PLC_STAT_DATA_TYPE` | PLC 数据 |
| 502 | `VCORE_PLC_STAT_ACK_TYPE` | PLC 数据应答 |
| 601 | `VCORE_PARAM_CMD_MSG_TYPE` | 参数命令 |
| 701 | `VCORE_PARAM_STAT_MSG_TYPE` | 参数状态 |

原注释把 1～100 列为 NML 保留区，101～199 列为框架保留区，并给 Task、PLC、参数分别规划命令／状态编号段。这里记录的是该头文件的规划，不扩展成所有工程的通用编号规则。

### 2.3 `task_subtype.hh`：每条 Task 消息携带什么

操作模式枚举的数值为：

```cpp
enum OPERATION_MODE
{
    EDIT = 1,
    AUTO = 2,
    MDI = 3,
    JOG = 4,
    INC = 5,
    HND = 6,
    REF = 7
};
```

这些值用于表达操作模式，不是 NML 消息 type。例如，`mode＝2` 与“消息类型＝201”可以同时出现：它们分别回答“目标模式是什么”和“这是什么消息”。

| 消息类 | 本类新增的业务字段 | 阅读含义 |
| --- | --- | --- |
| `VCORE_TASK_CMD_SET_MODE` | `int mode` | 请求的模式值 |
| `VCORE_TASK_CMD_RESET` | `bool reset` | RESET 消息携带的标志 |
| `VCORE_TASK_CMD_LOAD` | `char programName[12]` | 原注释写为 8.3 格式程序名 |
| `VCORE_TASK_CMD_START` | 无 | 本类以消息类型表达启动请求 |
| `VCORE_TASK_CMD_PAUSE` | 无 | 本类以消息类型表达暂停请求 |
| `VCORE_TASK_CMD_STEP` | `bool stepping` | 单段相关标志 |
| `VCORE_TASK_CMD_HWGUIDANCE` | `bool hw_guidance` | 手轮引导相关标志 |

**字段定义不等于处理规则。**例如 `reset` 为 false 时如何处理、`stepping` 是开关还是某种触发条件，需要看 taskmgr 接收后的业务分支；这两个头文件没有给出那些实现。

所列 `VCORE_TASK_STAT` 的业务字段是：

```cpp
int mode;
char programName[12];
bool running;  // 自动执行运行状态
bool paused;   // 自动执行暂停状态
bool stop;     // 自动运行停止状态
bool reset;    // 自动运行复位状态
bool g99mode;  // 分转进给模式(G98/G99)
```

原始类中**没有 `IsXRadiusPrg`**。后文添加它的内容是接入说明，不是原文件已有行为。

`running`、`paused`、`stop`、`reset` 是不同字段；定义本身没有声明它们必定互斥，也没有规定所有合法组合。

---

<a id="mechanism"></a>
## 3. 类、继承、format 和 update 怎样配合

### 3.1 从一个真实命令类开始

来源：`task_subtype.hh`，仅对排版进行换行。

```cpp
class VCORE_TASK_CMD_SET_MODE : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_SET_MODE()
        : RCS_CMD_MSG(VCORE_TASK_CMD_SET_MODE_TYPE,
                      sizeof(VCORE_TASK_CMD_SET_MODE)) {};

    void update(CMS * cms);
    int mode;
};
```

这几部分各自负责不同事情：

| 代码 | 作用 |
| --- | --- |
| `class VCORE_TASK_CMD_SET_MODE` | 定义一种具体消息类 |
| `: public RCS_CMD_MSG` | 公开继承命令消息基类 |
| `public:` | 后面的构造函数、方法和字段可由外部访问 |
| `RCS_CMD_MSG(..., sizeof(...))` | 在初始化列表中调用基类构造函数，传入具体消息 type 和本类对象大小 |
| `int mode` | 本类携带的业务字段 |
| `void update(CMS *cms)` | 声明本类的字段格式处理方法 |

构造对象时，会先构造基类部分，然后执行本类构造函数体。这里的 `sizeof(VCORE_TASK_CMD_SET_MODE)` 描述 C++ 对象的内存大小，不能仅凭它认定格式化后的消息字节流也一样长。

状态类采用相同的组织方法，但继承的是 `RCS_STAT_MSG`：

```cpp
class VCORE_TASK_STAT : public RCS_STAT_MSG
```

现有资料没有包含这两个基类的完整源码，因此不在这里补写它们的全部成员、内部清零行为或虚函数声明。

### 3.2 继承关系与包含关系分开看

继承在已贴代码中直接可见：

```text
RCS_CMD_MSG   ← VCORE_TASK_CMD_SET_MODE 等命令类
RCS_STAT_MSG  ← VCORE_TASK_STAT、ParamStatMsg 等状态类
```

总体状态的 `task`、`motion` 则是架构描述中的**子对象／包含关系**：

```text
VCORE_STAT
    ├── task
    └── motion
```

“task 状态放在总体状态里”不表示 task 类继承自总体状态类，也不表示两个对象内存地址可以直接互换。

### 3.3 `update(CMS*)`：处理本消息的字段

`task.cc` 中的真实代码：

```cpp
void VCORE_TASK_CMD_SET_MODE::update(CMS * cms)
{
    cms->update(mode);
}
```

`VCORE_TASK_CMD_SET_MODE::` 表示这是该类方法在类外的实现；方法里的 `mode` 就是当前消息对象的成员。

这里没有读取系统参数，也没有切换模式的业务处理。它把消息对象里已经存在的 `mode` 交给 CMS 处理。

状态消息同理：

```cpp
void VCORE_TASK_STAT::update(CMS * cms)
{
    cms->update(mode);
    cms->update(programName, sizeof(programName));
    cms->update(running);
    cms->update(paused);
    cms->update(stop);
    cms->update(reset);
    cms->update(g99mode);
}
```

结合 `nml.md` 的说明，这些方法用于其展示的消息编码／解码过程。同一份字段描述可以用于两个方向；不是“update 永远等于发送”。

在这套格式定义里，新字段需要配套补入所属类的 `update()`。但判断具体运行路径时，仍需查看通道配置和调用链；**进入 `update()` 不等于 UI 已经接收，未观察到它执行也不能单凭这一点认定通道一定失效。**现有资料没有展示所有传输配置下的库内部路径。

### 3.4 为什么 START、PAUSE 的 update 是空的

原代码：

```cpp
void VCORE_TASK_CMD_START::update(CMS* cms)
{

}

void VCORE_TASK_CMD_PAUSE::update(CMS* cms)
{

}
```

对应类没有新增业务字段，所以这里没有字段处理语句。消息类型已经分别表达 START 和 PAUSE。

准确说法是“没有本类新增的业务字段”，不是“消息完全没有任何数据”。其 type 和基类消息部分仍然需要由消息机制处理。

### 3.5 `format()`：根据 type 选择消息类

`task.cc` 的相关分支：

```cpp
case VCORE_TASK_CMD_SET_MODE_TYPE:
    ((VCORE_TASK_CMD_SET_MODE *)buffer)->update(cms);
    break;

case VCORE_TASK_STAT_TYPE:
    ((VCORE_TASK_STAT *)buffer)->update(cms);
    break;
```

函数参数中的 `void *buffer` 是通用地址。分支根据 `type`，把它按对应消息类型解释，再调用该消息的 `update()`。

```text
type＝201
    ↓
把 buffer 按 VCORE_TASK_CMD_SET_MODE 处理
    ↓
VCORE_TASK_CMD_SET_MODE::update(cms)
    ↓
cms->update(mode)
```

强制转换不是重新创建消息，也不会把错误布局自动转换成正确布局。消息 type、实际对象和格式函数必须对应。

完整 `vcore_task_msg_format()` 处理的类型为 101、102、201～207、301。它在未知类型时返回 0，匹配分支后返回 1。这里的 1 表示该格式函数认出了类型，**不是“启动成功”“参数修改成功”或“UI 已收到”的应答。**

这段代码采用 `switch(type)` 显式分派。不能仅凭多个类都有 `update()`，就认定此处靠虚函数自动发现消息类型。

### 3.6 `nml_msg.cc` 并不是所有消息的总分发器

其完整实现只有两个示例方法：

```cpp
void VCORE_FRAME_CMD_1::update(CMS * cms)
{
    cms->update(c);
}

void VCORE_FRAME_STAT_1::update(CMS * cms)
{
    cms->update(c);
}
```

它们的类型 101、102 由 `task.cc` 中的 `vcore_task_msg_format()` 处理。文件名叫 `nml_msg.cc`，不代表所有消息都必须先经过这个文件里的某个总入口。

到这里，可以用一句话串起定义层：

> **类定义业务内容，构造函数指定 type 和 size，format 按 type 分派，update 描述具体字段。业务执行仍在接收方的处理逻辑中。**

---

<a id="parameter"></a>
## 4. 参数消息：统一消息外壳加业务数据区

源码依据：`param_nml_msg.hh` 与 `param_msg.cc`。

### 4.1 Param 与 Task 的组织方式不同

Task 为 SET_MODE、RESET、LOAD 等定义不同消息类和不同 type。参数模块则使用两个统一外壳：

```text
ParamCmdMsg     type＝601
ParamStatMsg    type＝701
```

命令内部再用 `sub_cmd` 区分动作，实际内容放进 `data[]`。

| 字段 | ParamCmdMsg | ParamStatMsg | 从现有源码能说明什么 |
| --- | --- | --- | --- |
| `sub_cmd` | `uint32_t` | 无 | 子命令字段；具体取值未提供 |
| `status` | 无 | `int32_t` | 返回状态字段；错误码含义未提供 |
| `seq` | `uint32_t` | `uint32_t` | 两侧均有序号字段；实际请求／响应匹配由业务代码完成 |
| `data_len` | `uint32_t` | `uint32_t` | 本次交给数组 update 的长度 |
| `data` | `uint8_t[1024]` | `uint8_t[1024]` | 实际业务数据区 |

两种构造函数都把本类的控制字段设为 0，并用 `memset` 清零 `data`。

**初始化 `status＝0` 只能证明初值是 0，不能证明协议规定“0 表示成功”。**同样，两边都有 `seq`，不代表库已经自动完成请求关联。

### 4.2 格式函数只认识两种参数消息

```cpp
int param_msg_format(NMLTYPE type, void *buffer, CMS *cms)
{
    switch (type)
    {
    case VCORE_PARAM_CMD_MSG_TYPE:
        ((ParamCmdMsg *)buffer)->update(cms);
        /* code */
        return 1;
    case VCORE_PARAM_STAT_MSG_TYPE:
        ((ParamStatMsg *)buffer)->update(cms);
        /* code */
        return 1;
    default:
        return 0;
    }
}
```

这里不判断 `sub_cmd`，也不读写数据库。子命令解析属于后面的参数业务处理。

### 4.3 先处理长度，再处理数据

```cpp
void ParamCmdMsg::update(CMS *cms) {
    cms->update(sub_cmd);
    cms->update(seq);
    cms->update(data_len);
    cms->update(data, data_len);
}

void ParamStatMsg::update(CMS *cms) {
    cms->update(status);
    cms->update(seq);
    cms->update(data_len);
    cms->update(data, data_len);
}
```

按照当前方法的调用顺序，命令字段为：

```text
sub_cmd → seq → data_len → data 的前 data_len 个元素
```

状态字段为：

```text
status → seq → data_len → data 的前 data_len 个元素
```

`data` 的类型是字节数组，因此这里的元素数也对应字节数。例如 `data_len＝8` 时，该数组调用处理的是 `data[0]` 到 `data[7]`，不是自动处理全部 1024 字节。

数组容量固定为 1024，当前两个方法中没有可见的长度上界检查。**应检查业务填充和消息解码路径如何拒绝超长数据，不能把“直接截成 1024”当成已经处理了协议错误。**具体错误返回或 CMS 错误设置接口没有提供，本文不补造实现。

### 4.4 参数协议目前能追到哪里

```text
构造 ParamCmdMsg
    ↓ 填入 sub_cmd、seq、data_len、data
写入参数命令通道
    ↓
接收方按 type＝601 识别消息
    ↓
参数业务代码解释 sub_cmd 和 data        ← 当前缺少这一段
    ↓
准备 ParamStatMsg
    ↓
使用状态消息返回结果                  ← 当前缺少实际读写业务函数
```

现有源码尚不能证明 `data[]` 内部采用何种编码，也不能证明 UI 修改某个 Pr 参数时一定使用这套消息。需要继续看 `ParamCmdMsg` 的实际构造、发送和接收处理位置。

---

<a id="server"></a>
## 5. vcoresvr：把消息格式与具体通道绑定

源码依据：`vcoresvr/vcoresvr.cc`。

### 5.1 main 的执行顺序

```text
注册 SIGINT／SIGTERM 处理函数及 atexit 回调
    ↓
hal_init("vcoresvr")
    ↓ 初始化失败则返回
构造 PLC、Task、Param 通道对象
    ↓
hal_ready(comp_id)
    ↓
run_nml_servers()
    ↓ 若该调用返回
main 返回 0
```

这里没有实际处理“执行 START”“写某个参数”等业务分支，也没有循环填充 `VCORE_TASK_STAT` 的代码。

### 5.2 一行构造代码包含四个信息

原代码按参数换行：

```cpp
RCS_STAT_CHANNEL ch0_stat_buf(
    vcore_task_msg_format,
    "ch0-stat",
    "vcoresvr",
    "/userdata/ncstudio/vcore/config/vcore_cfg.nml"
);
```

| 参数 | 这段代码中绑定的内容 |
| --- | --- |
| `vcore_task_msg_format` | 该通道对象使用的消息格式函数 |
| `"ch0-stat"` | buffer 名称 |
| `"vcoresvr"` | 配置使用的进程名称 |
| 配置文件路径 | NML 配置来源 |

于是可以把库内关系连起来：

```text
ch0_stat_buf
    ↓ 绑定
vcore_task_msg_format
    ↓ 当处理 VCORE_TASK_STAT_TYPE 时
VCORE_TASK_STAT::update
    ↓
mode / programName / running / paused / stop / reset / g99mode
```

这条关系证明消息格式如何被选用，**不证明哪个业务进程已经写入了最新状态，也不证明 UI 已经读到。**

### 5.3 原代码构造了哪些通道对象

| buffer 名称 | 原代码中的通道类 | format 函数 |
| --- | --- | --- |
| `plc-cmd` | `RCS_CMD_CHANNEL` | `vcore_plc_msg_format` |
| `plc-stat`、`plc-stat2` | `RCS_STAT_CHANNEL` | `vcore_plc_msg_format` |
| `ch0-cmd`、`ch1-cmd`、`ch2-cmd`、`ch3-cmd` | `RCS_CMD_CHANNEL` | `vcore_task_msg_format` |
| `ch0-stat`、`ch1-stat`、`ch2-stat`、`ch3-stat` | `RCS_STAT_CHANNEL` | `vcore_task_msg_format` |
| `param-cmd` | `RCS_CMD_CHANNEL` | `param_msg_format` |
| `param-stat` | **`RCS_CMD_CHANNEL`** | `param_msg_format` |

这里共构造 13 个对象；其中 Task 对应四组命令／状态 buffer。仅凭这些对象，不能确定现场当前启用了几个加工通道，也不能确定工程的最大通道能力。

最后一行保留原代码事实：参数状态 buffer 使用的是 `RCS_CMD_CHANNEL`，而 `ParamStatMsg` 继承 `RCS_STAT_MSG`。这是值得核对的配套关系，但不能只凭名称直接改成另一种类；需要结合实际通道实现、配置和两端使用方式确认。

### 5.4 vcore_cfg.nml 尚未给出，哪些内容不能确认

当前只知道配置文件路径和构造时使用的名称，尚不知道具体 buffer 大小、进程读写角色、共享内存／远程连接选项、队列方式及服务器配置。

因此，不在教程中虚构一份“可以直接替换”的 `vcore_cfg.nml`，也不把所有读写都画成必须由 `vcoresvr` 在中间逐条转发。该进程实际服务哪些访问路径，要以配置和库实现为准。

另一个需要分开的概念是：项目中的**加工通道**组织解析与执行实例，NML 的**消息通道／buffer**组织消息交换，两者不是同一个 C++ 对象。

### 5.5 退出代码怎样读

```cpp
static void vcoresvr_exit()
{
    rtapi_print_msg(RTAPI_MSG_INFO, "vcoresvr exit\n");
    kill_nml_servers();
    hal_exit(comp_id);
}

static void vcoresvr_quit(int sig)
{
    vcoresvr_exit();
}
```

`main()` 同时注册信号处理函数和 `atexit(vcoresvr_exit)`。原注释说明作者曾遇到 NML 服务退出时未进入预期信号回调，因此增加退出回调。

从本文件还能看到：`daemonize()` 定义了但未被调用；`vcoresvr_quit()` 内没有显式的进程退出调用；通道构造后没有展示有效性检查。是否需要调整这些地方，应单独检查生命周期和库行为，不与新增一个状态字段混为一次修改。

---

<a id="snapshot"></a>
## 6. emcmotStatus 的值从哪里来

### 6.1 先把类型、指针、普通对象区分开

状态定义片段中出现过以下类型名、指针声明和对象声明：

```cpp
// 类型名：描述状态结构。
emcmot_status_t
```

```cpp
// Auto 侧的状态指针。
emcmot_status_t *emcmot_status = &auto_data->emcmotStruct->status;
```

```cpp
// 另一个位置也可能使用这个指针名。
emcmot_status_t *emcmotStatus = &auto_data->emcmotStruct->status;
```

以及：

```cpp
// 普通对象，是否全局要看它实际定义的位置。
emcmot_status_t emcmotStatus;
```

| 写法 | 本质 | 成员访问 |
| --- | --- | --- |
| `emcmot_status_t` | 类型 | 本身不是一份运行状态 |
| `emcmot_status_t *emcmot_status` | 指针 | `emcmot_status->g99mode` |
| `emcmot_status_t *emcmotStatus` | 指针 | `emcmotStatus->g99mode` |
| `emcmot_status_t emcmotStatus` | 对象 | `emcmotStatus.g99mode` |

对于同一实例、同一状态区，两种指针都指向 `&auto_data->emcmotStruct->status` 时，可以通过任一指针访问这份状态。**但不同作用域里的同名变量，不因此变成同一个对象。**

取地址语句只建立指向关系，不会把 Auto 状态复制到另一个进程中的普通变量里，也不会自动把字段发给 UI。

### 6.2 共享状态写入与本地副本获取是两段代码

```text
Auto 侧的问题：谁发布状态？
    emcmot_status->某字段 = 当前执行结果

taskmgr 侧的问题：谁取得状态？
    读取共享状态 → 应用层 emcmotStatus

NML 组装侧的问题：谁填写对外字段？
    stat->某字段 = emcmotStatus.某字段
```

所以看到 `stat->g99mode = emcmotStatus.g99mode`，只证明第三段的赋值。要继续追第二段，应进入项目笔记中的 `VCoreAutoUpdate()`。

### 6.3 nml.md 展示的读取方式是整体复制

`nml.md` 的“为什么需要 memcpy 快照”给出如下片段：

```c
memcpy(s, emcmotStatus, sizeof(emcmot_status_t));
if (s->head == s->tail) {
    return EMCMOT_COMM_OK;
}
```

第一句的阅读顺序是：

```text
源：emcmotStatus 指向的状态
    ↓ 复制 sizeof(emcmot_status_t) 个字节
目标：s 指向的对象
```

这里是在整体复制，不需要对 `g99mode`、`homing_active` 等每个字段分别写赋值。

**这解释了为什么只搜索 `emcmotStatus.g99mode =`，可能找不到状态读取动作。**它也可能通过输出参数传入函数后，在函数内部用 `s` 这样的形参名更新。

不过，摘录没有给出完整读取函数及其调用处，因此不能直接断定 `s` 在 VCore 当前实现中就是某个已确认变量的地址。

### 6.4 head／tail 检查的作用

参考文档先展示写方：

```c
emcmotStatus->head++;
/* 中间更新状态 */
emcmotStatus->tail = emcmotStatus->head;
```

再展示复制后比较：

```c
if (s->head == s->tail) {
    return EMCMOT_COMM_OK;
}
```

原文用这些片段说明读取副本时的一致性检查，并说明不一致时重试。本文保留这个阅读意图，不把摘录当成完整的并发同步实现；实际重试、边界及同步保证要继续看原工程。

### 6.5 回到 VCore，下一步应如何定位

```text
VCoreAutoUpdate()
    ↓
实际状态读取接口
    ↓
emcmotStatus 是否作为输出对象传入
    ↓
接口内部是整块复制还是逐字段更新
    ↓
读取失败时怎样处理，更新结果对应哪个通道
```

在看到这段实现前，不需要另建一条从 taskmgr 直接访问 Auto 私有变量的通路。应先把已有状态取得机制查清楚。

本节源码依据：学习笔记中的状态定义片段，以及 `nml.md` 第 3.3 节。

---

<a id="homing"></a>
## 7. 用 homing_active 走完状态回传的十个环节

本节沿用 `nml.md` 的十环节组织和 `EMC_*` 名称。所列文件路径来自该文档的摘录，不代表已核对当前 VCore 仓库。

### 7.1 源头变量

`src/emc/motion/homing.c`：

```c
static bool homing_active;
```

同一文件中的状态机改变该变量。此时它是模块内部状态，不是 NML 对外字段。

### 7.2 取值接口

`nml.md` 摘录：

```c
static bool base_get_homing_is_active(void) {
    return homing_active;
}
```

```c
bool get_homing_is_active(void)
{ return base_get_homing_is_active(); }
```

```c
EXPORT_SYMBOL(get_homing_is_active);
```

后续发布代码通过接口取得内部状态。

### 7.3 写入共享状态

`src/emc/motion/control.c` 的 `update_status()` 片段：

```c
emcmotStatus->jogging_active = hal_get_bool(emcmot_hal_data->jog_is_active);
emcmotStatus->homing_active = get_homing_is_active();
```

第二句把源值写入共享状态成员。**有字段声明，不等于已经有这一步实时赋值。**

### 7.4 共享结构体定义字段

`src/emc/motion/motion.h`，`emcmot_status_t` 中的字段节选：

```c
bool jogging_active;
bool homing_active; /* homing state machine is running (get_homing_is_active()) */
```

这提供共享状态中的存放位置。它与下一步的 NML 字段是不同对象中的成员。

### 7.5 NML 状态类定义字段

`src/emc/nml_intf/emc_nml.hh`，`EMC_MOTION_STAT` 字段节选：

```cpp
bool jogging_active;
bool homing_active;
uint64_t heartbeat;
```

同名字段不会自动同步，必须有从内部状态到 NML 状态的赋值。

### 7.6 初始化 NML 字段

`src/emc/nml_intf/emcops.cc` 的初始化列表节选：

```cpp
jogging_active(0),
homing_active(false),
heartbeat(0)
```

初始化给出初值，运行中的值仍由状态刷新提供。

### 7.7 字段进入消息格式处理

`src/emc/nml_intf/emc.cc` 的相关语句：

```cpp
cms->update(jogging_active);
cms->update(homing_active);
cms->update(heartbeat);
```

参考例子中字段属于 `EMC_MOTION_STAT`，不是 `EMC_TRAJ_STAT`，所以在对应类的 `update()` 中处理。

### 7.8 应用层副本填入 NML 状态

`src/emc/task/taskintf.cc` 的赋值：

```cpp
stat->jogging_active = emcmotStatus.jogging_active;
stat->homing_active = emcmotStatus.homing_active;
```

原文说明：右侧是 task 本地对象，左侧是 `EMC_MOTION_STAT` 指针。右侧的值怎样取得，见第 6 节的共享状态读取。

### 7.9 写出总体状态

参考文档给出的写出片段：

```cpp
ch0_stat->write(stat);
```

该处文档描述写出的是总体 `EMC_STAT`。它与上一小节的 `stat` 不一定是同一类型，必须按各自函数定义判断。

### 7.10 使用侧按成员层级取值

参考文档给出的 `src/emc/task/emctaskmain.cc` 片段：

```cpp
const bool homing_running = emcStatus->motion.homing_active || any_homing;
```

其中访问路径为 `emcStatus → motion → homing_active`。这行展示字段使用方式，但没有包含完整的 UI 通道创建、`read()`、类型检查和界面刷新实现。

以上十个环节同时包含结构定义和运行动作，不是说程序运行时依次执行十次“声明／初始化”。运行方向可以缩成：

```text
源状态 → 共享状态 → 本地副本 → NML 对象 → 写出 → 使用侧读取
```

### 7.11 总体状态的 update 怎样到达子字段

`nml.md` 展示的总体状态结构为：

```text
EMC_STAT
├── EMC_TASK_STAT task
├── EMC_MOTION_STAT motion
│   ├── EMC_TRAJ_STAT traj
│   ├── EMC_JOINT_STAT joint[N]
│   ├── EMC_AXIS_STAT axis[N]
│   ├── EMC_SPINDLE_STAT spindle[N]
│   └── homing_active 等本层字段
└── EMC_IO_STAT io
```

`EMC_STAT::update()` 的调用节选：

```cpp
EMC_STAT_MSG::update(cms);
task.update(cms);
motion.update(cms);
io.update(cms);
```

所以 `homing_active` 的格式处理链是：

```text
EMC_STAT::update
    ↓ motion.update(cms)
EMC_MOTION_STAT::update
    ↓ cms->update(homing_active)
homing_active
```

外层方法里没有直接出现字段名，不代表字段遗漏；应继续进入对应子对象的 `update()`。

此处示例明确调用了基类和子对象方法，而附录中的简化 `VCORE_TASK_STAT::update()` 只展示本类字段。不要把其中一段的调用机械加到另一段：是否由通道／基类机制处理通用字段，需要查看各自的实际库实现。

---

<a id="new-field"></a>
## 8. 添加 IsXRadiusPrg：把数据来源与消息归属分开

### 8.1 先确定两件事

| 要确定的问题 | 为什么要先确定 |
| --- | --- |
| UI 要的是当前执行生效的值，还是解析器已解析到的值 | 项目笔记把 task 状态描述为命令执行结果；源值应符合实际显示需求 |
| 实际 NML 写出的是独立 Task 消息，还是总体状态 | 决定 format 链和 UI 的成员访问路径 |

`nml.md` 的新增字段例子选择 `EMC_MOTION_STAT`；项目讲解把解释器命令执行结果划入 `VCORE_TASK_STAT`。本文保留两者的范围，不把参考例子直接改名成 VCore 的最终方案。

**经过 `emcmot_status_t` 是取得 Auto 状态的路径；放入 task 或 motion 是对外消息归类。它们不是二选一。**

### 8.2 各层需要完成的动作

以下是根据现有链路整理的接入步骤，不是当前源码已经存在的改动。

| 环节 | 需要补充或确认 |
| --- | --- |
| 源值 | 确认字段的真实保存位置及 0／1 含义，不只按名字猜含义 |
| 内部状态结构 | 若现有结构没有该字段，按项目结构约定增加并初始化 |
| Auto 发布 | 在已确认的状态发布位置写入当前有效值 |
| 状态取得 | 确认该字段进入应用层 `emcmotStatus`；整块复制与逐字段复制分别检查 |
| NML 消息类 | 在选定的状态类增加字段并初始化 |
| 分类填充 | 将应用层值赋给对外消息字段 |
| 格式处理 | 在字段所属类的 `update(CMS*)` 中配套添加 |
| 写出与 UI | 沿实际顶层消息类型写出、接收并读取成员 |

### 8.3 复用已贴 Task 消息时的增量代码

前提：已经确认要扩展的就是所列 `VCORE_TASK_STAT`，且项目约定该字段使用 `bool`。

**消息声明处：**保留原有字段，只增加成员。

```cpp
// 接入示意：添加在实际选定的状态类中。
bool IsXRadiusPrg;
```

构造函数也要按项目约定设置初值；这里不规定 true 一定表示半径或直径，不改动原有 `mode`、`stop`、`reset` 等默认值。

**消息格式处：**在原 `VCORE_TASK_STAT::update()` 的 `g99mode` 后补充。

```cpp
cms->update(g99mode);
cms->update(IsXRadiusPrg);
```

**分类填充处：**当 `stat` 是目标 Task 状态指针、`emcmotStatus` 是已刷新的普通对象时。

```cpp
stat->IsXRadiusPrg = emcmotStatus.IsXRadiusPrg;
```

如果当前函数里定义的是状态指针，就按该处真实变量使用 `->`。不能把两个不同作用域的 `emcmotStatus` 混用。

这三处并没有完成 Auto 的上游发布。源字段尚未进入应用层时，最后一行只是把未更新的值继续复制出去。

### 8.4 format、通道和 UI 是否需要变化

如果只是给原来的消息类补字段，并且不改变消息类型，所列 `vcore_task_msg_format()` 已经有这一分支：

```cpp
case VCORE_TASK_STAT_TYPE:
    ((VCORE_TASK_STAT *)buffer)->update(cms);
    break;
```

因此通常不需要为了同一消息的一个新字段额外增加 `case` 或新建通道。仍须核对新消息布局、配置容量和所有相关读写方版本。

UI 成员路径取决于真正收到什么。以下只是两种不同前提的访问示意，不是完整接收代码：

```cpp
// 前提一：task_status 已正确指向独立的 VCORE_TASK_STAT 消息。
const bool mode_from_task = task_status->IsXRadiusPrg;
```

```cpp
// 前提二：whole_status 已正确指向具有 task 成员的总体状态对象。
const bool mode_from_total = whole_status->task.IsXRadiusPrg;
```

不要把总体状态的缓冲首地址直接当成独立 Task 子对象地址。

这里只处理模态通信。是否据此对某种 X 坐标乘 2，要另行核对坐标字段本身的单位、含义和现有显示规则，不能连带修改所有坐标。

### 8.5 怎样确认真的传到了 UI

按数据方向查看第一个不一致的位置：

| 检查位置 | 应验证什么 | 前一层正确、本层错误时重点查什么 |
| --- | --- | --- |
| Auto 源值 | 当前有效模态是否正确 | 模态的业务更新逻辑 |
| 共享状态字段 | 是否已发布正确值 | 发布赋值、实例／通道选择 |
| `emcmotStatus` | 读取后是否得到同一值 | 读取接口、复制范围、读取失败处理 |
| NML 写出对象 | 发出的实际对象字段是否正确 | 分类填充、顶层对象选择 |
| UI 接收对象 | 正确类型中是否取得变化 | 通道、消息布局、format、读写两端版本 |
| 界面使用 | 是否真正使用该字段刷新 | UI 缓存、映射和显示逻辑 |

进入 `update()`、写入通道、UI 取得字段、界面显示正确，是不同级别的证据。

代码调试应在仿真或不连接执行机构的测试环境完成；不要在实际加工过程中用断点暂停控制进程，也不要在实时循环中持续刷日志。

---

<a id="check"></a>
## 9. 原代码检查点与日常速查

### 9.1 从这七份代码能直接提出的检查点

这些是对所列片段的阅读检查，不是已经修改原工程或验证了现场故障。

| 位置 | 原代码现象 | 应怎样理解／核对 |
| --- | --- | --- |
| `nml_msg.hh` | `#ifndef nml_msg_h` 后没有定义同名宏，而是定义两个其他宏 | 本文件自身的 include guard 不对应；核对是否存在重复包含问题 |
| `task_subtype.hh` | 枚举写 `JOG`，构造函数使用 `OPERATION_MODE_JOG` | 本文件中没有后一个枚举项；是否由其他头文件定义需核对，不能先认定必然编译失败 |
| `VCORE_TASK_STAT` 构造函数 | 显式赋值只看见 `mode`、`reset` | 其他字段的初始化是否由基类或发布前赋值保证，需要继续看实现 |
| LOAD 的 `programName[12]` | 固定长度数组，update 处理 12 个元素 | 不保证末尾自动有 `\0`；完整的 8＋点＋3 个字符加结束符需要 13 个位置，不能未经协议确认就直接扩大数组 |
| `ParamCmdMsg`／`ParamStatMsg` | 按 `data_len` 处理固定容量数组 | 核对发送填充和接收解码的长度保护 |
| `param-stat` | 用 `RCS_CMD_CHANNEL` 构造 | 与消息类继承关系一起检查，但不单凭名字判定修改方案 |
| `vcoresvr` | 退出函数有多种入口，且初始化失败也会结束 main | 核对清理是否允许重复调用，以及失败时是否跳过无效组件清理 |
| 通道对象构造后 | 本文件没有展示有效性检查 | `hal_ready()` 不能代替对所有 NML 通道状态的核对 |

共享结构和消息类发生变化时，要统一更新实际使用这些布局的生产者、消费者和格式处理模块。不能只替换一侧头文件或只替换 UI。具体哪些二进制必须重新构建，要看当前工程依赖关系。

### 9.2 日常只按问题找到对应位置

| 问题 | 第一定位点 |
| --- | --- |
| 不知道消息编号 | `nml_msg.hh` |
| 不知道消息里有什么字段 | 对应 `.hh` 类定义 |
| 不知道某个 type 用哪个类处理 | 对应 format 的 `switch(type)` |
| 不知道字段如何被格式化 | 字段所属类的 `update(CMS*)` |
| 不知道通道使用哪个 format | 通道构造的第一个参数 |
| 不知道状态从哪里取得 | `VCoreAutoUpdate()` 及其实际读取接口 |
| 不知道对外字段从哪里赋值 | 分类填充函数及 `stat` 的真实类型 |
| 不知道 UI 为什么没变化 | 对照第 8.5 节逐层比较，找第一个不一致点 |

当前仍缺少 PLC 三份正文、`vcore_cfg.nml` 配置正文，以及 taskmgr 顶层状态读写／共享状态读取函数的完整实现。本文没有把缺失部分补成假定的可运行代码。

## 最后记住这一条线

```text
.hh：定义消息内容
    ↓
format / update：定义消息怎样处理
    ↓
vcoresvr：把格式函数绑定到通道并运行服务

Auto：产生并发布执行结果
    ↓
状态读取接口：取得应用层副本
    ↓
分类更新函数：把值填进对外消息
    ↓
NML 写出、UI 读取：完成对外状态传递
```

**消息格式定义回答“能够传什么、怎样处理”；运行中的赋值和读写回答“这一次实际传了什么、谁已经收到”。**

### 资料说明

本文依据项目架构讲解、状态分类与更新函数笔记、附录收录的七份 VCore 源码，以及学习资料 `nml.md` 中的 `homing_active` 源码摘录整理。参考文档不是完整仓库源码；没有展示的函数内部细节不作确定结论。以下附录保留原始代码中的命名、字段、注释及可疑写法，便于与正文核对。

---

<a id="original-source"></a>
## 附录：七份消息与服务源码

阅读正文即可理解流程；需要逐行对照时再展开对应文件。在不支持折叠的 Markdown 阅读器中，可直接查看下方代码块。

这些是学习时收集的源码正文，不是包含 `IsXRadiusPrg` 的新版本，也不表示已核对当前工程分支。

<details>
<summary>A1　include/nml_msg.hh</summary>

```cpp
#ifndef nml_msg_h
#define NML_MESSAGE_H_20260316
#define NML_MESSAGE_H_20260316_

#include "rcs.hh"
#include "cms.hh"         // class CMS
#include "nml.hh"         // class NML
#include "nmlmsg.hh"      // class NMLmsg
#include "cmd_msg.hh"     // class NMLcmdmsg
#include "stat_msg.hh"    // class NMLmsg

// 1 - 100 NML reserved

// 101 - 199 vcore frame reserved
#define VCORE_FRAME_CMD_1_TYPE          ((NMLTYPE)101)              // 命令示例
#define VCORE_FRAME_STAT_1_TYPE         ((NMLTYPE)102)              // 状态示例

// 200 - 299 taskmgr cmd message
#define VCORE_TASK_CMD_BASE_TYPE        ((NMLTYPE)200)
#define VCORE_TASK_CMD_SET_MODE_TYPE    (VCORE_TASK_CMD_BASE_TYPE + 1)    // 模式切换
#define VCORE_TASK_CMD_RESET_TYPE       (VCORE_TASK_CMD_BASE_TYPE + 2)    // 模式切换
#define VCORE_TASK_CMD_LOAD_TYPE        (VCORE_TASK_CMD_BASE_TYPE + 3)    // 载入加工文件
#define VCORE_TASK_CMD_START_TYPE       (VCORE_TASK_CMD_BASE_TYPE + 4)    // 开始
#define VCORE_TASK_CMD_PAUSE_TYPE       (VCORE_TASK_CMD_BASE_TYPE + 5)    // 暂停
#define VCORE_TASK_CMD_STEP_TYPE        (VCORE_TASK_CMD_BASE_TYPE + 6)    // 单段执行
#define VCORE_TASK_CMD_HWGUIDANCE_TYPE   (VCORE_TASK_CMD_BASE_TYPE + 7)    // 手轮引导

// 300 - 399 taskmgr status message
#define VCORE_TASK_STAT_BASE_TYPE       ((NMLTYPE)300)
#define VCORE_TASK_STAT_TYPE            (VCORE_TASK_STAT_BASE_TYPE + 1)    // taskmgr状态

// 400 - 499 plc cmd message
#define VCORE_PLC_CMD_BASE_TYPE         ((NMLTYPE)400)
#define VCORE_PLC_CMD_DOWNLOAD_TYPE     (VCORE_PLC_CMD_BASE_TYPE + 1)      // 梯形图下载
#define VCORE_PLC_CMD_PARAM_TYPE        (VCORE_PLC_CMD_BASE_TYPE + 2)      // 参数设置
#define VCORE_PLC_CMD_RUN_TYPE           (VCORE_PLC_CMD_BASE_TYPE + 3)      // 梯形图执行

// 500 - 599 plc status message
#define VCORE_PLC_STAT_BASE_TYPE        ((NMLTYPE)500)
#define VCORE_PLC_STAT_DATA_TYPE        (VCORE_PLC_STAT_BASE_TYPE + 1)     // PLC数据
#define VCORE_PLC_STAT_ACK_TYPE         (VCORE_PLC_STAT_BASE_TYPE + 2)     // PLC数据应答

// 600 - 699 parameter cmd message
#define VCORE_PARAM_CMD_BASE_TYPE       ((NMLTYPE)600)
#define VCORE_PARAM_CMD_MSG_TYPE        (VCORE_PARAM_CMD_BASE_TYPE + 1)

// 700 - 799 parameter status message
#define VCORE_PARAM_STAT_BASE_TYPE      ((NMLTYPE)700)
#define VCORE_PARAM_STAT_MSG_TYPE       (VCORE_PARAM_STAT_BASE_TYPE + 1)

extern int vcore_plc_msg_format(NMLTYPE type, void *buffer, CMS *cms);
extern int vcore_task_msg_format(NMLTYPE type, void *buffer, CMS *cms);
extern int param_msg_format(NMLTYPE type, void *buffer, CMS *cms);

class VCORE_FRAME_CMD_1 : public RCS_CMD_MSG
{
public:
    VCORE_FRAME_CMD_1() : RCS_CMD_MSG(VCORE_FRAME_CMD_1_TYPE, sizeof(VCORE_FRAME_CMD_1)){};

    // For internal NML/CMD use only.
    void update(CMS * cms);
    char c;
};

class VCORE_FRAME_STAT_1 : public RCS_STAT_MSG
{
public:
    VCORE_FRAME_STAT_1() : RCS_STAT_MSG(VCORE_FRAME_STAT_1_TYPE, sizeof(VCORE_FRAME_STAT_1)){};

    // For internal NML/CMS use only.
    void update(CMS * cms);
    char c;
};

#endif
```

</details>

<details>
<summary>A2　include/task_subtype.hh</summary>

```cpp
#ifndef TASK_SUBTYPE_HH
#define TASK_SUBTYPE_HH

#include "nml_msg.hh"

enum OPERATION_MODE
{
    EDIT = 1,
    AUTO = 2,
    MDI = 3,
    JOG = 4,
    INC = 5,
    HND = 6,
    REF = 7
};

class VCORE_TASK_CMD_SET_MODE : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_SET_MODE() : RCS_CMD_MSG(VCORE_TASK_CMD_SET_MODE_TYPE, sizeof(VCORE_TASK_CMD_SET_MODE)){};

    // For internal NML/CMD use only.
    void update(CMS * cms);

    int mode;
};

class VCORE_TASK_CMD_RESET : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_RESET() : RCS_CMD_MSG(VCORE_TASK_CMD_RESET_TYPE, sizeof(VCORE_TASK_CMD_RESET)){};

    // For internal NML/CMD use only.
    void update(CMS * cms);

    bool reset;
};

class VCORE_TASK_CMD_LOAD : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_LOAD() : RCS_CMD_MSG(VCORE_TASK_CMD_LOAD_TYPE, sizeof(VCORE_TASK_CMD_LOAD)) {};

    // For internal NML/CMD use only.
    void update(CMS * cms);

    char programName[12]; // 程序名(8.3格式)
};

class VCORE_TASK_CMD_START : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_START() : RCS_CMD_MSG(VCORE_TASK_CMD_START_TYPE, sizeof(VCORE_TASK_CMD_START)) {};

    // For internal NML/CMD use only.
    void update(CMS * cms);
};

class VCORE_TASK_CMD_PAUSE : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_PAUSE() : RCS_CMD_MSG(VCORE_TASK_CMD_PAUSE_TYPE, sizeof(VCORE_TASK_CMD_PAUSE)) {};

    // For internal NML/CMD use only.
    void update(CMS * cms);
};

class VCORE_TASK_CMD_STEP : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_STEP() : RCS_CMD_MSG(VCORE_TASK_CMD_STEP_TYPE, sizeof(VCORE_TASK_CMD_STEP)) {};

    // For internal NML/CMD use only.
    void update(CMS * cms);

    bool stepping;
};

class VCORE_TASK_CMD_HWGUIDANCE : public RCS_CMD_MSG
{
public:
    VCORE_TASK_CMD_HWGUIDANCE() : RCS_CMD_MSG(VCORE_TASK_CMD_HWGUIDANCE_TYPE, sizeof(VCORE_TASK_CMD_HWGUIDANCE)) {};

    // For internal NML/CMD use only.
    void update(CMS * cms);

    bool hw_guidance;
};

class VCORE_TASK_STAT : public RCS_STAT_MSG
{
public:
    VCORE_TASK_STAT() : RCS_STAT_MSG(VCORE_TASK_STAT_TYPE, sizeof(VCORE_TASK_STAT)) { mode = OPERATION_MODE_JOG; reset = true; };

    // For internal NML/CMS use only.
    void update(CMS * cms);

    int mode;
    char programName[12];
    bool running;  // 自动执行运行状态
    bool paused;   // 自动执行暂停状态
    bool stop;     // 自动运行停止状态
    bool reset;    // 自动运行复位状态
    bool g99mode;  // 分转进给模式(G98/G99)
};

#endif
```

</details>

<details>
<summary>A3　include/param_nml_msg.hh</summary>

```cpp
#ifndef PARAM_NML_HH
#define PARAM_NML_HH

#include "nml_msg.hh"
#include <cstring>

#define PARAM_NML_DATA_MAX 1024

// 格式函数声明
extern int param_msg_format(NMLTYPE type, void *buffer, CMS *cms);

// 命令消息类
class ParamCmdMsg : public RCS_CMD_MSG {
public:
    ParamCmdMsg() : RCS_CMD_MSG(VCORE_PARAM_CMD_MSG_TYPE, sizeof(ParamCmdMsg)) {
        sub_cmd = 0;
        seq = 0;
        data_len = 0;
        memset(data, 0, sizeof(data));
    }
    void update(CMS *cms);
    uint32_t sub_cmd;
    uint32_t seq;
    uint32_t data_len;
    uint8_t data[PARAM_NML_DATA_MAX];
};

// 状态消息类
class ParamStatMsg : public RCS_STAT_MSG {
public:
    ParamStatMsg() : RCS_STAT_MSG(VCORE_PARAM_STAT_MSG_TYPE, sizeof(ParamStatMsg)) {
        status = 0;
        seq = 0;
        data_len = 0;
        memset(data, 0, sizeof(data));
    }
    void update(CMS *cms);
    int32_t status;
    uint32_t seq;
    uint32_t data_len;
    uint8_t data[PARAM_NML_DATA_MAX];
};

#endif
```

</details>

<details>
<summary>A4　src/nml_msg.cc</summary>

```cpp
#include "nml_msg.hh"

void VCORE_FRAME_CMD_1::update(CMS * cms)
{
    cms->update(c);
}

void VCORE_FRAME_STAT_1::update(CMS * cms)
{
    cms->update(c);
}
```

</details>

<details>
<summary>A5　src/task.cc</summary>

```cpp
#include "task_subtype.hh"

// 格式化函数(NML 必需)
int vcore_task_msg_format(NMLTYPE type, void *buffer, CMS *cms)
{
    switch(type)
    {
    case VCORE_FRAME_CMD_1_TYPE:
        ((VCORE_FRAME_CMD_1 *)buffer)->update(cms);
        break;
    case VCORE_FRAME_STAT_1_TYPE:
        ((VCORE_FRAME_STAT_1 *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_SET_MODE_TYPE:
        ((VCORE_TASK_CMD_SET_MODE *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_RESET_TYPE:
        ((VCORE_TASK_CMD_RESET *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_LOAD_TYPE:
        ((VCORE_TASK_CMD_LOAD *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_START_TYPE:
        ((VCORE_TASK_CMD_START *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_PAUSE_TYPE:
        ((VCORE_TASK_CMD_PAUSE *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_STEP_TYPE:
        ((VCORE_TASK_CMD_STEP *)buffer)->update(cms);
        break;
    case VCORE_TASK_CMD_HWGUIDANCE_TYPE:
        ((VCORE_TASK_CMD_HWGUIDANCE*)buffer)->update(cms);
        break;
    case VCORE_TASK_STAT_TYPE:
        ((VCORE_TASK_STAT *)buffer)->update(cms);
        break;
    default:
        return 0;
    }
    return 1;
}

void VCORE_TASK_CMD_SET_MODE::update(CMS * cms)
{
    cms->update(mode);
}

void VCORE_TASK_CMD_RESET::update(CMS* cms)
{
    cms->update(reset);
}

void VCORE_TASK_CMD_LOAD::update(CMS* cms)
{
    cms->update(programName, 12);
}

void VCORE_TASK_CMD_START::update(CMS* cms)
{

}

void VCORE_TASK_CMD_PAUSE::update(CMS* cms)
{

}

void VCORE_TASK_CMD_STEP::update(CMS* cms)
{
    cms->update(stepping);
}

void VCORE_TASK_CMD_HWGUIDANCE::update(CMS* cms)
{
    cms->update(hw_guidance);
}

void VCORE_TASK_STAT::update(CMS * cms)
{
    cms->update(mode);
    cms->update(programName, sizeof(programName));
    cms->update(running);
    cms->update(paused);
    cms->update(stop);
    cms->update(reset);
    cms->update(g99mode);
}
```

</details>

<details>
<summary>A6　src/param_msg.cc</summary>

```cpp
#include "param_nml_msg.hh"

int param_msg_format(NMLTYPE type, void *buffer, CMS *cms)
{
    switch (type)
    {
    case VCORE_PARAM_CMD_MSG_TYPE:
        ((ParamCmdMsg *)buffer)->update(cms);
        /* code */
        return 1;
    case VCORE_PARAM_STAT_MSG_TYPE:
        ((ParamStatMsg *)buffer)->update(cms);
        /* code */
        return 1;
    default:
        return 0;
    }
}

void ParamCmdMsg::update(CMS *cms) {
    cms->update(sub_cmd);
    cms->update(seq);
    cms->update(data_len);
    cms->update(data, data_len);
}

void ParamStatMsg::update(CMS *cms) {
    cms->update(status);
    cms->update(seq);
    cms->update(data_len);
    cms->update(data, data_len);
}
```

</details>

<details>
<summary>A7　vcoresvr/vcoresvr.cc</summary>

```cpp
#include <signal.h>

#include "rcs.hh"
#include "nml_msg.hh"
#include <iostream>
#include "timer.hh"
#include "cms.hh"
#include "nml.h"
#include "nml_srv.h"

#include "hal.h"    /* HAL public API decls */
#include "rtapi.h"

static int comp_id;

// based on code from
// https://microhowto.info/howto/cause_a_process_to_become_a_daemon_in_c.html
static void daemonize()
{
    pid_t pid = fork();
    if (pid < 0) {
        perror("daemonize: fork0");
    } else if (pid) {
        _exit(0);
    }

    if(setsid() < 0)
        perror("daemonize: setsid()");

    // otherwise the parent may deliver a SIGHUP to this process when it
    // terminates
    signal(SIGHUP, SIG_IGN);

    pid = fork();
    if (pid < 0) {
        perror("daemonize: fork() 2");
    } else if (pid) {
        _exit(0);
    }
}

static void vcoresvr_exit()
{
    rtapi_print_msg(RTAPI_MSG_INFO, "vcoresvr exit\n");
    kill_nml_servers();
    hal_exit(comp_id);
}

static void vcoresvr_quit(int sig)
{
    vcoresvr_exit();
}

int main(int argc, char *argv[])
{
    // trap ctrl+C kill
    signal(SIGINT, vcoresvr_quit);
    signal(SIGTERM, vcoresvr_quit);
    // run nml_servers 遇到中断信号后直接退出了，程序没有进到vcoresvr_quit函数，所以在atexit中处理
    atexit(vcoresvr_exit);

    comp_id = hal_init("vcoresvr");
    if (comp_id < 0)
    {
        rtapi_print_msg(RTAPI_MSG_ERR, "vcoresvr: ERROR: hal_init failed, comp_id:%d\n", comp_id);
        return -1;
    }

    RCS_CMD_CHANNEL plc_cmd_buf(vcore_plc_msg_format, "plc-cmd", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_CMD_CHANNEL ch0_cmd_buf(vcore_task_msg_format, "ch0-cmd", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_CMD_CHANNEL ch1_cmd_buf(vcore_task_msg_format, "ch1-cmd", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_CMD_CHANNEL ch2_cmd_buf(vcore_task_msg_format, "ch2-cmd", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_CMD_CHANNEL ch3_cmd_buf(vcore_task_msg_format, "ch3-cmd", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_CMD_CHANNEL p_cmd_channel(param_msg_format, "param-cmd", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");

    RCS_STAT_CHANNEL plc_stat_buf(vcore_plc_msg_format, "plc-stat", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_STAT_CHANNEL plc_stat2_buf(vcore_plc_msg_format, "plc-stat2", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_STAT_CHANNEL ch0_stat_buf(vcore_task_msg_format, "ch0-stat", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_STAT_CHANNEL ch1_stat_buf(vcore_task_msg_format, "ch1-stat", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_STAT_CHANNEL ch2_stat_buf(vcore_task_msg_format, "ch2-stat", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_STAT_CHANNEL ch3_stat_buf(vcore_task_msg_format, "ch3-stat", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");
    RCS_CMD_CHANNEL p_stat_channel(param_msg_format, "param-stat", "vcoresvr", "/userdata/ncstudio/vcore/config/vcore_cfg.nml");

    // std::cout << "vcoresvr start" << std::endl;
    hal_ready(comp_id);

    run_nml_servers();

    return 0;
}
```

</details>
