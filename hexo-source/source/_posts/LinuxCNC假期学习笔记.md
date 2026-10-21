---
title: LinuxCNC 假期学习笔记：HAL、NML、CMake 与 EtherCAT
date: "2026-10-22 00:01:00"
permalink: /2026/10/22/LinuxCNC假期学习笔记/
tags:
  - LinuxCNC
  - HAL
  - NML
  - CMake
  - EtherCAT
categories:
  - 技术笔记
cover: /image/covers/linuxcnc-holiday-study.jpg
description: 从 HAL 引脚、信号和实时线程入手，通过自定义组件与 NML 收发实验，串起 CMake 构建、EtherCAT 接入及七天学习练习，附常见问题排查表。
---

# LinuxCNC 假期学习笔记：HAL、NML、CMake 与 EtherCAT

> 围绕控制数据与操作命令，串起 HAL 配置、组件开发、NML 通信、CMake 构建和 EtherCAT 入门。

学习 LinuxCNC，可以先围绕两个问题展开：控制数据如何在组件之间流动，一条操作命令如何在进程之间传递。前者会把我们带到 HAL、实时线程和硬件驱动，后者会涉及 NML、消息定义和共享内存。CMake 帮助我们把程序构建起来，EtherCAT 则把软件中的控制量与现场设备连接起来。

本文按这条思路整理概念和实验。读完后，应当能看懂一份基本的 HAL 配置，编写一个简单的实时组件，理解 NML 的收发流程，并知道接入 EtherCAT 前需要准备什么。

文中的 HAL 与 NML 示例以 LinuxCNC 2.9 系列接口为学习基线，命令在已安装相应开发环境的 Linux 系统中执行。图形工具需要桌面环境；软件实验先使用独立 HAL 会话，不连接实际执行机构。EtherCAT 部分介绍接入方法，具体配置由设备、主站及驱动版本决定。

<!-- more -->

## 阅读导航

| 学习目标 | 阅读位置 |
| --- | --- |
| 理清 HAL、NML、CMake 与 EtherCAT 的职责 | [一：整体认识](#overview) |
| 看懂引脚、信号与实时线程 | [二：HAL 基础](#hal-basics) |
| 跑通信号发生器并观察数据 | [三：最小实验](#hal-experiment)、[四：观察工具](#hal-tools) |
| 编写比例计算组件并连接信号 | [五：自定义组件](#custom-component) |
| 定义消息、配置通道并收发数据 | [六：NML 通信](#nml) |
| 构建发送端与接收端 | [七：CMake](#cmake) |
| 理解现场设备的数据映射与同步 | [八：EtherCAT](#ethercat) |
| 安排练习并排查常见问题 | [九：学习练习](#practice)、[十：问题速查](#troubleshooting) |

<a id="overview"></a>

## 一 先了解各部分负责什么

先把几个容易混在一起的概念放到同一张表里。

| 内容 | 主要职责 | 学习时要回答的问题 |
| --- | --- | --- |
| HAL | 将组件的输入输出组织成信号网络 | 谁产生数据，谁读取数据 |
| 实时线程 | 按周期和顺序调用实时函数 | 多久执行一次，先执行哪个函数 |
| NML | 在进程间传递具有类型的消息 | 消息如何定义，双方如何访问通道 |
| CMake | 描述目标及其编译和链接依赖 | 源文件在哪里，头文件和库如何找到 |
| EtherCAT | 与现场设备交换过程数据及配置数据 | 软件变量如何对应设备对象与通道 |

在 LinuxCNC 中，界面、Task、运动控制与硬件驱动各有职责。界面与 Task 之间可以使用 NML；Task 与实时运动控制之间还有专门的共享内存通信机制；实时运动控制通过 HAL 与驱动交换控制量和反馈量。不能把整套架构简单理解成“所有通信都经过 NML”。相关职责可对照官方 [INI 配置中的 Task 说明](https://linuxcnc.org/docs/2.9/html/config/ini-config.html#sub:ini:sec:task) 和 [架构与运动控制说明](https://linuxcnc.org/docs/2.9/html/code/code-notes.html#_architecture_overview)。

可以用下面的简图帮助定位，图中的双向连接只表示存在命令和状态交换，不表示它们使用同一条消息通道。

```text
界面  <-->  Task 与解释器        NML 命令与状态
Task  <-->  实时运动控制         专用共享内存等机制
运动控制  <-->  HAL 驱动         引脚与信号
HAL 驱动  <-->  现场设备         板卡或 EtherCAT 等接口
```

HAL 也包含用户态组件。某个程序使用 HAL 还是 NML，取决于它需要交换的数据形式和接口职责，不能只按“是否属于界面”或“是否跨进程”判断。

<a id="hal-basics"></a>

## 二 理解 HAL 的数据连接和执行顺序

### 认识五个基本对象

HAL 是 Hardware Abstraction Layer，即硬件抽象层。对使用者而言，它提供了一种按名字连接软件接口的方式。一个组件可以读取传感器，也可以只做比例换算、逻辑运算或滤波。

| 对象 | 含义 | 例子 |
| --- | --- | --- |
| component | 提供引脚、参数或函数的组件 | `siggen`、`pid` |
| pin | 组件的数据接口 | `siggen.0.sine` |
| signal | 连接引脚的具名数据值 | 自定义的 `test-sine` |
| parameter | 组件暴露的配置或观察项 | 自定义组件的 `gain` 参数 |
| function 与 thread | 被周期调用的函数及其执行线程 | `siggen.0.update` 与 `test-thread` |

常见数据类型包括 `bit`、`s32`、`u32` 和 `float`，分别用于布尔值、有符号整数、无符号整数和浮点值。连接到同一信号的引脚需要类型一致。

引脚方向是相对于组件定义的。`OUT` 表示组件写出数据，`IN` 表示组件读取数据，`IO` 表示接口允许按组件约定双向使用。硬件输入驱动读取到一个开关后，向 HAL 提供的通常是 `OUT` 引脚；名称中的“输入”描述物理方向，两者并不矛盾。

### 用 net 连接引脚

典型的数据连接可以写成：

```hal
net test-sine siggen.0.sine => mytest.0.in
```

这里，`test-sine` 是信号名，`siggen.0.sine` 是写入端，`mytest.0.in` 是读取端。一个信号可以连接多个读取端。对于普通的 `OUT` 与 `IN` 连接，一个信号最多有一个 `OUT` 写入端；将多个输出连在一起不会自动实现逻辑或运算，需要显式使用逻辑组件。

`=>`、`<=` 等箭头用于说明阅读方向，不会改变引脚自身的方向，也不决定执行顺序。涉及 `IO` 引脚时还有额外的连接限制，不能把它当成任意多写入端的总线。连接规则见官方 [HAL Basics](https://linuxcnc.org/docs/2.9/html/hal/basic-hal.html#_net)。

HAL 中的 signal 也不是 Linux 的进程信号。它不是“每次变化就发送一次通知”的消息，而是组件共同访问的数据值。普通 pin 与 signal 适合传递当前值，不会自动保留每次变化的历史。

### 用线程决定函数何时执行

`loadrt` 加载实时组件，`addf` 把组件导出的函数加入线程，`start` 启动周期执行。这三个动作作用不同，加载成功后仍要检查函数是否已经加入运行中的线程。

例如，在独立 HAL 实验中创建一个支持浮点运算的线程：

```hal
loadrt threads name1=test-thread period1=1000000 fp1=1
```

`period1` 的单位是纳秒，`1000000 ns` 等于 `1 ms`，对应名义上的 `1000 Hz` 调用频率。实际能否稳定满足周期，还取决于实时环境和负载。`fp1=1` 显式启用浮点支持，适合后面的信号发生器和乘法组件实验。参数定义见 [threads 手册](https://linuxcnc.org/docs/2.9/html/man/man9/threads.9.html)。

同一线程中的函数按加入位置执行。假设先更新信号源，再计算比例输出：

```hal
addf siggen.0.update test-thread
addf mytest.0 test-thread
```

在这个单线程实验中，`mytest.0` 可以读取本周期刚更新的输入。如果交换顺序，它通常会使用上一次保留下来的输入。跨线程的数据时序还受周期、优先级和调度影响，不能只靠两条配置语句的先后推断同步关系。

### 区分实时与用户态

`loadusr` 启动用户态程序，适用于界面、监视、文件访问等不要求硬实时执行的工作。用户态组件也能创建 HAL 引脚，与实时组件交换数据。HAL 的共享内存结构支持这种访问，因此“HAL 只能在同一进程里通信”并不准确。[HAL API 介绍](https://linuxcnc.org/docs/html/man/man3/intro.3hal.html) 对两类组件及共享数据有明确说明。

还要区分“用户态实时实现”和“普通非实时程序”。例如在 PREEMPT_RT 配置中，某些通过 `loadrt` 加载的组件运行在用户空间，但仍属于实时执行体系。`loadrt` 不等于所有情况下都加载内核模块。

<a id="hal-experiment"></a>

## 三 用一个最小实验熟悉 HAL

### 启动独立环境

在 Linux 终端运行：

```bash
halrun
```

出现 `halcmd:` 后，输入的是 HAL 命令，此时不需要再加 `halcmd` 前缀。下面的配置创建信号发生器，并以 1 ms 周期更新：

```hal
loadrt threads name1=test-thread period1=1000000 fp1=1
loadrt siggen num_chan=1
setp siggen.0.frequency 1
setp siggen.0.amplitude 1
setp siggen.0.offset 0
addf siggen.0.update test-thread
start
```

随后查看对象和数值：

```hal
show comp
show pin siggen
show param
show funct
show thread
getp siggen.0.sine
```

多次读取 `siggen.0.sine`，数值应随时间变化。频率设置为 `1 Hz`，意味着波形约每秒重复一次。把幅值改为 `5` 后，零偏置正弦波的范围应接近 `-5` 到 `5`。

```hal
setp siggen.0.amplitude 5
```

这里的 `amplitude` 在 LinuxCNC 2.9 中是输入引脚，不应仅因它“用于设置幅值”就称为 parameter。判断对象类型，应以 `show pin`、`show param` 和组件手册为准。相关接口见 [siggen 手册](https://linuxcnc.org/docs/2.9/html/man/man9/siggen.9.html)。

### 理解 setp 和 sets

`setp` 可以修改可写参数，也可以给未连接信号的输入引脚赋值。输出引脚由组件产生，已经接到信号上的引脚也不能再用 `setp` 单独覆盖。

如果要给没有写入端的信号设置值，可以使用 `sets`。一旦该信号存在写入端，就应由写入端更新数据。`setp`、`sets` 和 `net` 的作用应分开理解，不能把它们都当成普通变量赋值。

在另一个 Linux 终端操作已有 HAL 环境时，需要使用前缀：

```bash
halcmd show pin siggen
halcmd getp siggen.0.sine
```

这些命令连接已有环境；`halrun` 则负责实验环境的建立和清理。不要把启动第二个独立实验会话当成查询已有配置的方法。

阅读 PID 配置时，也可以沿用这个方法。例如，在已经创建 `test-thread` 的独立实验中：

```hal
loadrt pid names=pid.x
setp pid.x.Pgain 100
setp pid.x.Igain 0.1
addf pid.x.do-pid-calcs test-thread
```

`names=pid.x` 指定实例名，`do-pid-calcs` 是实际的导出函数名，`Pgain` 和 `Igain` 的大小写应保持准确。这些数值只用于演示配置语法；要形成控制回路，还需要命令、反馈、使能和输出的连接，并依据对象进行整定。接口见 [PID 手册](https://linuxcnc.org/docs/2.9/html/man/man9/pid.9.html)。

### 保存并重新加载配置

从另一个 Linux 终端导出当前配置：

```bash
halcmd save allu > saved.hal
```

相比 `save all`，`allu` 还会保存未连接输入引脚的赋值。保存结果适合检查和整理，仍应人工确认用户态程序的启动命令、执行入口及其他项目配置是否齐全。它不会替代完整的 LinuxCNC INI 配置、外部文件和硬件说明。保存项定义见 [halcmd 手册](https://linuxcnc.org/docs/2.9/html/man/man1/halcmd.1.html)。

先在原 `halcmd:` 会话输入 `exit` 结束实验，再执行：

```bash
halrun -I -f saved.hal
```

`-I` 使文件执行完后保留交互会话。如果导出的文件没有 `start`，需在 `halcmd:` 下补上。只运行 `halrun -f saved.hal` 时，文件处理完毕后环境会被清理，不能期待它一直在后台运行。[halrun 手册](https://linuxcnc.org/docs/2.9/html/man/man1/halrun.1.html) 说明了这一生命周期。

正常结束使用 `exit`。`halrun -U` 属于强制清理实时环境的手段，应在确认环境异常且没有正在工作的机床配置时使用。

<a id="hal-tools"></a>

## 四 用工具观察信号

完成最小实验后，再使用图形工具观察数据，比直接面对整机配置更容易定位问题。

| 工具 | 适合观察的内容 | 典型用途 |
| --- | --- | --- |
| halmeter | 某个对象的当前值 | 查看使能、输入状态或数值 |
| halshow | 组件、引脚、信号、函数和线程 | 查连接关系并建立监视列表 |
| halscope | 随时间变化的数据 | 比较波形、延迟和触发时刻 |

在已有 `halcmd:` 会话中可运行：

```hal
loadusr halmeter
loadusr halshow
loadusr halscope
```

`halshow` 用于查结构，`halmeter` 用于读当前值，`halscope` 用于看时间变化。HAL 数字量若变化很快，图形刷新可能看不见每个脉冲；此时应使用采样工具，而不能据此判断“信号从未变化”。

另一种常见调用是 `loadusr halscope 80000`。其中 `80000` 是采样缓冲区的样本数参数，并非直接把采样频率设成 80 kHz。采样时间尺度取决于采样线程和相应设置。命令格式及工具说明见 [HAL Tools](https://linuxcnc.org/docs/2.9/html/hal/tools.html)。

排查“不更新”时，可以依次确认：对象是否存在、函数是否出现在 `show funct` 中、函数是否加入正确线程、线程是否已启动、输入信号是否确实变化。若涉及浮点函数，还要检查线程是否支持浮点运算。

<a id="custom-component"></a>

## 五 编写并连接一个自定义 HAL 组件

### 先用 comp 文件完成比例计算

一个合适的入门目标是让输出等于输入乘以增益。新建 `mytest.comp`：

```c
component mytest "Scale an input by a configurable gain";
pin in float in;
pin out float out;
param rw float gain = 2.0;
function _;
license "GPL";
;;

FUNCTION(_) {
    out = in * gain;
}
```

文件名与 `component` 名称保持一致。`;;` 之前是组件声明，之后是 C 函数实现。`function _;` 导出的默认实例函数名是 `mytest.0`；引脚名是 `mytest.0.in` 和 `mytest.0.out`。

`.comp` 是 `halcompile` 的生成器输入，并不是直接交给普通 C 编译器的完整源文件。生成器会完成重复的注册代码。若声明中使用下划线，生成后的 HAL 名称还可能转换成连字符，应以实际导出结果为准。语法与命名规则见 [HAL Component Generator](https://linuxcnc.org/docs/2.9/html/hal/comp.html)。

### 编译后验证固定输入

对于使用 `linuxcnc-uspace` 软件包的开发环境，可安装匹配的开发包，并安装组件：

```bash
sudo apt install linuxcnc-uspace-dev
sudo halcompile --install mytest.comp
```

开发包需要与已安装的 LinuxCNC 类型和版本匹配；RIP 源码环境还应先加载其环境脚本，安装组件时通常不需要 `sudo`。具体选项见 [halcompile 手册](https://linuxcnc.org/docs/2.9/html/man/man1/halcompile.1.html)。

另起一个独立 `halrun` 会话，在 `halcmd:` 下输入：

```hal
loadrt threads name1=test-thread period1=1000000 fp1=1
loadrt mytest count=1
addf mytest.0 test-thread
setp mytest.0.in 3
setp mytest.0.gain 2
start
getp mytest.0.out
```

线程执行后，输出应为 `6`。再把 `gain` 改成 `4`，输出应变为 `12`。这一步先确认计算逻辑，下一步才引入信号连接。

`param` 用于参数，`pin` 用于连线；需要在组件间传递的运行数据应设计为 pin。组件还可以用 `variable` 保存实例内部状态，例如上一周期输入或积分累计值，这些内部变量不会自动成为 HAL 引脚。

### 用信号发生器驱动组件

结束上一个会话，新建 `chain.hal`：

```hal
loadrt threads name1=test-thread period1=1000000 fp1=1
loadrt siggen num_chan=1
loadrt mytest count=1

setp siggen.0.frequency 1
setp siggen.0.amplitude 1
setp siggen.0.offset 0
setp mytest.0.gain 2

net test-sine siggen.0.sine => mytest.0.in

addf siggen.0.update test-thread
addf mytest.0 test-thread
start
```

在 Linux 终端运行：

```bash
halrun -I -f chain.hal
```

用 `halscope` 同时观察 `siggen.0.sine` 与 `mytest.0.out`，输出应与输入同频，幅值约为输入的两倍。这个实验同时覆盖了加载、设值、连接、调度和观察五个环节。

### 再理解手写 C 组件

熟悉 `.comp` 后，再看纯 C 组件会更清楚。初始化阶段通常需要调用 `hal_init()` 注册组件，使用 `hal_malloc()` 分配 HAL 数据，通过 `hal_pin_*_newf()` 等接口创建引脚，使用 `hal_export_funct()` 导出周期函数，最后调用 `hal_ready()` 表示就绪。退出时通过 `hal_exit()` 清理注册资源。

纯 C 组件要自行处理初始化失败和资源释放；`.comp` 会生成其中的大部分样板代码。周期回调只做耗时可控的计算和接口操作，文件读写、等待输入等工作应放在合适的非实时部分。实际函数签名和使用条件应查对应的 HAL API 手册。

对于带积分、微分或滤波的组件，应按实际调用周期计算时间相关项，而不是把“1 ms”写死。`.comp` 提供的 `period` 以纳秒表示，`fperiod` 以秒表示，便于使用周期信息。

<a id="nml"></a>

## 六 用 NML 理解进程间消息通信

### 区分消息机制和共享内存

NML 即 Neutral Message Language，可理解为一种具有统一接口的消息通信机制。共享内存是它可以使用的底层方式之一，并不等于 NML 的全部。NIST 的 [NML 介绍](https://www.nist.gov/publications/neutral-message-language-model-and-method-message-passing-heterogeneous-environments) 说明了这种接口与底层通信方式的关系。

共享内存让不同进程可以访问同一段物理存储，但双方仍有各自的地址空间，不能把一个进程中的任意指针交给另一个进程直接使用。消息机制在此之上规定类型、大小、访问方式和数据表示。

普通 HAL pin 与 signal 常用于交换当前控制量；NML 则适合表达一条带类型的命令或一份状态消息。选择依据是数据语义。例如“当前使能状态”与“请求执行某项操作”虽然都可能涉及一个数值，但对消费顺序和反馈的要求不同。

| 比较项 | 普通 HAL pin 与 signal | NML 消息 |
| --- | --- | --- |
| 主要组织方式 | 具名引脚和数据值 | 类型号与消息对象 |
| 常见使用场景 | 控制量、反馈量、状态位 | 命令、状态和结构化数据 |
| 更新的含义 | 读取当前值 | 按通道配置读写消息 |
| 保存历史 | 默认不保存变化历史 | 可配置队列，仍需处理容量与错误 |
| 进程边界 | 可连接实时和用户态组件 | 面向进程间通信等场景 |

### 用 nml 文件描述通道和访问者

下面建立一个本机实验通道 `study`，由 `receiver` 创建缓冲区，`sender` 向其中写入消息。新建 `study.nml`：

```text
# B name type host size neut RPC buffer# max_procs key
B study SHMEM localhost 4096 0 0 1 2 21001

# P name buffer type host ops server timeout master c_num
P receiver study LOCAL localhost R 0 1.0 1 0
P sender   study LOCAL localhost W 0 1.0 0 1
```

`B` 行描述缓冲区。这里的 `4096` 是缓冲区大小；`1` 是 buffer 编号；`2` 是进程槽位数量；`21001` 是共享内存 key。缓冲区还需要容纳内部管理数据，不能把全部字节都当成可用消息载荷。实验 key 应避免与其他应用冲突。

`P` 行描述某个命名访问者如何使用缓冲区。`R` 和 `W` 分别表示读、写；`server` 标志与 `master` 标志是两个不同字段。这里两个进程的 `server` 都是 `0`；`receiver` 的 `master=1` 表示负责创建和销毁本地缓冲区，因此先启动它。`c_num` 为 `0` 和 `1`，处于对应槽位范围内。

这些名称是 NML 构造时查找配置的标识，并非系统根据进程的可执行文件名自动识别出来的。字段格式可对照官方 [NML 配置说明](https://linuxcnc.org/docs/2.9/html/code/code-notes.html#_configuration_file_format) 及实际使用的 [linuxcnc.nml](https://raw.githubusercontent.com/LinuxCNC/linuxcnc/2.9/configs/common/linuxcnc.nml)。

本示例未启用 `queue`，用于观察最新状态。发送速度快于接收速度时，中间值可能被覆盖。需要逐条处理的命令，应进一步设计队列容量、写入失败处理，以及确认和重试机制，不能把一次 `write()` 成功直接理解为业务已经执行成功。

### 定义消息类型和字段处理函数

新建 `message.hpp`。此处使用 LinuxCNC 的头文件，定义一个带转速和序号的学习消息：

```cpp
#pragma once
#include <cms.hh>
#include <nml.hh>
#include <nmlmsg.hh>

constexpr NMLTYPE SET_SPEED_TYPE = 2101;

class SET_SPEED : public NMLmsg {
public:
    SET_SPEED()
        : NMLmsg(SET_SPEED_TYPE, sizeof(SET_SPEED)),
          rpm(0.0), sequence(0) {}

    double rpm;
    int sequence;

    void update(CMS* cms) {
        cms->update(rpm);
        cms->update(sequence);
    }
};

inline int study_format(NMLTYPE type, void* buffer,
                        CMS* cms) {
    switch (type) {
    case SET_SPEED_TYPE:
        static_cast<SET_SPEED*>(buffer)->update(cms);
        return 1;
    default:
        return 0;
    }
}
```

`NMLmsg` 的构造参数传入类型号和对象大小；类型号用于识别消息。`update()` 描述字段如何由 CMS 处理，`study_format()` 根据类型选择对应处理函数。接口依据见 [NMLmsg 声明](https://raw.githubusercontent.com/LinuxCNC/linuxcnc/2.9/src/libnml/nml/nmlmsg.hh) 和 [CMS 字段接口](https://raw.githubusercontent.com/LinuxCNC/linuxcnc/2.9/src/libnml/cms/cms.hh)。

这里没有消息类型表注册等扩展功能，目的是展示一类固定消息的基本结构。不同 RCS/NML 分支的生成器、类型检查和头文件组织存在差别，不应把其他教程中的 `check_type_info()` 或单个 `rcs.hh` 直接当成所有版本的通用接口。

还要注意，本机 raw 共享内存访问可能采用快速路径，并非每次读写都会逐字段执行 `update()`。跨平台编码和格式转换时，字段处理函数才体现出相应作用；具体行为由通道配置与库实现决定，可对照 [NML 读写实现](https://raw.githubusercontent.com/LinuxCNC/linuxcnc/2.9/src/libnml/nml/nml.cc)。

将 C++ 的 `class` 类比成 C 的 `struct`，可以帮助初步理解“多个字段组成一条消息”，但不能当作语言层面的等式。C++ 的 `class` 与 `struct` 都能包含成员函数和继承，只是默认访问权限等规则不同；涉及继承的消息也不能随意按裸结构体布局处理。

### 编写发送端

新建 `sender.cpp`，从标准输入读取转速，每成功解析一个值就发送一条消息：

```cpp
#include "message.hpp"
#include <iostream>

int main(int argc, char** argv) {
    const char* cfg = argc > 1 ? argv[1] : "study.nml";
    NML channel(study_format, "study", "sender", cfg);
    if (!channel.valid()) {
        std::cerr << "Invalid NML channel\n";
        return 1;
    }

    SET_SPEED msg;
    while (std::cin >> msg.rpm) {
        ++msg.sequence;
        if (channel.write(msg) < 0) {
            std::cerr << "NML write failed\n";
            return 1;
        }
    }
}
```

这个实验只传递数值，不会控制真实主轴。消息类型名也不会自动让它成为 LinuxCNC 已有的机床控制命令。对实际 LinuxCNC 发命令，需要使用相应的消息定义、通道和状态协议。

### 编写接收端

新建 `receiver.cpp`。使用短周期轮询避免空转占满 CPU，并在收到中断后正常退出，让对象完成清理：

```cpp
#include "message.hpp"
#include <chrono>
#include <csignal>
#include <iostream>
#include <thread>

volatile std::sig_atomic_t running = 1;
void on_signal(int) { running = 0; }

int main(int argc, char** argv) {
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    const char* cfg = argc > 1 ? argv[1] : "study.nml";
    NML channel(study_format, "study", "receiver", cfg);
    if (!channel.valid()) {
        std::cerr << "Invalid NML channel\n";
        return 1;
    }

    while (running) {
        const NMLTYPE type = channel.read();
        if (type < 0) {
            std::cerr << "NML read failed\n";
            return 1;
        }
        if (type == SET_SPEED_TYPE) {
            const auto* msg = static_cast<SET_SPEED*>(
                channel.get_address());
            if (!msg) return 1;
            std::cout << "sequence=" << msg->sequence
                      << ", rpm=" << msg->rpm
                      << std::endl;
        }
        std::this_thread::sleep_for(
            std::chrono::milliseconds(20));
    }
}
```

`read()` 返回负值表示错误，返回 `0` 表示没有新消息，正值表示消息类型号。只有识别出类型后，才按对应类型访问 `get_address()` 返回的消息。该地址由通道管理，需要长期保存的数据应复制出来，不应跨后续读操作长期持有内部指针。方法签名见 [NML 类声明](https://raw.githubusercontent.com/LinuxCNC/linuxcnc/2.9/src/libnml/nml/nml.hh)。

至此，NML 的工作过程可以归纳为：配置缓冲区和访问者，定义消息，提供字段处理与类型分发函数，创建通道，然后检查读写结果。

<a id="cmake"></a>

## 七 用 CMake 组织和构建示例

### 让构建描述围绕目标展开

CMake 根据 `CMakeLists.txt` 配置构建系统，再由构建工具调用编译器。它不会代替 C++ 编译器，也不会自动提供缺少的 LinuxCNC 库。

把上一节文件放在同一个目录：

```text
nml-study/
  CMakeLists.txt
  study.nml
  message.hpp
  sender.cpp
  receiver.cpp
```

编写 `CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.20)
project(nml_study LANGUAGES CXX)

find_package(Threads REQUIRED)
find_path(NML_INCLUDE_DIR NAMES nml.hh
          PATH_SUFFIXES linuxcnc REQUIRED)
find_library(NML_LIBRARY NAMES nml
             PATH_SUFFIXES linuxcnc REQUIRED)

add_library(NML::NML UNKNOWN IMPORTED)
set_target_properties(NML::NML PROPERTIES
    IMPORTED_LOCATION "${NML_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${NML_INCLUDE_DIR}"
)

add_executable(sender sender.cpp)
add_executable(receiver receiver.cpp)

foreach(app IN ITEMS sender receiver)
    target_compile_features(${app} PRIVATE cxx_std_17)
    target_link_libraries(${app} PRIVATE
        NML::NML Threads::Threads)
endforeach()

configure_file(study.nml study.nml COPYONLY)
```

`find_path()` 找到头文件目录，`find_library()` 找到库文件；导入目标 `NML::NML` 把二者关联起来，供两个可执行目标复用。这里查找的是 LinuxCNC 的 `nml` 库。部分资料中的 `rcs` 链接写法面向另一种库安装环境，不能仅凭文件内容相似就混用。

如果开发文件装在非标准位置，可以通过 `-DNML_INCLUDE_DIR=...` 和 `-DNML_LIBRARY=...` 传入实际目录和库文件路径。两个路径必须来自兼容的一套开发环境。发现旧路径被缓存时，重新配置一个构建目录通常比反复修改源代码更容易排查。

相关行为见 CMake 官方 [find_path](https://cmake.org/cmake/help/v3.20/command/find_path.html)、[find_library](https://cmake.org/cmake/help/v3.20/command/find_library.html) 与 [target_link_libraries](https://cmake.org/cmake/help/latest/command/target_link_libraries.html) 文档。

### 区分常用构建命令

| 命令或变量 | 作用 |
| --- | --- |
| `add_executable` | 声明可执行目标及源文件 |
| `add_library` | 声明静态库、共享库或导入库等目标 |
| `target_include_directories` | 为目标设置头文件搜索目录 |
| `target_link_libraries` | 为目标声明链接依赖 |
| `CMAKE_CURRENT_SOURCE_DIR` | 当前正在处理的源码目录 |
| `CMAKE_CURRENT_BINARY_DIR` | 当前对应的构建目录 |

源码中的头文件通常来自源码目录；配置时生成的头文件可能在构建目录中。两者要按文件实际位置选择。

`PRIVATE`、`PUBLIC`、`INTERFACE` 控制依赖由当前目标使用、向使用者传播，或两者兼有。例如只供某个可执行程序使用的头文件目录，通常可设为 `PRIVATE`。普通变量引用写作 `${变量名}`；内置变量名应保持文档中的准确拼写。

目标级接口有助于限制依赖的影响范围，具体说明见 [target_include_directories](https://cmake.org/cmake/help/latest/command/target_include_directories.html)。

### 构建并观察收发结果

在项目根目录运行：

```bash
cmake -S . -B build
cmake --build build
```

先在第一个 Linux 终端启动接收端，等通道创建成功：

```bash
./build/receiver ./build/study.nml
```

再在第二个终端启动发送端：

```bash
./build/sender ./build/study.nml
```

输入 `1000` 并回车，等待接收后再输入 `1500`。接收端的预期输出形如：

```text
sequence=1, rpm=1000
sequence=2, rpm=1500
```

这里展示的是预期结果格式。若快速连续输入，非队列缓冲区可能只保留较新的值，序号可能不连续。这个现象正好可以用来练习区分“最新状态”与“每条消息都要处理”的需求。

在接收端按 `Ctrl+C` 可结束轮询。实际排错时，先区分构建阶段、动态库加载阶段和通道连接阶段：找不到头文件要查 include 目录，未定义符号要查链接依赖，运行时找不到库要查动态加载路径，通道无效则应查配置、主进程和资源冲突。

<a id="ethercat"></a>

## 八 了解 EtherCAT 如何接入 HAL

### 先掌握数据映射和同步概念

EtherCAT 是用于现场设备通信的工业以太网技术。在 LinuxCNC 的应用中，主站与设备交换的数据经过 HAL 驱动映射成引脚，再参与控制计算。它与 HAL、NML 分处不同层次：EtherCAT 面向设备通信，HAL 面向软件控制接口的连接，NML 面向消息通信。

| 概念 | 入门时的理解 |
| --- | --- |
| 主站与从站 | 主站组织通信，从站提供设备功能 |
| ESI | 描述设备能力及相关对象的 XML 信息文件 |
| PDO | 映射和周期交换过程数据 |
| SDO | 在 CoE 等场景下访问对象字典中的参数 |
| DC | 通过分布式时钟实现设备间时间同步 |
| 状态机 | 管理设备从初始化到运行的状态转换 |

PDO 常用于位置、速度、控制字或输入输出状态；SDO 常用于参数访问。具体对象、数据长度和访问条件要看设备文档，不能把相同编号或相同字段名视为所有设备都具有相同行为。基础术语可查 [EtherCAT Technology Group 技术介绍](https://www.ethercat.org/en/technology.html)。

DC 提供设备间的时间同步，但不会自动消除主机调度延迟。主机的控制周期、过程数据交换节奏和设备同步设置仍需要配合。技术细节可继续阅读 [EtherCAT Compendium](https://www.ethercat.org/en/compendium.htm)。

### 把接入分成可以验证的步骤

建议先确认主站可以识别设备，再配置 PDO，最后接到控制逻辑。不要一开始就把整条轴的驱动、单位换算和控制参数同时改动。

1. 记录 LinuxCNC、实时内核、EtherCAT 主站和 HAL 驱动的版本，确认组合支持目标设备。
2. 确认网卡与主站配置，使用主站工具检查设备是否可见。
3. 对照设备手册与 ESI，核对厂商标识、产品标识和 PDO 映射。
4. 加载 HAL 驱动配置，检查导出的引脚名称、方向与类型。
5. 在独立测试中验证一个输入或一个受控输出，再接入上层逻辑。
6. 需要同步运动时，再检查周期、DC 配置和驱动器工作模式。

以 linuxcnc-ethercat 项目为例，已有 `servo-thread` 的配置中，结构大致如下：

```hal
loadusr -W lcec_conf ethercat.xml
loadrt lcec

addf lcec.read-all servo-thread
# 在这里加入需要使用反馈值的控制函数
addf lcec.write-all servo-thread
```

这只是说明读取、计算、写出的组织关系。`ethercat.xml` 必须匹配实际设备和驱动版本，已有机床配置也不应再次创建同名线程。较新 LinuxCNC 与驱动组合可能还有额外的初始化要求，应查对应版本说明。项目入口见 [linuxcnc-ethercat](https://github.com/linuxcnc-ethercat/linuxcnc-ethercat)。

设备状态进入 OP，只说明通信状态达到运行阶段，不能据此推断比例、方向、驱动模式和机械动作均正确。调试时还需要逐项核对单位与反馈关系，例如编码器计数如何换算成毫米，以及目标方向与实际方向是否一致。

<a id="practice"></a>

## 九 把学习内容转成可检查的练习

下面是一轮七天练习的安排，可以按基础拆成更长时间。每一阶段保留配置文件和观察记录，后续遇到问题时便于复现。

| 阶段 | 练习内容 | 完成时应能给出的结果 |
| --- | --- | --- |
| 第一天 | 认识架构与 HAL 对象 | 解释 pin、signal、function 和 thread 的关系 |
| 第二天 | 运行 siggen 实验 | 给出可重复加载的 HAL 文件和波形记录 |
| 第三天 | 编写 mytest 组件 | 固定输入和正弦输入均符合预期 |
| 第四天 | 观察线程执行顺序 | 解释调换函数顺序后数据时序的变化 |
| 第五天 | 配置 NML 并收发消息 | 对照配置说清 B 行、P 行和类型号的含义 |
| 第六天 | 整理 CMake 项目 | 从新建 build 目录完成配置与构建 |
| 第七天 | 梳理 EtherCAT 接入 | 列出目标设备、映射、同步及待验证事项 |

完成基础实验后，可以继续做几个有明确观察目标的改动：

- 将 `mytest` 扩展为带上下限的比例组件，检查边界值输出。
- 给 HAL 信号增加第二个读取端，观察一个写入端向多个组件提供数据的方式。
- 调换同一线程中两个函数的顺序，用波形比较读取到的是哪一周期的数据。
- 给 NML 消息增加一个字段，同时更新发送端、接收端与字段处理函数。
- 快速发送多条 NML 状态，观察非队列模式下序号是否连续，再研究队列和确认需求。

每份实验记录至少写清运行环境、输入条件、预期结果和实际观察。下一次打开项目时，应能根据记录重新完成实验，而不必依赖记忆补全命令。

<a id="troubleshooting"></a>

## 十 常见问题速查

排查时先定位失败阶段，再检查名称、连接和执行状态。

| 现象 | 优先检查 |
| --- | --- |
| 组件已加载但输出不变 | 函数是否 addf，线程是否 start，输入是否改变 |
| setp 报错 | 对象是否可写、是否为输出引脚、是否已连接信号 |
| net 连接失败 | 名称、数据类型和写入端数量是否正确 |
| 自定义组件名称找不到 | 文件名、component 名、实例名和实际导出名 |
| 波形看不到快速脉冲 | 是否使用合适的采样线程、触发和时间尺度 |
| NML 通道无效 | 配置路径、缓冲区名、进程名、master 和资源 key |
| NML 序号出现跳变 | 是否使用非队列通道，收发速度是否匹配 |
| CMake 找不到开发文件 | 开发包是否匹配，搜索目录与缓存是否正确 |
| EtherCAT 可见但没有有效数据 | 状态机、PDO 映射、驱动支持与周期设置 |

后续阅读源码时，可以沿两条路径进行：从一条 HAL 引脚追到它的生产函数和使用函数；从一条 NML 消息追到配置、类型分发与接收处理。先把一条数据路径完整解释清楚，再扩展到更大的机床配置。

## 延伸阅读

- [VCore NML 通信教程：从消息定义到 UI 状态回传](/2026/10/19/NML通信教程/)：结合具体消息源码，继续追踪状态回传路径。
- [CNC 解析器知识文档：词法、语法与模态状态](/2026/10/22/CNC解析器知识文档/)：沿 G 代码的数据流理解词法、语义、模态与输出段。
