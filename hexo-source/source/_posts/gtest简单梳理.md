---
title: GoogleTest（gtest）入门与 VCore 实战
date: "2026-10-22 00:02:00"
permalink: /2026/10/22/gtest简单梳理/
tags:
  - GoogleTest
  - 单元测试
  - C++
  - CMake
categories:
  - 技术笔记
cover: /image/covers/gtest-basics.jpg
description: 从第一条 TEST 到 TEST_F 测试夹具，梳理 EXPECT 与 ASSERT、字符串和浮点断言、测试筛选，并以 VCore 复位清零 G50 偏移为例练习准备、执行与检查。
---

# GoogleTest（gtest）入门与 VCore 实战

本文按“认识工具 → 写第一条测试 → 选择断言 → 复用测试环境 → 编译运行 → 项目实战”的顺序介绍 gtest。初学时先阅读第 1—5 节，再把这些方法应用到第 6 节的 VCore 示例中。

<!-- more -->

## 阅读导航

| 想弄清的问题 | 对应章节 |
| --- | --- |
| 一条测试如何组织准备、执行和检查 | [1：认识 gtest](#introduction)、[2：第一条测试](#first-test) |
| EXPECT、ASSERT、字符串与浮点断言怎么选 | [3：断言选择](#assertions) |
| 如何用 TEST_F 和 SetUp 复用测试环境 | [4：测试夹具](#fixtures) |
| 怎样编译、运行和筛选测试 | [5：编译与运行](#build-run) |
| 如何验证 VCore 复位时清零 G50 偏移 | [6：VCore 实战](#vcore-reset) |
| 下一步如何练习与查阅文档 | [7：入门练习](#exercises)、[8：参考资料](#references) |

<a id="introduction"></a>

## 1. 认识 gtest：一条测试做什么

GoogleTest（常简称为 gtest）是 C++ 测试框架，用来组织测试、检查代码行为，并报告通过或失败。

写一条测试，主要做三件事：

1. **准备（Arrange）**：设置输入、对象和初始状态。
2. **执行（Act）**：调用被测函数或触发被测行为。
3. **检查（Assert）**：比较实际结果与预期结果。

这三个步骤常简称为 AAA。写测试前，先回答：**初始条件是什么？调用什么？应该得到什么结果？**

<a id="first-test"></a>

## 2. 第一条测试：使用 TEST

下面用一个简单的加法函数演示完整的测试结构：

```cpp
#include <gtest/gtest.h>

// 被测业务代码。实际项目中通常在业务源文件中实现。
int Add(int a, int b)
{
    return a + b;
}

TEST(AddTest, HandlesPositiveNumbers)
{
    // 1. Arrange（准备）：设置输入。
    int a = 2;
    int b = 3;

    // 2. Act（执行）：调用被测函数。
    int result = Add(a, b);

    // 3. Assert（检查）：验证输出。
    EXPECT_EQ(5, result);
}
```

- `AddTest`：测试套件名，把相关测试放在一起。
- `HandlesPositiveNumbers`：这条测试的名字，说明所验证的场景。
- `EXPECT_EQ(5, result)`：检查 `result` 是否等于 `5`。

gtest 会自动注册 `TEST` 定义的测试，运行时报告通过或失败。这条测试的完整名称是 `AddTest.HandlesPositiveNumbers`。

如果想先把这条测试跑起来，可以先阅读第 5 节的编译与运行说明，再回来学习断言和测试夹具。

<a id="assertions"></a>

## 3. 检查结果：断言怎么选

“断言”就是把预期结果写成可执行的检查。

### 3.1 常用断言

| 检查对象或条件 | 写法示例 |
|---|---|
| 整数、枚举、HAL 整数参数相等 | `EXPECT_EQ(0, param_value);` |
| 两个值不相等 | `EXPECT_NE(0, result);` |
| 布尔值 | `EXPECT_TRUE(valid);` / `EXPECT_FALSE(valid);` |
| C 字符串内容相同 | `EXPECT_STREQ("hello", text);` |
| 两个 `std::string` 内容相同 | `EXPECT_EQ(expected_text, actual_text);` |
| 直接赋值或清零后的 `double` | `EXPECT_DOUBLE_EQ(0.0, offset);` |
| 明确绝对误差范围的浮点结果 | `EXPECT_NEAR(expected, actual, 1e-6);` |
| 解引用前检查指针非空 | `ASSERT_NE(nullptr, ptr);` |

比较相等时，通常按“期望值、实际值”的顺序写。这是便于阅读的约定，不是参数的语法限制。

### 3.2 EXPECT 与 ASSERT 的区别

大多数断言都有 `EXPECT_*` 和 `ASSERT_*` 两种形式：

| 形式 | 检查失败时的行为 | 适合的情况 |
|---|---|---|
| `EXPECT_*` | 记录失败，继续执行当前函数 | 希望一次看到多个检查结果 |
| `ASSERT_*` | 记录失败，立即退出当前函数 | 后面的代码依赖这个检查成功 |

两者都会让测试失败。`ASSERT_*` 不会结束整个测试程序；如果写在辅助函数中，退出的也只是该辅助函数。

例如，假设 `ptr` 是被测代码返回的指针，需要先确认它非空，再解引用：

```cpp
ASSERT_NE(nullptr, ptr);
EXPECT_EQ(42, *ptr);
```

这里如果使用 `EXPECT_NE`，检查失败后仍会执行 `*ptr`，可能因空指针解引用而崩溃。

### 3.3 字符串与浮点数的注意点

- 比较 C 字符串内容时使用 `EXPECT_STREQ`。对两个 `const char*` 使用 `EXPECT_EQ`，比较的是指针地址。
- 比较两个 `std::string` 的内容，可以使用 `EXPECT_EQ`。
- `EXPECT_DOUBLE_EQ` 是浮点近似比较，不是严格的逐位相等检查。
- `EXPECT_NEAR` 的第三个参数是允许的绝对误差，应按实际单位和精度要求选择。

### 3.4 循环中的场景标记

`SCOPED_TRACE(retain);` 用来给当前作用域中的测试失败信息补充上下文。例如，在循环里检查多个保留策略时，可以记录当前的 `retain` 值，便于定位失败场景。它本身不检查结果，不属于断言。

<a id="fixtures"></a>

## 4. 测试夹具：使用 TEST_F 复用准备工作

当多条测试需要相同的初始化数据或对象时，可以定义“测试夹具”。下面用简化的复位偏移逻辑演示，便于对应第 6 节的 VCore 场景。

### 4.1 定义夹具并编写测试

```cpp
#include <gtest/gtest.h>

struct ResetData
{
    bool retain = false;  // 是否保留偏移
    double offset = 0.0;
};

// 教学示例中的被测业务代码。
void Reset(ResetData& data)
{
    if (!data.retain) {
        data.offset = 0.0;
    }
}

// 测试夹具：集中准备每条测试需要的数据。
class ResetTest : public ::testing::Test
{
protected:
    ResetData data;

    void SetUp() override
    {
        data.retain = false;
        data.offset = 10.0;
    }
};

// 场景一：不保留时，应该清零。
TEST_F(ResetTest, ClearsOffsetWhenRetentionDisabled)
{
    Reset(data);

    EXPECT_DOUBLE_EQ(0.0, data.offset);
}

// 场景二：保留时，应该保持原值。
TEST_F(ResetTest, KeepsOffsetWhenRetentionEnabled)
{
    data.retain = true;

    Reset(data);

    EXPECT_DOUBLE_EQ(10.0, data.offset);
}
```

### 4.2 TEST 与 TEST_F 怎么选

- 不需要自定义夹具时，使用 `TEST(测试套件名, 测试名)`。
- 需要访问夹具中的成员或辅助方法时，使用 `TEST_F(夹具类名, 测试名)`；第一个参数必须是已经定义的夹具类。

### 4.3 每条测试的生命周期

每条 `TEST_F` 都会创建新的夹具对象，正常执行顺序为：

**创建夹具对象 → SetUp() → 测试内容 → TearDown() → 销毁夹具对象。**

因此，上面第二条测试开始前，`offset` 仍会由 `SetUp()` 设置成 `10.0`。不需要清理资源时，可以不重写 `TearDown()`。

注意：

- `SetUp()` 在每条测试前执行，注意大小写，写成 `Setup()` 不会覆盖正确的方法；使用 `override` 可以帮助编译器发现这类错误。
- 每条测试有新的夹具对象，但全局变量、静态数据和外部资源仍可能共享，需要自行恢复，避免测试依赖执行顺序。

<a id="build-run"></a>

## 5. 编译与运行测试

### 5.1 测试程序入口

独立练习时，可以按 [GoogleTest 官方 CMake 入门教程](https://google.github.io/googletest/quickstart-cmake.html) 创建测试目标。链接 `GTest::gtest_main` 时，由它提供测试程序的 `main()`，前面的示例无需再手写入口函数。

如果项目已经接入 gtest，应使用项目已有的测试目标和构建方式。仅包含 `#include <gtest/gtest.h>` 还不够，构建时也需要正确链接 gtest。

### 5.2 常用运行命令

下面假设编译得到的测试程序名为 `my_tests.exe`，并在 Windows PowerShell 中运行。程序路径需要替换成实际值。

```powershell
# 列出所有测试
.\my_tests.exe --gtest_list_tests

# 运行全部测试
.\my_tests.exe

# 只运行加法测试套件
.\my_tests.exe --gtest_filter="AddTest.*"

# 只运行一条加法测试
.\my_tests.exe --gtest_filter="AddTest.HandlesPositiveNumbers"

# 只运行第 4 节的复位测试套件
.\my_tests.exe --gtest_filter="ResetTest.*"

# 只运行一条复位测试
.\my_tests.exe --gtest_filter="ResetTest.KeepsOffsetWhenRetentionEnabled"
```

`--gtest_filter` 按“测试套件名.测试名”筛选，支持 `*` 通配符。筛选的测试需要已经编译进该测试程序。

### 5.3 如何阅读结果

运行时，gtest 会显示测试名称及通过或失败状态。断言失败时，通常会给出源文件位置、被检查的表达式和值；可以据此比较期望与实际行为。

<a id="vcore-reset"></a>

## 6. VCore 实战：验证复位时清零 G50 偏移

本节把前面的通用方法应用到 VCore。示例依赖项目已有的数据结构、夹具和函数，需要在项目测试环境中编译运行。

### 6.1 区分 gtest 工具和项目代码

| 类别 | 示例 | 作用 |
|---|---|---|
| gtest 提供的测试工具 | `TEST`、`TEST_F`、`EXPECT_EQ`、`ASSERT_NE` | 定义测试、组织测试环境、检查结果 |
| VCore 项目中的代码 | `auto_array`、`reset_action()`、`dispatch()`、`mock_execute_per_perid()` | 提供项目数据、执行被测行为或辅助操作 |

`ResetActionTest` 是项目定义的测试夹具类，需要结合它的定义了解初始化方式。函数名中包含 `mock`，也不意味着它属于 gMock。

### 6.2 测试环境与 Auto 数据

`auto_array[0]` 表示第 0 通道的 Auto 数据。常见字段包括：

```cpp
auto_array[0].g50_retain_coord                  // G50 保留策略
auto_array[0].g50_coordinate_offset_param[0]    // 第一个 G50 偏移参数
auto_array[0].local_data.g50_coord_val[0]       // 本地保存的第一个 G50 偏移值
auto_array[0].cur_code_segment                 // 当前程序段
auto_array[0].req_reset                        // 复位请求
auto_array[0].reset_state                      // 当前复位状态
auto_array[0].emcmotStruct->status              // 对外状态结构
```

### 6.3 项目中的几个入口

| 入口 | 用途 |
|---|---|
| `reset_action(auto_array)` | 调用真实复位动作 |
| `mock_execute_per_perid()` | 执行一个周期 |
| `dispatch(EMCMOT_RESET)` | 发送 RESET 命令 |
| `run_post_code_segment_statement()` | 执行程序段后处理 |

程序段后处理的调用示例：

```cpp
run_post_code_segment_statement(auto_array, 1000000);
```

测试执行哪个入口，应根据想验证的行为和项目实现选择。

### 6.4 完整用例：不保留 G50 时，复位清零偏移

VCore 中通常使用 `TEST_F(夹具类名, 用例名)`。例如：

```cpp
TEST_F(ResetActionTest, G50Retain0ClearsOnReset)
{
    // 1. Arrange（准备）：不保留 G50，并设置非零初值。
    auto_array[0].g50_retain_coord = 0;
    auto_array[0].local_data.g50_coord_val[0] = 10.0;
    auto_array[0].g50_coordinate_offset_param[0] = 20;
    auto_array[0].req_reset = true;
    auto_array[0].reset_state = false;

    // 2. Act（执行）：调用真实复位动作。
    reset_action(auto_array);

    // 3. Assert（检查）：期望值在前，实际值在后。
    EXPECT_DOUBLE_EQ(0.0, auto_array[0].local_data.g50_coord_val[0]);
    EXPECT_EQ(0, auto_array[0].g50_coordinate_offset_param[0]);
}
```

- `ResetActionTest`：已有的夹具类，提供公共测试环境。
- `G50Retain0ClearsOnReset`：用例名，说明条件和预期结果。

这条测试可以按三个步骤理解：

1. **准备**：把保留策略设置为 `0`，给两个偏移字段设置非零初值，并准备复位请求与复位状态，构造“不保留 G50、有非零偏移、请求复位”的场景。
2. **执行**：调用 `reset_action(auto_array)`，触发真实复位动作。
3. **检查**：两个断言分别验证本地偏移值和偏移参数是否清零。

**先把偏移设置成非零值很关键**：如果一开始就是 `0.0`，即使被测代码没有执行清零，检查也可能通过。

如果还要测试“保留 G50 时保持原值”，可以另写一条测试：设置相应保留策略、设置非零初值、执行复位，再检查原值。具体策略取值和预期行为需要以项目要求与实现为准。

### 6.5 单独运行这个用例

假设项目测试程序名为 `my_tests.exe`，可以使用以下筛选条件；程序路径需要替换成实际值：

```powershell
.\my_tests.exe --gtest_filter="ResetActionTest.G50Retain0ClearsOnReset"
```

<a id="exercises"></a>

## 7. 入门练习

建议按下面的顺序练习：

1. 给第 2 节的 `Add()` 补上“两个负数相加”和“与零相加”两条测试。
2. 故意写错一次期望值，观察失败报告里的文件位置、期望值和实际值，然后改回正确值。
3. 运行第 4 节 `ResetTest` 的两条测试，观察 `SetUp()` 为每条测试准备初始数据。
4. 使用第 5 节的 `--gtest_filter` 单独运行其中一条测试。
5. 回到第 6 节的 VCore 示例，逐行标记“准备、执行、检查”，再尝试编写一个新的行为场景。

<a id="references"></a>

## 8. 参考资料

- [GoogleTest 官方入门：TEST、断言与测试夹具](https://google.github.io/googletest/primer.html)
- [GoogleTest 官方断言参考](https://google.github.io/googletest/reference/assertions.html)
- [GoogleTest 官方 CMake 入门教程](https://google.github.io/googletest/quickstart-cmake.html)
- [GoogleTest 进阶：筛选并运行部分测试](https://google.github.io/googletest/advanced.html#running-a-subset-of-the-tests)

## 延伸阅读

- [LinuxCNC 假期学习笔记：HAL、NML、CMake 与 EtherCAT](/2026/10/22/LinuxCNC假期学习笔记/)：结合 HAL 和 NML 示例，继续熟悉项目环境与构建方式。
- [CNC 解析器知识文档：词法、语法与模态状态](/2026/10/22/CNC解析器知识文档/)：从字段、模态与坐标边界寻找可以转化为测试的行为场景。
