---
title: uIP 1.0 最小移植工程接入说明
layout: page
comments: false
---

# uIP 1.0 单片机最小移植框架

[下载完整工程](/downloads/uip10/uip10-minimal-port.zip) · [返回协议栈原理文章](/2026/10/23/uip10-porting-blog/)

此工程提供网卡接口、初始化、主循环、独立 TCP 与 ARP 定时处理，以及带持久缓冲和重传处理的 TCP 回显应用。随包包含作者发布的 uIP 1.0 核心六文件，并对 ARP 时间差计算做了三处显式类型转换，以修复 8 位时间回绕问题；来源、补丁和校验值见 `third_party/SOURCE.md`。

默认配置是 IPv4、普通无 VLAN 以太网、静态 IP `192.168.1.50/24`、网关 `192.168.1.1`、MAC `02:00:00:00:00:50`、TCP 回显端口 `1234`、两条并发 TCP 连接。UDP、IPv6、IP 分片重组和 IPv4 选项未启用。原版 ICMP echo 路径保留，可用于 ping 验证。

硬件适配位置统一标为 `TODO_HW`。默认板级模板主动报编译错误，防止把未实现的驱动当作可运行固件。主机测试使用 fake board，不会触发这个板级模板错误。

## 文件与调用关系

```text
main.c                         初始化后反复调用 uip_port_run_once()
config/port_config.h           IP/MAC、缓冲区、回显端口、周期
config/port_types.h            整数类型与目标编译器适配
config/uip-conf.h              uIP 大小端、连接数、应用入口等
port/board_port.h              硬件接口及明确的数据布局约定
port/board_port.c              TODO_HW 网卡、GPIO/SPI/EMAC、毫秒时钟
core/uip_port.c                初始化、帧分发、立即输出、独立定时处理
app/tcp_echo.c                 连接事件、复制输入、ACK、重传、接收反压
third_party/uip/               uIP 1.0 核心与已记录的 ARP 回绕修正
tests/                         不需要网卡的真实协议栈报文测试
tools/echo_client.py           上板后使用的 Python 回显验证客户端
```

```text
board_nic_read -> uip_buf/uip_len -> IPv4 / ARP 分发
  IPv4 -> uip_arp_ipin -> uip_input -> tcp_echo_appcall
        -> 有输出时 uip_arp_out -> board_nic_send
  ARP  -> uip_arp_arpin -> 有输出时 board_nic_send

每次主循环还独立检查：
  每 500 ms：遍历全部 TCP 连接 uip_periodic -> 有输出时立即发送
  每  10 s：uip_arp_timer
```

## 需要根据硬件修改的位置

| 位置 | 修改内容 |
|---|---|
| `port/board_port.c` 的 `board_init` | MCU 时钟、GPIO、SPI/EMAC 引脚与外设初始化 |
| `board_nic_init` | 具体网卡复位、寄存器、PHY、MAC 地址、收发缓存；0 表示成功 |
| `board_nic_read` | 非阻塞读取一帧、检查状态、限长复制、丢弃错误帧并释放 RX 缓存 |
| `board_nic_send` | 同步复制/发送，处理以太网最小帧填充及 FCS；0 表示成功 |
| `board_tick_init` 和示意 ISR | 实际硬件定时器，每 1 ms 更新一次计数，并正确清中断标志 |
| `board_millis` | 原子读取 32 位毫秒计数；8/16 位 MCU 通常需要保存并恢复中断状态 |
| `config/uip-conf.h` | MCU 实际大小端、TCP 连接数和监听数 |
| `config/port_config.h` | 真实网段、唯一 MAC、回显端口与 RAM 容量 |
| `config/port_types.h` | 老编译器的精确整数类型、C51 存储模型等 |
| `main.c` | 初始化失败后的 LED/UART 等处理策略 |

完成板级函数后，将 `BOARD_PORT_IMPLEMENTED` 改为 `1`。MCU 工程中编译 `main.c`、`port/board_port.c`、`core/uip_port.c`、`app/tcp_echo.c`、`third_party/uip/uip.c` 和 `third_party/uip/uip_arp.c`；把 `config`、`port`、`core`、`app`、`third_party/uip` 加入头文件搜索路径。不要加入 `tests/host_test.c`，也不要再加入原 Unix 平台的 `main.c`。

通用部分按 C99 编译。Cortex-M 等平台可据 HAL 接入；这不是特定型号的 BSP。Keil C51 还需处理缺少 `stdint.h`、`xdata`、通用指针与核心中的 `data` 关键字等问题，不能只换几条 typedef 就认定已经移植完成。源码原有的结构体布局、整型宽度和访问对齐须在目标编译器确认。

## 网卡接口约定

`board_nic_read(frame, capacity)` 返回一帧有效长度；无包、坏包或超长包返回 0。数据从以太网目的 MAC 开始，包含 14 字节以太网头，不含前导码、芯片私有接收头和 FCS。任何时候都不能写超过 `capacity`；超长帧必须整帧丢弃，不能截断后交给协议栈。

`board_nic_send(frame, length)` 接收当前完整、连续的以太网帧。此约定已与实际 1.0 发布版的 `uip_send()` 复制行为核对。长度不足最小以太网帧时由驱动或硬件补齐，FCS 也由驱动或硬件生成。若使用 DMA，返回之前须等 DMA 完成，或先复制到驱动私有 TX 缓冲区；返回后 uIP 会立即复用 `uip_buf`。发送等待须有上限，失败视为丢包，由 TCP 重传恢复；建议在板级驱动记录错误计数以便调试。

网卡收到帧后设置 `uip_len` 的输入阶段，它表示含以太网头的长度；`uip_input()` 产生 IP 输出后，`uip_len` 暂为 IP 长度；`uip_arp_out()` 之后才是实际以太网发送长度。每次生成输出都立即发送，不能遍历完连接后才统一处理共享缓冲区。

## 时钟与并发规则

硬件 ISR 只更新时基或设置接收事件；协议栈、回显应用和收发接口全部由同一个主循环或 RTOS 任务串行调用。`volatile` 无法保证 8/16 位 MCU 上的 32 位读取原子性，必须在 `board_millis()` 中处理。

`uip_port_run_once()` 每轮最多读取一帧，然后无条件调用独立的定时处理。TCP 每 500 ms、ARP 每 10 s，两个到期判断互相独立，且都不依赖“当前没有收到包”。定时使用无符号差值处理计数回绕，通过累加周期推进时间基准，避免逐轮漂移。

一次调用每类定时器最多补偿 4 个遗漏周期；其余欠账保留到后续循环，避免长时间阻塞后一次补偿无限占用 CPU。正常运行仍应频繁调用主循环，不能依靠补偿机制容忍长期阻塞；连接可能在补偿过程中正常超时。时钟不得在运行中重置，且两次定时处理的间隔须小于完整的 32 位毫秒回绕周期（约 49.7 天）。

## 回显应用行为

每个 TCP 连接有自己的持久 `payload` 缓冲，输入到达后立即从共享 `uip_appdata` 复制。按 `uip_mss()` 分片发送，记录未确认片段的长度；收到 `uip_acked()` 后才推进偏移，发生 `uip_rexmit()` 时提交同一片段的相同字节和长度。

缓冲被占用期间调用 `uip_stop()` 通告零窗口，全部回显被 ACK 后再 `uip_restart()`。期间到达而未被核心接受的后续数据不会被应用误当作新数据；发送端保留这些数据并在窗口恢复后重传。应用在入口快照 `uip_newdata()`，避免把 `uip_restart()` 设置的标志误当成真实输入。此策略优先保证简单明确的缓冲所有权，吞吐量较低，适合作为最小移植起点。

默认包缓冲是 600 字节，IPv4 TCP MSS 为 `600 - 14 - 20 - 20 = 546` 字节；每连接回显缓冲也是 546 字节。两连接仅回显状态就约占 `2 × (546 + 6) = 1104` 字节，另有 602 字节全局包缓冲、连接基础字段、ARP 表和调用栈；实际以链接 map 为准。资源紧张时可减小缓冲及连接数，但修改后须同步核查窗口、MSS 和测试配置。

**原版 1.0 的关闭限制：客户端应按 `send -> 收齐相同字节数的 echo -> close` 使用。** 原版 TCP 核心收到携带数据的 FIN 会立即进入 FINACK 路径，无法由回调延后关闭来完成这些数据的回显。因此不要在读取回显前 `shutdown(SHUT_WR)`，也不要用 EOF 表示本例的请求结束。普通收齐回显后的 FIN 关闭已测试；通用 TCP 半关闭不在这个最小框架范围内。

ARP 模块另外修正了原版的 8 位年龄计算：计数每 42 分 40 秒回绕时，按模 256 的差值处理老化和最老表项替换。补丁单独保留，便于与原始发布包比较。`uip_arp_ipin()` 在这个发布版实际上为空宏，代码保留该接口位置，ARP 映射仍依赖 ARP 请求/应答学习。

## 编译与验证

主机测试只验证协议栈、调度、应用之间的连接，无需物理网卡。测试默认使用小端主机、随包默认地址和两条连接；修改默认配置后应同步修改测试。

安装有 CMake 和 GCC/Clang 的开发环境可运行：

```sh
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

Windows MinGW 示例（确保 GCC、mingw32-make、CMake 在 PATH）：

```powershell
cmake -S . -B build -G "MinGW Makefiles"
cmake --build build
ctest --test-dir build --output-on-failure
```

也可不使用 CMake：

```powershell
.\tests\run_host_tests.ps1 -Compiler gcc
```

目标 MCU 通常使用厂商 IDE/交叉工具链，加入前述源文件。若已有 CMake 交叉工具链文件，可以关闭主机测试并开启模板目标：

```sh
cmake -S . -B build-mcu -DCMAKE_TOOLCHAIN_FILE=your-toolchain.cmake -DBUILD_HOST_TESTS=OFF -DBUILD_MCU_TEMPLATE=ON
cmake --build build-mcu
```

这仍需要你提供 MCU 启动文件、链接脚本、HAL 和真实板级驱动。原版核心中存在两处 GCC 未使用标签/常量警告，保持源码原样；自有通用移植代码与应用通过严格警告检查。

附带的 9 组报文测试覆盖初始化失败、ARP、握手、二进制回显、正常关闭、MSS 分段、双连接、共享缓冲被覆写后的重传、ACK 携带下一段输入、持续收包时的 TCP/ARP 定时、时钟回绕、有界补偿，以及 ARP 回绕后的过期和最老表项替换。两个 ARP 回归已分别在未修改的官方文件上复现失败，在补丁后通过。测试方法见 `tests/README.md`。SPI、PHY、FCS、DMA 和目标时钟仍须上板验证。

## 上板验证步骤

1. 实现全部 `TODO_HW`，配置真实 IP/MAC，先检查网卡 ID、PHY 链路和接收计数。
2. 在同网段 PC 上查看 ARP 和 ping；必要时抓包确认地址、长度及校验和。
3. 运行二进制回显客户端；它分批发送、逐批收齐，不使用半关闭：

   ```sh
   python tools/echo_client.py 192.168.1.50 --port 1234 --bytes 4096
   ```

4. 同时开启两个客户端，再验证真实丢包、网线断开恢复和持续接收流量下的周期处理。

不要在目标固件中编译 fake board；主机测试通过不代表具体单片机硬件已完成联调。
