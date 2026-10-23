---
title: uIP 1.0 协议栈原理：从共享缓冲区到可靠传输
date: "2026-10-23 00:00:00"
permalink: /2026/10/23/uip10-porting-blog/
tags:
  - uIP
  - TCP
  - 嵌入式
  - 单片机
  - 网络协议
categories:
  - 技术笔记
cover: /image/covers/uip10-porting.jpg
description: 从共享包缓冲区、TCP 状态机、序号与 ACK 入手，梳理 uIP 1.0 的重传、应用回调、MSS、窗口和定时驱动，附最小移植工程与中文资料校注。
---

# uIP 1.0 协议栈原理：从共享缓冲区到可靠传输

一条 TCP 连接需要维护序号、确认、超时和连接状态，还要处理丢包与重复报文。资源有限的单片机要完成这些工作，首先需要决定：哪些信息必须长期保存，哪些内容可以在需要时重新生成。

uIP 的设计把连接状态保留在小型结构体中，让多个连接复用同一块包缓冲区，并让应用参与业务数据的重传。理解这几个选择，就能看懂它如何在有限内存下完成网络通信，以及这些选择对应用程序提出了什么要求。

本文围绕经典 uIP 1.0 的 IPv4 与 TCP 实现展开，用 TCP 回显串起接收、确认、发送和重传。通用 TCP 概念参考 [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293.html)，具体实现以 [uIP 1.0 发布包](https://www.dunkels.com/adam/download/uip-1.0.tar.gz)为准；不同版本的接口和策略可能存在差异。

<!-- more -->

## 阅读导航

| 想弄清的问题 | 阅读位置 |
| --- | --- |
| 一帧数据经过哪些协议 | [1：协议分层](#layers) |
| 多个连接如何复用一块包缓冲 | [2—3：缓冲区、状态与生命周期](#shared-buffer) |
| TCP 如何建立连接并确认字节 | [4—5：状态机、序号与 ACK](#tcp-state) |
| 未确认数据和重传由谁维护 | [6—8：发送取舍、重传与回调](#outstanding-data) |
| MSS、窗口与定时器怎样配合 | [9—10：流控与周期处理](#mss-window) |
| 怎样串起完整回显与最小工程 | [11：回显流程](#echo-flow)、[12：工程下载](#downloads) |
| 查阅中文接口资料和历史代码 | [附录：七篇中文资料与补充移植文章](#uip-chinese-appendix) |

<a id="layers"></a>

## 1. 以太网、ARP 与 TCP/IP 的分工

在以太网上发送 TCP 业务数据时，外层是以太网头，里面是 IP 头、TCP 头，最后才是应用数据。

```text
以太网帧
┌───────────┬─────────┬─────────┬──────────────┐
│ 以太网头  │ IPv4 头 │ TCP 头  │ 应用数据     │
└───────────┴─────────┴─────────┴──────────────┘
   MAC地址     IP地址    端口、序号、ACK等
```

这些字段分别解决不同层次的问题：

| 协议或层次 | 在本例中承担的工作 |
|---|---|
| 以太网 | 将帧交给当前链路上的目标 MAC |
| ARP | 根据下一跳 IPv4 地址查找其 MAC |
| IPv4 | 提供源、目的 IP 地址及上层协议标识 |
| ICMP | 提供 ping 等基础诊断所需的部分功能 |
| TCP | 维护有序字节流、确认、重传、流控和连接状态 |
| 应用 | 解释字节的业务含义，决定回复什么 |

ARP 的作用尤其容易与 IP 路由混淆。访问同一子网的主机时，设备查找目标主机的 MAC；经过默认网关访问其他网段时，查找的是网关 MAC，IP 包的目的地址仍是远端主机。ARP 请求和 IPv4 包也属于不同的以太网类型，接收入口需要分别处理。[RFC 826](https://www.rfc-editor.org/rfc/rfc826.html)描述了地址解析的基本机制。

<a id="shared-buffer"></a>

## 2. 共享缓冲区与连接状态

uIP 使用全局 `uip_buf` 作为主要包处理工作区。网卡把当前收到的帧写进去，协议栈读取首部、更新状态，并可能在同一片内存中构造输出。

```text
收到一帧 → 写入 uip_buf → 协议处理 → 生成并发送输出
                                      ↓
                              下一次处理复用缓冲区
```

当前报文处理结束后，没有必要一直保存它的以太网头、IP 头和 TCP 头。下一次发送时，可以根据连接状态重新构造这些字段。这样就减少了长期占用 RAM 的报文副本。

但每条连接仍有自己的状态。`uip_conns[]` 中的连接结构保存远端 IP、本地与远端端口、接收进度、待确认发送范围、定时器及应用状态。共享一个包缓冲区，并不限制整个系统只能维持一条 TCP 连接：多个连接可以交替获得处理机会，各自的通信进度由连接表保存。

这里的“一个缓冲区”也不包含网卡内部接收队列、驱动私有缓存和应用持久数据。单片机实际占用多少 RAM，需要把这些部分一起统计。

<a id="buffer-lifetime"></a>

## 3. 数据指针与长度的生命周期

应用回调通过 `uip_appdata` 访问当前业务数据，但下一帧或下一次协议处理就可能覆盖这片内存。需要跨事件保存的内容，必须复制到应用存储区，或者保证以后能够从原始来源重新生成。

`uip_len` 的含义同样随处理阶段变化：

| 所处阶段 | 长度表示什么 |
|---|---|
| 网卡刚交入报文 | 输入以太网帧的有效长度 |
| TCP 新数据回调中 | 通过 `uip_datalen()` 获取当前输入负载长度 |
| `uip_input()` 产生 IP 输出后 | 待输出 IP 包的长度 |
| `uip_arp_out()` 返回后 | 应交给网卡发送的以太网帧长度 |

理解这个变化，就能解释为什么移植层需要在每次处理产生输出后立即发送：如果先处理多个连接、最后再统一发送，前面的输出可能已经被共享缓冲区中的新内容覆盖。

<a id="tcp-state"></a>

## 4. TCP 连接状态机

服务器监听一个端口，表示愿意接受发往该端口的连接请求。经典 uIP 把监听端口放在单独的表中；收到匹配的 SYN 后，才分配连接槽并进入握手状态。

下面是一个简化的被动建立和被动关闭路径，省略了重传及异常分支：

```text
监听端口表匹配到 SYN
        ↓
分配连接，进入 SYN_RCVD，发送 SYN+ACK
        ↓ 收到有效确认
    ESTABLISHED
        ↓ 接受对端 FIN
发送 FIN+ACK，进入 LAST_ACK
        ↓ 对端确认本机 FIN
       CLOSED
```

主动发起连接、主动关闭和同时关闭会经过其他路径，例如 `SYN_SENT`、`FIN_WAIT_1`、`FIN_WAIT_2`、`TIME_WAIT`、`CLOSING`。因此，不能仅根据“设备是服务器”就断定关闭时一定进入 `TIME_WAIT`。状态与收到的报文一起，决定当前能接受什么、应回复什么。

协议栈检查报文的长度、校验和和连接信息后，还会检查序号。对携带数据的段，如果序号不符合当前期待的接收位置，经典 uIP 会回复相应确认，等待合适的数据到达，而不为一般乱序数据建立完整的接收缓存。这个取舍节省了内存，也增加了对后续重传的依赖。

<a id="sequence-ack"></a>

## 5. 序号与 ACK

假设握手已经完成，PC 从序号 1000 开始发送四个字节 `ABCD`。单片机接受后，确认号为 1004。回显是反方向的一次发送，使用单片机自己的发送序号，例如 5000：

```text
PC                                                   单片机
SEQ=1000，数据 ABCD  ---------------------------------->
                    <----------------------------------
                    ACK=1004，SEQ=5000，回显 ABCD
ACK=5004            ---------------------------------->
```

`ACK=1004` 确认的是 PC 发出的四个字节；`ACK=5004` 确认的是单片机发出的四个回显字节。前一次确认到达或发出，都不能代替后一次确认。

TCP 提供字节流，所以应用的一次发送不保证对应对端的一次接收。ACK 也只说明相应序列范围已被对端 TCP 接受，不代表对端业务已经解析、写入 Flash 或执行完命令。需要确认业务操作完成时，应在应用协议中另行定义应答。[TCP 序号说明](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.4)

<a id="outstanding-data"></a>

## 6. 未确认数据与吞吐取舍

核心同时跟踪一个未确认的发送序列范围，确认之后再推进下一段。这个限制针对每条连接的发送进度，不是说整个协议栈只能处理一个数据包或连接。SYN 和 FIN 也各占用一个序号，同样涉及确认与重传。

这种组织方式减少了维护多个在途段所需的队列和状态。在忽略处理时间、丢包、延迟 ACK 等影响时，单个在途数据段的发送速率量级可以用 `单段数据量 ÷ RTT` 估算。往返时延变长后，即使网卡速度很高，等待确认仍会限制吞吐。这里的公式用于解释设计取舍，不是实际性能保证。

<a id="retransmission"></a>

## 7. 核心与应用的重传职责

核心负责保存序号、判断确认是否有效、维护超时和重试次数，并重新生成协议头。建立连接与关闭所需的 SYN、SYN+ACK、FIN 等控制报文也由核心处理重传。

已经建立连接后的业务数据，则需要应用在 `uip_rexmit()` 事件中重新提供。关键要求是：重供原片段的相同字节和原长度，不能把它替换成新的采样值或下一条消息。收到 `uip_acked()` 后，才推进对应的发送偏移。[uIP 应用接口](https://github.com/adamdunkels/uip/blob/master/uip/uip.h)

固定网页可以从 Flash 再次读取，未必需要把整段内容长期复制到 RAM；实时采样结果和回显数据如果无法可靠重建，就需要保留快照。uIP 的节省来自允许应用利用自身的数据来源，而不是省略 TCP 所要求的可靠性处理。这也是作者在[早期设计文档](https://www.dunkels.com/adam/download/uip-doc-0.5.pdf)中说明的设计思路；该文档描述 0.5 版，本文的具体接口仍以 1.0 源码为准。

正式 1.0 的 `uip_send()` 会把本次数据复制到共享发送区，但这个副本并不是持久的重传队列。应用仍需保留或重建原内容，直到相应确认到达。重传事件只说明没有及时收到预期确认；原数据丢失、ACK 丢失或确认延迟，都可能导致重发。

<a id="app-events"></a>

## 8. 应用事件回调

应用入口由 `UIP_APPCALL` 注册，在输入处理、周期处理或轮询路径中同步调用。常用事件如下：

| 事件检查 | 应用应关注的事情 |
|---|---|
| `uip_connected()` | 本次发生连接建立事件，初始化连接私有状态 |
| `uip_newdata()` | 正常输入路径中的新数据标志，按有效长度读取 |
| `uip_acked()` | 当前跟踪的发送范围已获确认，推进应用进度 |
| `uip_rexmit()` | 重新提供原来的数据片段 |
| `uip_poll()` | 获得无新输入时提交待发数据的机会 |
| 关闭、复位、超时事件 | 清理连接相关资源 |

一次回调可能包含多个事件，例如确认上一段数据的同时又收到新数据。应用应按依赖关系处理它们，不能把所有事件都写成互斥的 `else if`。`uip_connected()` 也不是可以在任意位置使用的永久连接状态查询。

连接的 `appstate` 保存跨事件的数据，却没有为每条连接提供独立的线程栈。回调中长时间等待串口、Flash 或外设，会推迟其他连接及定时处理。Protothreads 可以帮助组织等待逻辑，但它是应用结构工具，不是使用 uIP 的必要条件。

<a id="mss-window"></a>

## 9. MSS 与接收窗口

MSS 限制单个 TCP 段的负载大小，不包括 IP 和 TCP 首部。接收窗口描述接收端从确认位置起还能接收的字节范围；它还具有方向性：

| 参数或状态 | 约束方向 |
|---|---|
| 本机通告的接收窗口 | 对端还能向本机发送多少数据 |
| 对端通告的接收窗口 | 本机向对端发送数据的空间 |
| 当前连接的 `uip_mss()` | 本次发送片段可采用的大小，受协商及对端窗口影响 |

例如，本地包缓冲为 600 字节，普通以太网头、IPv4 头、TCP 头分别取 14、20、20 字节时，本地 TCP 负载上限是 `600 - 14 - 20 - 20 = 546` 字节。它不是“可以发送 600 字节业务数据”。实际发送还应查询 `uip_mss()`。

回显应用可以在缓冲忙碌时调用 `uip_stop()`，通告本机接收窗口为零，同时继续向对端发送回显，因为两个方向的窗口相互独立。回显全部被确认后，再用 `uip_restart()` 恢复接收。正式 1.0 对对端零窗口还有特殊探测策略，不能把 `uip_mss()` 简化成没有例外的 `min(MSS, 窗口)` 公式。

还有一个实现细节：`uip_restart()` 自身会设置 `UIP_NEWDATA`，以触发相应输出。因此应用应在回调入口保存真实的新数据事件，不能在恢复窗口后仅凭该标志判断又收到了一份负载。

<a id="timers"></a>

## 10. 独立驱动 TCP 与 ARP 定时器

一段数据发出后，如果数据或 ACK 丢失，网络可能暂时不再产生输入。协议栈必须通过定时处理发现等待超时，触发重传或最终终止连接。

经典示例使用 TCP 500 ms、ARP 10 s 的周期驱动。500 ms 是定时处理粒度，不是每个包固定的重传间隔；核心还会维护重传状态并执行退避。ARP 周期处理则负责让旧地址映射过期。[作者周期处理示例](https://github.com/adamdunkels/uip/blob/master/doc/example-mainloop-with-arp.c)

因此，主循环需要分别处理输入和到期事件。只在“没有收到包”时检查定时器，会让持续流量推迟这些工作。一个主循环串行处理协议事件，中断提供时基或事件通知，就可以支持这种运行方式。

<a id="echo-flow"></a>

## 11. TCP 回显的完整过程

单片机接受 PC 的新数据，推进接收序号，把业务字节复制到连接私有缓冲；应用按当前 MSS 提交一段回显，核心生成带确认号的 TCP/IP 输出。

输出进入以太网之前，还需要下一跳 MAC。`uip_arp_out()` 查不到映射时，可能把原 IP 包替换成 ARP 请求；TCP 数据保留在应用的重传来源中，等到重传机会再提交。因此，ARP 输出并非永远只是增加一个以太网头。[uIP ARP 实现](https://github.com/adamdunkels/uip/blob/master/uip/uip_arp.c)

PC 确认回显后，应用推进发送偏移；如果还有剩余内容，就继续下一段。没有及时获得确认时，核心触发重传事件，应用重新提供原段。全部回显被确认之后，应用才能释放这批数据并恢复接收空间。

<a id="downloads"></a>

## 12. 配套工程与下载

配套的最小工程把这些关系落实成了每连接持久缓冲、ACK 后推进、原段重传和接收反压，并通过 9 组主机报文测试验证主要路径。它还保留了正式 1.0 的关闭边界：客户端应先收齐回显，再关闭连接；不要把在读取前执行写端半关闭，当作本例的请求结束方式。工程中的 ARP 回绕修正也有单独补丁和回归测试。

进一步阅读代码时，可以按 `uip_input()` 的输入入口、TCP 连接查找与状态分支、应用回调、输出组包、`uip_periodic()` 的超时路径这一顺序追踪。每走一步，都检查当前连接状态、序号和确认号，以及 `uip_buf` 此刻归谁使用，就能把协议概念与实际执行过程对应起来。

配套材料：[最小工程](/downloads/uip10/uip10-minimal-port.zip)、[工程接入说明](/uip10-minimal-port/)。

<a id="uip-chinese-appendix"></a>

## 附录 uIP 中文资料正文整理

本附录收录七篇中文文档的技术正文、接口清单、解释和代码示例，另附《UIP协议在单片机上的移植与实现》的技术章节与原始重点函数。正文前面的原理讲解与本附录可对照阅读。

整理时清除了 Word 超链接域代码、论坛复制提示和旧版源文件行号，调整了段落、表格与代码排版。原文的历史表述、误译和版本差异在各篇“整理校注”中单独说明；校注不是原文。为修复排版而补齐的标点也在相应篇末说明。附录中的旧示例不能全部直接作为可编译工程使用。

现有中文资料没有第五篇，以下保留原始编号；第六篇中对第五篇的引用也仅作为原资料中的引用保留。七篇中文文档的原始 Word 文件见[中文原始资料包](/downloads/uip10/uip-chinese-originals.zip)。补充移植文章保留相关技术文字及代码，不转写 Word 插图，不收入封面个人信息、声明、致谢和夹带的无关内容。

阅读导航：

- [第一篇 与设备驱动接口](#uip-cn-1)
- [第二篇 初始化函数](#uip-cn-2)
- [第三篇 配置函数](#uip-cn-3)
- [第四篇 应用层接口](#uip-cn-4)
- [第六篇 Protothreads](#uip-cn-6)
- [第七篇 编译时配置](#uip-cn-7)
- [第八篇 应用程序](#uip-cn-8)
- [补充资料 单片机移植文章](#uip-cn-paper)

<a id="uip-cn-1"></a>

### 中文资料第一篇 与设备驱动接口

源文件：`UIP中文文档第一_与设备驱动接口.doc`。

本节保留原资料的技术正文、接口和全部代码示例，清理 Word 超链接域、论坛“复制代码”字样和旧版源代码行号。原文有误或与核对版本不一致之处见篇末“整理校注”。

原文：实现设备驱动与 uIP 的对接，需要开发者实现如下七个接口程序：

| 原文接口 | 说明 |
| --- | --- |
| `#define uip_input()` | 处理一个输入的数据包。 |
| `#define uip_periodic(conn)` | 通过连接号，对连接周期性进行处理。 |
| `#define uip_conn_active(conn) (uip_conns[conn].tcpstateflags != UIP_CLOSED)` | 原文列出的连接状态判断宏。 |
| `#define uip_periodic_conn(conn)` | 周期性处理一个连接，此操作要借助指向这个连接的结构体的指针。 |
| `#define uip_poll_conn(conn)` | 请求轮询（poll）某一指定连接。 |
| `#define uip_udp_periodic(conn)` | 周期性处理 UDP 连接，此操作要借助连接号。 |
| `#define uip_udp_periodic_conn(conn)` | 周期性处理一个 UDP 连接，要借助指向此连接结构体的指针。 |

还有一个变量在接口中用到，即 uIP 包缓冲区：

```c
u8_t uip_buf[UIP_BUFSIZE + 2];
```

下面对以上接口进行详细介绍。

#### 1. `uip_input()`：处理输入数据包

接口形式：`#define uip_input()`。

此函数应该在设备从网络上接收到数据包时得到调用。设备驱动应该在调用此函数之前，将接收到的数据包内容存入 `uip_buf` 缓冲区，并将其长度赋给 `uip_len` 变量。此函数返回时，如果系统有数据要输出，会直接将数据存入 `uip_buf`，并将其长度值赋给 `uip_len`。如果没有数据要发送，则将 `uip_len` 赋 0。

通常使用此函数的方法如下：

```c
uip_len = devicedriver_poll();
if(uip_len > 0) {
  uip_input();
  if(uip_len > 0) {
    devicedriver_send();
  }
}
```

注意：如果你写的 uIP 设备驱动需要使用 ARP 协议（Address Resolution Protocal，原文拼写），比如说在以太网内使用 uIP 的时候，就得在调用此函数之前先调用 uIP 的 ARP 代码：

```c
#define BUF ((struct uip_eth_hdr *)&uip_buf[0])

uip_len = ethernet_devicedrver_poll();
if(uip_len > 0) {
  if(BUF->type == HTONS(UIP_ETHTYPE_IP)) {
    uip_arp_ipin();
    uip_input();
    if(uip_len > 0) {
      uip_arp_out();
      ethernet_devicedriver_send();
    }
  } else if(BUF->type == HTONS(UIP_ETHTYPE_ARP)) {
    uip_arp_arpin();
    if(uip_len > 0) {
      ethernet_devicedriver_send();
    }
  }
}
```

使用例程：`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。接口定义于 `uip.h`。

#### 2. `uip_periodic(conn)`：按连接号周期性处理 TCP 连接

接口形式：`#define uip_periodic(conn)`。

此函数对 uIP 的 TCP 连接进行一些必要的周期性处理（定时器、轮询等），应该在周期性 uIP 定时器消息到来时被调用。它应该对每一个连接都得到调用，不管连接是打开的还是关闭的。

此函数返回时，可能会有要传送出去的数据包等待得到服务，包内容会被放到 uIP 包缓冲区中。如果真的有数据包需要送出，则 `uip_len` 的值会被置为一个大于零的数，此时设备驱动应该将数据包发送出去。（原文译注：这一段与第 1 节中相应段落的意思应该是一致的。）

通常调用此函数时，会使用如下的 `for` 循环：

```c
for(i = 0; i < UIP_CONNS; ++i) {
  uip_periodic(i);
  if(uip_len > 0) {
    devicedriver_send();
  }
}
```

注意：如果所写的设备驱动需要使用 ARP 协议，例如是在以太网中使用 uIP，就得在调用驱动函数发送传出数据之前调用 `uip_arp_out()` 函数：

```c
for(i = 0; i < UIP_CONNS; ++i) {
  uip_periodic(i);
  if(uip_len > 0) {
    uip_arp_out();
    ethernet_devicedriver_send();
  }
}
```

参数 `conn`：将要轮询的连接号。使用例程：`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。接口定义于 `uip.h`。

#### 3. `uip_periodic_conn(conn)`：按结构体指针周期性处理 TCP 连接

接口形式：`#define uip_periodic_conn(conn)`。

此函数与 `uip_periodic()` 执行的操作相同，不同之处仅在于传入的参数是一个指向 `uip_conn` 结构体的指针。此函数可以用于对某个连接强制进行周期性处理。

参数 `conn`：指向要进行处理的连接结构体的指针。接口定义于 `uip.h`。

#### 4. `uip_poll_conn(conn)`：请求轮询特定 TCP 连接

接口形式：`#define uip_poll_conn(conn)`。

原文：函数功能与 `uip_periodic_conn()` 相同，但不是执行任何定时器处理。轮询以得到新数据。

参数 `conn`：指向要进行处理的 `uip_conn` 连接结构体的指针。接口定义于 `uip.h`。

#### 5. `uip_udp_periodic(conn)`：按连接号周期性处理 UDP 连接

接口形式：`#define uip_udp_periodic(conn)`。

此函数基本上与 `uip_periodic()` 相同，区别仅在于这里处理的是 UDP 连接。其调用方式也与 `uip_periodic()` 类似：

```c
for(i = 0; i < UIP_UDP_CONNS; i++) {
  uip_udp_periodic(i);
  if(uip_len > 0) {
    devicedriver_send();
  }
}
```

注意：对于 `uip_periodic()` 函数，在 uIP 中使用 ARP 和以太网时，要特别注意一些事情，这对于 `uip_udp_periodic()` 也一样：

```c
for(i = 0; i < UIP_UDP_CONNS; i++) {
  uip_udp_periodic(i);
  if(uip_len > 0) {
    uip_arp_out();
    ethernet_devicedriver_send();
  }
}
```

参数 `conn`：要处理的 UDP 连接号。使用例程：`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。接口定义于 `uip.h`。

#### 6. `uip_udp_periodic_conn(conn)`：按结构体指针周期性处理 UDP 连接

接口形式：`#define uip_udp_periodic_conn(conn)`。

函数功能与 `uip_udp_periodic(conn)` 相同，不同之处在于所用参数为指向连接结构体的指针，而非连接号。此函数可用于强制执行某个连接的周期性处理。

参数 `conn`：指向要处理的 UDP 连接的 `uip_udp_conn` 结构体的指针。接口定义于 `uip.h`。

#### 7. 包缓冲区与包长度变量

变量形式：

```c
u8_t uip_buf[UIP_BUFSIZE + 2];
```

`uip_buf` 数组用于盛放传入、传出的数据包。设备驱动应将传入的数据放于此缓冲区中。发送数据时，设备驱动从缓冲区中读取链路层的头和 TCP/IP 头。链路层头的大小在 `UIP_LLH_LEN` 中定义。

原文注意：应用数据无需放在这个缓冲区中，所以设备驱动需要从 `uip_appdata` 指针所指的地方读取数据。下面是一个例子：

```c
void
devicedriver_send(void)
{
  hwsend(&uip_buf[0], UIP_LLH_LEN);
  if(uip_len <= UIP_LLH_LEN + UIP_TCPIP_HLEN) {
    hwsend(&uip_buf[UIP_LLH_LEN], uip_len - UIP_LLH_LEN);
  } else {
    hwsend(&uip_buf[UIP_LLH_LEN], UIP_TCPIP_HLEN);
    hwsend(uip_appdata, uip_len - UIP_TCPIP_HLEN - UIP_LLH_LEN);
  }
}
```

此变量定义于 `uip.c`，被 `uip_process()` 引用。

包长度变量形式：

```c
u16_t uip_len;
```

`uip_len` 表示 `uip_buf` 缓冲区中的数据包长度。原文译者注：`uip_buf` 是一个数组，其长度固定，此处指的是动态存放的数据长度，不是指数组本身长度。

原文：这个“全局函数”盛放存储于 `uip_buf` 中的数据包的长度。当网络设备驱动调用 uIP 输入函数时，`uip_len` 要被设为传入数据包的大小。当向外发送数据包时，设备驱动通过这个变量确定要发送的数据包在 `uip_buf` 中的长度。

应用例程：`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。此变量定义于 `uip.c`，被 `uip_arp_arpin()`、`uip_process()`、`uip_split_output()` 引用。

#### 整理校注

1. 篇首“需要开发者实现如下七个接口程序”表述不准确：所列 `uip_input()`、周期处理和轮询宏是 uIP 核心提供的入口，移植者主要负责调用它们，并实现实际网卡初始化、收包、发包和时钟。原文清单有七个宏，但详细小节把连接活动判断宏略过，将缓冲区列为第 7 节；这里保留了清单和全部详细说明。
2. `uip_conn_active(conn)` 在原文中只列出宏定义，没有独立展开说明；这里保留原式。它与核对的 uIP 1.0 `uip.h` 定义一致。
3. `uip_poll_conn()` 不执行周期定时器处理，而是请求对应用进行轮询；原文“但不是执行任何定时器处理”按此理解。
4. ARP 收包示例原文缺最外层 `if` 的结束花括号，这里已补齐。缓冲区声明原文缺分号，这里已补齐。示例中的 `ethernet_devicedrver_poll()` 拼写按原文保留，实际工程须与自己的驱动函数名一致。
5. 关于“应用数据无需放在缓冲区”和分段发送的段落、示例按原文完整保留。核对的 uIP 1.0 源码中，`uip_send()` 在发送源地址不同于 `uip_sappdata` 时会通过 `memcpy` 把数据复制到 `uip_sappdata` 所指发送区域，而头文件仍保留这段旧的发送说明。驱动应依据正在使用的版本、实际输出路径与帧布局实现；不要只凭这一段认定负载总在缓冲区外，也不要把示例固定的 TCP/IP 头拆分方式直接套用到所有协议和所有报文。
6. `uip_len` 是全局变量，原文称“全局函数”是笔误。设备驱动还应验证实际帧长度和缓冲区上限；本文示例只展示接口调用顺序。

<a id="uip-cn-2"></a>

### 中文资料第二篇 初始化函数

源文件：`UIP中文文档第二_uIP初始化函数.doc`。

本节保留原资料的接口说明、初始化代码分析和两个连接结构体。旧版源代码行号及 Word 超链接域已清理；原文有误或有待补充之处见篇末“整理校注”。

#### 初始化接口

##### 1. `void uip_init(void)`

此函数用于在启动时初始化 uIP 的 TCP/IP 栈。应用示例：`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。定义于 `uip.c`。

##### 2. `void uip_setipid(u16_t id)`

此函数用于启动时设置初始的 `ip_id`。定义于 `uip.c`。

#### 1. `uip_init(void)` 代码分析

```c
void
uip_init(void)
{
  for(c = 0; c < UIP_LISTENPORTS; ++c) {
    uip_listenports[c] = 0;
  } /* 将 uip_listenports 数组全部清零。 */

  for(c = 0; c < UIP_CONNS; ++c) {
    uip_conns[c].tcpstateflags = UIP_CLOSED;
  } /* 将所有连接的 tcpstateflags 状态标志设为关闭，表示此连接为关闭状态。 */

#if UIP_ACTIVE_OPEN
  lastport = 1024;
#endif /* UIP_ACTIVE_OPEN */
  /* 原文注释：上面的段不知什么意思。 */

#if UIP_UDP
  for(c = 0; c < UIP_UDP_CONNS; ++c) {
    uip_udp_conns[c].lport = 0;
  }
#endif /* UIP_UDP */
  /* 原文注释：如果定义了 UIP_UDP，则将 uip_udp_conns 的 lport 清零。 */

  /* IPv4 initialization. */
#if UIP_FIXEDADDR == 0
  /* uip_hostaddr[0] = uip_hostaddr[1] = 0; */
#endif /* UIP_FIXEDADDR */
  /* 原文注释：如果主机地址要为固定的，在上面这里赋值。 */
}
```

各项说明如下：

- `UIP_LISTENPORTS`：可同时监听的 TCP 端口数最大值，每监听一个 TCP 端口都要占用两字节内存。此宏定义于 `uipopt.h`，原文所述默认值为 20。
- `UIP_CONNS`：原文称“可同时打开的 TCP 端口数的最大值”。由于 TCP 连接是静态分配的，所以降低这个值的大小可以降低占用的内存空间，每个 TCP 连接大约需要 30 字节内存。此宏定义于 `uipopt.h`，原文所述默认值为 10。
- `UIP_UDP_CONNS`：最大的并行 UDP 连接数。此宏定义于 `uipopt.h`，原文所述默认值为 10。
- `uip_conns`：`struct uip_conn` 型结构体数组，数组大小为 `UIP_CONNS`。每个 `uip_conn` 代表一个 TCP 连接。
- `uip_udp_conns`：`struct uip_udp_conn` 型结构体数组，数组大小为 `UIP_UDP_CONNS`。每个 `uip_udp_conn` 代表一个 UDP 连接。
- `UIP_ACTIVE_OPEN`：是否编译可以让上层应用程序动态打开外向 TCP 连接的代码。关闭此功能可以降低 uIP 的代码大小。此宏定义于 `uipopt.h`。

#### 2. `uip_conn`：TCP 连接结构体

此结构体代表一个 uIP 的 TCP 连接，用于鉴定一个 TCP 连接。对应用来说，除一个域之外，所有的域都是只读的。例外的是 `appstate` 域，它的目的是让应用存取应用相关的连接状态，此域的类型定义于 `uipopt.h` 中。此结构体定义于 `uip.h`。

以下保留原文的全部成员及中英文技术注释，并调整排版：

```c
struct uip_conn {
  uip_ipaddr_t ripaddr;
  /**< The IP address of the remote host. 远程主机的 IP 地址。 */

  u16_t lport;
  /**< The local TCP port, in network byte order.
       本地主机的 TCP 端口，以网络传输中的字节顺序表示。 */

  u16_t rport;
  /**< The local remote TCP port, in network byte order.
       远程主机的 TCP 端口，以网络传输中的字节顺序表示。 */

  u8_t rcv_nxt[4];
  /**< The sequence number that we expect to receive next.
       我们期待接收的下一个序号。 */

  u8_t snd_nxt[4];
  /**< The sequence number that was last sent by us.
       我们上次发送的序号。 */

  u16_t len;
  /**< Length of the data that was previously sent.
       上次发送的数据长度。 */

  u16_t mss;
  /**< Current maximum segment size for the connection.
       现行连接的段大小最大值。 */

  u16_t initialmss;
  /**< Initial maximum segment size for the connection.
       连接的初始段大小最大值。 */

  u8_t sa;
  /**< Retransmission time-out calculation state variable.
       重传超时计算状态变量。 */

  u8_t sv;
  /**< Retransmission time-out calculation state variable.
       重传超时计算状态变量。 */

  u8_t rto;
  /**< Retransmission time-out. 重传超时。 */

  u8_t tcpstateflags;
  /**< TCP state and flags. TCP 状态标志。 */

  u8_t timer;
  /**< The retransmission timer. 重传定时器。 */

  u8_t nrtx;
  /**< The number of retransmissions for the last segment sent.
       上次发送的段的重传次数。 */

  uip_tcp_appstate_t appstate;
  /**< The application state. 应用状态。 */
};
```

#### 3. `uip_udp_conn`：UDP 连接结构体

此结构体代表一个 uIP UDP 连接，定义于 `uip.h`。

```c
struct uip_udp_conn {
  uip_ipaddr_t ripaddr;
  /**< The IP address of the remote peer.
       远程对等主机的 IP 地址。 */

  u16_t lport;
  /**< The local port number in network byte order.
       本地端口号，以网络字节顺序表示。 */

  u16_t rport;
  /**< The remote port number in network byte order.
       远程端口号，以网络字节顺序表示。 */

  u8_t ttl;
  /**< Default time-to-live. 默认存活时间。 */

  uip_udp_appstate_t appstate;
  /**< The application state. 应用状态。 */
};
```

#### 4. `uip_setipid(u16_t id)` 的实现

```c
void uip_setipid(u16_t id)
{
  ipid = id;
}
```

此函数只是将传来的参数赋值给 `ipid`。

#### 整理校注

1. `UIP_ACTIVE_OPEN` 段中的 `lastport = 1024` 用于初始化主动连接使用的本地临时端口分配状态；原文“不知什么意思”的注释保留在代码中，供对照阅读。
2. `UIP_FIXEDADDR == 0` 表示不使用编译期固定地址。原文“如果主机地址要为固定的，在上面这里赋值”的注释与条件含义不一致；运行时指定地址应使用相应 `uip_sethostaddr()` 等接口，编译期固定地址则按所选版本的配置机制设置。
3. 原文 `#if UIP_UDP` 是判断宏值是否非零，不只是判断该宏是否“定义”。
4. `UIP_CONNS` 限制同时存在的 TCP **连接数**，不是监听端口数；监听端口数由 `UIP_LISTENPORTS` 控制。一个监听端口可对应多个连接，二者不应混为一谈。
5. 原文的默认值和“每个 TCP 连接约 30 字节”保留作为旧资料描述。最终数值以实际版本配置、编译器布局和 `sizeof(struct uip_conn)` 为准；每连接的 `appstate` 也占内存。
6. `uip_init()` 初始化核心状态，不等于完成网卡、ARP、IP 地址、定时器和业务监听的全部初始化。初始化示例中的 `uip_hostaddr` 清零语句本来就是注释，不能据此推断它会执行地址设置。
7. `appstate` 的类型由应用通过 `uip_tcp_appstate_t`、`uip_udp_appstate_t` 提供，并通过配置头文件包含进来；不应据原文“定义于 uipopt.h”而把应用状态硬塞入通用核心配置。

<a id="uip-cn-3"></a>

### 中文资料第三篇 配置函数

源文件：`UIP中文文档第三_uIP配置函数.doc`。

uIP 配置函数用于设置一些如 IP 地址等的 uIP 运行时参数。它包括以下函数：

| 原文接口 | 说明 |
| --- | --- |
| `#define uip_sethostaddr(addr)` | 设定主机 IP 地址。 |
| `#define uip_gethostaddr(addr)` | 获取主机 IP 地址。 |
| `#define uip_setdraddr(addr)` | 设定默认路由器地址。 |
| `#define uip_getdraddr(addr)` | 获取默认路由器地址。 |
| `#define uip_setnetmask(addr)` | 设定网络掩码。 |
| `#define uip_getnetmask(addr)` | 获取网络掩码。 |
| `#define uip_setethaddr(eaddr)` | 设定以太网 MAC 地址。 |

前六个函数皆定义于 `uip.h`，最后一个定义于 `uip_arp.h`。

#### 1. `uip_sethostaddr(addr)`

```c
#define uip_sethostaddr(addr) uip_ipaddr_copy(uip_hostaddr, (addr))
```

原文说明：“获取主机 IP 地址”。主机 IP 地址由 4 字节的数组表示，第一个八位数就是数组的第一个成员。（原文解释：八位数，octet，是网络术语，即是一个字节，但网络术语不叫字节。）

常用方法如下：

```c
uip_ipaddr_t addr;
uip_ipaddr(&addr, 192, 168, 1, 2);
uip_sethostaddr(&addr);
```

参数 `addr`：指向 IP 地址类型 `uip_ipaddr_t` 的指针。

参考：`uip_ipaddr()`。应用例程：`dhcpc.c`、`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。定义于 `uip.h`。

#### 2. `uip_gethostaddr(addr)`

```c
#define uip_gethostaddr(addr) uip_ipaddr_copy((addr), uip_hostaddr)
```

使用方法示例：

```c
uip_ipaddr_t hostaddr;
uip_gethostaddr(&hostaddr);
```

#### 3. `uip_setdraddr(addr)`

设定默认路由器地址。

```c
#define uip_setdraddr(addr) uip_ipaddr_copy(uip_draddr, (addr))
```

#### 4. `uip_getdraddr(addr)`

获取默认路由器地址。

```c
#define uip_getdraddr(addr) uip_ipaddr_copy((addr), uip_draddr)
```

#### 5. `uip_setnetmask(addr)`

设定子网掩码。

```c
#define uip_setnetmask(addr) uip_ipaddr_copy(uip_netmask, (addr))
```

#### 6. `uip_getnetmask(addr)`

获取子网掩码。

```c
#define uip_getnetmask(addr) uip_ipaddr_copy((addr), uip_netmask)
```

#### 7. `uip_setethaddr(eaddr)`

```c
#define uip_setethaddr(eaddr) do { \
  uip_ethaddr.addr[0] = eaddr.addr[0]; \
  uip_ethaddr.addr[1] = eaddr.addr[1]; \
  uip_ethaddr.addr[2] = eaddr.addr[2]; \
  uip_ethaddr.addr[3] = eaddr.addr[3]; \
  uip_ethaddr.addr[4] = eaddr.addr[4]; \
  uip_ethaddr.addr[5] = eaddr.addr[5]; \
} while(0)
```

原文说明：“获取以太网的 MAC 地址”。ARP 代码需要知道以太网卡的 MAC 地址，才能回应 ARP 查询，并产生以太网头。注意：此宏只能用来确定以太网卡的 MAC 地址，并不能用来改变它。

原文参数说明：`eaddr` 指向 `uip_eth_addr` 结构体的指针，里面包含了以太网卡的 MAC 地址。宏定义于 `uip_arp.h`。

相关结构体定义于 `uip.h`：

```c
struct uip_eth_addr {
  u8_t addr[6];
};
```

#### 整理校注

1. `uip_sethostaddr()` 是**设置**主机 IP 地址，原文详细说明中的“获取”是笔误；`uip_gethostaddr()` 才是获取。
2. `uip_setethaddr()` 是把给定 MAC 地址**设置到 uIP 协议栈的 `uip_ethaddr` 中**，原文详细说明中的“获取”也是笔误。它不会替代网卡驱动去改写硬件的 MAC 寄存器；必须确保硬件与协议栈使用一致的 MAC。
3. 从原文保留的宏展开 `eaddr.addr[n]` 可见，`uip_setethaddr()` 接受的是一个 `struct uip_eth_addr` **结构体值表达式**，不是结构体指针。正确形式为 `uip_setethaddr(mac)`，其中 `mac` 是结构体变量；原文参数说明写成“指针”有误。
4. `uip_gethostaddr(&hostaddr)` 示例原文缺结束分号，这里已补齐。其他宏定义及代码的实质行为按原文保留。
5. `uip_ipaddr_t` 的具体底层表示取决于源码版本；不要因为原文写“4 字节的数组”就绕过 `uip_ipaddr()`、复制宏和配置接口自行假定结构布局。`octet` 准确指 8 位单位。
6. 这组是运行时配置接口；使用它们时还应核对所选源码中 `UIP_FIXEDADDR`、`UIP_FIXEDETHADDR` 的配置方式，确保与编译期固定地址配置一致。

<a id="uip-cn-4"></a>

### 中文资料第四篇 应用层接口

源文件：`UIP中文文档第四_应用层要调用的函数.doc`。正文据本地文档完整整理；只清除 Word 超链接域、论坛复制提示等排版噪声，并将旧 Doxygen 定义页和行号简化为文件名与接口名。原文中的接口拼写、代码和技术表述保留，疑点集中放在篇末“整理校注”。

#### 接口清单

这一部分包含的内容较多，包括一些宏定义和函数。

宏定义：

| 原文宏定义或接口 | 原文说明 |
|---|---|
| `#define uip_outstanding(conn) ((conn)->len)` | 原文列出此定义。 |
| `#define uip_datalen()` | 存放在 `uip_appdata` 中的现行可用的传入数据长度。 |
| `#define uip_urgdatalen()` | 到达连接的带外数据长度（紧急的）。 |
| `#define uip_close()` | 关闭当前连接。 |
| `#define uip_abort()` | 中止当前连接。 |
| `#define uip_stop()` | 告诉发送方主机停止发送数据。 |
| `#define uip_stopped()` | 查明当前连接是否以前被 `uip_stop()` 停止过。 |
| `#define uip_restart()` | 如果当前连接被 `uip_stop()` 停止过，重新开始。 |
| `#define uip_udpconnection()` | 查明当前连接是否是 UDP 连接。 |
| `#define uip_newdata()` | 查明新传入的数据是否可用。 |
| `#define uip_acked()` | 查明以前发送的数据是否得到回应了。 |
| `#define uip_connected()` | 查明连接是否连接上了。 |
| `#define uip_closed()` | 查明连接是否是被另一端关闭。 |
| `#define uip_aborted()` | 查明连接是否被另一端中止。 |
| `#define uip_timeout()` | 查明连接是否超时。 |
| `#define uip_rexmit()` | 查明是否需要将上次传送的数据重新传送。 |
| `#define uip_poll()` | 查明连接是否被 uIP 轮询了。 |
| `#define uip_initialmss()` | 获得当前连接的初始最大段大小。 |
| `#define uip_mss()` | 获取可以在当前连接上发送的最大段大小。 |
| `#define uip_udp_remove(conn)` | 移除一个 UDP 连接。 |
| `#define uip_udp_bind(conn,port)` | 绑定一个 UDP 连接到本地端口。 |
| `#define uip_udp_send(len)` | 在当前连接上发送一个长度为 `len` 的 UDP 数据报。 |

函数：

```c
void uip_listen(u16_t port);
void uip_unlisten(u16_t port);
uip_conn *uip_connect(uip_ipaddr_t *ripaddr, u16_t port);
void uip_send(const void *data, int len);
uip_udp_conn *uip_udp_new(uip_ipaddr_t *ripaddr, u16_t port);
```

依次用于：开始监听指定端口、停止监听指定端口、通过 TCP 连接到远程主机、在当前连接上发送数据，以及建立一个新的 UDP 连接。

#### 1. `uip_datalen()`

如果有当前可用的传入数据，获取其长度。必须先调用 `uip_data()` 查明是否有当前可用的传入数据。

应用例程：`dhcpc.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 2. `uip_urgdatalen()`

任何到达连接的带外数据（紧迫数据）长度。要使用此宏，应配置 `UIP_URGDATA` 宏为真。定义于 `uip.h`。

#### 3. `uip_close()`

此函数会以一种谨慎的方式关闭连接。

应用例程：`telnetd.c`。定义于 `uip.h`。

#### 4. `uip_abort()`

此函数用于中止（重置）当前连接，多用于出现错误导致无法使用 `uip_close()` 的场合。

应用示例：`webclient.c`。定义于 `uip.h`。

#### 5. `uip_stop()`

告诉发送主机停止发送数据。此函数会关闭接收机窗口，停止从当前连接接收数据。定义于 `uip.h`。

#### 6. `uip_restart()`

如果当前连接曾被 `uip_stop()` 停止，那么重新开始。该函数会重新打开接收机窗口，从当前连接上接收数据。定义于 `uip.h`。

#### 7. `uip_udpconnection()`

此函数查明当前连接是否是一个 UDP 连接。定义于 `uip.h`。

#### 8. `uip_newdata()`

如果 `uip_appdata` 指针所指之处有送给应用的新数据，此宏得到一个非零值。数据的大小可以通过 `uip_len` 获得。

应用例程：`dhcpc.c`、`resolv.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 9. `uip_acked()`

如果上次发送给远程主机的数据得到回应了，此宏得到一个非零值，这意味着应用可以发送新的数据。

应用例程：`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 10. `uip_connected()`

如果当前连接已经与远程主机连接，则此宏得到非零值。这包括两种情形：一是连接被主动打开（通过 `uip_connect()`），二是连接被被动打开（通过 `uip_listen()`）。

应用例程：`hello-world.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 11. `uip_closed()`

如果远程主机关闭了当前连接，则此宏得到非零值。这时应用可能要做一些清理工作。

应用例程：`smtp.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 12. `uip_aborted()`

如果当前连接被远程主机中止或重置，则为非零值。

应用例程：`smtp.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 13. `uip_timeout()`

如果当前连接由于多次重传导致超时中止，则为非零值。

应用例程：`smtp.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 14. `uip_rexmit()`

如果上次传输的数据在网络中丢失，而应用应该重新传输，则此宏得非零值。应用应该使用 `uip_send()` 重新传输与上次传输完全相同的数据。

应用例程：`telnetd.c`、`webclient.c`。定义于 `uip.h`；参考 `webclient_appcall()`。

#### 15. `uip_poll()`

这个宏解决的问题是连接是不是由 uIP 轮询的。如果应用收到请求的原因是因为当前连接空闲太久被 uIP 轮询了，此宏得到非零值。轮询事件是用来发送数据的，这无需等待远程主机发送数据。

应用例程：`resolv.c`、`telnetd.c`、`webclient.c`。定义于 `uip.h`；参考 `httpd_appcall()`、`resolv_appcall()`、`webclient_appcall()`。

#### 16. `uip_mss()`

在连接上传送的当前最大段大小，是由接收机的窗口计算和连接的 MSS 计算的（它可以由 `uip_initialmss()` 计算）。

应用例程：`telnetd.c`、`webclient.c`。定义于 `uip.h`。

#### 17. `uip_udp_remove(conn)`

移除一个 UDP 连接。

参数：`conn`，指向代表连接的 `uip_udp_conn` 结构体。

应用例程：`resolv.c`。定义于 `uip.h`；参考 `resolv_conf()`。

#### 18. `uip_udp_bind(conn, port)`

绑定一个 UDP 连接到本地端口。

参数：

- `conn`：指向代表 UDP 连接的 `uip_udp_conn` 结构体的指针。
- `port`：本地端口号，以网络字节顺序。

应用例程：`dhcpc.c`。定义于 `uip.h`。

#### 19. `uip_udp_send(len)`

在当前连接上发送一个长度为 `len` 的数据报。该函数只有在 UDP 事件（轮询或新数据）时才能调用。要发送的数据要提前送到 `uip_buf` 缓冲区中 `uip_appdata` 指针所指示的位置。

参数：`len`，存放在 `uip_buf` 中、要发送的数据报的长度。

应用例程：`resolv.c`。定义于 `uip.h`。

#### 20. `void listen(u16_t port)`（原文标题）

开始监听指定端口。注意：由于此函数中所用的参数 `port` 是网络字节顺序的，所以需要用到转换函数 `HTONS()` 或 `htons()`。

```c
uip_listen(HTONS(80));
```

参数：`port`，一个 16 位、以网络字节顺序的端口号。

应用例程：`hello-world.c`、`telnetd.c`。原文将定义位置标为 `uip.h` 的旧 Doxygen 页面。

#### 21. `void uip_unlisten(u16_t port)` 与原文紧接的 TCP 连接示例

停止监听指定端口。注意：由于这里面用到的 `port` 是以网络字节顺序的，所以需要用到 `HTONS()` 或 `htons()` 函数。

原文在此之后紧接下列连接示例及参数、返回值说明，未另列 `uip_connect()` 小标题，现保留这一编排并分段显示：

```c
uip_ipaddr_t ipaddr;
uip_ipaddr(&ipaddr, 192, 168, 1, 2);
uip_connect(&ipaddr, HTONS(80))
```

参数：

- `ripaddr`：远程主机的 IP 地址。
- `port`：16 位、网络字节顺序的端口号。

返回值：指向新连接的连接标识符的指针，当没有分配新连接时为 `NULL`。

应用例程：`smtp.c`、`webclient.c`。此函数定义于 `uip.c`。引用了 `htons()`、`uip_conn::lport`、`uip_conn::tcpstateflags`、`UIP_CLOSED`、`uip_conn`、`UIP_CONNS`、`uip_conns`。

#### 22. `void uip_send(void *data, int len)`（原文此处签名）

在当前连接上发送数据。此函数用于发送一个单段 TCP 数据。只有 uIP 因为事件处理而请求的应用才能发送数据。

调用这个函数后，实际发送数据量多少取决于 TCP 允许的数据量多少。uIP 会自动裁剪数据，以保证发出去的数据是适量的。可以用 `uip_mss()` 来查询实际可以发送的数据量。

注意：此函数不保证发送的数据能到达目的地。如果数据在网络中丢失，应用会接到请求，此时 `uip_rexmit()` 事件被置位。这时应用就得使用此函数重发数据。

参数：

- `data`：指向将要发送的数据的指针。
- `len`：要发送的数据的长度最大值。

应用例程：`dhcpc.c`、`telnetd.c`、`webclient.c`。定义于 `uip.c`；引用了 `uip_sappdata`、`uip_slen`。

#### 23. `struct uip_udp_conn *uip_udp_new(uip_ipaddr_t *ripaddr, u16_t rport)`

建立新的 UDP 连接。此函数用于建立一个新的 UDP 连接。此函数会自动为新连接分配一个本地未使用的端口。然而，也可以在调用 `uip_udp_new()` 函数之后，调用 `uip_udp_bind()` 选择一个新的端口。例如：

```c
uip_ipaddr_t addr;
struct uip_udp_conn *c;

uip_ipaddr(&addr, 192, 168, 2, 1);
c = uip_udp_new(&addr, HTONS(12345));
if(c != NULL) {
  uip_udp_bind(c, HTONS(12344));
}
```

参数：

- `ripaddr`：远程主机的 IP 地址。
- `rport`：远程主机的端口号，以网络字节顺序。

返回值：指向新连接结构体 `uip_udp_conn` 的指针，如果连接未能分配则为 `NULL`。

应用例程：`dhcpc.c`、`resolv.c`。定义于 `uip.c`；引用了 `htons()`、`uip_udp_conn::lport`、`uip_udp_conn`、`UIP_UDP_CONNS`、`uip_udp_conns`。

#### 整理校注

以下校注以作者发布的 uIP 1.0 源码为依据，区分原文与可用于实际工程的接口。

- 原文 `uip_timeout()` 应核对为 `uip_timedout()`；第 1 项中的 `uip_data()` 应为 `uip_newdata()`。正文保留原拼写便于与原件对照。
- 清单中的 `uip_stopped()` 缺少参数；1.0 实际形式是 `uip_stopped(conn)`。`uip_outstanding(conn)` 属于核心内部接口，不宜作为一般应用接口任意操作连接字段。
- `uip_connected()` 表示本次回调发生连接建立事件，不是可随时调用的永久连接状态查询。`uip_acked()` 表示当前跟踪的发送范围得到确认，不等于整个业务请求已经处理完成。
- 判断真实新输入并读取长度时，宜使用 `uip_newdata()` 与 `uip_datalen()`。1.0 的 `uip_restart()` 也会主动设置新数据标志，因此应用应在调用它之前保存本次真实输入事件，避免随后误读共享缓冲。
- 原文将重传归因于“数据在网络中丢失”，但未及时收到确认也可能源于 ACK 丢失或延迟。重传仍须提交原片段相同字节与原长度，不能在 `uip_send()` 后立即丢失重传来源。
- 原文第 20 项的 `listen` 应核对为 `uip_listen`；第 21 项的示例及 `ripaddr`、返回值说明实际上对应 `uip_connect()`，不是 `uip_unlisten()`。该连接示例最后一行还缺少分号。
- 清单省略了部分结构体名的 `struct`：正式声明是 `struct uip_conn *uip_connect(...)` 和 `struct uip_udp_conn *uip_udp_new(...)`。第 22 项的正式签名为 `void uip_send(const void *data, int len)`，与篇首清单一致。
- 原文地址示例保留了 `&ipaddr`、`&addr` 写法。正式 1.0 中 `uip_ipaddr_t` 为数组类型，`uip_ipaddr()` 宏内部进行指针转换，而 `uip_connect()`、`uip_udp_new()` 接受 `uip_ipaddr_t *`；原文这种取址形式与该版本接口相符。移用到其他分支时，仍应核对实际声明。
- “自动裁剪”不是允许向 `uip_send()` 提交任意长内存块的安全保证。正式 1.0 会先把所给数据复制到共享发送区，应用应在提交之前限制长度不超过缓冲容量与当前 `uip_mss()`，并自行管理分段与重传。
- `uip_mss()` 是当前发送片段限额，受连接 MSS 及对端窗口影响；该版对零窗口另有特殊策略，不能简化为无例外的最小值公式。UDP 的“连接”是协议栈保存远端地址和端口的本地结构，并不表示 TCP 式握手。

<a id="uip-cn-6"></a>

### 中文资料第六篇 Protothreads

源文件：`UIP中文文档第六_uIP原始线程(protothreads.doc`。原文使用“原始线程”译名。以下保留全部技术说明、清单和接口解释；只调整段落、标点、表格及旧 Doxygen 引用的呈现。原文中的拼写、含义冲突与实现限制集中在篇末校注，不在正文中默改。

#### 详细说明

“原始线程”是一种轻量级的、无需堆栈的线程。它主要用于内存极为受限的系统，如深入嵌入式系统、传感器网络等。“原始线程”是以 C 代码实现的，为事件驱动的系统提供了线性的代码执行空间。

“原始线程”既可以用在有实时操作系统的系统中，也可以用在没有实时操作系统的系统中。它在事件驱动的系统上层提供了阻塞上下文，省去了每个线程的单独堆栈空间开销。原始线程的目标是在没有复杂的状态机或多线程的情况下实现控制顺序流。原始线程在 C 语言内部实现了条件阻塞。

原始线程相对于纯事件驱动方法的优势，是原始线程提供了可以阻塞函数的顺序代码结构。在纯事件驱动的方法中，阻塞的实现必须将一个函数手动分成两个部分：一部分放在阻塞调用前，一部分放在阻塞调用后。这让使用 `if()` 和 `while()` 语句变得困难。

原始线程相对于普通线程的优势，是它不需要为每个线程分配堆栈。在内存受限的系统中，为每个线程分配堆栈空间会占用大量的内存。相比而言，原始线程的每个线程只需 2 到 12 个字节的状态字，具体多大与构架有关。

注意：由于原始线程的阻塞调用不需保存堆栈上下文，原始线程阻塞时，局部变量也不再保留。这意味着局部变量的使用必须十分小心。如果不确定，尽量不要在原始线程中使用局部变量。

#### 主要特性与应用

主要特性（原文列述）：

- 无机器相关代码——代码完全是 C 写的。
- 不使用错误——倾向于像 `longjump()` 这样的函数。
- 很小的 RAM 开销——每条线程仅两个字节。
- 既可以使用 OS，也可以不使用。
- 提供阻塞等待而无需多线程或堆栈切换。

主要应用：

- 内存受限系统。
- 事件驱动的协议栈。
- 深入嵌入式系统。
- 传感器网络。

原始线程包括四个基本操作：初始化（`PT_INIT()`）、执行（`PT_BEGIN()`）、条件阻塞（`PT_WAIT_UNTIL()`）和退出（`PT_EXIT()`）。在此之上，还有两个方便使用的函数：反向条件阻塞（`PT_WAIT_WHILE()`）和原始线程阻塞（`PT_WAIT_THREAD()`）。见“uIP 中文文档第五 原始套接字”。

原始线程的分布是基于一个类似于 BSD 的协议的。也就是说，允许商业的和非商业的使用。唯一的需要是 “credit is given”。

#### 原始线程与传统线程、协同程序

原文再次说明：原始线程是极端轻量级的、无需堆栈的线程。它在事件驱动的系统上层提供阻塞上下文，无需为每个线程提供堆栈的开销。原始线程的目标是在没有复杂的状态机或多线程的情况下实现控制顺序流。原始线程在 C 函数内部实现了条件阻塞。

在内存受限的系统中，如深入嵌入式系统，传统的多线程内存开销可能会显得过大。在传统线程中，每条线程都需要自己的堆栈，这种要求并非必要的。堆栈空间可能花去大部分内存空间。

原始线程相对于多线程的优势，在于原始线程相当轻量级，不需要自己的堆栈。相反，所有线程都运行在同一个堆栈中，上下文切换是通过堆栈的回转实现的。这在内存受限的系统中具有优势，因为那里一个线程的堆栈可能就占用了很大一部分内存。原始线程的每条线程只需两字节，而且原始线程是纯用 C 实现的，不需要任何与机器有关的汇编语言代码。

一个原始线程在一个 C 语言函数中运行，不能跨过多个函数。原始线程可以调用普通 C 语言函数，在调用的 C 语言函数中不能阻塞。嵌套调用函数内部的阻塞，是通过为可以阻塞的函数产生一个新的线程来实现的。这种方法的优点是阻塞是明确的，程序员确切地知道哪些函数可以阻塞，哪些函数永远也不会阻塞。

原始线程与不对称的协同程序相似，主要不同在于协同程序为每个协同程序使用单独堆栈，而原始线程无需堆栈。与原始线程最相似的机制是 Python 产生器。这些产生器也是无堆栈的结构，但用途不同。原始线程在 C 函数内部实现阻塞上下文，而 Python 产生器从产生函数中提供多个退出点。

#### 局部变量与调度

局部变量：由于原始线程的阻塞调用不需保存堆栈上下文，原始线程阻塞时，局部变量也不再保留。这意味着局部变量的使用必须十分小心。如果不确定，尽量不要在原始线程中使用局部变量。

调度：原始线程是通过重复调用宿主函数驱动的。每调用宿主函数一次，原始线程都会运行到阻塞或退出为止。这样说来，原始线程的调度是由使用原始线程的应用做到的。

#### 实现机制

原始线程的实现采用了 “local continuation” 机制。“local continuation” 代表一个程序在某个位置的当前执行状态，但不提供任何调用历史或局部变量。

“local continuation” 可以在指定函数内设定，以捕获程序状态。设定后可以恢复，以复原设定时函数的状态。

“local continuation” 有多种实现方法：

1. 使用机器相关的汇编语言。
2. 使用标准 C 结构体。
3. 使用编译器扩展。

第一种方式通过保存和恢复处理器状态实现，所说的处理器状态不包括堆栈指针。这种方式每个原始线程需要 16 到 32 字节的内存空间，具体是多少与处理器构架有关。

标准 C 语言的实现方式每个线程只需要 2 字节，它以一种不明显的方式优化了 C 语言中的 `switch()` 语句，这与 Duff 的设备类似。然而，这种实现对使用原始线程的代码稍有限制：不能在代码中使用 `switch()` 语句。

某些编译器的 C 语言扩展也可以实现原始线程。比如 GCC 支持标签指针，这就可以用于此目的。在这种实现方式下，每个原始线程需要 4 字节内存。

#### 文件、模块和数据结构

- 文件：`ft.h`（原文名称）。
- 原始线程的实现模块：Local continuation。
- 实现原始线程的基础数据结构：`struct pt`。

#### 接口与状态定义清单

| 分类 | 原文宏定义 | 原文说明 |
|---|---|---|
| 初始化 | `#define PT_INIT(pt)` | 初始化原始线程。 |
| 声明和定义 | `#define PT_THREAD(name_args)` | 声明原始线程。 |
| 声明和定义 | `#define PT_BEGIN(pt)` | 在要实现原始线程的函数内部声明原始线程开始。 |
| 声明和定义 | `#define PT_END(pt)` | 声明原始线程结尾。 |
| 阻塞等待 | `#define PT_WAIT_UNTIL(pt,condition)` | 等待直到条件为真。 |
| 阻塞等待 | `#define PT_WAIT_WHILE(pt,cond)` | 等待，只要条件为真。 |
| 分级的原始线程 | `#define PT_WAIT_THREAD(pt,thread)` | 阻塞等待子线程完成。 |
| 分级的原始线程 | `#define PT_SPAWN(pt,child,thread)` | 产生子进程并等待其结束。 |
| 退出和重启 | `#define PT_RESTART(pt)` | 重启原始线程。 |
| 退出和重启 | `#define PT_EXIT(pt)` | 退出原始线程。 |
| 调用原始线程 | `#define PT_SCHEDULE(pt)` | 调度原始线程。 |
| 原始线程让位 | `#define PT_YIELD(pt)` | 当前原始线程让位，即暂时中止，让别的线程先执行。 |
| 原始线程让位 | `#define PT_YIELD_UNTIL(pt)` | 当前原始线程让位，直到条件为真。 |

原文列出的状态定义：

```c
#define PT_WAITING 0
#define PT_EXITED 1
#define PT_ENDED 2
#define PT_YIELDED 3
```

#### 1. `PT_BEGIN(pt)`

在实现原始线程的 C 函数中声明原始线程开始。此宏用于声明原始线程的开始点，应该把它放在使用原始线程的函数的开头。放在此句之前的 C 语句，每次原始线程调度都会执行一次。

参数：`pt`，指向线程控制结构的指针。

应用例程：`dhcpc.c`。定义于 `pt.h`。

#### 2. `PT_END(pt)`

声明原始线程结尾。此宏用于声明原始线程的结尾，它通常必须与 `PT_BEGIN()` 宏匹配使用。

参数：`pt`，指向原始线程控制结构的指针。

应用例程：`dhcpc.c`。定义于 `pt.h`。

#### 3. `PT_EXIT(pt)`

退出原始线程。此宏使原始线程退出。如果退出的线程是一个子线程，则其父线程结束阻塞状态，得以继续运行。

参数：`pt`，指向原始线程控制结构的指针。定义于 `pt.h`。

#### 4. `PT_INIT(pt)`

初始化原始线程。初始化必须在使用之前完成。

参数：`pt`，指向原始线程控制结构的指针。

见 `PT_SPAWN()`；应用例程为 `dhcpc.c`。定义于 `pt.h`；被 `httpd_appcall()` 引用。

#### 5. `PT_RESTART(pt)`

重启原始线程。此宏会致使运行的线程从 `PT_BEGIN()` 处重新开始执行。

参数：`pt`，指向原始线程控制结构的指针。

应用例程：`dhcpc.c`。定义于 `pt.h`。

#### 6. `PT_SCHEDULE(f)`

调度线程。此函数调度线程，如果调度的线程在运行，则此函数返回非零值；如已经退出，则返回零值。

参数：`f`，要调度的线程的宿主函数调用。

原文将定义文件写为 `ph.h`。

#### 7. `PT_SPAWN(pt, child, thread)`

此宏用于产生一个子线程，并等待直到子线程退出。它只能用于线程内部。

参数：

- `pt`：指向线程控制结构的指针。
- `child`：指向子线程控制结构的指针。
- `thread`：带参数的子线程（原文参数说明的最后一句未写参数名，此处按清单标签排版）。

定义于 `pt.h`。

#### 8. `PT_THREAD(name_args)`

此宏用于声明原始线程，所有原始线程都必须由此声明。

应用例程：`dhcpc.c`、`smtp.c`。定义于 `pt.h`。

#### 9. `PT_WAIT_THREAD(pt, thread)`

阻塞并等待子线程完成。这个宏调度一个子线程，并等待子线程完成。

注意：在此函数使用之前，子原始线程必须通过 `PT_INIT()` 初始化。

参数：

- `pt`：指向原始线程控制结构体的指针。
- `thread`：带有参数的子线程。

定义于 `pt.h`。

#### 10. `PT_WAIT_UNTIL(pt, condition)`

阻塞等待，直到条件为真。此宏阻塞线程，直到指定条件为真。

参数：

- `pt`：指向原始线程控制结构体的指针。
- `condition`：指定条件。

应用例程：`dhcpc.c`。定义于 `pt.h`。

#### 11. `PT_WAIT_WHILE(pt, cond)`

阻塞等待，直到条件为真。此宏阻塞线程，只要指定条件为真。

参数：

- `pt`：指向原始线程控制结构体的指针。
- `condition`：指定条件（原文此处参数名与签名中的 `cond` 不同）。

定义于 `pt.h`。

#### 12. `PT_YIELD(pt)`

从当前线程中让位。这个函数会让当前线程让位，从而使其它线程先在系统中运行。

参数：`pt`，指向原始线程控制结构体的指针。

应用例程：`dhcpc.c`。定义于 `pt.h`。

#### 13. `PT_YEILD_UNTIL(pt, cond)`（原文拼写）

使当前线程让位，直到某条件发生。此函数会让当前线程让位，直到某条件为真。

参数：

- `pt`：指向原始线程控制结构的指针。
- `cond`：条件。

定义于 `pt.h`。

#### 整理校注

- `PT_WAIT_WHILE(pt, cond)` 的意思是“只要条件为真就继续等待；条件变假后继续执行”，不是第 11 项第一句写的“等待直到条件为真”。正式 1.0 中它展开为 `PT_WAIT_UNTIL((pt), !(cond))`。
- 第 13 项的 `PT_YEILD_UNTIL` 是拼写错误，应为 `PT_YIELD_UNTIL(pt, cond)`。清单中的 `PT_YIELD_UNTIL(pt)` 少了条件参数；`PT_SCHEDULE` 清单写 `pt`，详细说明写 `f`，正式形式是接受宿主函数调用表达式的 `PT_SCHEDULE(f)`。
- 文件名 `ft.h`、`ph.h` 应核对为 `pt.h`。Local continuation 的相关实现在 `lc.h`、`lc-switch.h`、`lc-addrlabels.h` 等文件中，具体选用方式应以所用版本为准。
- “阻塞”在这里是协作式等待：宿主函数返回，把执行机会交回调用者，后续再次调用时从保存的续点恢复。不是把整个 MCU 停在等待循环里，也不会自动调度其它线程。
- `PT_RESTART()` 会重置续点并返回；后续再次调度时从开头运行，不是在当前调用中立即跳回开头。`PT_YIELD_UNTIL()` 至少让位一次，并在之后的调度中检查继续条件。
- 自动局部变量的值不会跨等待、让位等返回点自动保留。需要跨事件使用的数据应放入持久状态，例如每连接的 `appstate`。不能为了保留值，就让多个连接随意共用同一个 `static` 变量；静态存储期不等于每连接私有。
- 原文多处出现 2 字节、2～12 字节、16～32 字节、4 字节等数值，它们涉及不同 local continuation 实现及目标架构。不能将其中任一数字当成所有平台的总开销；还要统计应用状态、缓冲区和普通调用栈。
- “无需堆栈”应理解为不为每个 Protothread 保存独立调用栈；执行 C 函数仍会使用调用者的栈。Protothreads 也可运行在不同 OS 线程上，不能把“所有线程共用同一个堆栈”泛化成任何集成方式都必然如此。
- “不使用错误——倾向于像 `longjump()` 这样的函数”是原文语义不顺的一句，`longjump` 也不是标准 C 函数名。这里宜理解为无需借助容易用错的 `setjmp`/`longjmp` 式上下文跳转；不能把正文当成建议调用这些函数。
- 基于 `switch` 的实现需要避免与续点宏发生冲突，尤其不能将等待等续点宏嵌入普通 `switch`。限制与所选 local continuation 后端有关，不应笼统推广成任何地方都禁止写 `switch`。
- `PT_SPAWN` 创建的是协作式子 Protothread，不是操作系统进程；需要由父线程调度并等待。原文比较协同程序和 Python 产生器的文字属于历史性说明，现代语言中的协程并不都使用独立栈。
- 原文第 6 项对“运行/退出”的口语解释应结合具体返回码理解。正式 1.0 的 `PT_SCHEDULE(f)` 定义为 `((f) == PT_WAITING)`；所列四个状态值与该发布版一致，不应套用其他版本的状态值或调度宏定义。
- 原文的“类似 BSD”与 “credit is given” 是许可证概述；实际再分发时应保留随源码附带的版权声明、许可条件和免责声明。

<a id="uip-cn-7"></a>

### 中文资料第七篇 编译时配置

原文件名：`UIP中文文档第七_uIP编译时配置选项.doc`。

以下为该篇技术正文的 Markdown 整理版，保留宏与类型清单、详细说明和示例代码，移除了 Word 超链接域、论坛续帖及编辑提示。宏清单中的说明沿用原资料含义；存在的旧注释、误译和代码问题在本篇末尾集中校注，不能将清单直接当作可编译配置文件。

#### 相关文件与工程配置

相关文件：

- `uip-conf.h`：uIP 配置文件。
- `uipopt.h`：uIP 配置选项。

uIP 有大量配置选项，都可以根据工程需要重载。它们保存在一个与工程相关的 `uip-conf.h` 文件中；工程配置项的名称带有 `UIP_CONF` 前缀。

| 原文宏或类型 | 原文说明 |
|---|---|
| `#define UIP_CONF_MAX_CONNECTIONS` | 最大 TCP 连接数。 |
| `#define UIP_CONF_MAX_LISTENPORTS` | 最大监听 TCP 端口数。 |
| `#define UIP_CONF_BUFFER_SIZE` | uIP 缓冲区大小。 |
| `#define UIP_CONF_BYTE_ORDER` | CPU 字节顺序。 |
| `#define UIP_CONF_LOGGING` | 是否开启日志。 |
| `#define UIP_CONF_UDP` | 是否启用 UDP 功能。 |
| `#define UIP_CONF_UDP_CHECKSUMS` | 是否启用“UDC 校验和”（原文如此）。 |
| `#define UIP_CONF_STATISTICS` | 是否开启 uIP 配置统计。 |
| `typedef uint8_t u8_t` | 8 位数据类型。 |
| `typedef uint16_t u16_t` | 16 位数据类型。 |
| `typedef unsigned short uip_stats_t` | 统计数据类型。 |

#### 静态配置选项

这些选项可用于静态配置 IP 地址，条件是 `UIP_FIXEDADDR` 必须设为 `1`。指定节点的配置选项包括 IP 地址、子网掩码、默认路由以及以太网地址；原文说明后三项只有在以太网中才可用。

| 原文宏 | 原文说明 |
|---|---|
| `#define UIP_FIXEDADDR` | 决定 uIP 是否使用固定 IP 地址。 |
| `#define UIP_PINGADDRCONF` | 设置 ping 地址。 |
| `#define UIP_FIXEDETHADDR` | ARP 模块是否按固定 MAC 地址编译。 |

#### IP 配置选项

| 原文宏或默认值 | 原文说明 |
|---|---|
| `#define UIP_TTL 64` | 定义 uIP 包的生存时间 TTL。 |
| `#define UIP_REASSEMBLY` | 打开 IP 包重新组装功能。 |
| `#define UIP_REASS_MAXAGE 40` | IP 分片被丢弃前，在重组缓冲区中等待的时间。 |

#### UDP 配置选项

| 原文宏 | 原文说明 |
|---|---|
| `#define UIP_UDP` | 是否将 UDP 支持加入编译。 |
| `#define UIP_UDP_CHECKSUMS` | 是否使用 UDP 校验和；原清单在宏名后多写了一个句点。 |
| `#define UIP_UDP_CONNS` | 最大并发 UDP 连接数。 |

#### TCP 配置选项

| 原文宏或默认值 | 原文说明 |
|---|---|
| `#define UIP_ACTIVE_OPEN` | 决定是否编译 uIP 主动打开连接的支持。 |
| `#define UIP_CONNS` | 最大同时打开 TCP 连接数。 |
| `#define UIP_LISTENPORTS` | 最大 TCP 监听端口数。 |
| `#define UIP_URGDATA` | 是否编译 TCP 紧迫数据提醒。 |
| `#define UIP_RTO 3` | 初始重传超时计数，以定时器脉冲个数计。 |
| `#define UIP_MAXRTX 8` | 一段数据最多重传多少次后取消连接。 |
| `#define UIP_MAXSYNRTX 5` | 一个 SYN 最多重传多少次后认定连接请求失败。 |
| `#define UIP_TCP_MSS (UIP_BUFSIZE - UIP_LLH_LEN - UIP_TCPIP_HLEN)` | TCP 最大段大小。 |
| `#define UIP_RECEIVE_WINDOW` | “广播接收器的最大窗口大小”（原清单如此）。 |
| `#define UIP_TIME_WAIT_TIMEOUT 120` | 一个连接处于 TIME_WAIT 状态的最大时间。 |

#### ARP 配置选项

| 原文宏或默认值 | 原文说明 |
|---|---|
| `#define UIP_ARPTAB_SIZE` | ARP 表大小。 |
| `#define UIP_ARP_MAXAGE 120` | ARP 表项最大存活年龄，单位为 10 秒。 |

#### 通用配置选项

| 原文宏或函数 | 原文说明 |
|---|---|
| `#define UIP_BUFSIZE` | uIP 包缓冲区大小。 |
| `#define UIP_STATISTICS` | 是否编译统计功能。 |
| `#define UIP_LOGGING` | 是否编译某些事件的日志功能。 |
| `#define UIP_BROADCAST` | 是否支持广播功能。 |
| `#define UIP_LLH_LEN` | 链路层头长度。 |
| `void uip_log(char *msg)` | 打印 uIP 日志信息。 |

#### CPU 架构配置

这里指定 CPU 的大小端模式。原资料介绍：“当今的 CPU 多是小端，最著名的例外是 Motorola 的 CPU，它是大端。”应根据 CPU 的大小端模式配置 `BYTE_ORDER`。

| 原文宏 | 原文说明 |
|---|---|
| `#define UIP_BYTE_ORDER` | uIP 所运行 CPU 的大小端模式。 |

#### 针对应用的配置

uIP 应用使用一个应用函数实现。TCP/IP 事件发生时，uIP 调用这个函数。函数名必须在编译时通过 `UIP_APPCALL` 注册。

uIP 应用可以在 `uip_conn` 结构中保存应用状态，方法是利用 `typedef uip_tcp_appstate_t` 和 `uip_udp_appstate_t` 指定应用状态类型。包含这些定义的文件必须被包含在 `uipopt.h` 中。以下为原文示例，保留其最后一行缺少分号的写法：

```c
void httpd_appcall(void);
#define UIP_APPCALL httpd_appcall

struct httpd_state {
  u8_t state;
  u16_t count;
  char *dataptr;
  char *script;
};

typedef struct httpd_state uip_tcp_appstate_t
```

原文还列出下列配置与类型条目。这是声明清单，并非一段完整可编译代码：

| 原文条目 | 原文说明 |
|---|---|
| `#define UIP_APPCALL smtp_appcall` | TCP/IP 事件的应答函数名称。 |
| `typedef smtp_state uip_tcp_appstate_t` | 存储在 `uip_conn` 中的应用状态类型。 |
| `typedef int uip_udp_appstate_t` | 存储在 `uip_conn` 中的应用状态类型（原文如此）。 |
| `#define UIP_LITTLE_ENDIAN 3412` | 小端标记常量。 |
| `#define UIP_BIG_ENDIAN 1234` | 大端标记常量。 |

#### 选项与类型的详细说明

##### 1. `UIP_ACTIVE_OPEN`

决定是否支持在 uIP 中主动打开连接。如果工程中运行在 uIP 上层的应用不需要主动打开 TCP 连接，可以关闭此选项，以减小编译后的代码大小。

定义文件：`uipopt.h`。

##### 2. `UIP_ARP_MAXAGE`

```c
#define UIP_ARP_MAXAGE 120
```

以 10 秒为单位的 ARP 表项最大年龄。`120` 对应 20 分钟，是 BSD 中的默认值。

定义文件：`uipopt.h`。引用函数：`uip_arp_timer()`。

##### 3. `UIP_ARPTAB_SIZE`

ARP 表大小。如果 uIP 节点可能在本地网络中有很多连接，应将此值设得较大。

定义文件：`uipopt.h`。引用函数：`uip_arp_init()`、`uip_arp_out()`、`uip_arp_timer()`。

##### 4. `UIP_BROADCAST`

用于配置广播支持；只有开启 UDP 时，这个标志才有意义。

定义文件：`uipopt.h`。

##### 5. `UIP_BUFSIZE`

uIP 包缓冲区大小。原文写作“不就小于 60 字节，不须大于 1500 字节”，其表述意图是给出 60～1500 字节的范围。原文认为这个值越小，TCP 吞吐量越小；值越大则相反。

定义文件：`uipopt.h`。引用函数：`uip_split_output()`。

##### 6. `UIP_BYTE_ORDER`

uIP 运行的 CPU 架构字节顺序。原文给出的可选值为 `BIG_ENDIAN` 和 `LITTLE_ENDIAN`。

应用例程：`example-mainloop-with-arp.c`、`example-mainloop-without-arp.c`。定义文件：`uipopt.h`。

##### 7. `UIP_CONNS`

可同时打开的最大 TCP 连接数。TCP 连接表采用静态分配，因此减小这个选项可以减少 RAM 占用。原文给出的估计是每个 TCP 连接大约需要 30 字节 RAM。

定义文件：`uipopt.h`。引用函数：`uip_connect()`。

##### 8. `UIP_FIXEDADDR`

决定 uIP 是否使用固定 IP 地址。如果使用固定 IP 地址，可以在 `uipopt.h` 中指定；如果需要动态设置 IP 地址，可以通过以下三个宏在运行时指定地址、默认路由和子网掩码：

```c
uip_sethostaddr(...);
uip_setdraddr(...);
uip_setnetmask(...);
```

定义文件：`uipopt.h`。

##### 9. `UIP_FIXEDETHADDR`

决定 uIP 是否使用固定 MAC 地址。如果不使用固定 MAC 地址，可使用 `uip_setethaddr()` 在运行时指定。

定义文件：`uipopt.h`。

##### 10. `UIP_LISTENPORTS`

可以同时监听的最大端口数。每监听一个 TCP 端口需要 2 字节内存。

定义文件：`uipopt.h`。引用函数：`uip_init()`、`uip_listen()`、`uip_unlisten()`。

##### 11. `UIP_LLH_LEN`

链路层头长度，也就是 IP 头在 `uip_buf` 中的偏移量。以太网对应 `14`，SLIP 对应 `0`。

定义文件：`uipopt.h`。引用函数：`uip_ipchksum()`、`uip_process()`、`uip_split_output()`。

##### 12. `UIP_LOGGING`

决定是否将事件日志加入编译。日志对于调试很有帮助。开启此选项后，必须在工程对应的平台上实现 `uip_log()`。

定义文件：`uipopt.h`。

##### 13. `UIP_MAXRTX`

```c
#define UIP_MAXRTX 8
```

同一段数据最多重传多少次后取消连接。原资料建议不改变这一项。

定义文件：`uipopt.h`。引用函数：`uip_process()`。

##### 14. `UIP_MAXSYNRTX`

```c
#define UIP_MAXSYNRTX 5
```

一个 SYN 最多重传多少次，超过后认为连接请求失败。原资料同样建议不改变这一项。

定义文件：`uipopt.h`。引用函数：`uip_process()`。

##### 15. `UIP_PINGADDRCONF`

设置 ping IP 地址。如果开启此项，uIP 使用 ping 包设置自己的 IP 地址。原文说明：启动时 IP 地址为空，把收到的第一个 ping 包用于设置自己的地址。此项只有在 `UIP_FIXEDADDR` 为 `0` 时才可用。

定义文件：`uipopt.h`。

##### 16. `UIP_REASSEMBLY`

打开 IP 包重组功能。uIP 支持碎片 IP 包的重新组装；该特性需要额外 RAM 保存重组缓冲区。原文估计重组代码大小约为 700 字节，重组缓冲区大小与 `uip_buf` 一样，由 `UIP_BUFSIZE` 配置。

原资料特别注明：IP 包重组没有经过严格测试。

定义文件：`uipopt.h`。

##### 17. `UIP_RECEIVE_WINDOW`

通告的接收器窗口。如果处理器对输入数据的处理能力较慢，原文建议设得较低，例如使用 `uip_buf` 的大小；否则可以设得较高，例如 32768 字节。

定义文件：`uipopt.h`。

##### 18. `UIP_RTO`

```c
#define UIP_RTO 3
```

以时钟脉冲计算的重传超时计数。原资料建议不改变此项。

定义文件：`uipopt.h`。引用函数：`uip_process()`。

##### 19. `UIP_STATISTICS`

决定是否将统计功能加入编译。统计信息对于调试以及向用户显示状态很有帮助。

定义文件：`uipopt.h`。

##### 20. `UIP_TCP_MSS`

```c
#define UIP_TCP_MSS (UIP_BUFSIZE - UIP_LLH_LEN - UIP_TCPIP_HLEN)
```

TCP 最大数据段大小。此值不应大于：

```text
UIP_BUFSIZE - UIP_LLH_LEN - UIP_TCPIP_HLEN
```

定义文件：`uipopt.h`。

##### 21. `UIP_TIME_WAIT_TIMEOUT`

```c
#define UIP_TIME_WAIT_TIMEOUT 120
```

一个连接应该停留在 TIME_WAIT 状态的最长时间。原文接着说明：“此配置选项没有真正的实现，所以不应理会。”这句话按原资料保留，其与正式源码的差异见后文校注。

定义文件：`uipopt.h`。原文列出的引用函数为 `uip_process()`。

##### 22. `UIP_TTL`

```c
#define UIP_TTL 64
```

uIP 发出 IP 包的生存时间 TTL。原资料建议通常不改变这一项。

定义文件：`uipopt.h`。

##### 23. `UIP_UDP_CHECKSUMS`

决定是否使用 UDP 校验和。原文特别说明：“对 UDP 校验和的支持目前并不包含于 uIP，故此项无用。”这条旧注释按原资料保留，其与正式源码的差异见后文校注。

定义文件：`uipopt.h`。

##### 24. `UIP_URGDATA`

决定是否编译 TCP 紧迫数据通告功能。紧迫数据，即带外数据，在 TCP 中使用较少，所以通常不需要该功能。

定义文件：`uipopt.h`。

##### 25. `u16_t`

```c
typedef uint16_t u16_t;
```

16 位数据类型。这个类型定义指定整个 uIP 中使用的 16 位数据类型。

应用例程和头文件：`dhcpc.c`、`dhcpc.h`、`resolv.c`、`resolv.h`、`smtp.c`、`smtp.h`、`telnetd.c`、`uip-conf.h`。定义文件：`uip-conf.h`。

##### 26. `u8_t`

```c
typedef uint8_t u8_t;
```

8 位数据类型。这个类型定义指定整个 uIP 中使用的 8 位数据类型。

应用例程和头文件：`dhcpc.c`、`dhcpc.h`、`resolv.c`、`smtp.h`、`telnetd.c`、`telnetd.h`、`uip-conf.h`。定义文件：`uip-conf.h`。

##### 27. `uip_stats_t`

```c
typedef unsigned short uip_stats_t;
```

统计数据类型。这个类型定义指定整个 uIP 中使用的统计数据类型。

定义文件：`uip-conf.h`。

##### 28. `uip_tcp_appstate_t`

这种类型的应用状态保存在 `uip_conn` 结构中，通常通过 `typedef` 定义为保存应用状态信息的结构。

应用例程：`smtp.h`、`telnetd.h`、`webclient.h`。原资料所列定义文件：`smtp.h`。

##### 29. `uip_udp_appstate_t`

原文说明：这种类型的应用状态保存在 `uip_conn` 结构中，通常通过 `typedef` 定义为保存应用状态信息的结构。这里保留原文结构名称，正确名称见校注。

应用例程：`dhcpc.h`。原资料所列定义文件：`resolv.h`。

##### 30. `uip_log()`

```c
void uip_log(char *msg);
```

打印 uIP 日志信息。使用 uIP 的模块必须实现这个函数；uIP 每产生一条日志信息，就调用一次该函数。

#### 第七篇整理校注

1. **TIME_WAIT 的旧注释与正式 1.0 源码不符。** `uip.c` 的 `UIP_TIMER` 分支会给 `UIP_TIME_WAIT`、`UIP_FIN_WAIT_2` 连接的 `timer` 加一，达到 `UIP_TIME_WAIT_TIMEOUT` 后关闭连接。因此不能按“未实现、可以忽略”处理。其单位是调用协议栈周期处理的次数；使用 500 ms 周期时，`120` 次对应约 60 秒。
2. **UDP 校验和的旧注释同样与源码不符。** 正式 1.0 `uip.c` 中已有受 `UIP_UDP_CHECKSUMS` 控制的输入校验及输出校验和计算，不能据 `uipopt.h` 中沿用的旧注释认定其无效。输入路径允许 IPv4 UDP 校验和字段为零；非零时才检验其值。配置清单中的“UDC”是笔误，所指是 UDP；`UIP_UDP_CHECKSUMS` 宏名本身也没有末尾句点。
3. **`UIP_RECEIVE_WINDOW` 应译为“向对端通告的 TCP 接收窗口”。** 清单中的“广播接收器”是对 advertised receive window 的误译，与广播无关。详细说明中的 32768 是历史建议值；实际应根据接收处理能力、可保留数据量以及具体应用流控确定，不能超出应用能可靠接收的范围。
4. **UDP 应用状态属于 `struct uip_udp_conn`。** `uip_tcp_appstate_t` 存在 `struct uip_conn` 的 `appstate` 中；`uip_udp_appstate_t` 存在 `struct uip_udp_conn` 的 `appstate` 中。UDP 回调使用 `UIP_UDP_APPCALL`，不能只依赖 TCP 的 `UIP_APPCALL`。通过 `uip-conf.h` 引入应用头文件即可使 `uipopt.h` 间接获得这些声明，须避免相互包含。
5. **字节序必须按具体 MCU 与编译器确认。** Motorola 的笼统举例不是选型规则，有些架构可以选择字节序；也不能把“单片机”一概视为大端。该发布版实际使用 `UIP_LITTLE_ENDIAN`、`UIP_BIG_ENDIAN` 两个宏及其值 `3412`、`1234`；这些数值是 uIP 的约定标记，不是应按个人理解交换的数值。工程通常通过 `UIP_CONF_BYTE_ORDER` 选择，头文件会映射为 `UIP_BYTE_ORDER`。
6. **原文示例与清单不是可直接复制的完整 C 配置。** HTTP 状态 `typedef` 的末尾缺少分号；实际应写成 `typedef struct httpd_state uip_tcp_appstate_t;`。SMTP 状态的准确声明也应以对应应用头文件为准。前面的无值 `#define` 与类型条目只是索引；它们不表示把所有宏定义成空值。整型位宽必须在目标编译器下验证。
7. **内存和缓冲范围是历史量级。** “每 TCP 连接约 30 字节”没有包含任意应用状态、对齐和编译器差异；必须按实际 `sizeof(struct uip_conn)`、连接数、每连接缓冲及其他全局缓冲计算。“60～1500 字节”也不是通用硬性范围，必须同时核查链路层头、IP/TCP 头、MTU、驱动容量与 MSS 公式。重组代码约 700 字节同样取决于编译条件。
8. **`UIP_FIXEDADDR=0` 允许运行时配置，不等于自动启用 DHCP。** 可在初始化时调用三个设置地址的宏配置静态地址；真正使用 DHCP 仍需 DHCP 客户端与相应应用衔接。`UIP_PINGADDRCONF` 则是从首个符合条件的 ping 包目标地址取得本机地址的特殊配置机制，并非普通 ping 应答功能的总开关。

<a id="uip-cn-8"></a>

### 中文资料第八篇 应用程序

原文件名：`UIP中文文档第八_uIP应用程序.doc`。

以下保留本篇全部应用列表、简介和相关变量，移除了 Word 超链接域。此原文件本身篇幅很短，没有包含各应用实现代码或更长的调用教程。

#### 详细说明

uIP 发行版包含大量应用程序。它们既可直接使用，也可用于学习如何编写 uIP 应用。

#### 相关模块

| 模块 | 原文说明 |
|---|---|
| DNS resolver | “DNS 服务器”，用于查找主机名并映射为 IP 地址；此称呼沿用原文，角色校正见篇末。 |
| SMTP E-mail sender | RFC 821 定义的简单邮件传输协议，是在因特网上发送和传输邮件的标准方法。 |
| Telnet server | uIP Telnet 服务器。 |
| Hello, world | 一个小例程，用于讲述如何使用“原始套接字”编写应用；术语校正见篇末。 |
| Web client | HTTP 客户端，可以从网络服务器下载网页和文件。 |
| Web server | 一个非常简单的网络服务器实现。 |

#### 相关变量

原文列出 Telnet 状态结构中的以下四个成员：

```text
char telnetd_state::buf[TELNETD_CONF_LINELEN]
char telnetd_state::bufptr
u8_t telnetd_state::numsent
u8_t telnetd_state::state
```

这里的 `telnetd_state::成员名` 是文档生成器表示“结构成员”的标记，并非让 C 程序采用 C++ 的作用域语法。按 C 结构成员声明排版，原文列出的四项为：

```c
char buf[TELNETD_CONF_LINELEN];
char bufptr;
u8_t numsent;
u8_t state;
```

#### 第八篇整理校注

1. **DNS resolver 是 DNS 解析客户端，不是 DNS 服务器。** 正式发布版 `apps/resolv/resolv.c` 与 `resolv.h` 提供 `resolv_query()` 等接口，向配置的 DNS 服务器发出查询，再通过结果回调提供主机名对应的 IP 地址。
2. **Hello, world 中的“原始套接字”指 uIP protosockets。** 它不是通常网络编程中绕过 TCP/UDP 协议处理的 raw socket。该示例用于展示 uIP 的 protosocket 编程方式，应与原始报文套接字区分。
3. **“相关变量”不是完整的 Telnet 状态结构。** 原文确实只列出了上述四项；正式发布版 `telnetd.h` 的结构另外还有 `char *lines[TELNETD_CONF_NUMLINES];`。本整理保留原文四项范围，不把它冒充完整结构定义。`bufptr` 在该旧示例中实际声明为 `char`，不能仅凭名称理解成指针。
4. **应用列表说明的是该历史发布版示例。** SMTP 条目对 RFC 821 的引用、Telnet 及简单 Web 示例应按其原始学习背景理解；它们没有在这篇资料中提供现代邮件认证、TLS 或其他完整应用部署步骤。

<a id="uip-cn-paper"></a>

### 补充资料 单片机移植文章技术正文与原始代码

来源：《UIP协议在单片机上的移植与实现》（2011 年 5 月）。本节保留第 1 至第 3 章技术文字、参考文献及附录重点函数，未收入封面个人信息、声明、致谢和末尾夹带的无关合同。原始 Word 图形未转写，以下涉及连接图及流程图的文字按历史材料保留。

以下为历史资料整理，不代表对原文每项结论的认可。代码含原始拼写、标点和平台混用问题，保留用于对照；可编译的最小工程见博客前面的配套链接。

#### 1 概述

#### 1.1 研究背景

近些年来，人们对把各种装置连接到一个现有的IP网络比如因特网上产生了浓厚的兴趣。为了能通过因特网通讯，一个可实现的TCP/IP协议栈是很必要的。对于由32位嵌入式处理器构建的中、高端网络接入嵌入式系统，一般会运行一个集成有TCP/IP协议栈的操作系统。但是对于由8位和16位低端处理器构建的系统，因为它所具有的处理能力和资源十分有限，通常不运行操作系统，这就要求系统开发者根据应用的要求和所选用的处理器的实际情况构建自己的TCP/IP协议栈，而TCP/IP协议的透明性掩盖了它实现的复杂性，从无到有构建一个协议栈是一件艰巨的任务，并且缺少有效的调试工具。uIP TCP/IP协议栈是应用于低端8位或16位微处理器构建的嵌入式系统的一个可实现的极小的TCP/IP协议栈，它可以用于商业和非商业目的。为了方便于移植uIP使用C语言编写，而且uIP协议栈的代码大小和RAM的需求比其它一般的TCP/IP栈要小，这就使得它可以方便的应用于各种低端系统上。本文将简要描述uIP的实现方法，分析uIP协议栈的应用接口，并讨论如何将其应用到51系列单片机上。

#### 1.2 研究意义

单片机在嵌入式领域中属于很低端的处理器，它的资源和处理能力有限。首先，它的数据存储空间RAM和程序存储空间ROM都不能超过64K；其次，它的CPU频率通常在12M～40M之间，指令的执行速度相对较慢，导致网络传输速度很难上去。据计算，12M 的51 单片机的最快网络传送速度大概是25KB/s。这些特点导致在单片机上不可能运行大而全的 TCP/IP 协议栈，需要使用精简的嵌入式协议栈。虽然通讯流量和处理速度不允许很大，但对于一般的楼宇、工业、家居智能化等领域也足够应付。更重要的是，它的成本很低，具有很高的经济价值。考虑到这些原因，uIP 协议栈是一个不错的选择。因此本文以基于单片机控制的硬件和uIP 协议栈介绍单片机TCP/IP 网络编程与应用。

#### 1.3 研究思路

本文将简要描述uIP协议的实现方法，分析其在单片机上的移植过程，研究其关键库函数的功能及其使用方法，并讨论如何将其应用到51系列单片机上。

#### 2 UIP协议在单片机上的移植过程

#### 2.1 UIP特性

uIP 协议栈去掉了完整的TCP/IP系统中不常用的功能，简化了通讯流程，只保留了网络通信必须使用的协议，设计重点放在了IP/TCP/ICMP/UDP/ARP这些网络层和传输层的协议上，因此保证了其代码的通用性和结构的稳定性。由于uIP协议栈专门为嵌入式系统而设计，因此还具有以下优越功能：

（1）代码非常少，其协议栈代码不到6K，方便阅读与移植。

（2）占用的内存数极少，RAM占用仅几百字节。

（3）它的硬件处理层、协议栈层和应用层共用一个全局缓存区，不存在数据拷贝，而且发送和接收都是依靠这个缓存区，极大的节省了空间和时间。

（4）支持多个主动连接和被动连接并发。

（5）它的源代码中提供一套实例程序：web 客户端，web 服务器，Telnet 服务器，电子邮件发送程序(SMTP 客户端)， DNS 主机名解析程序等。通用性强，移植起来基本不用修改就可通过。

（6）在数据的处理上采用轮循机制，不需要操作系统的支持。由于 uIP 对资源的需求少而且移植容易，大部分的8位微控制器都使用过uIP协议栈, 而且很多著名的嵌入式产品和项目(如卫星，Cisco 路由器，无线传感器网络)中均在使用uIP 协议栈。

#### 2.2 UIP 架构

uIP相当于一个代码库，通过一系列的函数实现与底层硬件和高层应用程序之间的通讯，对于整个系统来说它内部的协议组是透明的，从而增加了协议的通用性。

uIP协议栈与系统底层和高层应用之间的关系如图（一）所示：

图（一） uIP在系统中的位置

uIP 协议栈主要提供了三个函数供系统底层调用。即uip_init(), uip_input()和uip_periodic()。其与应用程序的主要接口是UIP_APPCALL( )。uip_init()是系统初始化时调用的，主要用于初始化协议栈的侦听端口和默认所有连接是关闭的。当网卡驱动收到一个输入包时，将其放入全局缓冲区 uip_buf 中，包的大小由全局变量uip_len 约束。同时将调用uip_input()函数，这个函数将会根据包首部的协议处理这个包并在需要时调用应用程序。当uip_input()返回时，一个输出包同样放在全局缓冲区uip_buf 里，并把大小赋给uip_len。若uip_len 是0，则说明没有包要发送；否则调用底层系统的发包函数就会将包发送到网络上。uIP周期计时用于驱动所有的uIP内部时钟事件：当周期计时激发，每一个TCP连接都会调用uIP函数uip_periodic()。类似于uip_input()函数，uip_periodic()函数返回时，输出的IP 包要放到uip_buf 中，供底层系统查询uip_len 的大小并发送。由于TCP/IP 的应用场景很多，所以应用程序作为单独的模块由用户实现。uIP 协议栈提供一系列接口函数供用户程序调用，其中大部分函数是作为C的宏命令实现的，主要是为了速度、代码大小、堆栈和效率的使用。用户需要将应用层入口程序作为接口提供给uIP协议栈，并将这个函数定义为UIP_APPCALL（）。这样以来，uIP 在接受到底层传来的数据包后，在需要送到上层应用程序处理的地方，调用UIP_APPCALL( )，在不用修改协议栈的情况下可以适配不同的应用程序。

#### 2.3 UIP 在MCS-51单片机上的移植

1．为此项目建立一个keil C 工程，建立src 目录存放源文件。

2．通过阅读uip-1.0\unix\main.c，了解uIP 的的主循环代码架构，并将main.c

放到src 目录下。

3．仿照uip-1.0\unix\tapdev.c 写网卡驱动程序，与具体硬件相关。这一步比较费点时间，不过好在大部分网卡芯片的驱动程序都有代码借鉴或移植。驱动需要提供三个函数。etherdev_init（）：网卡初始化函数，初始化网卡的工作模式。u16_t etherdev_read(void)：读包函数。将网卡收到的数据放入全局缓存区uip_buf 中，返回包的长度，赋给uip_len。void etherdev_send(void)：发包函数。将全局缓存区uip_buf 里的数据（长度放在uip_len 中）发送出去。因此，收包和发包主要是操作uip_buf 和uip_len。

4．因为uIP 协议栈需要使用时钟，为TCP 和ARP 的定时器服务，所以使用单片机的定时器0 用作时钟，每20ms 让计数tick_cnt 加1，这样，25 次计数（0.5S）满了后可以调用TCP 的定时处理程序，10S 后可以调用ARP 老化程序。对uIP1.0 版本，增加了timer.c/timer.h，专门用来管理时钟，都放到src 下。

5．uIP 协议栈的主要内容在uip-1.0\uip\下的uip.c/uip.h 中，放到src 下。如果需要ARP 协议，需要将uip_arp.c 和uip_arp.h 也放到src 下。

6．uipopt.h/uip-conf.h 是配置文件，用来设置本地的IP 地址、网关地址、MAC 地址、全局缓冲区的大小、支持的最大连接数、侦听数、ARP 表大小等。需要放在src 下，并且根据需要配置。在V1.00 版本中对配置做了如下修改：

（1）配置IP 地址，默认先关IP，在初始化中再设定。

```c
#define UIP_FIXEDADDR 0
#define UIP_IPADDR0 192
#define UIP_IPADDR1 168
#define UIP_IPADDR2 1
#define UIP_IPADDR3 9
#define UIP_NETMASK0 255
#define UIP_NETMASK1 255
#define UIP_NETMASK2 255
#define UIP_NETMASK3 0
#define UIP_DRIPADDR0 192
#define UIP_DRIPADDR1 168
#define UIP_DRIPADDR2 1
#define UIP_DRIPADDR3 1
```

（2）设置MAC 地址

```c
#define UIP_FIXEDETHADDR 1
#define UIP_ETHADDR0 0x00
#define UIP_ETHADDR1 0x4f
#define UIP_ETHADDR2 0x49
#define UIP_ETHADDR3 0x12
#define UIP_ETHADDR4 0x12
#define UIP_ETHADDR5 0x13
```

（3）ping 功能

```c
#define UIP_PINGADDRCONF 1
```

（4）关闭主动请求连接的功能

```c
#define UIP_ACTIVE_OPEN 0
```

（5）将uip_tcp_appstate_t 定位u8_t 类型。

（6）由于单片机是大端结构，因此宏定义需要修改

```c
#define UIP_CONF_BYTE_ORDER UIP_BIG_ENDIAN
```

（7）暂时不移植打印信息，先关闭

```c
#define UIP_CONF_LOGGING 0
```

（8）定义数据结构类型

```c
typedef unsigned char u8_t;
typedef unsigned int u16_t;
typedef unsigned long u32_t;
```

7．若使用 keil C 的小模式编译，则需要在大部分的RAM 的变量前增加xdata。

8．data为keil C 的关键词，代码中所有出现data 的地方（主要是参数、局部变量、结构体成员）改为pucdata或ucdata。

9．解决编译过程中的错误。由于uIP 协议栈是用C 语言编写，所以编译过程中的问题比较少，并且容易解决。

#### 3 UIP协议在单片机上的实现

#### 3.1 UIP协议关键库函数的功能及使用方法

应用程序必须作为C函数去实现，uIP在任何一个事件发生时调用UIP_APPCALL()。表 1 列出了可能的事件和每个事件的对应测试函数，测试函数用于区别不同的事件。函数是作为C宏命令实现的，将会是零或非零值。注意，某些函数可以在互相连接时发生(即新数据可以在数据确应的同时到达)。

表 1  uIP应用事件和对应的测试参数

| 原文事件描述 | 测试宏 |
|---|---|
| 一个数据包到达，确定先前发送到数据 | `uip_acked()` |
| 应用程序的新数据包已到达 | `uip_newdata()` |
| 一个远程主机连接到监听端口 | `uip_connected()` |
| 一个到达远程主机的连接建立成功 | `uip_connected()` |
| 计时时间满重发 | `uip_rexmit()` |
| 计时时间满周期性轮询 | `uip_poll()` |
| 远程主机关闭连接 | `uip_closed()` |
| 远程主机中断连接 | `uip_aborted()` |
| 由于太多重传，连接中断 | `uip_timedout()` |


当应用程序调用时，uIP设置全局变量uip_conn去指向当前连接的uip_conn结构，这可以用于区别不同的服务。一个典型的应用是检查uip_conn->lport (当地TCP端口号)去决定哪个服务连接应该提供。例如，如果值uip_conn->lport等于80，应用程序可以决定启动一个HTTP服务；若值是23，则是启动TELNET服务。

#### 3.1.1 接收数据

如果uIP测试函数uip_newdata()的值为1,则远程连接的主机有发送新数据，uip_appdata指针指向实际数据，数据的大小通过uIP函数uip_datalen()获得。在数据不是被缓冲后，应用程序必须立刻启动。

#### 3.1.2 发送数据

应用程序通过使用uIP函数uip_send()发送数据。uip_send()函数采用两个参数：一个指针指向发送数据和数据的长度。如果应用程序为了产生要发送的实际数据需要RAM空间，包缓存(通过uip_appdata指针指向)可以用于这方面。在一个时间里应用程序只能在连接中发送一块数据，所以不可以在每个应用程序启用中调用uip_send()超过一次，只有上一次调用的数据将会发出后才可以。注意，调用uip_send()后会改变某些全局变量，在应用函数返回前它不能被调用。

#### 3.1.3 重发数据

若数据在网络中丢失，则应用程序必须重新发数据。无论是数据收到还是没有收到，uIP都保持跟踪，并通知应用程序什么时候察觉出数据丢失了。若测试函数uip_rexmit()为真，则应用程序要重发上一次发出的数据。重发就好像原来那样发送，也就是通过uip_send()发送。

#### 3.1.4 关闭连接

应用程序通过调用uip_close()关闭当前连接，这会导致连接干净地关闭。为了指出致命的错误，应用程序可以通过中止连接和调用uip_abort()函数完成这项工作。若连接已经被远端关闭，则测试函数uip_closed()为真，应用程序接着可以做一些必要的清理工作。

#### 3.1.5 报告错误

有两个致命的错误可以发生在连接中：连接由远程主机中止和连接多次重发上一数据而被中止。uIP通过调用函数报告这些问题，应用程序使用两个测试函数uip_aborted()和uip_timedout() 去测试这些错误情况。

#### 3.1.6 轮询

当连接空闲时，uIP周期性地轮询应用程序，应用程序使用测试函数uip_poll()去检查它是否被轮询过。

#### 3.1.7 监听端口

uIP维持一个监听TCP端口列表，通过uip_listen()函数，一个新的监听端口被打开。当一个连接请求在一个监听端口到达，uIP产生一个新的连接。若一个新连接产生，则应用程序被调用，测试函数uip_connected()为真。

#### 3.1.8 打开连接

作为uIP的0.6版，在uIP里面通过使用uip_connect()函数打开一个新连接。这个函数打开一个新连接到指定的IP地址和端口，返回一个新连接的指针到uip_conn结构。若是没有空余的连接槽，则函数返回空值。为了方便，函数uip_ipaddr()可以用于将IP地址打包进两个单元16位数组里，通过uIP去代表IP地址。

接下来用两个例子说明。第一个例子展示了怎样打开一个连接去远端TCP端口8080。若没有足够的TCP连接插槽去允许一个新连接打开，则uip_connect()函数返回NULL并通过uip_abort()中止当前连接。第二个例子展示怎样打开一个新连接去指定的IP地址。

例1：打开一个连接去远端TCP端口8080。

```c
void connect_example1_app(void)
{
if(uip_connect(uip_conn->ripaddr, 8080) == NULL)
 {
uip_abort();
}
}
```

例2:打开一个连接去当前连接的远端的端口8080。

```c
void connect_example2(void)
 {
u16_t  ipaddr[2];
uip_ipaddr(ipaddr, 192,168,0,1);
uip_connect(ipaddr, 8080);
}
```

#### 3.1.9 数据流控制

uIP通过函数uip_stop()和函数uip_restart()提供对存取TCP数据流的控制途径。假如一个应用程序下载数据到一个慢速设备，例如磁盘驱动器。当磁盘驱动器的作业队列满时，应用程序不会准备从服务器接收更多的数据，直到队列排出空位。函数uip_stop()可以用于维护流控制和停止远程主机发送数据。当应用程序准备好接收更多数据时，可用函数uip_restart()告知远程终端再次发送数据。函数uip_stopped()可以用于检查当前连接是否停止。

#### 3.1.10 UIP函数总结

表 2 包含了所有uIP提供的函数

表 2 uIP 函数总结（按原表字段重新排版，原文接口拼写保留）。

| 分类 | 接口 | 原文说明 |
|---|---|---|
| 系统接口 | `uip_init()` | 初始化 uIP |
| 系统接口 | `uip_input()` | 处理输入包 |
| 系统接口 | `uip_periodic()` | 处理周期计时事件 |
| 应用接口 | `uip_listen()` | 开始监听端口 |
| 应用接口 | `uip_connect()` | 连接到远程主机 |
| 应用接口 | `uip_send()` | 在当前连接发送数据 |
| 应用接口 | `uip_datalen()` | 输入数据的大小 |
| 应用接口 | `uip_close()` | 关闭当前连接 |
| 应用接口 | `uip_abort()` | 中止当前连接 |
| 应用接口 | `uip_stop()` | 停止当前连接 |
| 应用接口 | `uip_stopped()` | 查找连接是否停止 |
| 应用接口 | `uip_restart()` | 重新启动当前连接 |
| 测试函数 | `uip_newdata()` | 远程主机已经发出数据 |
| 测试函数 | `uip_acked()` | 确定发出的数据 |
| 测试函数 | `uip_connected()` | 当前连接刚连上 |
| 测试函数 | `uip_closed()` | 当前连接刚关闭 |
| 测试函数 | `uip_aborted()` | 当前连接刚中止 |
| 测试函数 | `uip_timeout()` | 当前连接刚超时 |
| 测试函数 | `uip_rexmit` | 数据重发 |
| 测试函数 | `uip_poll()` | 应用程序循环运行 |
| 其他 | `uip_mss()` | 获得当前连接的最大段的大小 |
| 其他 | `uip_ipaddr()` | 将 IP 地址结构打包 |
| 其他 | `htons(), ntohs()` | 在主机和网络之间转换字节次序 |

#### 3.2 重点代码分析

从系统的立场看，uIP有3个C函数，即uip_init()，uip_input()和 uip_periodic()。uip_init()函数用于初始化uIP堆栈在系统启动期间的调用。当网络设备驱动器读一个IP包到包缓存时，调用函数uip_input()。周期性运行时调用uip_periodic()，代表的是一秒一次。

#### 3.2.1 UIP/设备驱动接口

当设备驱动在包缓存里(uip_buf)放一个输入包，系统应该调用uip_input()函数。函数将会处理这个包并在需要时调用应用程序。当uip_input()返回，一个输出包放在包缓存里，包的大小由全局变量uip_len约束。如果uip_len是0，则没有包要发送。

#### 3.2.2 UIP/周期计时接口

周期计时用于驱动所有uIP内部时钟事件，例如包重发。当周期计时激发，每一个TCP连接应该调用uIP函数uip_periodic()。连接编号传递作为自变量给uip_periodic()函数。类似于uip_input()函数，当uip_periodic()函数返回，输出的IP包要放在包缓存里。在这个特别的例子，函数netdev_send()是网络驱动的部分，将uip_buf数组的目录发出到网上。

```c
for(i = 0; i < UIP_CONNS; ++i) {
    uip_periodic(i);
    if(uip_len > 0) {
        netdev_send();
    }
}
```

#### 3.2.3 UIP协议栈提供的主要接口

提供的接口在 uip.h 中，为了减少函数调用造成的额外支出，大部分接口函

数以宏命令实现。

1．初始化uIP协议栈：uip_init()

2．处理输入包：uip_input()

3．处理周期计时事件：uip_periodic()

4．开始监听端口：uip_listen()

5．连接到远程主机：uip_connect()

6．接收到连接请求：uip_connected()

7．主动关闭连接：uip_close()

8．连接被关闭：uip_closed()

9．发出去的数据被应答：uip_acked()

10．在当前连接发送数据：uip_send()

11．在当前连接上收到新的数据：uip_newdata()

12．告诉对方要停止连接：uip_stop()

13．连接被意外终止：uip_aborted()

#### 3.3 以太网的芯片ENC28J60介绍及编程

#### 3.3.1 ENC28J60介绍

ENC28J60 是带有行业标准串行外设接口（SerialPeripheral Interface，SPI）的独立以太网控制器。 它可作为任何配备有SPI 的控制器的以太网接口，ENC28J60 符合IEEE 802.3 的全部规范，采用了一系列包过滤机制以便对传入数据包进行限制。它还提供了一个内部DMA 模块，以实现快速数据吞吐和硬件支持的IP校验和计算，通过两个中断引脚和SPI 实现与主控制器的通信，数据传输速率高达10 Mb/s。两个专用的引脚用于连接LED，进行网络活动状态指示。要将单片机连接到速率为10 Mbps 的以太网，只需ENC28J60、两个脉冲变压器和一些无源元件即可。ENC28J60 由七个主要功能模块组成：

1. SPI 接口——充当主控制器和ENC28J60 之间的通信通道。

2. 控制寄存器——用于控制和监视ENC28J60。

3. 双端口RAM缓冲器——用于发送和接收数据包。

4. 判优器——当DMA、发送和接收模块发出请求时对RAM 缓冲器的访问进行控制。

5. 总线接口——对通过SPI 接收的数据和命令进行解析。

6. MAC （Medium Access Control）模块——实现符合IEEE 802.3 标准的MAC 逻辑。

7. PHY（物理层）模块——对双绞线上的模拟数据进行编码和译码。该器件还包括其他支持模块，如片内稳压器、振荡器、电平变换器（提供可以接受5V 电压的I/O引脚）和系统控制逻辑。

各模块工作特性如下：

（1）以太网控制器特性

- IEEE 802.3 兼容的以太网控制器
- 接收器和冲突抑制电路
- 集成MAC 和10 BASE-T PHY
- 支持半双工和全双工模式
- 支持一个带自动极性检测和校正的10BASE-T 端口
- 可编程在发生冲突时自动重发
- 可编程填充和CRC 生成
- 可编程自动拒绝错误数据包
- 最高速度可达10 Mb/s
（2）缓冲器

- 8 KB 发送/ 接收数据包双端口SRAM
- 可配置发送/ 接收缓冲器大小
- 硬件管理的循环接收FIFO
- 用于快速数据传送的内部DMA
- 字节宽度的随机访问和顺序访问（地址自动递增）
- 硬件支持的IP 校验和计算
（2）介质访问控制器（即MAC）特性

- 支持单播、组播和广播数据包
- 可编程数据包过滤，并在以下事件的逻辑“与”和“或”结果为真时唤醒主机：
- 单播目标地址

- 组播地址

- 广播地址

- 由64 位哈希表定义的组目标地址

- Magic Packet

- 多达64 字节的可编程模式匹配（偏移量可由用户定义）

- 环回模式
（3）物理层（PHY）特性

- 环回模式
- 整形输出滤波器
（4）工作特性

- 两个用来表示连接、发送、接收、冲突和全/ 半双工状态的可编程LED 输出
- 25 MHz 时钟
- 使用两个中断引脚的七个中断源
- 带可编程预分频器的时钟输出引脚
- 工作电压范围是3.14V ——3.45V
- TTL 电平输入
- 温度范围：-40°C——+85°C （工业级）， 0°C ——+70°C （商业级）（仅SSOP 封装）
- 28 引脚SPDIP、SSOP、SOIC 和QFN 封装
#### 3.3.2 ENC28J60与单片机的连接

ENC28J60与微控制器MCU的连接是通过SPI实现的，支持10Mbps。对于没有SPI接口的芯片可通过用I/O口模拟SPI接口的方式实现。ENC28J60仅支持SPI模式0,0。

微控制器可通过SPI接口发送命令，访问ENC28J60的寄存器或读写接收/发送缓冲区，完成相关操作。复位也可通过SPI接口用软件实现，其中软件复位不影响RESET引脚的状态。

ENC28J60有两个中断输出，分别用于事件中断触发和网络唤醒主机。

CPU采用LPC2138用宏定义实现SPI口读写操作。SOSPDR为SPI数据寄存器，该双向寄存器为SPI提供发送和接收的数据，发送数据通过写该寄存器提供，SPI接收的数据可从该寄存器读出。SOSPSR为SPI状态寄存器，在对SPI接口进行操作之前需对其初始化。以下是读/写SPI接口的源代码：

```c
　　　#defineREADSPI（Val）
　   ｛
　　　　 S0SPDR=0x00;
　　　   while（0==（S0SPSR&0x80））
　　　   Val=S0SPDR;
　　　｝
```

```c
　　　　 #defineWRITESPI（Val）
　　　　｛
　　　　 if（0==（S0SPSR&0x40））
           ｛
　　　　      S0SPDR=Val;　　　　          while（0==（S0SPSR&0x80））
　　　　     ｝　　　　          ｝
```

uIP的设置单独包含在一个叫uipopt.h的头文件里，都是以宏的形式定义方便修改。用户应根据自己的应用在uipopt.h文件里设置本地的物理地址、IP地址、网关地址、收发缓冲区的大小、支持的最大连接数、ARP表大小等选项。添加必须的模块，对uIP进行了正确地配置后，需要编写主程序函数。针对基于以太网WEBSERVER应用，主程序在完成初始化后将不停的进行查询，若有新数据包到达则送uip_input（）函数处理，没有新数据包到达则处理定时事件。流程图如下所示：


#### 原文参考文献

[1]李广弟，朱月秀，王秀山.单片机基础[M].北京:北京航空航天大学出版社,2001.7
[2]韩志军，沈晋源，望振波.单片机应用系统设计[M].北京:机械工业出版社,2005
[3]楼然苗，李光飞.51单片机设计实例[M].北京:北京航空航天大学出版社,2003
[4]雷晓平等编.单片机及其应用[M].成都:电子科技大学出版社,2005.6
[5]李兰友等编.单片机开发应用十例[M].北京:电子工业出版社,2006.7
[6]吴微,文军等编.单片机原理及制作[M].武汉:武汉大学出版社,2004.12
[7]靳达.单片机应用系统开发实例导航[M].北京:人民邮电出版社, 2003.10
[8]周志敏,周纪海等编.LED驱动电路设计与应用[M].北京:人民邮电出版社,2004.8
[9]何立民.单片机高级教程[M].北京:北京航空航天大学出版社,2001
[10]夏继强.单片机实验与实践教程[M].北京: 北京航空航天大学出版社,2001
[11]阎石.数字电子技术基础[M].北京:高等教育出版社,2005

#### 原文附录 重点函数程序

原文依次包括 USART、ARP 相关代码及主函数。下面保留原始技术代码，未将其改写成另一份可编译工程。

```c
(1) USART函数
#include "USART.h"
#include "STC12C5A.h"
#define BAUD 9600
//串口初始化
void USART_Init()
{
	PCON &= 0x7f;		//波特率不倍速 SMOD=0
	SCON = 0x50;		//8位数据,可变波特率
	AUXR |= 0x40;		//定时器1时钟为Fosc,即1T
	AUXR &= 0xfe;		//串口1选择定时器1为波特率发生器
	TMOD &= 0x0f;		//清除定时器1模式位
	TMOD |= 0x20;		//设定定时器1为8位自动重装方式
	TL1 = 0xB2;		//设定定时初值
	TH1 = 0xB2;		//设定定时器重装值
	ET1 = 0;			//禁止定时器1中断
	TR1 = 1;			//启动定时器1
	ES = 1;			//开串行中断
	EA = 1;			//开总中断
}	                 //发送一个字符,ASCII码
void SendASC(unsigned char d)
{
	SBUF=d;
	while(!TI);	//等待发送完成,TI置位
	TI=0;
}
//发送字符串
void SendString(unsigned char *str)
{
	while(*str)
	{
		SendASC(*str) ;
		str++;
	}
}
//串口中断服务程序
void USART_Interrupt(void)  interrupt 4	  //放在这里和放在main（）里面一样
{
	unsigned char RxData=0;
	EA=0;
    if(RI) 			//必须判断RI(接收中断标志)是否为1
    {
        RI=0;
        RxData = SBUF;	//在这里添加你的接收代码
		SendString("The word you send is ");
		SendASC(RxData);
		SendASC('\n');
  }
	EA=1;
}
(2) uip_arp函数
#include "uip_arp.h"
#include <string.h>
struct arp_hdr
{
  struct uip_eth_hdr ethhdr;
  u16_t hwtype;
  u16_t protocol;
  u8_t hwlen;
  u8_t protolen;
  u16_t opcode;
  struct uip_eth_addr shwaddr;
  u16_t sipaddr[2];
  struct uip_eth_addr dhwaddr;
  u16_t dipaddr[2];
}
struct ethip_hdr
{
  struct uip_eth_hdr ethhdr;
  u8_t vhl；
  tos；
  len[2]；
  ipid[2]；
  ipoffset[2]；
  ttl；
  proto;
  u16_t ipchksum;
  u16_t srcipaddr[2]；
  destipaddr[2];
}
#define ARP_REQUEST 1
#define ARP_REPLY 2
#define ARP_HWTYPE_ETH 1
struct arp_entry
{
  u16_t ipaddr[2];
  struct uip_eth_addr ethaddr;
  u8_t time;
}
struct uip_eth_addr uip_ethaddr =
{
      {
        UIP_ETHADDR0；
        UIP_ETHADDR1；
		 UIP_ETHADDR2；
        UIP_ETHADDR3；
		 UIP_ETHADDR4；
		 UIP_ETHADDR5；
      }
}
static struct arp_entry arp_table[UIP_ARPTAB_SIZE];
static u16_t ipaddr[2];
static u8_t i, c;
static u8_t arptime;
static u8_t tmpage;
#define BUF   ((struct arp_hdr *)&uip_buf[0])
#define IPBUF ((struct ethip_hdr *)&uip_buf[0])
--------*/
Void uip_arp_init(void)
{
for(i = 0; i < UIP_ARPTAB_SIZE; ++i)
{
    memset(arp_table[i].ipaddr, 0, 4);
    }
}
--------*/
Void uip_arp_timer(void)
{
  struct arp_entry *tabptr;
  ++arptime;
for(i = 0; i < UIP_ARPTAB_SIZE; ++i)
{
    tabptr = &arp_table[i];
    if((tabptr->ipaddr[0] | tabptr->ipaddr[1]) != 0 &&
      arptime - tabptr->time >= UIP_ARP_MAXAGE)
    {
      memset(tabptr->ipaddr, 0, 4);
     }
   }
}
--------*/
static void uip_arp_update(u16_t *ipaddr, struct uip_eth_addr *ethaddr)
{
  register struct arp_entry *tabptr;
for(i = 0; i < UIP_ARPTAB_SIZE; ++i)
{
    tabptr = &arp_table[i];
    if(tabptr->ipaddr[0] != 0 &&
       tabptr->ipaddr[1] != 0)
    {
      if(ipaddr[0] == tabptr->ipaddr[0] &&
	    ipaddr[1] == tabptr->ipaddr[1])
      {
	    memcpy(tabptr->ethaddr.addr, ethaddr->addr, 6);
	    tabptr->time = arptime;
	    return;
       }
     }
  }
for(i = 0; i < UIP_ARPTAB_SIZE; ++i)
{
     tabptr = &arp_table[i];
     if(tabptr->ipaddr[0] == 0 &&
       tabptr->ipaddr[1] == 0)
   {
      break;
    }
 }
   if(i == UIP_ARPTAB_SIZE)
{
    tmpage = 0;
    c = 0;
for(i = 0; i < UIP_ARPTAB_SIZE; ++i)
{
      tabptr = &arp_table[i];
      if(arptime - tabptr->time > tmpage)
       {
	      tmpage = arptime - tabptr->time;
	      c = i;
        }
     }
    i = c;
  }
  memcpy(tabptr->ipaddr, ipaddr, 4);
  memcpy(tabptr->ethaddr.addr, ethaddr->addr, 6);
  tabptr->time = arptime;
}
--------*/
Void uip_arp_ipin(void)
{
uip_len -= sizeof(struct uip_eth_hdr);
if((IPBUF->srcipaddr[0] & uip_arp_netmask[0]) !=
    (uip_hostaddr[0] & uip_arp_netmask[0]))
 {
    return;
  }
  if((IPBUF->srcipaddr[1] & uip_arp_netmask[1]) !=
     (uip_hostaddr[1] & uip_arp_netmask[1]))
  {
    return;
   }
  uip_arp_update(IPBUF->srcipaddr, &(IPBUF->ethhdr.src));
  return;
}
--------*/
Void uip_arp_arpin(void)
{
if(uip_len < sizeof(struct arp_hdr))
 {
    uip_len = 0;
    return;
   }
  uip_len = 0;
switch(BUF->opcode)
{
      case HTONS(ARP_REQUEST):
      if(BUF->dipaddr[0] == uip_hostaddr[0] &&
      BUF->dipaddr[1] == uip_hostaddr[1])
  {
      BUF->opcode = HTONS(2);
      memcpy(BUF->dhwaddr.addr, BUF->shwaddr.addr, 6);
      memcpy(BUF->shwaddr.addr, uip_ethaddr.addr, 6);
      memcpy(BUF->ethhdr.src.addr, uip_ethaddr.addr, 6);
      memcpy(BUF->ethhdr.dest.addr, BUF->dhwaddr.addr, 6);
      BUF->dipaddr[0] = BUF->sipaddr[0];
      BUF->dipaddr[1] = BUF->sipaddr[1];
      BUF->sipaddr[0] = uip_hostaddr[0];
      BUF->sipaddr[1] = uip_hostaddr[1];
      BUF->ethhdr.type = HTONS(UIP_ETHTYPE_ARP);
      uip_len = sizeof(struct arp_hdr);
    }
    break;
    case HTONS(ARP_REPLY):
    if(BUF->dipaddr[0] == uip_hostaddr[0] &&
    BUF->dipaddr[1] == uip_hostaddr[1])
{
      uip_arp_update(BUF->sipaddr, &BUF->shwaddr);
     }
    break;
  }
  return;
}
---------*/
Void uip_arp_out(void)
{
  struct arp_entry *tabptr;
  if((IPBUF->destipaddr[0] & uip_arp_netmask[0]) !=
    (uip_hostaddr[0] & uip_arp_netmask[0]) ||
    (IPBUF->destipaddr[1] & uip_arp_netmask[1]) !=
    (uip_hostaddr[1] & uip_arp_netmask[1]))
{
    ipaddr[0] = uip_arp_draddr[0];
    ipaddr[1] = uip_arp_draddr[1];
}
else
{
    ipaddr[0] = IPBUF->destipaddr[0];
    ipaddr[1] = IPBUF->destipaddr[1];
  }
for(i = 0; i < UIP_ARPTAB_SIZE; ++i)
{
    tabptr = &arp_table[i];
    if(ipaddr[0] == tabptr->ipaddr[0] &&ipaddr[1] == tabptr->ipaddr[1])
     {
    break;
}
 }
if(i == UIP_ARPTAB_SIZE)
 {
    memset(BUF->ethhdr.dest.addr, 0xff, 6);
    memset(BUF->dhwaddr.addr, 0x00, 6);
    memcpy(BUF->ethhdr.src.addr, uip_ethaddr.addr, 6);
    memcpy(BUF->shwaddr.addr, uip_ethaddr.addr, 6);
    BUF->dipaddr[0] = ipaddr[0];
    BUF->dipaddr[1] = ipaddr[1];
    BUF->sipaddr[0] = uip_hostaddr[0];
    BUF->sipaddr[1] = uip_hostaddr[1];
BUF->opcode = HTONS(ARP_REQUEST);
    BUF->hwtype = HTONS(ARP_HWTYPE_ETH);
    BUF->protocol = HTONS(UIP_ETHTYPE_IP);
    BUF->hwlen = 6;
    BUF->protolen = 4;
    BUF->ethhdr.type = HTONS(UIP_ETHTYPE_ARP);
    uip_appdata = &uip_buf[40 + UIP_LLH_LEN];
    uip_len = sizeof(struct arp_hdr);
    return;
  }
  memcpy(IPBUF->ethhdr.dest.addr, tabptr->ethaddr.addr, 6);
  memcpy(IPBUF->ethhdr.src.addr, uip_ethaddr.addr, 6);
  IPBUF->ethhdr.type = HTONS(UIP_ETHTYPE_IP);
  uip_len += sizeof(struct uip_eth_hdr);
}
（3）主函数
#incldue<reg52.h>
void  main(void)
{
  unsigned char i;
  unsigned char arptimer=0;
  USART_init(); //网络初始化函数
  nic_init();//uip协议栈初始化
  uip_init();// init app 应用程序初始化,如tcp或者udp ,http的应用
httpd_init();// init ARP cache 初始化arp协议的缓冲
  uip_arp_init(); // init periodic timer 初始化周期函数定时器
  initTimer(); //开放中断
 //主循环
  while(1)
 {
    uip_len = nic_poll();
    if(uip_len == 0)//如果没有数据包
    {
      if(timerCounter > TIMERCOUNTER_PERIODIC_TIMEOUT)
      {
        timerCounter = 0;
        for(i = 0; i < UIP_CONNS; i++)
         {
             uip_periodic(i);//周期性检查函数
		      if(uip_len > 0) //如果包长度大于0 发送包
           {
 uip_arp_out();//主动发送和重发数据包在此进行
            nic_send();
           }
         }
        if(++arptimer == 20)//更新arp表
        {
          uip_arp_timer();
          arptimer = 0;
         }
     }
  }
    else  // packet received 接收到网络数据包
    {
      // process an IP packet 处理ip数据包
      if(BUF->type == htons(UIP_ETHTYPE_IP))
      {
            uip_arp_ipin();
        uip_input();
        if(uip_len > 0)
        {
          uip_arp_out();
          nic_send();
         }
       }
      // process an ARP packet 处理arp包
      else if(BUF->type == htons(UIP_ETHTYPE_ARP))
      {
        uip_arp_arpin();
        if(uip_len > 0)
         {
           nic_send();
          }
       }
   }
}
```

#### 整理校注

1. 文中“单片机”有时实际指传统 51，后续又使用 LPC2138、STC12C5A、`reg52.h` 及不同寄存器。不能把这些片段视为同一套已验证的硬件工程。`xdata`、`data` 关键字处理是 Keil C51 的平台事项。
2. 原文对所有单片机的容量、频率、大小端，以及 uIP 使用范围所作泛化，是历史材料中的表述；目标芯片与编译器须单独确认。“代码不到 6K”“RAM 几百字节”不能作为本工程资源保证，应用持久数据与编译器布局也会增加占用。
3. “不存在数据拷贝”不能概括正式 1.0 的所有路径。发布版 `uip_send()` 会把本次应用数据复制到共享发送区；应用仍须保留或重建重传来源。
4. `UIP_FIXEDADDR=0` 时，原文列出的静态 IP 宏不能替代运行时的 `uip_sethostaddr()`、`uip_setnetmask()`、`uip_setdraddr()`。`UIP_PINGADDRCONF` 是通过 ping 包配置本机 IP 的特殊功能，不是普通 ping 应答开关。
5. 文中 `uip_connect(..., 8080)` 等端口示例应按接口要求使用网络字节序，例如 `HTONS(8080)`。事件表中的 `uip_timeout()` 应核对为正式 1.0 的 `uip_timedout()`。
6. 原文同时给出 TCP 0.5 秒与 1 秒周期。当前配套工程采用经典示例的 TCP 500 ms、ARP 10 s；500 ms 是周期驱动粒度，不是固定重传间隔。定时检查独立于接收，不采用原文“无包才处理定时”的分支安排。
7. 不能把任意应用的 `uip_tcp_appstate_t` 都压缩成一个 `u8_t`；它必须能容纳该应用每连接需要保存的状态。回显应用另有持久缓冲与发送进度。
8. `uip_stop()` 是接收反压，不是关闭连接。`uip_connected()`、`uip_acked()` 等是当前回调的事件标志，不是任意时刻的永久状态查询。
9. 附录保留的 `#incldue`、`Void`、全角符号、缺失声明等属于原始代码问题。原版 ARP 时间差的回绕问题已在配套工程用单独补丁修正；不要把原始附录直接当作该修正后的实现。
10. 事件测试宏按零与非零判断；原文“`uip_newdata()` 的值为 1”不应理解为必须等于整数 1。表中的 `uip_rexmit` 实际用作 `uip_rexmit()`；函数总结表和事件表已按原字段重新排版，未把原文口语说明当成标准接口定义。
