---
title: FPGA 学习笔记：工程结构与模块解析
date: 2026-09-09 00:02:44
tags:
  - FPGA
  - VHDL
  - Verilog
categories:
  - 技术笔记
cover: /image/covers/fpga-learning.jpg
description: 结合 KT22TAFMB 工程梳理 FPGA 模块结构，记录 FSMC 总线解码、KL 总线调度、键盘扫描、手轮计数及位流生成流程。
---

# FPGA 学习

> **分层注释版说明**：保留原文和代码逻辑。简单语法不机械重复注释；每个模块先说明作用和数据流，每个进程说明执行方式，关键代码行再用右侧短注释解释。

<!-- more -->

## 快速查阅

- [顶层模块 KT22TAFMB](#module-top)
- [FSMC 总线接口 FSMC_Decode](#module-fsmc)
- [KL 总线调度 KL_DATA_TOP](#module-kl-data-top)
- [单次读取 Single_Rec_SET](#module-single-rec)
- [键盘扫描 KEY_Scan_SET](#module-key-scan)
- [手轮计数 hcod_counter](#module-hcod)

`【动作】`看核心数据流，`【状态】`看跳转，`【时序】`看更新时刻，`【故障】/【风险】`看需要重点检查的位置。


## 代码结构

- 1. **项目结构与文件层级**

  #### 文件组成

  - **顶层文件：KT22TAFMB.vhd**
    - 作为顶层模块，整合了各个功能模块（如 FSMC_Decode、KL_DATA_TOP、hcod_counter 等）。
    - 包含时钟管理（PLL）、FSMC 总线解码、数码管和 LED 控制、手轮计数等功能。
  - **功能模块**
    - **FSMC_Decode.vhd**：FSMC 总线解码模块，负责将外部 FSMC 总线信号映射到内部寄存器。
    - **KL_DATA_TOP.vhd**：管理 KL 总线，控制数码管、LED 显示，以及键盘和手轮信号的处理。
    - **hcod_counter.v**：手轮 AB 相信号解码，实现正交计数。
    - **Double_WR_SET.vhd、Single_WR_SET.vhd、Single_Rec_SET.vhd**：用于 KL 总线的数据写入和读取操作。
    - **KEY_Scan_SET.vhd**：键盘扫描模块，读取按键状态。
    - **filter800ns.v**：信号去抖模块，用于滤除手轮和按键的毛刺。
  - **IP 核**
    - **pll.v / pll.vhd**：时钟管理模块，将输入时钟（如 32.768 MHz）倍频到系统主时钟（如 131.072 MHz）。
  - **约束文件**
    - **EF2L45.adc**：管脚约束文件，定义了 FPGA 引脚与外部硬件的连接关系。
    - **KT22TAFMB.sdc**：时序约束文件，确保设计满足时序要求。

  #### 编译顺序

  - 在截图中可以看到一个明确的编译顺序，通常顶层文件最后编译，底层模块（如 IP 核、功能组件）先编译。正确的顺序一般如下：

    plain

    复制

    ```plain
    1. IP 核文件（如 pll.v）
    2. 功能模块（如 FSMC_Decode、KL_DATA_TOP、hcod_counter 等）
    3. 顶层文件（如 KT22TAFMB.vhd）
    ```

    

  ### 2. **项目界面功能**

  #### 关键工具标签

  - **Hierarchy Navigation**：显示项目的模块层次结构，方便定位文件。
  - **IP Files**：列出所有 IP 核及其配置文件（如 pll.ipc）。
  - **Compile Order**：定义文件的编译顺序，确保设计正确综合。
  - **Constraints**：加载约束文件（如 .adc 和 .sdc），确保设计与硬件匹配。

  #### 流程标签

  - **FPGA Flow**：展示 FPGA 开发的完整流程，包括逻辑优化、布局布线、时序分析和位流生成。
  - **Design Summary**：提供资源利用率（如 LUT、FF、PLL 使用情况）和时序报告，帮助评估设计性能。

  ### 3. **如何使用这些信息**

  #### 快速上手

  1. **确认顶层模块正确性**
     - 打开 `KT22TAFMB.vhd`，检查是否正确实例化了所有子模块（如 FSMC_Decode、KL_DATA_TOP、hcod_counter）。
     - 确保信号连接（如时钟、复位、FSMC 总线、手轮信号）无误。
  2. **检查编译顺序**
     - 在 `Compile Order` 中确认文件顺序是否合理。IP 核和底层模块应先于顶层模块编译。
  3. **约束文件加载**
     - 确保 `.adc`（管脚约束）和 `.sdc`（时序约束）文件已正确加载。未加载约束可能导致综合/布线失败。
  4. **运行综合与实现**
     - 点击 `Optimize Gate` 开始逻辑综合，检查是否有语法错误或未满足的约束。
     - 查看 `Utilization Summary` 和 `Timing Summary`，确认资源占用和时序是否达标。
  5. **生成位流文件**
     - 如果综合和实现通过，生成 `.bit` 文件用于 FPGA 烧录。

  #### 常见问题排查

  表格

  

  

  | 现象               | 可能原因                     | 解决方法                                       |
  | :----------------- | :--------------------------- | :--------------------------------------------- |
  | 综合报错未找到模块 | 文件未按正确顺序编译         | 检查 `Compile Order`，确保底层模块先于顶层编译 |
  | 时序不达标         | 未加载 `.sdc` 文件或约束错误 | 检查约束文件路径和内容                         |
  | 管脚冲突           | 未加载 `.adc` 文件或定义重复 | 检查管脚约束文件                               |
  | 顶层信号未连接     | 实例化模块时漏掉信号         | 打开顶层文件，检查端口映射                     |

  ### 4. **总结**

  通过这些截图和界面信息，你可以：

  1. 快速定位项目的关键模块和文件。
  2. 确保编译顺序和约束文件正确加载。
  3. 用综合和时序报告评估设计是否符合硬件要求。

  如果需要进一步调试或修改设计，可以直接在对应模块中操作（如调整寄存器映射、修改时钟频率等）。

- 

  2 秒定顶层文件

  - **Design** 栏最顶层、字体加粗的那个 module 就是 **Top**，右键 → **Set as Top Level**（若已加粗可跳过）
  - 双击它 → 代码窗口打开，先扫一眼 `module xxx(…);` 括号里的信号，基本能猜出功能：
    例：`input clk_25m, input rst_n, output [3:0] led, output uart_tx …`
    立刻知道：25 M 时钟、低电平复位、4 个 LED、串口发

  ------

  3 时钟/复位网络 30 秒看懂

  - 菜单 **Tools → Netlist Analyzer → Clock Tree**
    只看 **“Clock”** 页，列出所有时钟 nets 及其频率、约束是否已加
    例：`clk_25m | 25.00 MHz | SDC:yes` → 说明约束已搞定
    若显示 `unconstrained`，先记下，等会儿看 SDC 文件
  - 复位同理：在 Netlist Analyzer 搜 `rst*` 或 `reset*` 可看到复位扇出数量，判断是全局复位还是局部

  ------

  4 关键接口一眼定位

  - **Design** 栏按住 `Ctrl` 点选任意子模块 → 右键 **“Go to Instantiation”** 可层层下钻
    但更快的是直接看 **“I/O Ports”** 报告：
    菜单 **Process → Compile → 双击 Compile Report → I/O Ports**
    表格里已按管脚号排好，直接看 `Signal Name` 与 `I/O Standard`
    例：`uart_tx | LVCMOS33 | B4` 立刻知道串口发在 B4 管脚，3.3 V 电平

  ------

  5 资源占用 5 秒

  - 同样 **Compile Report → Summary**
    重点看四行：
    `Logic LUTs` / `Registers` / `Block RAMs` / `PLLs`
    例：`LUTs: 1203 / 45216 (2.7%)` → 资源很轻，还有大把空间

  ------

  6 管脚约束文件 1 分钟

  - **Constraints** 栏双击 `.adc` 文件（安路管脚约束格式，等价于 Altera 的 .qsf）
    每行格式：
    `set_pin_assignment {clk_25m} { LOCATION = A10; IOSTANDARD = LVCMOS33; }`
    直接搜关键词 `led`、`key`、`uart` 就能知道外设接在哪个 PIN，和原理图对照极快
    若发现 `LOCATION = NA` → 说明该信号未分配管脚，代码里可能预留测试

  ------

  7 时序约束文件（可选）

  - 若有 `.sdc` 文件，双击打开，看有没有 `create_clock`、`set_input_delay`、`set_output_delay`
    没有也不影响编译，但高速接口（SDRAM、SPI-Flash）必须加，否则后期掉坑

  ------

  8 快速导航小技巧

  表格

  

  

  | 目的           | 快捷键/入口                       | 结果                             |
  | :------------- | :-------------------------------- | :------------------------------- |
  | 找某个信号定义 | `Ctrl+Shift+F` → 输入信号名       | 全工程搜索，秒跳                 |
  | 看 RTL 原理图  | 右键 Top → **View RTL Schematic** | 自动生成门级图，双击可展开子模块 |
  | 定位警告/错误  | **Console** 窗口双击 Warning      | 直接跳到代码行                   |

  ------

  9 3 分钟实战示范（文字版）
  假设刚打开一个 `ethernet_test` 工程：

  1. 顶层 `ethernet_top.v` → 看到 `input clk_50m, input rst_n, output [1:0] rgmii_tx …`
     秒懂：50 M 时钟，RGMII 网口发
  2. **Clock Tree** 报告：
     `clk_50m | 50.00 MHz | SDC:yes`
     `clk_125m | 125.00 MHz | SDC:yes` → 已约束 125 M 收发电路
  3. **I/O Ports**：
     `rgmii_txd[3:0] | LOCATION = B12,B11,A12,A11`
     对照原理图，确认就是 PHY 的 TX 数据口
  4. **Compile Summary**：
     `LUT 2800 / 45216 (6%)` `PLL 1 / 4`
     资源富裕，可继续加功能
     → 全程 3 分钟，工程骨架已摸清，再决定是否深入看 MAC 代码

## RTL/TOP.vhd

<a id="module-top"></a>

### KT22TAFMB 顶层模块

| 项目 | 内容 |
| --- | --- |
| 作用 | 连接PLL、FSMC、KL调度和手轮计数模块，并完成MCU寄存器映射 |
| 主数据流 | 外部信号 → 子模块处理 → `BUS_Din_Reg` → MCU读取 |
| 关键映射 | 读寄存器5为选轴倍率，读寄存器6为手轮旋转计数 |
| 阅读重点 | `component`只是声明，真正硬件由后面的实例和`port map`产生 |

```vhdl
----------------------------------------------------------------------------------
-- KT22TAFMB 为 KT22TAFMB 工程的顶层模块，其功能包含各个功能模块的例化、互联及寄存器映射等。
-- 部分功能模块内部的控制信号由 FSMC 解码模块输出的使能信号控制，此类信号也在本模块内映射。
-- 编码格式：UTF-8
----------------------------------------------------------------------------------
library IEEE;
use IEEE.STD_LOGIC_1164.all;
use IEEE.std_logic_unsigned.all;                                    -- 【说明】引入旧式非IEEE标准算术包的无符号向量运算
use work.kaitong.all;                                               -- 【声明】导入kaitong包中的项目自定义类型

entity KT22TAFMB is
	generic(
		Reg_Width : Positive := 64; -- 读/写寄存器空间数
        Key_Col_Num : Positive := 8
	);
	port(
		CLK_32M		: in std_logic;
		Nrst 		: in std_logic;
		-- FSMC 总线
		FSMC_NE   : in STD_LOGIC; -- 片选信号，低有效
		FSMC_NOE  : in STD_LOGIC; -- 读使能信号，低有效
		FSMC_NWE  : in STD_LOGIC; -- 写使能信号，低有效
		FSMC_NADV : in STD_LOGIC; -- 地址锁存使能信号，低有效
		FSMC_AD   : inout STD_LOGIC_VECTOR (15 downto 0); -- 数据总线，地址数据复用，对应 ADDR[15:0]
		-- 手轮 AB 相信号
		H_CODA    : in std_logic;    --手轮A相
		H_CODB    : in std_logic;    --手轮B相
		-- KL 总线
		KL_nRD    : out std_logic;   --键显数据读使能，低有效
		KL_nWR    : out std_logic;   --键显数据写使能，低有效
		KL_ADDR   : out std_logic_vector(5 downto 0);  --地址信号
		KL_DATA   : inout std_logic_vector(7 downto 0) --数据信号

	);
end KT22TAFMB;

architecture Behavioral of KT22TAFMB is

component pll is
   port(refclk   : in std_logic;
		reset    : in std_logic;
		clk0_out : out std_logic
   );
end component;

signal CLK : std_logic;		--130M 时钟  【时序】声明内部1位时钟网络CLK

component FSMC_Decode is
	generic(
		Reg_Width : Positive := 64 -- 读/写寄存器空间数
	); 
	Port(
		CLK  : in STD_LOGIC; --时钟信号		
		Nrst : in STD_LOGIC; --复位信号 
	-- FSMC 总线
		FSMC_NE   : in STD_LOGIC; -- 片选信号，低有效
	    FSMC_NOE  : in STD_LOGIC; -- 读使能信号，低有效
		FSMC_NWE  : in STD_LOGIC; -- 写使能信号，低有效
		FSMC_NADV : in STD_LOGIC; -- 地址锁存使能信号，低有效
		FSMC_AD   : inout STD_LOGIC_VECTOR (15 downto 0); -- 数据总线，地址数据复用，对应 ADDR[15:0]
	--内部总线
		BUS_Din_Reg  : in  vector16_array(Reg_Width - 1 downto 0);
		BUS_Dout_Reg : out vector16_array(Reg_Width - 1 downto 0);
		BUS_Rd_Ncs   : out STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);
		BUS_We_Ncs   : out STD_LOGIC_VECTOR(Reg_Width - 1 downto 0)
	);
end component;

signal BUS_Din_Reg  : vector16_array(Reg_Width - 1 downto 0);
signal BUS_Dout_Reg : vector16_array(Reg_Width - 1 downto 0);
signal BUS_Rd_Ncs   : STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);
signal BUS_We_Ncs   : STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);

component KL_DATA_TOP is
    generic (
        Key_Col_Num : Positive := 8
    );
    port (
        clk  : in std_logic;
        Nrst : in std_logic;
        -- KL 总线接口
        KL_nWR  : out std_logic;
        KL_nRD  : out std_logic;
        KL_ADDR : out std_logic_vector(5 downto 0);
        KL_DATA : inout std_logic_vector(7 downto 0);
        -- 内部数据接口
        LED_DATA_Array : in vector8_array(6 downto 0);      -- LED 控制信号
        Nixie_Tube     : in vector8_array(5 downto 0);      -- 数码管控制信号
        GP_Output      : in std_logic_vector(7 downto 0);   -- 通用输出信号
        Key_Value      : out vector8_array(Key_Col_Num - 1 downto 0);     -- 键盘按键值
        MPG_IN         : out std_logic_vector(6 downto 0)   -- 手轮输入信号
    );
end component;

signal LED_DATA_Array : vector8_array(6 downto 0);      -- LED 控制信号
signal Nixie_Tube     : vector8_array(5 downto 0);      -- 数码管控制信号
signal GP_Output      : std_logic_vector(7 downto 0);   -- 通用输出信号
signal Key_Value      : vector8_array(Key_Col_Num - 1 downto 0);     -- 键盘按键值
signal MPG_IN         : std_logic_vector(6 downto 0);    -- 手轮输入信号

component hcod_counter is   -- 手轮编码器计数
    port(
        nReset 	   : in std_logic;
		clk_100    : in std_logic;
        count_clr  : in std_logic;
        coda       : in std_logic;
        codb       : in std_logic;
        out_counter : out std_Logic_vector(15 downto 0)
    );
end component;

signal Count_Clr : std_logic;
signal Out_Counter : std_Logic_vector(15 downto 0);

constant Version_Number : std_logic_vector(15 downto 0) := x"0000"; -- 版本号  【说明】16位版本号固定为十六进制0000
constant timing_optimze : std_logic_vector(15 downto 0) := x"5555"; --调整时序用，无需读取  【常量】timing_optimze = x"5555"

signal BUS_TEST  : std_logic_vector(15 downto 0);

begin

-- pll 模块，32.768Mhz 四倍频生成 131.072 MHz 时钟
clk_gen: pll                                                        -- 【连接】实例名clk_gen，模块类型pll
	port map(
		refclk   => CLK_32M,
		reset    => not Nrst,                                             -- 【复位】Nrst取反后连接PLL复位端，需核对PLL极性
		clk0_out => CLK
	);

-- FSMC 总线解码模块
FSMC: FSMC_Decode                                                   -- 【连接】实例化FSMC_Decode，实例名FSMC
	generic map(
		Reg_Width => Reg_Width                                            -- 【说明】左边是子模块参数，右边是父模块同名参数；将父级寄存器数量传给解码器
		)
	Port map(
		CLK => CLK,
		Nrst => Nrst,
		FSMC_NE => FSMC_NE,
		FSMC_NOE => FSMC_NOE,
		FSMC_NWE => FSMC_NWE,
		FSMC_NADV => FSMC_NADV,
		FSMC_AD => FSMC_AD,
		BUS_Din_Reg  => BUS_Din_Reg,
		BUS_Dout_Reg => BUS_Dout_Reg,
		BUS_Rd_Ncs => BUS_Rd_Ncs,
		BUS_We_Ncs => BUS_We_Ncs
	);

-- 写寄存器空间
LED_DATA_Array(0) <= BUS_Dout_Reg(0)(7 downto 0);
LED_DATA_Array(1) <= BUS_Dout_Reg(0)(15 downto 8); -- 0x00
LED_DATA_Array(2) <= BUS_Dout_Reg(1)(7 downto 0);
LED_DATA_Array(3) <= BUS_Dout_Reg(1)(15 downto 8); -- 0x02
LED_DATA_Array(4) <= BUS_Dout_Reg(2)(7 downto 0);
LED_DATA_Array(5) <= BUS_Dout_Reg(2)(15 downto 8); -- 0x04
LED_DATA_Array(6) <= BUS_Dout_Reg(3)(7 downto 0);  -- 0x06

Nixie_Tube(0) <= BUS_Dout_Reg(4)(7 downto 0);
Nixie_Tube(1) <= BUS_Dout_Reg(4)(15 downto 8);  -- 0x08
Nixie_Tube(2) <= BUS_Dout_Reg(5)(7 downto 0);
Nixie_Tube(3) <= BUS_Dout_Reg(5)(15 downto 8);  -- 0x0a
Nixie_Tube(4) <= BUS_Dout_Reg(6)(7 downto 0);
Nixie_Tube(5) <= BUS_Dout_Reg(6)(15 downto 8);  -- 0x0c

--Nixie_Tube(0) <= x"01";
--Nixie_Tube(1) <= x"02";
--Nixie_Tube(2) <= x"04";
--Nixie_Tube(3) <= x"ff";
--Nixie_Tube(4) <= x"10";
--Nixie_Tube(5) <= x"ff";

GP_Output <= BUS_Dout_Reg(7)(7 downto 0);       -- 0x0e
Count_Clr <= BUS_Dout_Reg(8)(0);                -- 0x10  【连接】把MCU写寄存器8的bit0接给旋转计数清零输入

BUS_TEST <= BUS_Dout_Reg(9);                    -- 0x12

-- 读寄存器空间
BUS_Din_Reg(0) <= timing_optimze;              -- 0x00  【说明】读寄存器0固定返回5555图样，用于识别总线数据；不会改变计时参数
BUS_Din_Reg(1) <= Key_Value(1) & Key_Value(0); -- 0x02  【映射】拼接键盘组1和0，送到读寄存器1
BUS_Din_Reg(2) <= Key_Value(3) & Key_Value(2); -- 0x04  【映射】拼接键盘组3和2，送到读寄存器2
BUS_Din_Reg(3) <= Key_Value(5) & Key_Value(4); -- 0x06  【映射】拼接键盘组5和4，送到读寄存器3
BUS_Din_Reg(4) <= Key_Value(7) & Key_Value(6); -- 0x08  【映射】拼接键盘组7和6，送到读寄存器4
BUS_Din_Reg(5) <= x"00" & '0' & MPG_IN;        -- 0x0a  【映射】高9位补0，MPG_IN=7F时读出007F
BUS_Din_Reg(6) <= out_counter;                 -- 0x0c  【映射】手轮旋转计数送到读寄存器6
BUS_Din_Reg(7) <= Version_Number;              -- 0x0e  【映射】版本号送到读寄存器7
BUS_Din_Reg(8) <= (others => '0');             -- 0x10  【映射】读寄存器8固定返回0
BUS_Din_Reg(9) <= BUS_TEST;                    -- 0x12  【说明】把BUS_TEST接到读数组9，配合上面的写数组9形成读回检查

BUS_Din_Reg(10) <= BUS_Dout_Reg(4);        -- 0x14  【动作】FPGA提供给MCU读取的数据数组 ← BUS_Dout_Reg(4)
BUS_Din_Reg(11) <= BUS_Dout_Reg(5);        -- 0x16  【动作】FPGA提供给MCU读取的数据数组 ← BUS_Dout_Reg(5)
BUS_Din_Reg(12) <= BUS_Dout_Reg(6);        -- 0x18  【动作】FPGA提供给MCU读取的数据数组 ← BUS_Dout_Reg(6)

-- KL 数据线控制模块
KL : KL_DATA_TOP                                                    -- 【连接】实例化KL_DATA_TOP，实例名KL；它调度外部显示、键盘和选轴倍率读取
    generic map(
        Key_Col_Num => Key_Col_Num
    )
    port map(
        clk            => clk,
        Nrst           => Nrst,
        KL_nWR         => KL_nWR,
        KL_nRD         => KL_nRD,
        KL_ADDR        => KL_ADDR,
        KL_DATA        => KL_DATA,
        LED_DATA_Array => LED_DATA_Array,
        Nixie_Tube     => Nixie_Tube,
        GP_Output      => GP_Output,
        Key_Value      => Key_Value,
        MPG_IN         => MPG_IN        
    );

-- 手轮编码器计数模块
COD_H: hcod_counter                                                 -- 【实例】实例化Verilog手轮计数模块
    port map(
        nReset 	   =>  Nrst,
        clk_100	   =>  CLK,                                         -- 【时钟】端口名虽为clk_100，实际接入CLK
        count_clr  =>  Count_Clr,
        coda       =>  H_CODA,
        codb       =>  H_CODB,
        out_counter => Out_Counter
    );

end Behavioral;
```

1 顶层接口 10 秒

表格

| 信号     | 方向 | 物理含义                   | 板级接法提示          |
| :------- | :--- | :------------------------- | :-------------------- |
| CLK_32M  | I    | 32.768 MHz 有源晶振        | 专用时钟引脚          |
| Nrst     | I    | 低电平复位                 | 按键或上电复位芯片    |
| FSMC_*   | I/O  | STM32 并行总线 16 bit 复用 | 接 MCU 的 FSMC/FCM 口 |
| H_CODA/B | I    | 手轮 AB 相正交             | 接编码器，需滤波      |
| KL_*     | O/I  | 键盘-显示总线              | 接 74HC595+键盘扫描板 |

------

2 时钟树 5 秒

表格

| 源      | 频率        | 用途       | 备注                    |
| :------ | :---------- | :--------- | :---------------------- |
| CLK_32M | 32.768 MHz  | PLL 参考   | 外部晶振                |
| CLK     | 131.072 MHz | 系统主时钟 | PLL 4× 倍频，供所有模块 |

------

3 寄存器地址表（FSMC 16 bit 地址线 → 内部偏移）

表格

| 偏移   | 读写 | 名称                    | 位宽 | 功能说明         |
| :----- | :--- | :---------------------- | :--- | :--------------- |
| 0x00   | W    | LED_DATA_Array(0)(7:0)  | 8    | LED0~7           |
| 0x00+2 | W    | LED_DATA_Array(0)(15:8) | 8    | LED8~15          |
| 0x04   | W    | LED_DATA_Array(2)(7:0)  | 8    | LED16~23         |
| 0x06   | W    | LED_DATA_Array(3)(7:0)  | 8    | LED24~31         |
| 0x08   | W    | Nixie_Tube(0)(7:0)      | 8    | 数码管位 0       |
| 0x0A   | W    | Nixie_Tube(2)(7:0)      | 8    | 数码管位 2       |
| 0x0C   | W    | Nixie_Tube(4)(7:0)      | 8    | 数码管位 4       |
| 0x0E   | W    | GP_Output(7:0)          | 8    | 通用输出         |
| 0x10   | W    | Count_Clr(0)            | 1    | 写 1 清手轮计数  |
| 0x12   | W/R  | BUS_TEST                | 16   | 回环测试寄存器   |
| 0x02   | R    | Key_Value(1)&(0)        | 16   | 键盘列 0~1       |
| 0x04   | R    | Key_Value(3)&(2)        | 16   | 键盘列 2~3       |
| 0x06   | R    | Key_Value(5)&(4)        | 16   | 键盘列 4~5       |
| 0x08   | R    | Key_Value(7)&(6)        | 16   | 键盘列 6~7       |
| 0x0A   | R    | MPG_IN(6:0)             | 7    | 手轮按键状态     |
| 0x0C   | R    | out_counter             | 16   | 手轮 AB 相计数器 |
| 0x0E   | R    | Version_Number          | 16   | 固件版本 0x0000  |

4 内部模块连线 1 句 FSMC_Decode 把 MCU 并行总线 → 64 个 16 bit 寄存器槽；
KL_DATA_TOP 把寄存器值 → 74HC595 驱动数码管+LED+读键盘；
hcod_counter 把 H_CODA/B → 16 bit 计数器，可被 0x10 清零。

------

5 资源预估（EF2L45 够用）

表格

| 类型 | 用量 | 占比 |
| :--- | :--- | :--- |
| LUT  | ~400 | <1 % |
| FF   | ~200 | <1 % |
| PLL  | 1/4  | 25 % |
| 管脚 | 38   | 27 % |

------

6 快速验证步骤（5 分钟）

1. 烧录 `.bit` 后，MCU 先读 0x0E 应返回 0x0000（版本号）。
2. MCU 写 0x55AA 到 0x12，再读回 0x55AA → 证明 FSMC 通路 OK。
3. 写 0xFF 到 0x00，LED 灯 0~7 应全亮。
4. 旋转手轮，读 0x0C 数值应随方向增减；写 0x01 到 0x10，计数器清零。

## RTL/FSMC_Decode.vhd

<a id="module-fsmc"></a>

### FSMC_Decode 总线接口

| 项目 | 内容 |
| --- | --- |
| 作用 | 将MCU的复用地址/数据总线转换为FPGA内部寄存器读写 |
| 读流程 | 锁存地址 → 译码片选 → 选择读数据 → 驱动FSMC_AD |
| 写流程 | 锁存地址 → 生成写片选 → 保存FSMC_AD |
| 阅读重点 | 低有效信号0才有效；默认64项数组必须防止地址索引越界 |

```vhdl
library IEEE;
use IEEE.STD_LOGIC_1164.all;
use IEEE.STD_LOGIC_arith.all;                                       -- 【声明】导入旧式std_logic_arith运算包
use IEEE.STD_LOGIC_unsigned.all;                                    -- 【声明】导入旧式std_logic_unsigned运算包
use work.kaitong.all;

entity FSMC_Decode is
	generic(
		Reg_Width : Positive := 64 -- 读/写寄存器空间数
	); 
	Port(
		CLK  : in STD_LOGIC; --时钟信号		
		Nrst : in STD_LOGIC; --复位信号 
	-- FSMC 总线
		FSMC_NE   : in STD_LOGIC; -- 片选信号，低有效
	    FSMC_NOE  : in STD_LOGIC; -- 读使能信号，低有效
		FSMC_NWE  : in STD_LOGIC; -- 写使能信号，低有效
		FSMC_NADV : in STD_LOGIC; -- 地址锁存使能信号，低有效
		FSMC_AD   : inout STD_LOGIC_VECTOR (15 downto 0); -- 数据总线，地址数据复用，对应 ADDR[15:0]
	--内部总线
		BUS_Din_Reg  : in  vector16_array(Reg_Width - 1 downto 0);
		BUS_Dout_Reg : out vector16_array(Reg_Width - 1 downto 0);
		BUS_Rd_Ncs   : out STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);
		BUS_We_Ncs   : out STD_LOGIC_VECTOR(Reg_Width - 1 downto 0)
	);
end FSMC_Decode;

architecture Behavioral of FSMC_Decode is

signal FSMC_NE_d1   : STD_LOGIC;
signal FSMC_NE_d2   : STD_LOGIC;
signal FSMC_NOE_d1  : STD_LOGIC;
signal FSMC_NOE_d2  : STD_LOGIC;
signal FSMC_NWE_d1  : STD_LOGIC;
signal FSMC_NWE_d2  : STD_LOGIC;
signal FSMC_NADV_d1 : STD_LOGIC;
signal FSMC_NADV_d2 : STD_LOGIC;
signal FSMC_AD_d1   : STD_LOGIC_VECTOR(15 downto 0);
signal FSMC_AD_d2   : STD_LOGIC_VECTOR(15 downto 0);

signal ADDR    : STD_LOGIC_VECTOR(15 downto 0);
signal BUS_Ncs : STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);
signal Rd_Ncs  : STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);
signal We_Ncs  : STD_LOGIC_VECTOR(Reg_Width - 1 downto 0);
signal FSMC_Data_TMP : STD_LOGIC_VECTOR(15 downto 0);

begin
-- 信号两级同步，去除亚稳态
-- ------------------------------------------------------------------
-- 进程作用：同步采样FSMC异步输入
-- 更新方式：时钟上升沿更新，Nrst低时复位
-- 阅读重点：多位AD总线同步不能自动保证整字一致
-- ------------------------------------------------------------------
	process(clk,nrst)
	begin
		if(nrst = '0')then
			FSMC_NE_d1   <= '0';                                             -- 【复位】复位时把片选历史置0
			FSMC_NE_d2   <= '0';                                             -- 【复位】复位时第二级片选也置0，不能把它理解为不选中
			FSMC_NOE_d1  <= '0';                                             -- 【复位】复位时把读使能第一级置0，0是有效读
			FSMC_NOE_d2  <= '0';                                             -- 【风险】复位值也会满足后面的读输出条件
			FSMC_NWE_d1  <= '0';
			FSMC_NWE_d2  <= '0';
			FSMC_NADV_d1 <= '0';
			FSMC_NADV_d2 <= '0';	
			FSMC_AD_d1   <= (others => '0');
			FSMC_AD_d2   <= (others => '0');
		elsif(rising_edge(clk))then
			FSMC_NE_d1   <= FSMC_NE;
			FSMC_NOE_d1  <= FSMC_NOE;
			FSMC_NWE_d1  <= FSMC_NWE;
			FSMC_NADV_d1 <= FSMC_NADV;
			FSMC_AD_d1   <= FSMC_AD;

			FSMC_NE_d2   <= FSMC_NE_d1;
			FSMC_NOE_d2  <= FSMC_NOE_d1;
			FSMC_NWE_d2  <= FSMC_NWE_d1;
			FSMC_NADV_d2 <= FSMC_NADV_d1;	
			FSMC_AD_d2   <= FSMC_AD_d1;
		end if;
	end process;

-- 地址锁存
-- ------------------------------------------------------------------
-- 进程作用：在地址阶段锁存FSMC复用总线地址
-- 更新方式：时钟上升沿更新
-- 阅读重点：NADV和NE均为低时会连续采样
-- ------------------------------------------------------------------
	process(Nrst,CLK)
	begin
		if(Nrst = '0')then
			ADDR <= (others => '0');
		elsif(rising_edge(CLK))then
			if(FSMC_NADV_d2 = '0' and FSMC_NE_d2 = '0') then                 -- 【动作】在同步后的地址有效阶段且片选有效时允许更新ADDR
				ADDR <= FSMC_AD_d2;                                             -- 【动作】保存两级采样后的复用总线值作为地址；读取的是本拍更新前的FSMC_AD_d2
			end if;
		end if;
	end process;

-- 地址解码
-- ------------------------------------------------------------------
-- 进程作用：把锁存地址译码为低有效片选
-- 更新方式：纯组合逻辑
-- 阅读重点：地址索引必须落在寄存器数组范围内
-- ------------------------------------------------------------------
    process(ADDR)
        begin
            BUS_Ncs <= (others => '1');                             -- 【动作】默认全部不选中，再拉低目标片选
			BUS_Ncs(CONV_INTEGER(ADDR(7 downto 1))) <= '0'; -- 16 位寄存器  【风险】地址索引可到127，默认数组仅64项，缺少范围检查
    end process;

--组合逻辑输出片选
-- ------------------------------------------------------------------
-- 进程作用：生成各寄存器的低有效读写片选
-- 更新方式：纯组合逻辑
-- 阅读重点：片选与NOE/NWE均低时对应操作有效
-- ------------------------------------------------------------------
    process(BUS_Ncs,FSMC_NOE_d2,FSMC_NWE_d2)        
        begin
            for i in 0 to Reg_Width - 1 loop
                Rd_Ncs(i) <= BUS_Ncs(i) or FSMC_NOE_d2; -- 读片选  【说明】低有效逻辑：只有地址片选为0且读使能为0时，OR结果才为0，表示这项读操作有效
                We_Ncs(i) <= BUS_Ncs(i) or FSMC_NWE_d2; -- 写片选  【说明】同理，将地址选中与低有效写使能组合，得到逐寄存器写片选
            end loop;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：将读片选再寄存两拍
-- 更新方式：时钟上升沿更新
-- 阅读重点：用于匹配后续读数据时序
-- ------------------------------------------------------------------
	process(Nrst,CLK)
	begin
		if(Nrst = '0')then
			BUS_Rd_Ncs <= (others => '1');
			BUS_We_Ncs <= (others => '1');
		elsif(rising_edge(CLK))then
			BUS_Rd_Ncs <= Rd_Ncs; -- 读片选输出寄存器
			BUS_We_Ncs <= We_Ncs; -- 写片选输出寄存器
		end if;
	end process;
---***************************************************************************------
---数据总线读操作
---***************************************************************************------
-- ------------------------------------------------------------------
-- 进程作用：从内部数组选择MCU要读取的数据
-- 更新方式：纯组合逻辑
-- 阅读重点：默认返回FFFF，并应确认总线输出使能条件
-- ------------------------------------------------------------------
	process(BUS_Din_Reg,Rd_Ncs,FSMC_NE_d2)
	begin
		FSMC_Data_TMP <= (others => '1');                                 -- 【说明】读数据选择器默认给出16位全1，即FFFF；这与特定MPG寄存器返回的007F不同

		for i in 0 to Reg_Width - 1 loop
			if(Rd_Ncs(i) = '0' and FSMC_NE_d2 = '0')then
				FSMC_Data_TMP <= BUS_Din_Reg(i);                                -- 【说明】组合选择当前索引i的数据
			end if;
		end loop;
	end process;
	
	FSMC_AD <= FSMC_Data_TMP when FSMC_NOE_d2 = '0' else (others => 'Z');  -- 【风险】总线输出使能未同时检查片选和复位
---***************************************************************************------
---数据总线写操作
---***************************************************************************------			
-- ------------------------------------------------------------------
-- 进程作用：保存MCU写入各寄存器的数据
-- 更新方式：时钟上升沿更新
-- 阅读重点：写有效窗口内会每拍保存
-- ------------------------------------------------------------------
	process(Nrst,CLK)
	begin
		if(Nrst = '0')then
			BUS_Dout_Reg <= (others => (others => '0'));                     -- 【复位】清零写寄存器数组的全部元素和全部位
		elsif(rising_edge(CLK))then                   
			for i in 0 to (Reg_Width - 1) loop
				if(We_Ncs(i) = '0' and FSMC_NE_d2 = '0')then
					BUS_Dout_Reg(i) <= FSMC_AD_d2; -- 锁存总线写数据  【时序】写有效期间每拍保存数据，依赖MCU总线时序
				end if;
			end loop;
		end if;
	end process;

end Behavioral;
```

1 一张时序图（记住就行） STM32 侧典型 FSMC 读周期

plain

```plain
    ┌──────┐
NE  ┘      └──────────────────
NADV┘  └──┐                   （低锁存地址）
NOE ┐     └──┐                （低使能读）
AD  │ A[15:0] │ D[15:0]       （先地址后数据）
```

代码里用 **NADV 下降沿** 锁存地址，用 **NOE 低** 开启读，用 **NWE 低** 开启写；
所有信号都打 2 级 D 触发器去亚稳态。

------

2 寄存器地址映射表（关键）

表格

| FSMC 地址 *1 | 内部索引 | 功能（示例来自顶层） |
| :----------- | :------- | :------------------- |
| 0x0000_0000  | 0        | LED[15:0]            |
| 0x0000_0002  | 1        | LED[31:16]           |
| 0x0000_0004  | 2        | LED[39:32]           |
| 0x0000_0006  | 3        | LED[47:40]           |
| 0x0000_0008  | 4        | 数码管位 0-1         |
| 0x0000_000A  | 5        | 数码管位 2-3         |
| 0x0000_000C  | 6        | 数码管位 4-5         |
| 0x0000_000E  | 7        | 通用输出 GPIO        |
| 0x0000_0010  | 8        | 手轮计数清零         |
| 0x0000_0012  | 9        | 回环测试             |
| …            | …        | 可扩展到 63          |

*1 注意：STM32 地址线 A[1] 对应 16-bit 半字，因此地址 = index << 1。

------

3 三句话总结

1. **地址译码**：`ADDR(7 downto 1)` 直接当索引，64 选 1 低有效。
2. **读通路**：`Rd_Ncs(i) = BUS_Ncs(i) OR NOE_d2`；当唯一低时把 `BUS_Din_Reg(i)` 送上总线。
3. **写通路**：`We_Ncs(i) = BUS_Ncs(i) OR NWE_d2`；当唯一低时把 `FSMC_AD_d2` 锁存到 `BUS_Dout_Reg(i)`。

------

4 想扩展 / 改深度，改 1 行即可

plain

```plain
generic map(Reg_Width => 128)   -- 扩到 128 寄存器
```

地址译码自动跟随，无需动任何逻辑。

------

5 常见坑提醒

表格

| 现象             | 原因                         | 解决                                                   |
| :--------------- | :--------------------------- | :----------------------------------------------------- |
| STM32 读不到数据 | 地址没左移 1 位              | MCU 地址 = index << 1                                  |
| 偶尔读到旧数据   | 建立-保持时间不足            | 在 STM32 FSMC 时序配置里 **Data latency 设 1 个 HCLK** |
| 写不进去         | FSMC 写时序 NOE/NWE 极性配反 | 检查 NOE/NWE 极性 = **Low 有效**                       |

## RTL/DATA_TOP.vhd

<a id="module-kl-data-top"></a>

### KL_DATA_TOP 调度模块

| 项目 | 内容 |
| --- | --- |
| 作用 | 轮流刷新LED/数码管、扫描键盘，并读取手轮选轴倍率 |
| 状态流程 | LED → 等待 → 关闭 → 数码管 → 等待 → 关闭 → 输出 → 键盘 → MPG |
| 数据处理 | KL输入稳定判断 → 历史防抖 → 发布`Key_Value`和`MPG_IN` |
| 阅读重点 | 多个子模块始终并行存在，上层通过En/Finish完成握手 |

```vhdl
library IEEE;
use IEEE.STD_LOGIC_1164.all;
use work.kaitong.all;

entity KL_DATA_TOP is
    generic (
        Key_Col_Num : Positive := 8
    );
    port (
        clk  : in std_logic;
        Nrst : in std_logic;
        -- KL 总线接口
        KL_nWR  : out std_logic;
        KL_nRD  : out std_logic;
        KL_ADDR : out std_logic_vector(5 downto 0);
        KL_DATA : inout std_logic_vector(7 downto 0);
        -- 内部数据接口
        LED_DATA_Array : in vector8_array(6 downto 0);      -- LED 控制信号
        Nixie_Tube     : in vector8_array(5 downto 0);      -- 数码管控制信号
        GP_Output      : in std_logic_vector(7 downto 0);   -- 通用输出信号
        Key_Value      : out vector8_array(Key_Col_Num - 1 downto 0);     -- 键盘按键值
        MPG_IN         : out std_logic_vector(6 downto 0)   -- 手轮输入信号
    );
end entity;

architecture rtl of KL_DATA_TOP is

    constant LED_ADDR    : std_logic_vector(5 downto 0) := "100100";  -- 【常量】LED_ADDR = "100100"
    constant Dig_ADDR    : std_logic_vector(5 downto 0) := "100011";  -- 【常量】Dig_ADDR = "100011"
    constant LED_EN_ADDR : std_logic_vector(5 downto 0) := "100010";  -- 【常量】LED_EN_ADDR = "100010"
    constant Output_ADDR : std_logic_vector(5 downto 0) := "100111";  -- 【常量】Output_ADDR = "100111"
    constant Scan_ADDR   : std_logic_vector(5 downto 0) := "100101";  -- 【常量】Scan_ADDR = "100101"
    constant Key_ADDR    : std_logic_vector(5 downto 0) := "001000";  -- 【常量】Key_ADDR = "001000"
    constant MPG_ADDR    : std_logic_vector(5 downto 0) := "001111";  -- 【说明】外部手轮开关的KL选通地址是6位二进制001111，即0F
    constant ALL_ZERO    : std_logic_vector(7 downto 0) := x"00";   -- 【常量】ALL_ZERO = x"00"
    constant ALL_ONE    : std_logic_vector(7 downto 0) := x"ff";    -- 【常量】ALL_ONE = x"ff"

    type state is (idle, Led_Set, LED_DIG_WAIT, LED_DIG_Close, Dig_Set, Output_Set, Key_Scan, Get_MPG, stop);  -- 【状态】定义上层调度的九种状态
    signal current_state, next_state : state;

    signal KL_nWR_Reg : std_logic;
    signal KL_nRD_Reg : std_logic;
    signal KL_DATA1 : std_logic_vector(7 downto 0);
    signal KL_DATA2 : std_logic_vector(7 downto 0);
    signal KL_DATA3 : std_logic_vector(7 downto 0);
    signal KL_DATA4 : std_logic_vector(7 downto 0);
    signal KL_DATA5 : std_logic_vector(7 downto 0);
    signal KL_DATA6 : std_logic_vector(7 downto 0);
    signal KL_DATA7 : std_logic_vector(7 downto 0);
    signal KL_DATA8 : std_logic_vector(7 downto 0);
    signal KL_DATA9 : std_logic_vector(7 downto 0);
    signal KL_DATA_REG : std_logic_vector(7 downto 0);
    signal KL_DATA_Out : std_logic_vector(7 downto 0);
    signal KL_ADDR_REG : std_logic_vector(5 downto 0);

    signal Led_Set_Done      : std_logic;
    signal Dig_Set_Done      : std_logic;
    signal Get_Key_Done      : std_logic;
    signal Key_Scan_Done     : std_logic;
    signal Output_Set_Done   : std_logic;
    signal Get_MPG_Done      : std_logic;
    signal DW_Send_Finish_d1 : std_logic;
    signal SW_Send_Finish_d1 : std_logic;
    signal KS_Scan_Finish_d1 : std_logic;
    signal SR_Rec_Finish_d1  : std_logic;
    signal Key_Scan_Done_d1  : std_logic;
    signal Get_MPG_Done_d1   : std_logic;
    signal Key_Value_Reg     : vector8_array(7 downto 0);
    signal Key_Value_Reg0    : vector8_array(7 downto 0);
    signal Key_Value_Reg1    : vector8_array(7 downto 0);
    signal Key_Value_Reg2    : vector8_array(7 downto 0);
    signal Key_Value_Reg3    : vector8_array(7 downto 0);
    signal MPG_IN_Reg        : std_logic_vector(6 downto 0);
    signal MPG_IN_Reg0       : std_logic_vector(6 downto 0);
    signal MPG_IN_Reg1       : std_logic_vector(6 downto 0);
    signal MPG_IN_Reg2       : std_logic_vector(6 downto 0);
    signal MPG_IN_Reg3       : std_logic_vector(6 downto 0);

    signal Scan_Cnt : integer range 0 to 51;                        -- 【信号】重复扫描计数器，实际只使用0到5

    signal Led_lft_reg : std_logic_vector(6 downto 0); -- 7 列 LED 使能信号
    signal Dig_lft_reg : std_logic_vector(5 downto 0); -- 6 列数码管使能信号
    signal Key_lft_reg : std_logic_vector(7 downto 0); -- 8 列键盘扫描信号

    component Double_WR_SET is
        port (
            clk  : in std_logic;
            Nrst : in std_logic;
    
            Send_En     : in std_logic;
            First_Data  : in std_logic_vector(7 downto 0);
            Second_Data : in std_logic_vector(7 downto 0);
            First_Addr  : in std_logic_vector(5 downto 0);
            Second_Addr : in std_logic_vector(5 downto 0);
            Send_Finish : out std_logic;
    
            KL_nWR  : out std_logic;
            KL_nRD  : out std_logic;
            KL_ADDR_Out : out std_logic_vector(5 downto 0);
            KL_DATA_Out : out std_logic_vector(7 downto 0)
        );
    end component;

    signal DW_Send_En     : std_logic;
    signal DW_First_Data  : std_logic_vector(7 downto 0);
    signal DW_Second_Data : std_logic_vector(7 downto 0);
    signal DW_First_Addr  : std_logic_vector(5 downto 0);
    signal DW_Second_Addr : std_logic_vector(5 downto 0);
    signal DW_Send_Finish : std_logic;
    signal DW_KL_nWR      : std_logic;
    signal DW_KL_nRD      : std_logic;
    signal DW_KL_ADDR_Out : std_logic_vector(5 downto 0);
    signal DW_KL_DATA_Out : std_logic_vector(7 downto 0);

    component Single_WR_SET is
        port (
            clk  : in std_logic;
            Nrst : in std_logic;
    
            Send_En    : in std_logic;
            Send_Data  : in std_logic_vector(7 downto 0);
            Send_Addr  : in std_logic_vector(5 downto 0);
            Send_Finish : out std_logic;
    
            KL_nWR  : out std_logic;
            KL_nRD  : out std_logic;
            KL_ADDR_Out : out std_logic_vector(5 downto 0);
            KL_DATA_Out : out std_logic_vector(7 downto 0)
        );
    end component;

    signal SW_Send_En     : std_logic;
    signal SW_Send_Data   : std_logic_vector(7 downto 0);
    signal SW_Send_Addr   : std_logic_vector(5 downto 0);
    signal SW_Send_Finish : std_logic;
    signal SW_KL_nWR      : std_logic;
    signal SW_KL_nRD      : std_logic;
    signal SW_KL_ADDR_Out : std_logic_vector(5 downto 0);
    signal SW_KL_DATA_Out : std_logic_vector(7 downto 0);

    component Single_Rec_SET is
        port (
            clk  : in std_logic;
            Nrst : in std_logic;
    
            Rec_En     : in std_logic;
            Rec_Addr   : in std_logic_vector(5 downto 0);
            Rec_Finish : out std_logic;
            Rec_Data   : out std_logic_vector(7 downto 0);
    
            KL_nWR  : out std_logic;
            KL_nRD  : out std_logic;
            KL_ADDR_Out : out std_logic_vector(5 downto 0);
            KL_DATA_In  : in std_logic_vector(7 downto 0)
        );
    end component;

    signal SR_Rec_En      : std_logic;
    signal SR_Rec_Addr    : std_logic_vector(5 downto 0);
    signal SR_Rec_Finish  : std_logic;
    signal SR_Rec_Data    : std_logic_vector(7 downto 0);
    signal SR_KL_nWR      : std_logic;
    signal SR_KL_nRD      : std_logic;
    signal SR_KL_ADDR_Out : std_logic_vector(5 downto 0);
    signal SR_KL_DATA_In  : std_logic_vector(7 downto 0);

    component KEY_Scan_SET is
        port (
            clk  : in std_logic;
            Nrst : in std_logic;
    
            Scan_En     : in std_logic;
            Scan_Data   : in std_logic_vector(7 downto 0);
            Scan_Addr   : in std_logic_vector(5 downto 0);
            Key_Addr    : in std_logic_vector(5 downto 0);
            Key_Value   : out std_logic_vector(7 downto 0);
            Scan_Finish : out std_logic;
    		tri_control : out std_logic;
            KL_nWR : out std_logic;
            KL_nRD : out std_logic;
            KL_ADDR_Out : out std_logic_vector(5 downto 0);
            KL_DATA_In  : in std_logic_vector(7 downto 0);
            KL_DATA_Out : out std_logic_vector(7 downto 0)
        );
    end component;

    signal KS_Scan_En     : std_logic;
    signal KS_Scan_Addr   : std_logic_vector(5 downto 0);
    signal KS_Scan_Data   : std_logic_vector(7 downto 0);
    signal KS_Key_Addr    : std_logic_vector(5 downto 0);
    signal KS_Key_Value   : std_logic_vector(7 downto 0);
    signal KS_Scan_Finish : std_logic;
    signal KS_KL_nWR      : std_logic;
    signal KS_KL_nRD      : std_logic;
    signal KS_KL_ADDR_Out : std_logic_vector(5 downto 0);
    signal KS_KL_DATA_In  : std_logic_vector(7 downto 0);
    signal KS_KL_DATA_Out : std_logic_vector(7 downto 0);

    signal Close_Done : std_logic;

    signal clk_200us      : std_logic;
    signal cnt_200us      : integer range 0 to 714286;              -- 【信号】计数器声明上限未被实际计时终值使用
    signal clk_en       : std_logic;

	signal tri_control : std_logic;
    signal key_set_tri : std_logic;

begin

    KL_nWR <= KL_nWR_Reg;                                           -- 【动作】外部KL总线低有效写选通 ← KL_nWR_Reg
    KL_nRD <= KL_nRD_Reg;                                           -- 【动作】外部KL总线低有效读选通 ← KL_nRD_Reg
    KL_ADDR <= KL_ADDR_REG;

-- ------------------------------------------------------------------
-- 进程作用：控制KL_DATA双向总线方向
-- 更新方式：纯组合逻辑
-- 阅读重点：tri_control=0驱动，=1输出Z释放总线
-- ------------------------------------------------------------------
	process(tri_control,KL_DATA_Out)
    begin
		if(tri_control = '0') then
    		KL_DATA <= KL_DATA_Out;                                       -- 【说明】方向为0时驱动KL_DATA_Out
        else
        	KL_DATA <= (others => 'Z');                                -- 【动作】方向为1时输出Z，表示FPGA不主动驱动
        end if;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：连续采样并判断KL输入是否稳定
-- 更新方式：时钟上升沿更新
-- 阅读重点：原相等判断中存在一处误写为<=
-- ------------------------------------------------------------------
    process(Nrst,CLK)
	begin
		if(Nrst = '0')then
			KL_DATA1 <= (others => '0');
            KL_DATA2 <= (others => '0');
            KL_DATA3 <= (others => '0');
            KL_DATA4 <= (others => '0');
            KL_DATA5 <= (others => '0');
            KL_DATA6 <= (others => '0');
            KL_DATA7 <= (others => '0');
            KL_DATA8 <= (others => '0');
            KL_DATA9 <= (others => '0');
		elsif(rising_edge(CLK))then
			    KL_DATA1 <= KL_DATA;
                KL_DATA2 <= KL_DATA1;
                KL_DATA3 <= KL_DATA2;                               -- 【动作】这是移位寄存器中的合法信号赋值：第3级保存旧的第2级
                KL_DATA4 <= KL_DATA3;
                KL_DATA5 <= KL_DATA4;
                KL_DATA6 <= KL_DATA5;
                KL_DATA7 <= KL_DATA6;
                KL_DATA8 <= KL_DATA7;
                KL_DATA9 <= KL_DATA8;

            if(KL_DATA1 = KL_DATA and KL_DATA2 = KL_DATA1 and KL_DATA3 <= KL_DATA2 and KL_DATA4 = KL_DATA3 and   -- 【故障】这里是“小于等于”，稳定判断应使用“等于”
                KL_DATA5 = KL_DATA4 and KL_DATA6 = KL_DATA5 and KL_DATA7 = KL_DATA6 and KL_DATA8 = KL_DATA7 and KL_DATA9 = KL_DATA8) then  -- 【条件】其余历史值也必须连续相等
                    KL_DATA_REG <= KL_DATA;                         -- 【动作】历史数据全部稳定时更新KL_DATA_REG
            end if;
		end if;
	end process;

-- ------------------------------------------------------------------
-- 进程作用：保存各子模块Finish信号的前一拍
-- 更新方式：时钟上升沿更新
-- 阅读重点：上层用当前值与历史值识别完成上升沿
-- ------------------------------------------------------------------
    process (clk, Nrst)
	begin
		if (Nrst = '0') then
            DW_Send_Finish_d1 <= '0';
            SW_Send_Finish_d1 <= '0';
            KS_Scan_Finish_d1 <= '0';
            SR_Rec_Finish_d1  <= '0';
		elsif (rising_edge(clk)) then
			DW_Send_Finish_d1 <= DW_Send_Finish;
            SW_Send_Finish_d1 <= SW_Send_Finish;
            KS_Scan_Finish_d1 <= KS_Scan_Finish;
            SR_Rec_Finish_d1  <= SR_Rec_Finish;
		end if;
	end process;

-- ------------------------------------------------------------------
-- 进程作用：对键盘和选轴倍率数据进行历史一致性防抖
-- 更新方式：时钟上升沿更新
-- 阅读重点：这是整字防抖，一个位变化会阻止整组发布
-- ------------------------------------------------------------------
    process (clk, Nrst)
	begin
		if (Nrst = '0') then
            Key_Scan_Done_d1 <= '0';
            Get_MPG_Done_d1  <= '0';
            MPG_IN           <= (others => '1');                    -- 【说明】MPG_IN是7位，全1就是7F，表示低有效输入全未选中
            MPG_IN_Reg0      <= (others => '1');
            MPG_IN_Reg1      <= (others => '1');
            MPG_IN_Reg2      <= (others => '1');
            MPG_IN_Reg3      <= (others => '1');
            Key_Value        <= (others => (others => '1'));        -- 【动作】键盘扫描值或对外发布的键盘数组，具体宽度看本模块端口全部置 1
            Key_Value_Reg0   <= (others => (others => '1'));
            Key_Value_Reg1   <= (others => (others => '1'));
            Key_Value_Reg2   <= (others => (others => '1'));
            Key_Value_Reg3   <= (others => (others => '1'));
		elsif (rising_edge(clk)) then
            Key_Scan_Done_d1 <= Key_Scan_Done;
            Get_MPG_Done_d1  <= Get_MPG_Done;

			for i in 0 to Key_Col_Num - 1 loop                               -- 【说明】遍历各键盘组的防抖硬件逻辑
                if(Key_Scan_Done_d1 = '0' and Key_Scan_Done = '1') then  -- 【边沿】检测 Key_Scan_Done 上升沿
                    Key_Value_Reg0(i) <= Key_Value_Reg(i);          -- 【动作】键盘采样完成上升沿时，将第i组当前原始样本送到历史0级；它不是本拍刚赋值后的新量
                    Key_Value_Reg1(i) <= Key_Value_Reg0(i);
                    Key_Value_Reg2(i) <= Key_Value_Reg1(i);
                    Key_Value_Reg3(i) <= Key_Value_Reg2(i);
                end if;

                if(Key_Value_Reg(i) = Key_Value_Reg0(i) and Key_Value_Reg0(i) = Key_Value_Reg1(i) and   -- 【说明】开始整字稳定判断：当前原始键盘字节与四级历史必须相等
                    Key_Value_Reg1(i) = Key_Value_Reg2(i) and Key_Value_Reg2(i) = Key_Value_Reg3(i)) then  -- 【说明】补完其余历史相等条件；一个位抖动也会阻止这个字节发布
                        Key_Value(i) <= Key_Value_Reg(i);           -- 【说明】把满足一致条件的第i组数据发布为Key_Value(i)
                end if;
            end loop;
            
            if(Get_MPG_Done_d1 = '0' and Get_MPG_Done = '1') then   -- 【边沿】读取完成上升沿到来时推进MPG历史
            	MPG_IN_Reg0 <= MPG_IN_Reg;                             -- 【动作】历史0级复制原始MPG_IN_Reg；下一行不会立即拿到本行刚更新的新值
            	MPG_IN_Reg1 <= MPG_IN_Reg0;
            	MPG_IN_Reg2 <= MPG_IN_Reg1;
            	MPG_IN_Reg3 <= MPG_IN_Reg2;
            end if;

            if(MPG_IN_Reg = MPG_IN_Reg0 and MPG_IN_Reg0 = MPG_IN_Reg1 and   -- 【条件】当前值与四级历史全部一致才通过
                MPG_IN_Reg1 = MPG_IN_Reg2 and MPG_IN_Reg2 = MPG_IN_Reg3) then  -- 【说明】补完历史1、2、3的相等比较
                    MPG_IN <= MPG_IN_Reg;                           -- 【动作】稳定后才发布MPG_IN，否则保持旧值
            end if;
		end if;
	end process;

-- ------------------------------------------------------------------
-- 进程作用：保存KL调度状态机的当前状态
-- 更新方式：时钟上升沿更新
-- 阅读重点：同拍其他进程仍读取更新前的current_state
-- ------------------------------------------------------------------
    process (clk, Nrst)
	begin
		if (Nrst = '0') then
			current_state <= idle;                                           -- 【动作】当前状态 ← idle
		elsif (rising_edge(clk)) then
			current_state <= next_state;                                     -- 【状态】时钟沿更新当前状态
		end if;
	end process;

-- ------------------------------------------------------------------
-- 进程作用：计算KL调度状态机的下一状态
-- 更新方式：纯组合逻辑
-- 阅读重点：只决定去哪里，不直接操作外部引脚
-- ------------------------------------------------------------------
    process (current_state,Led_Set_Done,clk_200us,Close_Done,Dig_Set_Done,Output_Set_Done,Key_Scan_Done,Get_MPG_Done)
	begin
		case current_state is
			when idle =>
                next_state <= Led_Set;                              -- 【状态】下一状态 ← Led_Set

            when Led_Set => -- 设置 LED 地址及数据
                if(Led_Set_Done = '1') then
                    next_state <= LED_DIG_WAIT;                     -- 【状态】下一状态 ← LED_DIG_WAIT
                else
                    next_state <= Led_Set;                          -- 【状态】下一状态 ← Led_Set
                end if;

            when LED_DIG_WAIT => 
                if(clk_200us = '1') then                            -- 【条件】计时到期？
                    next_state <= LED_DIG_Close;                    -- 【状态】下一状态 ← LED_DIG_Close
                else
                    next_state <= LED_DIG_WAIT;                     -- 【状态】下一状态 ← LED_DIG_WAIT
                end if;

            when LED_DIG_Close =>
                if(Close_Done = '1') then
                    if(Dig_Set_Done = '0') then                     -- 【状态】显示关闭后，未完成数码管更新则转Dig_Set
                        next_state <= Dig_Set;                      -- 【状态】下一状态 ← Dig_Set
                    else
                        next_state <= Output_Set;                   -- 【状态】下一状态 ← Output_Set
                    end if;
                else
                    next_state <= LED_DIG_Close;                    -- 【状态】下一状态 ← LED_DIG_Close
                end if;

            when Dig_Set => -- 设置数码管地址及数据
                if(Dig_Set_Done = '1') then
                    next_state <= LED_DIG_WAIT;                     -- 【状态】下一状态 ← LED_DIG_WAIT
                else
                    next_state <= Dig_Set;                          -- 【状态】下一状态 ← Dig_Set
                end if;

            when Output_Set => -- 设置通用输出地址及数据
                if(Output_Set_Done = '1') then
                    next_state <= Key_Scan;                         -- 【状态】下一状态 ← Key_Scan
                else
                    next_state <= Output_Set;                       -- 【状态】下一状态 ← Output_Set
                end if;

            when Key_Scan =>  -- 按键扫描
                if(Key_Scan_Done = '1') then
                    next_state <= Get_MPG;                          -- 【状态】下一状态 ← Get_MPG
                else
                    next_state <= Key_Scan;                         -- 【状态】下一状态 ← Key_Scan
                end if;
 
            when Get_MPG =>   -- 手轮信号扫描（倍率及轴选择）
                if(Get_MPG_Done = '1') then
                    next_state <= stop;                             -- 【状态】下一状态 ← stop
                else
                    next_state <= Get_MPG;                          -- 【状态】下一状态 ← Get_MPG
                end if;

            when stop => 
                next_state <= idle;                                 -- 【状态】下一状态 ← idle

            when others =>
                next_state <= idle;                                 -- 【状态】下一状态 ← idle
        end case;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：执行KL调度各状态的实际动作
-- 更新方式：时钟上升沿更新
-- 阅读重点：负责启动子模块、更新轮选值并接收返回数据
-- ------------------------------------------------------------------
    process (clk, Nrst)
    begin
        if(Nrst = '0')then                                          -- 【复位】低有效复位分支开始
            Scan_Cnt <= 0;
            Led_Set_Done    <= '0';
            Dig_Set_Done    <= '0';
            Get_Key_Done    <= '0';
            Key_Scan_Done   <= '0';
            Output_Set_Done <= '0';
            Get_MPG_Done    <= '0';
            DW_Send_En      <= '0';
            SW_Send_En      <= '0';
            SR_Rec_En       <= '0';
            KS_Scan_En      <= '0';
            clk_en          <= '0';
            tri_control     <= '0';                                 -- 【动作】数据总线方向选择，本顶层0表示驱动、1表示释放 ← 0
            Led_lft_reg     <= "0000001";                           -- 【说明】初始LED轮选位图为0000001，先选择索引0对应组
            Dig_lft_reg     <= "000001";                            -- 【说明】初始数码管轮选位图为000001，先选择索引0对应组
            Key_lft_reg     <= "11111110";                          -- 【说明】初始键盘轮选位图为11111110，低有效bit0首先被选择
            MPG_IN_Reg      <= (others => '0');                     -- 【复位】原始值清00，对外发布值初始化为7F
            DW_First_Data   <= (others => '0');
            DW_Second_Data  <= (others => '0');
            DW_First_Addr   <= (others => '0');
            DW_Second_Addr  <= (others => '0');
            SW_Send_Data    <= (others => '0');
            SW_Send_Addr    <= (others => '0');
            SR_Rec_Addr     <= (others => '0');
            KS_Scan_Addr    <= (others => '0');
            KS_Scan_Data    <= (others => '0');
            KS_Scan_Addr    <= (others => '0');                     -- 【说明】重复清零KS_Scan_Addr，无额外作用
            KS_Key_Addr     <= (others => '0');
            KL_DATA_Out     <= (others => '0');
            KL_ADDR_REG     <= (others => '0');
            Key_Value_Reg   <= (others => (others => '1'));
        elsif(rising_edge(clk))then
            case current_state is
                when idle =>
                    DW_Send_En      <= '0';
                    SW_Send_En      <= '0';
                    SR_Rec_En       <= '0';
                    KS_Scan_En      <= '0';
                    Led_Set_Done    <= '0';
                    Dig_Set_Done    <= '0';
                    Get_Key_Done    <= '0';
                    Key_Scan_Done   <= '0';
                    Output_Set_Done <= '0';
                    Get_MPG_Done    <= '0';
                    clk_en <= '0';
                    tri_control <= '0';                             -- 【动作】数据总线方向选择，本顶层0表示驱动、1表示释放 ← 0

                when Led_Set => 
                    for i in 0 to 6 loop
                        if(Led_lft_reg(i) = '1') then
                            DW_Second_Data <= LED_DATA_Array(i);    -- 【动作】选择当前LED组的数据作为第二笔写数据
                        end if;
                    end loop;

                    DW_First_Data <= '0' & Led_lft_reg;             -- 【说明】高位补1个0，再拼7位LED选择，形成8位的第一笔写数据
                    
                    DW_Second_Addr <= LED_ADDR; -- LED 地址
                    DW_First_Addr <= LED_EN_ADDR; -- LED 使能地址

                    if(DW_Send_Finish_d1 = '0' and DW_Send_Finish = '1') then  -- 【边沿】检测 DW_Send_Finish 上升沿
                        Led_lft_reg <= Led_lft_reg(5 downto 0) & Led_lft_reg(6);  -- 【动作】LED选择位循环左移，轮换到下一组
                        Led_Set_Done <= '1';
                    end if;

                    if(Led_Set_Done = '0') then
                        DW_Send_En <= '1'; -- 数据锁存使能生效
                    else
                        DW_Send_En <= '0';
                    end if;

					tri_control <= '0';                                            -- 【动作】数据总线方向选择，本顶层0表示驱动、1表示释放 ← 0
                    
                    KL_nWR_Reg <= DW_KL_nWR;
                    KL_nRD_Reg <= DW_KL_nRD;
                    KL_ADDR_REG <= DW_KL_ADDR_Out;
                    KL_DATA_Out <= DW_KL_DATA_Out;

                when LED_DIG_WAIT =>                                -- 【动作】执行显示驻留等待阶段；它是状态输出分支，不是下一状态判断
                    clk_en <= '1';                                  -- 【动作】只开启等待计数器，其他未赋值的寄存输出保持旧值，让当前显示持续

                when LED_DIG_Close => 
                    clk_en <= '0';
                    SW_Send_Data <= ALL_ZERO;                       -- 【说明】准备向当前显示数据地址写全0，以结束这一显示驻留阶段

                    if(Dig_Set_Done = '0') then
                        SW_Send_Addr <= LED_ADDR;
                    else
                        SW_Send_Addr <= Dig_ADDR;
                    end if;

                    if(SW_Send_Finish_d1 = '0' and SW_Send_Finish = '1') then  -- 【边沿】检测 SW_Send_Finish 上升沿
                        Close_Done <= '1';
                    else
                        Close_Done <= '0';
                    end if;

                    if(Close_Done = '0') then
                        SW_Send_En <= '1'; -- 数据锁存使能生效
                    else
                        SW_Send_En <= '0';
                    end if;

                    KL_nWR_Reg <= SW_KL_nWR;
                    KL_nRD_Reg <= SW_KL_nRD;
                    KL_ADDR_REG <= SW_KL_ADDR_Out;
                    KL_DATA_Out <= SW_KL_DATA_Out;

                when Dig_Set =>
                    for i in 0 to 5 loop
                        if(Dig_lft_reg(i) = '1') then
                            DW_Second_Data <= Nixie_Tube(i);        -- 【说明】按当前数码管轮选位i选择该组段码，交给双次写模块
                        end if;
                    end loop;

                    DW_First_Data <= Dig_lft_reg & "00";            -- 【说明】6位数码管轮选位图后拼两个0，形成8位控制值；不是把原信号永久扩大或修改
                    
                    DW_Second_Addr <= Dig_ADDR;     -- 数码管地址
                    DW_First_Addr <= LED_EN_ADDR; -- 数码管使能地址，与 LED 使能地址相同
                        
                    if(DW_Send_Finish_d1 = '0' and DW_Send_Finish = '1') then  -- 【边沿】检测 DW_Send_Finish 上升沿
                        Dig_lft_reg <= Dig_lft_reg(4 downto 0) & Dig_lft_reg(5);  -- 【说明】把6位数码管位图循环左移一位，以轮换下一组
                        Dig_Set_Done <= '1';
                    end if;

                    if(Dig_Set_Done = '0') then
                        DW_Send_En <= '1'; -- 数据锁存使能生效
                    else
                        DW_Send_En <= '0';
                    end if;

                    KL_nWR_Reg <= DW_KL_nWR;
                    KL_nRD_Reg <= DW_KL_nRD;
                    KL_ADDR_REG <= DW_KL_ADDR_Out;
                    KL_DATA_Out <= DW_KL_DATA_Out;

                when Output_Set =>
                    SW_Send_Data <= GP_Output; -- 设置通用输出数据
                    SW_Send_Addr <= Output_ADDR; -- 设置通用输出地址

                    if(SW_Send_Finish_d1 = '0' and SW_Send_Finish = '1') then  -- 【边沿】检测 SW_Send_Finish 上升沿
                        Output_Set_Done <= '1';
                    else
                        Output_Set_Done <= '0';
                    end if;

                    if(Output_Set_Done = '0') then
                        SW_Send_En <= '1'; -- 数据锁存使能生效
                    else
                        SW_Send_En <= '0';
                    end if;

                    KL_nWR_Reg <= SW_KL_nWR;
                    KL_nRD_Reg <= SW_KL_nRD;
                    KL_ADDR_REG <= SW_KL_ADDR_Out;
                    KL_DATA_Out <= SW_KL_DATA_Out;

                when Key_Scan =>
                        KS_Scan_Addr <= Scan_ADDR; -- 设置行扫描地址
                        KS_Scan_Data <= Key_lft_reg;

                        KS_Key_Addr <= Key_ADDR; -- 设置按键读地址
                    
                    if(KS_Scan_Finish_d1 = '0' and KS_Scan_Finish = '1') then  -- 【边沿】检测 KS_Scan_Finish 上升沿
                        Key_Scan_Done <= '1';

                        for i in 0 to Key_Col_Num - 1 loop
                            if(Key_lft_reg(i) = '0') then
                                Key_Value_Reg(i) <= KS_Key_Value;   -- 【动作】将本次返回的键盘字节保存到当前低有效轮选的数组项；其他项保持原值
                            end if;
                        end loop;

                        if(Scan_Cnt < 5) then -- 对同一行连续扫描 5 次  【时序】从0判断到5，实际重复6次后才轮换
                            Scan_Cnt <= Scan_Cnt + 1;
                        else
                            Scan_Cnt <= 0;
                            Key_lft_reg <= Key_lft_reg(6 downto 0) & Key_lft_reg(7);  -- 【说明】循环左移8位键盘选择，使低有效的0移动到下一组，例如FE变FD
                        end if;
                    else
                        Key_Scan_Done <= '0';
                    end if;

                    if(Key_Scan_Done = '0') then
                        KS_Scan_En <= '1'; -- 数据锁存使能生效
                    else
                        KS_Scan_En <= '0';
                    end if;

                    KL_nWR_Reg <= KS_KL_nWR;
                    KL_nRD_Reg <= KS_KL_nRD;
                    KL_ADDR_REG <= KS_KL_ADDR_Out;
                    KL_DATA_Out <= KS_KL_DATA_Out;
                    KS_KL_DATA_In <= KL_DATA_REG;
                    
                    tri_control <= key_set_tri;                     -- 【动作】数据总线方向选择，本顶层0表示驱动、1表示释放 ← key_set_tri

                when Get_MPG =>
                    SR_Rec_En <= '1';                               -- 【时序】本拍先置1，后续同进程赋值可能覆盖它
                    SR_Rec_Addr <= MPG_ADDR; -- 设置手轮数据地址  【动作】向单次读取子模块提供KL外设地址0F；请求和地址同拍更新后，子模块下一拍看到它们

                    if(SR_Rec_Finish_d1 = '0' and SR_Rec_Finish = '1') then  -- 【时序】用完成信号及其上一拍值检测新的完成上升沿，防止高电平期间重复接受
                        Get_MPG_Done <= '1';
                        MPG_IN_Reg <= SR_Rec_Data(6 downto 0);      -- 【动作】保存读取返回值的低7位
                    else
                        Get_MPG_Done <= '0';
                    end if;

                    if(Get_MPG_Done = '0') then                     -- 【说明】读取旧的Get_MPG_Done决定请求是否继续保持
                        SR_Rec_En <= '1'; -- 数据锁存使能生效
                    else
                        SR_Rec_En <= '0';                           -- 【说明】当旧Done已为1时撤销请求，让边沿触发子模块重新准备；并非启动后立即撤销
                    end if;

					tri_control <= '1';                                            -- 【说明】在手轮读取阶段释放FPGA对KL数据线的驱动，让外部输入器件提供数据

                    KL_nWR_Reg <= SR_KL_nWR;
                    KL_nRD_Reg <= SR_KL_nRD;
                    KL_ADDR_REG <= SR_KL_ADDR_Out;
                    SR_KL_DATA_In <= KL_DATA_REG;                   -- 【说明】将滤波后的总线值寄存转发给读取子模块，额外增加一拍延迟，不是零延迟导线
                    KL_DATA_Out <= (others => 'Z');                 -- 【动作】输出数据寄存值也设为Z；同时tri_control=1确保顶层总线驱动已释放

                when stop => 
                    DW_Send_En      <= '0';
                    SW_Send_En      <= '0';
                    SR_Rec_En       <= '0';
                    KS_Scan_En      <= '0';
                    Led_Set_Done    <= '0';
                    Dig_Set_Done    <= '0';
                    Get_Key_Done    <= '0';
                    Key_Scan_Done   <= '0';
                    Output_Set_Done <= '0';
                    Get_MPG_Done    <= '0';

                when others =>
                    null;
            end case;
        end if;
    end process;

U1 : Double_WR_SET
    port map(
        clk  => clk,
        Nrst => Nrst,
        Send_En => DW_Send_En,
        First_Data  => DW_First_Data,
        Second_Data => DW_Second_Data,
        First_Addr  => DW_First_Addr,
        Second_Addr => DW_Second_Addr,
        Send_Finish => DW_Send_Finish,
        KL_nWR  => DW_KL_nWR,
        KL_nRD  => DW_KL_nRD,
        KL_ADDR_Out => DW_KL_ADDR_Out,
        KL_DATA_Out => DW_KL_DATA_Out
    );

U2 : Single_WR_SET
    port map(
        clk  => clk,
        Nrst => Nrst,
        Send_En => SW_Send_En,
        Send_Data => SW_Send_Data,
        Send_Addr => SW_Send_Addr,
        Send_Finish => SW_Send_Finish,
        KL_nWR  => SW_KL_nWR,
        KL_nRD  => SW_KL_nRD,
        KL_ADDR_Out => SW_KL_ADDR_Out,
        KL_DATA_Out => SW_KL_DATA_Out
    );

U3 : Single_Rec_SET
    port map(
        clk  => clk,
        Nrst => Nrst,
        Rec_En     => SR_Rec_En,
        Rec_Addr   => SR_Rec_Addr,
        Rec_Finish => SR_Rec_Finish,
        Rec_Data   => SR_Rec_Data,
        KL_nWR  => SR_KL_nWR,
        KL_nRD  => SR_KL_nRD,
        KL_ADDR_Out => SR_KL_ADDR_Out,
        KL_DATA_In  => SR_KL_DATA_In
    );

U4 : KEY_Scan_SET
    port map(
        clk  => clk,
        Nrst => Nrst,
        Scan_En     => KS_Scan_En,
        Scan_Addr   => KS_Scan_Addr,
        Scan_Data   => KS_Scan_Data,
        Key_Addr    => KS_Key_Addr,
        Key_Value   => KS_Key_Value,
        Scan_Finish => KS_Scan_Finish,
        tri_control => key_set_tri,
        KL_nWR => KS_KL_nWR,
        KL_nRD => KS_KL_nRD,
        KL_ADDR_Out => KS_KL_ADDR_Out,
        KL_DATA_In  => KS_KL_DATA_In,
        KL_DATA_Out => KS_KL_DATA_Out
    );

-- ------------------------------------------------------------------
-- 进程作用：产生显示驻留用的计时到期脉冲
-- 更新方式：时钟上升沿更新
-- 阅读重点：按当前终值实际约217.99us
-- ------------------------------------------------------------------
    process(clk,Nrst)
    begin
        if(Nrst = '0')then
            clk_200us <= '0';
            cnt_200us <= 0;
        elsif(rising_edge(clk))then
            if(clk_en = '1') then
                if(cnt_200us = 28571)then                           -- 【时序】0到28571共28572拍，约217.99us
                    clk_200us <= '1';
                    cnt_200us <= 0;
                else
                    cnt_200us <= cnt_200us + 1;
                    clk_200us <= '0';
                end if;
            else
                cnt_200us <= 0;
                clk_200us <= '0';
            end if;
        end if;
    end process;

end architecture;
```

### u3 - single_rec_set - rtl

<a id="module-single-rec"></a>

### Single_Rec_SET 单次读取

| 项目 | 内容 |
| --- | --- |
| 作用 | 对指定KL地址完成一次8位读取 |
| 状态流程 | `idle → Addr_Set → rd_valid → Data_Get → stop → idle` |
| 正确时序 | 地址稳定 → `KL_nRD=0` → 数据采样 → 停止采样 → `KL_nRD=1` |
| 已知故障 | 原代码在Data_Get提前释放读使能，却继续采样，正确值可能被FF覆盖 |

```vhdl
library IEEE;
use IEEE.STD_LOGIC_1164.ALL;

entity Single_Rec_SET is
port(
    clk        : in  std_logic;
    Nrst       : in  std_logic;

    Rec_En     : in  std_logic;
    
    Rec_Addr   : in  std_logic_vector(5 downto 0);
    Rec_Finish : out std_logic;
    Rec_Data   : out std_logic_vector(7 downto 0);

    KL_nWR     : out std_logic;
    KL_nRD     : out std_logic;
    KL_ADDR_Out: out std_logic_vector(5 downto 0);
    KL_DATA_In : in  std_logic_vector(7 downto 0)
);
end entity;

architecture rtl of Single_Rec_SET is
type state is (idle, Addr_Set, rd_valid, Data_Get, stop);           -- 【状态】定义状态机全部状态
signal current_state, next_state : state;

signal clk_5us     : std_logic;
signal cnt_5us     : integer range 0 to 626;                        -- 【时序】0到625共626拍，不是625拍
signal clk_en_5us  : std_logic;
signal Rec_En_d1   : std_logic;
signal Command_Lock: std_logic;
signal Rec_Addr_Reg: std_logic_vector(5 downto 0);

begin

-- 1、状态跳转时序逻辑
-- ------------------------------------------------------------------
-- 进程作用：保存单次读取状态机的当前状态
-- 更新方式：时钟上升沿更新
-- 阅读重点：复位后从idle开始
-- ------------------------------------------------------------------
process(clk, Nrst)
begin
    if(Nrst = '0')then
        current_state <= idle;                                      -- 【动作】当前状态 ← idle
    elsif rising_edge(clk) then
        current_state <= next_state;                                -- 【状态】时钟沿更新当前状态
    end if;
end process;

-- 2、组合逻辑：状态跳转判断
-- ------------------------------------------------------------------
-- 进程作用：计算单次读取的下一状态
-- 更新方式：纯组合逻辑
-- 阅读重点：Data_Get分支只决定状态跳转
-- ------------------------------------------------------------------
process(current_state,clk_5us,Command_Lock)
begin
    case current_state is
        when idle =>
            if(Command_Lock = '1')then
                next_state <= Addr_Set;                             -- 【状态】下一状态 ← Addr_Set
            else
                next_state <= idle;                                 -- 【状态】下一状态 ← idle
            end if;

        when Addr_Set =>
            if(clk_5us = '1')then                                   -- 【条件】计时到期？
                next_state <= rd_valid;                             -- 【状态】下一状态 ← rd_valid
            else
                next_state <= Addr_Set;                             -- 【状态】下一状态 ← Addr_Set
            end if;

        when rd_valid =>
            if(clk_5us = '1')then                                   -- 【状态】计时到期后准备进入Data_Get
                next_state <= Data_Get;                             -- 【状态】下一状态 ← Data_Get
            else
                next_state <= rd_valid;                             -- 【状态】下一状态 ← rd_valid
            end if;

        when Data_Get =>                                            -- 【状态】这里只决定Data_Get的下一状态
            if(clk_5us = '1')then                                   -- 【条件】计时到期？
                next_state <= stop;                                 -- 【状态】下一状态 ← stop
            else
                next_state <= Data_Get;                             -- 【动作】定时脉冲未到，继续停留Data_Get；停留期间输出进程仍每个系统时钟执行一次
            end if;

        when stop =>
            if(clk_5us = '1')then                                   -- 【条件】计时到期？
                next_state <= idle;                                 -- 【状态】下一状态 ← idle
            else
                next_state <= stop;                                 -- 【状态】下一状态 ← stop
            end if;

        when others =>
            next_state <= idle;                                     -- 【状态】下一状态 ← idle
    end case;
end process;

-- 3、各状态输出逻辑
-- ------------------------------------------------------------------
-- 进程作用：执行单次读取各状态的总线动作
-- 更新方式：时钟上升沿更新
-- 阅读重点：原Data_Get中存在提前释放读使能的故障
-- ------------------------------------------------------------------
process(clk, Nrst)
begin
    if(Nrst = '0')then
        KL_nWR      <= '1';                                         -- 【动作】外部KL总线低有效写选通 ← 1，无效
        KL_nRD      <= '1';                                         -- 【动作】外部KL总线低有效读选通 ← 1，无效
        clk_en_5us  <= '0';
        Rec_Finish  <= '0';
        Rec_En_d1   <= '0';
        Command_Lock<= '0';
        Rec_Addr_Reg<= (others => '0');
        Rec_Data    <= (others => '0');                             -- 【动作】本次读取保存的8位结果清零
        KL_ADDR_Out <= (others => '0');
    elsif rising_edge(clk) then
        case current_state is
            when idle =>
                KL_nWR     <= '1';                                  -- 【动作】外部KL总线低有效写选通 ← 1，无效
                KL_nRD     <= '1';                                  -- 【动作】外部KL总线低有效读选通 ← 1，无效
                clk_en_5us <= '0';
                Rec_Finish <= '0';
                Rec_En_d1  <= Rec_En;                               -- 【动作】仅在idle保存请求电平，供下一次空闲采样比较
                if(Rec_En_d1 = '0' and Rec_En = '1')then            -- 【说明】前次空闲采样为0而当前请求为1，说明检测到启动边沿；不是只要请求高就每拍重启
                    Command_Lock <= '1';                            -- 【说明】锁存一次请求，令组合next_state准备进入Addr_Set
                    Rec_Addr_Reg <= Rec_Addr;                       -- 【动作】与命令一起保存地址，读取途中不再直接跟随上层地址变化
                else
                    Command_Lock <= '0';
                end if;

            when Addr_Set =>
                clk_en_5us  <= '1';
                KL_nRD      <= '1';                                 -- 【动作】外部KL总线低有效读选通 ← 1，无效
                Rec_Finish  <= '0';
                Command_Lock<= '0';
                KL_ADDR_Out <= Rec_Addr_Reg; --先设置地址  【动作】将启动时保存的地址送出，让地址先稳定，再去拉低读选通

            when rd_valid =>                                        -- 【动作】这是输出进程中的rd_valid动作段；不是另一份下一状态代码
                KL_nRD <= '0'; --拉低读使能信号  【说明】读选通拉低，外部被选中的输入器件应开始驱动数据

            when Data_Get =>                                        -- 【状态】Data_Get期间每个系统时钟都执行该分支
                KL_nRD   <= '1';                                    -- 【故障】过早拉高读使能，外设停止驱动数据
                Rec_Data <= KL_DATA_In;                             -- 【故障】读已释放却继续采样，正确值可能被FF覆盖

            when stop =>                                            -- 【修复】建议在stop停止采样后再拉高KL_nRD
                if(clk_5us = '1')then                               -- 【说明】收尾计时到期时报告完成
                    Rec_Finish <= '1';
                else
                    Rec_Finish <= '0';
                end if;

            when others =>
                null;
        end case;
    end if;
end process;

-- 4、5us定时计数器分频模块
-- ------------------------------------------------------------------
-- 进程作用：产生单次读取使用的短计时脉冲
-- 更新方式：时钟上升沿更新
-- 阅读重点：从0到625共626拍
-- ------------------------------------------------------------------
process(clk,Nrst)
begin
    if(Nrst = '0')then
        clk_5us <= '0';
        cnt_5us <= 0;
    elsif rising_edge(clk) then
        if(clk_en_5us = '1')then
            if(cnt_5us = 625)then                                   -- 【时序】计数到625后产生单拍到期标志
                clk_5us <= '1';                                     -- 【时序】计时到期标志保持高一拍，后续计数分支会把它清0
                cnt_5us <= 0;
            else
                cnt_5us <= cnt_5us + 1;
                clk_5us <= '0';
            end if;
        else
            cnt_5us <= 0;
            clk_5us <= '0';
        end if;
    end if;
end process;

end architecture;

```



### u4 - key_scan_set -rtl

<a id="module-key-scan"></a>

### KEY_Scan_SET 键盘扫描

| 项目 | 内容 |
| --- | --- |
| 作用 | 先写一组扫描选通数据，再从键盘地址读取8位输入 |
| 状态流程 | `idle → Scan_Set → wr_time → Key_Set → rd_time → Get_Key_Value → stop` |
| 总线方向 | 写阶段FPGA驱动数据；读阶段通过tri_control释放数据线 |
| 阅读重点 | Get_Key_Value期间保持读有效，完成采样后才释放，时序可用于对照单次读取模块 |

```vhdl
library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity KEY_Scan_SET is
    port (
        clk        : in std_logic;
        Nrst       : in std_logic;

        Scan_En    : in std_logic;
        Scan_Data  : in std_logic_vector(7 downto 0);
        Scan_Addr  : in std_logic_vector(5 downto 0);
        Key_Addr   : in std_logic_vector(5 downto 0);
        Scan_Finish: out std_logic;
        Key_Value  : out std_logic_vector(7 downto 0);
        tri_control: out std_logic;
        KL_nWR     : out std_logic;
        KL_nRD     : out std_logic;
        KL_ADDR_Out: out std_logic_vector(5 downto 0);
        KL_DATA_In : in  std_logic_vector(7 downto 0);
        KL_DATA_Out: out std_logic_vector(7 downto 0)
    );
end entity;

architecture rtl of KEY_Scan_SET is

    type state is (idle, Scan_Set, Key_Set, wr_time, rd_time, Get_Key_Value, stop);  -- 【状态】定义状态机全部状态
    signal current_state, next_state: state;

    signal Scan_Set_Done   : std_logic;                             -- 【说明】该标志虽在敏感列表中，但未参与状态判断
    signal clk_5us         : std_logic;
    signal clk_50us        : std_logic;
    signal cnt_5us         : integer range 0 to 626;
    signal cnt_50us        : integer range 0 to 6251;
    signal clk_en_5us      : std_logic;
    signal clk_en_50us     : std_logic;
    signal Scan_En_d1      : std_logic;
    signal Command_Lock    : std_logic;
    signal Scan_Data_Reg   : std_logic_vector(7 downto 0);
    signal Scan_Addr_Reg   : std_logic_vector(5 downto 0);
    signal Key_Addr_Reg    : std_logic_vector(5 downto 0);

begin

-- ------------------------------------------------------------------
-- 进程作用：保存键盘扫描状态机的当前状态
-- 更新方式：时钟上升沿更新
-- 阅读重点：复位后从idle开始
-- ------------------------------------------------------------------
    process(clk, Nrst)
    begin
        if (Nrst = '0') then
            current_state <= idle;                                  -- 【动作】当前状态 ← idle
        elsif rising_edge(clk) then
            current_state <= next_state;                            -- 【状态】时钟沿更新当前状态
        end if;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：计算键盘扫描的下一状态
-- 更新方式：纯组合逻辑
-- 阅读重点：按写选通、读采样和收尾顺序推进
-- ------------------------------------------------------------------
    process(current_state, clk_5us, Scan_Set_Done, Command_Lock, clk_50us)
    begin
        case current_state is
            when idle =>
                if(Command_Lock = '1') then
                    next_state <= Scan_Set;                         -- 【状态】下一状态 ← Scan_Set
                else
                    next_state <= idle;                             -- 【状态】下一状态 ← idle
                end if;

            when Scan_Set =>
                if(clk_5us = '1') then                              -- 【条件】计时到期？
                    next_state <= wr_time;                          -- 【状态】下一状态 ← wr_time
                else
                    next_state <= Scan_Set;                         -- 【状态】下一状态 ← Scan_Set
                end if;

            when wr_time =>
                if(clk_5us = '1') then                              -- 【条件】计时到期？
                    next_state <= Key_Set;                          -- 【状态】下一状态 ← Key_Set
                else
                    next_state <= wr_time;                          -- 【状态】下一状态 ← wr_time
                end if;

            when Key_Set =>
                if(clk_5us = '1') then                              -- 【条件】计时到期？
                    next_state <= rd_time;                          -- 【状态】下一状态 ← rd_time
                else
                    next_state <= Key_Set;                          -- 【状态】下一状态 ← Key_Set
                end if;

            when rd_time =>
                if(clk_5us = '1') then                              -- 【条件】计时到期？
                    next_state <= Get_Key_Value;                    -- 【状态】下一状态 ← Get_Key_Value
                else
                    next_state <= rd_time;                          -- 【状态】下一状态 ← rd_time
                end if;

            when Get_Key_Value =>
                if(clk_50us = '1') then                             -- 【条件】计时到期？
                    next_state <= stop;                             -- 【状态】下一状态 ← stop
                else
                    next_state <= Get_Key_Value;                    -- 【状态】下一状态 ← Get_Key_Value
                end if;

            when stop =>
                if(clk_5us = '1') then                              -- 【条件】计时到期？
                    next_state <= idle;                             -- 【状态】下一状态 ← idle
                else
                    next_state <= stop;                             -- 【状态】下一状态 ← stop
                end if;

            when others =>
                next_state <= idle;                                 -- 【状态】下一状态 ← idle
        end case;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：执行键盘扫描各状态的总线动作
-- 更新方式：时钟上升沿更新
-- 阅读重点：先写扫描位图，再释放数据线读取按键
-- ------------------------------------------------------------------
    process(clk, Nrst)
    begin
        if(Nrst = '0')then                                          -- 【风险】复位分支没有明确初始化tri_control
            KL_nWR      <= '1';                                     -- 【动作】外部KL总线低有效写选通 ← 1，无效
            KL_nRD      <= '1';                                     -- 【动作】外部KL总线低有效读选通 ← 1，无效
            Scan_Set_Done <= '0';
            Scan_Finish <= '0';
            clk_en_5us  <= '0';
            clk_en_50us <= '0';
            Scan_En_d1  <= '0';
            Command_Lock <= '0';
            Scan_Data_Reg  <= (others => '0');
            Scan_Addr_Reg  <= (others => '0');
            Key_Addr_Reg   <= (others => '0');
            KL_ADDR_Out    <= (others => '0');
            KL_DATA_Out    <= (others => '0');
            Key_Value      <= (others => '1');                      -- 【动作】键盘扫描值或对外发布的键盘数组，具体宽度看本模块端口全部置 1
        elsif(rising_edge(clk))then
            case current_state is
                when idle =>
                    KL_nWR <= '1';                                  -- 【动作】外部KL总线低有效写选通 ← 1，无效
                    KL_nRD <= '1';                                  -- 【动作】外部KL总线低有效读选通 ← 1，无效
                    Scan_Set_Done <= '0';
                    clk_en_5us <= '0';
                    clk_en_50us <= '0';
                    Scan_Finish <= '0';
                    Scan_En_d1 <= Scan_En;                          -- 【时序】仅在idle跟踪Scan_En，用于识别后续请求的上升沿；不是每拍全局采样

                    if(Scan_En_d1 = '0' and Scan_En = '1') then     -- 【边沿】检测 Scan_En 上升沿
                        Command_Lock <= '1';
                        Scan_Data_Reg <= Scan_Data;
                        Scan_Addr_Reg <= Scan_Addr;
                        Key_Addr_Reg  <= Key_Addr;
                    else
                        Command_Lock <= '0';
                    end if;
                    tri_control <= '0';                             -- 【动作】数据总线方向选择，本顶层0表示驱动、1表示释放 ← 0

                when Scan_Set =>
                    KL_nWR <= '1';                                  -- 【动作】外部KL总线低有效写选通 ← 1，无效
                    clk_en_5us <= '1';
                    Scan_Set_Done <= '0';
                    Scan_Finish <= '0';
                    Command_Lock <= '0';

                    KL_ADDR_Out <= Scan_Addr_Reg;
                    KL_DATA_Out <= Scan_Data_Reg;

                when wr_time =>
                    KL_nWR <= '0';                                  -- 【动作】外部KL总线低有效写选通 ← 0，低有效

                when Key_Set =>
                    KL_nWR <= '1';                                  -- 【动作】外部KL总线低有效写选通 ← 1，无效
                    Scan_Set_Done <= '1';
                    KL_ADDR_Out <= Key_Addr_Reg;                    -- 【说明】切换到读取键盘输入的外设地址

                when rd_time =>
                    KL_nRD <= '0';                                  -- 【说明】键盘读选通拉低，使外部输入有效
                    tri_control <= '1';                             -- 【动作】同时要求顶层释放数据总线，避免FPGA继续输出扫描位图

                when Get_Key_Value =>                               -- 【说明】开始保持并采样键盘数据的阶段
                    clk_en_5us  <= '0';                             -- 【时序】停止短计数器；计数器进程在看到使能变0后清零
                    clk_en_50us <= '1';                             -- 【时序】启动较长等待计数器，在此期间读选通保持此前的低电平
                    Key_Value <= KL_DATA_In;                        -- 【时序】每个系统时钟采样键盘输入；因为nRD仍有效，后续稳定样本可以覆盖早期样本

                when stop =>
                    KL_nRD <= '1';                                  -- 【动作】采样阶段结束后才拉高读选通；此状态不再更新Key_Value，顺序与推荐修复一致
                    KL_nWR <= '1';                                  -- 【动作】外部KL总线低有效写选通 ← 1，无效
                    clk_en_5us  <= '1';
                    clk_en_50us <= '0';

                    if(clk_5us = '1') then                          -- 【条件】计时到期？
                        Scan_Finish <= '1';                         -- 【说明】设置一拍完成标志
                    else
                        Scan_Finish <= '0';
                    end if;

                when others =>
                    null;
            end case;
        end if;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：产生键盘扫描的短计时脉冲
-- 更新方式：时钟上升沿更新
-- 阅读重点：从0到625共626拍
-- ------------------------------------------------------------------
    process(clk,Nrst)
    begin
        if(Nrst = '0')then
            clk_5us <= '0';
            cnt_5us <= 0;
        elsif rising_edge(clk)then
            if(clk_en_5us = '1') then
                if(cnt_5us = 625)then                               -- 【时序】短计数器终值625，从0起共626拍；不要把命名5us当作实际测量结果
                    clk_5us <= '1';
                    cnt_5us <= 0;
                else
                    cnt_5us <= cnt_5us + 1;
                    clk_5us <= '0';
                end if;
            else
                cnt_5us <= 0;
                clk_5us <= '0';
            end if;
        end if;
    end process;

-- ------------------------------------------------------------------
-- 进程作用：产生键盘数据稳定等待脉冲
-- 更新方式：时钟上升沿更新
-- 阅读重点：从0到6250共6251拍
-- ------------------------------------------------------------------
    process(clk,Nrst)
    begin
        if(Nrst = '0')then
            clk_50us <= '0';
            cnt_50us <= 0;
        elsif rising_edge(clk)then
            if(clk_en_50us = '1') then
                if(cnt_50us = 6250)then                             -- 【时序】长计数器终值6250，从0起共6251拍；131.072MHz下约47.691微秒
                    clk_50us <= '1';
                    cnt_50us <= 0;
                else
                    cnt_50us <= cnt_50us + 1;
                    clk_50us <= '0';
                end if;
            else
                cnt_50us <= 0;
                clk_50us <= '0';
            end if;
        end if;
    end process;

end architecture;

```



## RTL/hcod_counter.v

<a id="module-hcod"></a>

### hcod_counter 手轮计数

| 项目 | 内容 |
| --- | --- |
| 作用 | 检测A/B相合法状态变化，每个边沿增减18位内部计数 |
| 正向序列 | `00 → 10 → 11 → 01 → 00`，每个边沿加1 |
| 反向序列 | `00 → 01 → 11 → 10 → 00`，每个边沿减1 |
| 阅读重点 | `[17:2]`只是除4取整，不会确认是否完成完整AB周期 |

```verilog
module hcod_counter (                                               // 【说明】开始Verilog模块定义
                     clk_100,
                     nReset,
                     count_clr,
                     coda,
                     codb,
                     out_counter
                   );
input             clk_100;
input             nReset;
input             count_clr;
input             coda;
input             codb;
output reg [15:0] out_counter;                                      // 【动作】输出为16位，在always块中赋值所以声明reg
//======================================================================
reg         coda_dl1,coda_dl2;
reg         codb_dl1,codb_dl2;
reg         codz_dl1,codz_dl2;                                      // 【说明】声明两路Z相历史变量，但本模块没有Z相输入且后续没有使用；通常会被综合优化掉
reg  [17:0] pulse_counter;                                          // 【说明】内部累计器18位，位号17到0

wire        f_coda,f_codb;
//======================================================================
 filter800ns  filter0                                               // 【连接】实例化A相滤波器filter800ns，实例名filter0
                 (
                  .clk(clk_100),
                  .din(coda),
                  .dout(f_coda)
                 );
 filter800ns  filter1                                               // 【连接】再实例化一份独立的同类型滤波器，处理B相；两个实例并行工作
                 (
                  .clk(clk_100),
                  .din(codb),
                  .dout(f_codb)
                 );
//======================================================================
// ------------------------------------------------------------------
// 进程作用：保存滤波后A相的当前采样
// 更新方式：时钟上升沿更新
// 阅读重点：作为A相较新的状态
// ------------------------------------------------------------------
always@(posedge clk_100 or negedge nReset)
begin
	if(!nReset)
	  coda_dl1<=1'b0;
	else
	  coda_dl1<=f_coda;
end
//======================================================================
// ------------------------------------------------------------------
// 进程作用：保存A相前一拍状态
// 更新方式：时钟上升沿更新
// 阅读重点：与较新采样比较以识别A相边沿
// ------------------------------------------------------------------
always@(posedge clk_100 or negedge nReset)
begin
	if(!nReset)
	  coda_dl2<=1'b0;
	else
	  coda_dl2<=coda_dl1;//f_coda两级同步  【动作】A相第二级保存旧的第一级，形成一拍历史差；不是同拍直接等于新的f_coda
end
//======================================================================
// ------------------------------------------------------------------
// 进程作用：保存滤波后B相的当前采样
// 更新方式：时钟上升沿更新
// 阅读重点：作为B相较新的状态
// ------------------------------------------------------------------
always@(posedge clk_100 or negedge nReset)
begin
	if(!nReset)
	  codb_dl1<=1'b0;
	else
	  codb_dl1<=f_codb;
end
//======================================================================
// ------------------------------------------------------------------
// 进程作用：保存B相前一拍状态
// 更新方式：时钟上升沿更新
// 阅读重点：与较新采样比较以识别B相边沿
// ------------------------------------------------------------------
always@(posedge clk_100 or negedge nReset)
begin
	if(!nReset)
	  codb_dl2<=1'b0;
	else
	  codb_dl2<=codb_dl1;//f_codb两级同步  【动作】B相第二级保存旧的第一级
end
//======================================================================
// ------------------------------------------------------------------
// 进程作用：根据A/B相状态变化增减内部计数
// 更新方式：时钟上升沿更新
// 阅读重点：每个合法边沿计1，一个完整周期通常含4个边沿
// ------------------------------------------------------------------
always@(posedge clk_100 or negedge nReset)
begin
	if(!nReset)
	  pulse_counter<=18'd0;                                            // 【复位】低有效异步复位时将18位内部累计计数清零
	else if(count_clr)                                                 // 【复位】非复位时若count_clr为真，同步清零优先于增减；保持该信号高会不断清零
	  pulse_counter<=16'd0;                                            // 【复位】16位零会扩展为18位全零，建议写18位零
	else if((coda_dl1 && !coda_dl2 && !codb_dl1 && !codb_dl2)||        // 【动作】正向边沿：00→10（A上升）
	        (!coda_dl1 && coda_dl2 && codb_dl1 && codb_dl2)||          // 【动作】正向边沿：11→01（A下降）
	        (coda_dl1 && coda_dl2 && codb_dl1 && !codb_dl2)||          // 【动作】正向边沿：10→11（B上升）
	        (!coda_dl1 && !coda_dl2 && !codb_dl1 && codb_dl2))         // 【动作】正向边沿：01→00（B下降）
	  pulse_counter<=pulse_counter+1'b1;                               // 【时序】内部18位计数加1
	else if((!coda_dl1 && !coda_dl2 && codb_dl1 && !codb_dl2)||        // 【动作】反向边沿：00→01（B上升）
	        (coda_dl1 && coda_dl2 && !codb_dl1 && codb_dl2)||          // 【动作】反向边沿：11→10（B下降）
	        (coda_dl1 && !coda_dl2 && codb_dl1 && codb_dl2)||          // 【动作】反向边沿：01→11（A上升）
	        (!coda_dl1 && coda_dl2 && !codb_dl1 && !codb_dl2))         // 【动作】反向边沿：10→00（A下降）
	  pulse_counter<=pulse_counter-1'b1;                               // 【时序】内部18位计数减1，一个反向完整周期减4
end
//======================================================================
// ------------------------------------------------------------------
// 进程作用：把18位内部计数转换为16位输出
// 更新方式：时钟上升沿更新
// 阅读重点：直接取[17:2]等于除4取整，不验证完整周期
// ------------------------------------------------------------------
always@(posedge clk_100 or negedge nReset)
begin
	if(!nReset)
    out_counter<=16'd0;                                             // 【动作】对外提供的16位旋转计数 ← 16'd0
  else
    out_counter<=pulse_counter[17:2];                               // 【风险】取[17:2]等于除4取整，不验证完整AB周期
end
//======================================================================
endmodule
```



修改

没问题！既然你对 STM32（C语言）非常熟悉，但对 FPGA（VHDL语言）不太懂，我就用**“C语言程序员的视角”**，配合最通俗的比喻，为你把这次 FPGA 的修改做一个彻头彻尾的“保姆级”复盘。
这次修改的核心目标只有一个：**让 FPGA 充当一个“智能翻译官”，把底层硬件那些反人类的物理信号（低电平有效、接反的线序），在送给 STM32 之前，全部洗成最干净、最符合人类直觉的数据。**
我们一共在 FPGA 里做了两件事，分别修改了两个文件：
\### 第一件事：把所有按键改成“高电平有效”（按下为 1，松开为 0）
**修改文件：** KL_DATA_TOP.vhd（这是负责底层矩阵扫描的模块）
在硬件电路上，因为有上拉电阻，按键**没按时是 5V（逻辑 1）**，**按下时接地变 0V（逻辑 0）**。
我们需要 FPGA 在读取时把 0 和 1 颠倒过来。这就涉及两步：
\#### 1. 修改“默认初始值”（把 1 变成 0）
 \* **原理：** 在单片机里，我们习惯用 memset(key, 0, sizeof(key)) 把变量清零。在 FPGA 里，当系统刚上电或复位时，寄存器也需要一个默认值。
 \* **修改动作：** 既然我们希望“没按键=0”，我们就必须把复位时的初始状态从全 1 改成全 0。
 \* **VHDL代码翻译：**
  \* (others => '1') 就相当于 C 语言里的全填 0xFF。
  \* 我们把它改成了 (others => '0')，相当于全填 0x00。
\#### 2. 修改“扫描读取逻辑”（加上 not 取反）
 \* **原理：** 当 FPGA 的引脚真正去读物理按键时，我们需要在它存入寄存器的那一瞬间做一个取反。
 \* **修改动作：** 在 when Key_Scan => 这个扫描大循环里，加入了 not 关键字。
 \* **VHDL代码翻译：**
  \* 原代码：Key_Value_Reg(i) <= KS_Key_Value;（相当于 C 语言的 reg[i] = pin_val;，原样照搬）。
  \* 新代码：Key_Value_Reg(i) <= not KS_Key_Value;（相当于 C 语言的 reg[i] = ~pin_val;，按位取反）。
**第一步的结果：**
经过这步，所有按键都被成功翻转了。但是！这也导致了一个“误伤”：**波段开关的数据也被全局翻转了**，导致原本正常的编码全乱了。于是就有了第二步。
\### 第二件事：用“异或掩码”把波段开关救回来
**修改文件：** KT22TAFMB.vhd（这是最顶层模块，负责把数据挂载到 FSMC 总线给 STM32 读）
在 C 语言中，你非常聪明地使用了 temp3 ^ 0x03FF 来把波段开关的位再次翻转（负负得正）。我们现在把这行 C 代码，直接做成 FPGA 里的**硬件逻辑门**。
 \* **原理：** FPGA 是并行执行的硬件。当 STM32 通过 FSMC 发起读取 0x06 寄存器的请求时，FPGA 可以在吐出数据的最后一纳秒，让数据穿过一排 **“异或门（XOR）”**。
 \* **修改动作：** 我们在给总线数组 BUS_Din_Reg 赋值的时候，直接针对包含波段开关的 0x06 和 0x08 寄存器加上了 xor 操作。
 \* **VHDL代码翻译：**
  \* 原代码：BUS_Din_Reg(3) <= Key_Value(5) & Key_Value(4);（直接把底层的两个 8 位数据拼接成 16 位，原样送给 0x06 寄存器）。
  \* 新代码：BUS_Din_Reg(3) <= (Key_Value(5) & Key_Value(4)) xor x"03FF";
   \* & 相当于 C 语言里把两个 uint8_t 拼成 uint16_t（比如 (val5 << 8) | val4）。
   \* xor 就是 C 语言里的 ^。
   \* x"03FF" 就是十六进制常量 0x03FF。
\### 总结：数据在 FPGA 里的“奇妙漂流”
为了让你彻底懂，我们模拟一个波段开关和一个普通按键被同时读取的流程：
假设物理状态是：**普通按键被按下（物理电平 0）**，**波段开关停在 0档（物理电平 0000）**。

1. **第一关（底层引脚读取 KL_DATA_TOP.vhd）：**

  FPGA 探针读到引脚是 0 和 0000。
  经过 not 取反，存进底层寄存器变成了：按键=1，波段开关=1111。

2. **第二关（顶层总线吐出 KT22TAFMB.vhd）：**

  STM32 发起读取。数据从底层往上送。
  对于普通按键，FPGA 原样放行，STM32 读到 1（完美！1代表按下）。
  对于波段开关，FPGA 让它穿过 xor 异或掩码。1111 与 1111 异或，变成了 0000。STM32 读到 0000（完美！恢复了 0档 的编码）。
**为什么工业界都推崇这种做法？**
如果这些操作放在 STM32 里，你的 CPU 每次读取都要做位移、与、异或等几十条汇编指令。而放在 FPGA 里，这只是硅片上几根连在一起的导线和逻辑门，**耗时为绝对的 0 纳秒，完全不占用 CPU 资源！** 你的 STM32 代码因此变得极其干净清爽。



## 仿真

> 仿真截图待补充。

- 生成包含 ChipWatcher 功能的 `.bit` 文件并重新下载的步骤如下：

  1. **创建 ChipWatcher 配置**：
     - 在工具菜单中选择 **Tools → Debug Tools → ChipWatcher**，进入 ChipWatcher 页面
     - 如果之前没有创建过 ChipWatcher 配置，点击 **Create** 按钮，然后点击 **OK**
     - 选择采样时钟，一般选择频率最高的全局时钟信号
     - 设置采样深度和触发位置，采样深度越深，占用的芯片资源越多
     - 在空白处右键点击，选择 **Add Nodes**，选择需要观察的信号添加到右侧列表
     - 设置触发条件和触发信号之间的关系
  2. **保存 ChipWatcher 配置文件**：
     - 点击 **File → Save** 或使用快捷键 **Ctrl+S**，将 ChipWatcher 配置保存为 `.cwc` 文件
     - 根据提示，将配置文件添加到当前工程中
  3. **重新编译并生成 `.bit` 文件**：
     - 在项目管理界面，选择 **Optimize Gate** 进行逻辑综合，然后选择 **Generate Bitstream**，开始生成包含 ChipWatcher 功能的 `.bit` 文件
     - 确保生成过程中没有错误。
  4. **下载 `.bit` 文件到 FPGA**：
     - 双击打开 `.bit` 文件
     - 使用下载器（如安路 8 合 1 下载器），将 `.bit` 文件下载到 FPGA 中
  5. **使用 ChipWatcher 进行调试**：
     - 下载完成后，ChipWatcher 左上角的触发按钮会变亮，并给出提示
     - 点击触发按钮，ChipWatcher 将开始监控指定的信号，一旦满足预设的触发条件，便会返回芯片中的数据

   一张图（安路 TD 流程按钮位置）

  ```plain
  工具栏顺序（从左到右）：
  ① Optimize Gate  → ② Optimize Placement → ③ Optimize Routing
       ↑综合           ↑布局                   ↑布线
  ④ Generate Bitstream   ← 你漏点的按钮！
       ↑生成 bit
  ```

  **只有 ④ 做完才会在 `impl/phy_1/` 目录下出现 `KT22TAFMB.bit`**

  ------

  2 三步操作（照点即可）

  表格

  | 步骤 | 按钮 / 菜单                           | 成功标志                                                  |
  | :--- | :------------------------------------ | :-------------------------------------------------------- |
  | ①    | 菜单 **Process → Optimize Gate**      | Log 窗口出现 **“OPT gate finished”**                      |
  | ②    | 菜单 **Process → Optimize Placement** | **“OPT placement finished”**                              |
  | ③    | 菜单 **Process → Optimize Routing**   | **“OPT routing finished”**                                |
  | ④    | 菜单 **Process → Generate Bitstream** | **“Bitstream generation successful”** 且目录里出现 `.bit` |

  ------

  3 快速验证 bit 是否生成 打开工程目录：

  ```plain
  your_project/impl/phy_1/KT22TAFMB.bit
  ```

  文件存在 → 成功；不存在 → 继续点第 ④ 步。

  ------

  4 常见漏点提醒

  - **只点了 “Run” 或 “Compile”** = 只做综合，不会自动生成 bit。
  - **任何一步报 red 错误** → bit 生成会被跳过，先清错误再重新跑④。
  - **Clean 后必须重新跑①→④**，因为中间文件被删光。

  ------

  5 一键懒人法（推荐） 菜单 **Process → Run All**（或工具栏 ▶▶ 图标）
  = 自动按顺序跑完①②③④，去泡杯咖啡回来就能看见 `.bit`。

  ### 错误原因

  1. **未完成 FPGA 开发流程**：
     - 在生成 `.bit` 文件的过程中，某些步骤未成功完成（如逻辑综合、布局布线、时序优化等），导致工具认为当前流程未结束。
     - 这种情况下，即使生成了 `.bit` 文件，工具也无法确认其是否与当前设计一致。
  2. **未正确下载 `.bit` 文件**：
     - `.bit` 文件生成后未正确下载到 FPGA 中，可能是下载过程中断或下载器配置错误导致。

  ### 解决方法

  #### 步骤 1：检查并完成 FPGA 开发流程

  1. **回到项目管理界面**：
     - 在菜单中选择 **Project → Project Settings** 或 **Flow → Main Flow**，确认所有步骤（如逻辑综合、布局布线、生成位流文件）是否都标记为完成。
     - 如果某些步骤未完成，重新运行这些步骤。例如：
       - 点击 **Optimize Gate** 进行逻辑综合。
       - 点击 **Optimize Placement** 和 **Optimize Routing** 进行布局布线。
       - 点击 **Generate Bitstream** 生成 `.bit` 文件。
  2. **清理并重新生成**：
     - 如果仍有问题，点击 **Clean Project** 清除中间文件，然后重新编译整个项目：
       - 在菜单中选择 **Project → Clean Project**。
       - 重新运行所有步骤，确保没有错误。

  #### 步骤 2：重新下载 `.bit` 文件

  1. **确认 `.bit` 文件路径**：
     - 在错误提示框中，注意 `.bit` 文件的路径（如 `s/phy_1/KT22TAFMB.bit`）。确保路径正确且文件存在。
  2. **使用下载器重新下载**：
     - 打开下载器工具（如安路 8 合 1 下载器）。
     - 选择正确的 `.bit` 文件路径，并确保 JTAG 连接正常。
     - 点击 **Download** 按钮重新下载。

  #### 步骤 3：验证下载是否成功

  1. **检查下载状态**：
     - 下载完成后，查看开发工具的状态栏或日志窗口，确认是否显示“Download Successful”或类似的成功提示。
     - 如果下载失败，检查 JTAG 连接是否松动或开发板供电是否正常。
  2. **验证设计功能**：
     - 下载成功后，观察 FPGA 的实际运行状态，确认设计是否按预期工作。

  
