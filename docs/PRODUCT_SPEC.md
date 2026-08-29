# 「能打职业吗你」手机网页小游戏需求文档

## 1. 项目简介

### 1.1 项目名称

**能打职业吗你**

### 1.2 产品定位

一个面向手机端的轻量级网页小游戏，通过多个只需要「点击屏幕」即可完成的测试关卡，对用户的电竞基础能力进行娱乐化评估。

核心测试维度包括：

- 反应速度
- 判断能力
- 时机把控
- 视觉注意力
- 运动预判
- 稳定性
- 抗压能力

最终根据所有关卡表现生成一个「职业指数」和能力评分，并给出具有传播性的结果文案。

> 注意：本产品属于娱乐测试，不代表真实职业电竞选拔结果。

---

# 2. 核心产品原则

## 2.1 操作限制

整个游戏针对手机浏览器设计。

用户只能使用：

**单指点击屏幕**

不使用：

- 滑动
- 拖拽
- 长按
- 多指操作
- 键盘
- 鼠标
- 陀螺仪
- 摄像头
- 麦克风

所有关卡必须保证单手即可完成。

---

## 2.2 游戏时长

目标完整体验时长：

**2～3 分钟**

建议：

- 8 个关卡
- 每关约 10～20 秒
- 关卡之间结果展示约 2～3 秒

用户第一次体验时不应感觉流程过长。

---

## 2.3 核心体验

整体体验应该符合：

> 开始简单 → 逐渐变难 → 最后一关制造压力 → 输出职业能力报告

游戏不能只是 8 个「看到东西点击」的换皮版本。

不同关卡必须分别体现：

- 纯反应
- 判断
- 时机
- 预判
- 注意力
- 抗压

---



# 3. 整体流程

```text
首页
 ↓
开始测试
 ↓
简单说明
 ↓
关卡 1
 ↓
单关结果
 ↓
关卡 2
 ↓
...
 ↓
关卡 8
 ↓
数据计算
 ↓
职业能力报告
 ↓
分享 / 再测一次
```

---



# 4. 首页



## 4.1 页面内容

主标题：

# 能打职业吗你？

副标题：

> 用 2 分钟测测你的电竞天赋。

主按钮：

**开始测试**

辅助说明：

> 共 8 项测试<br>
> 建议使用惯用手完成

底部小字：

> 娱乐测试，不代表真实职业选拔结果。

---



# 5. 游戏通用规则



## 5.1 开始机制

每个关卡开始之前显示：

```text
第 X / 8 项

测试名称

简单玩法说明

点击开始
```

用户点击后进入准备阶段。

准备阶段建议随机等待：

```text
800ms ～ 2000ms
```

防止用户形成固定节奏。

---



## 5.2 点击事件

统一优先监听：

```js
pointerdown
```

而不是：

```js
click
```

原因：

`click` 在不同移动浏览器上可能存在额外延迟。

所有反应时间统计统一使用：

```js
performance.now()
```

不要使用：

```js
Date.now()
```

---



## 5.3 防误触

以下情况需要识别：

- 提前点击
- 连续点击
- 当前关卡已经结束后的点击
- 页面切换中的点击

禁止一次点击触发多个游戏状态。

---



# 6. 关卡设计

---



# 关卡 1：神经反射



## 测试目标

测量用户最基础的视觉反应速度。

## 玩法

初始屏幕显示：

> 等待绿色……

等待随机时间：

```text
1500ms ～ 4000ms
```

随后整个屏幕变绿。

用户需要尽快点击屏幕任意位置。

---



## 提前点击

如果屏幕变绿之前点击：

显示：

> 抢跑了！

本轮作废。

延迟约 800ms 后重新开始。

---



## 测试次数

有效测试：

**5 次**

剔除：

- 最快一次
- 最慢一次

取中间 3 次平均值。

---



## 结果

例如：

```text
平均反应

183 ms

最快：169 ms
```

记录：

```ts
reactionAverage
reactionBest
```

---



# 关卡 2：接棍挑战



## 测试目标

测试视觉运动判断和瞬间反应。

## 玩法

屏幕中央有一个固定接取区域。

一根细长棍子从屏幕顶部向下掉落。

用户需要在棍子进入接取区域的时候点击屏幕。

点击后立即停止动画。

计算棍子当前位置和最佳接取位置之间的距离。

---



## 评分

根据误差划分：

```text
PERFECT
GREAT
GOOD
MISS
```

建议：

```text
PERFECT：误差 ≤ 5%
GREAT：误差 ≤ 10%
GOOD：误差 ≤ 20%
MISS：误差 > 20%
```

---



## 测试次数

5 次。

每次：

- 下落速度略微随机
- 开始时间随机

防止形成固定节奏。

---



## 记录

```ts
catchAverageAccuracy
catchPerfectCount
```

---



# 关卡 3：别急着点



## 测试目标

测试：

- 反应能力
- 信息判断
- 抑制控制

不是看到变化就点击，而是判断之后再点击。

---



## 玩法

屏幕中央不断出现不同状态。

规则：

```text
绿色 → 点击
红色 → 不要点击
```

每个状态持续：

```text
400 ～ 1000ms
```

随机出现。

---



## 示例

```text
红
红
绿
红
绿
绿
红
```

---



## 总轮数

20 次。

其中约：

```text
绿色 50%
红色 50%
```

顺序完全随机。

不能使用明显固定交替规律。

---



## 评分指标

记录：

### 绿色反应时间

```ts
decisionReactionAverage
```



### 红色误触数量

```ts
decisionFalseTap
```



### 正确率

```ts
decisionAccuracy
```

---



# 关卡 4：极限闪现



## 测试目标

测试视觉变化识别能力。

---



## 玩法

屏幕保持相对静止。

等待随机时间后，在随机位置短暂出现一个明显目标。

例如：

```text
●
```

用户看到目标以后，需要立即点击屏幕任意位置。

不要求点击目标本身。

---



## 难度递增

目标显示时间逐渐缩短。

例如：

```text
500ms
350ms
250ms
180ms
120ms
90ms
```

如果用户没有及时点击：

记为 MISS。

---



## 防止提前点击

目标出现前点击：

记为：

```text
提前反应
```

当前轮失败。

---



## 测试次数

6～8 次。

---



## 记录

```ts
visualReactionAverage
visualShortestDetectedDuration
visualMissCount
```

---



# 关卡 5：完美格挡



## 测试目标

测试 Timing，即用户对精确时间窗口的把控。

---



## 玩法

屏幕中央存在一个固定目标点。

一个物体从外部逐渐接近目标点。

用户需要在物体与目标点重合的一瞬间点击。

---



## 动画

推荐：

```text
● --------> ◎
```

或者：

```text
      ↓
      ●

      ◎
```

必须保证：

- 动画流畅
- 使用 requestAnimationFrame
- 不依赖 CSS animation 的 animationend 计算结果

---



## 点击结果

根据点击发生时间相对于理论最佳时间点的偏差：

```text
PERFECT ±30ms
GREAT   ±60ms
GOOD    ±120ms
MISS    >120ms
```

---



## 测试次数

5 次。

每次：

- 移动速度随机
- 起始距离可以略微不同

---



## 记录

```ts
timingAverageError
timingPerfectCount
```

---



# 关卡 6：预判射击



## 测试目标

测试运动预测能力。

这关不允许用户依赖「看到目标到达」之后再反应。

---



## 玩法

一个目标以固定速度移动：

```text
● ---------->
```

运动一段距离以后进入遮挡区域：

```text
● ------> █████████ → 终点
```

进入遮挡区域之后目标不可见。

用户需要预测：

> 目标什么时候会到达终点。

认为到达终点的时候点击屏幕。

---



## 结果计算

已知：

```text
目标速度
遮挡距离
理论到达时间
用户点击时间
```

计算：

```ts
predictionError =
  userTapTime - expectedArrivalTime
```

结果示例：

```text
提前 23ms
```

或：

```text
晚了 41ms
```

---



## 测试次数

5 次。

需要随机改变：

- 目标速度
- 遮挡区域距离

否则用户会靠背节奏完成。

---



## 记录

```ts
predictionAverageError
predictionBestError
```

---



# 关卡 7：多目标警戒



## 测试目标

测试：

- 注意力分配
- 周边视觉
- 视觉变化识别

---



## 玩法

屏幕同时出现多个相似目标。

第一阶段：

```text
○    ○

○    ○
```

随机等待后，其中一个突然发生变化：

```text
○    ●

○    ○
```

用户发现变化后，点击屏幕任意位置。

---



## 难度递增

第一轮：

```text
4 个目标
```

之后：

```text
6 个
9 个
12 个
```

目标数量越多，视觉搜索难度越高。

---



## 注意

不要求点击变化目标。

只需要：

> 发现变化 → 点击屏幕

避免把这一关变成测试点击精准度。

---



## 测试次数

6 次。

---



## 记录

```ts
attentionReactionAverage
attentionMissCount
```

---



# 关卡 8：残血反杀



## 测试目标

作为最终综合关卡。

主要测试：

- 判断能力
- 反应
- 抗压
- 稳定性

---



## 玩法

屏幕中央显示：

```text
HP 100
```

HP 不断快速降低。

例如：

```text
100
93
81
68
54
39
28
17
13
11
7
```

规则：

> HP ≤ 10 时才能点击。

用户需要尽快在达到条件之后点击。

---



## 注意

HP 每次下降的数值必须随机。

不能简单：

```text
100
90
80
70
...
```

否则用户可以预判固定节奏。

---



## 失败情况

如果：

```text
HP > 10
```

就点击：

显示：

> 太急了。

记录提前点击。

如果 HP 到 0 还没有点击：

显示：

> 犹豫就会败北。

---



## 压力设计

这一关建议加入：

- 更快的数字变化
- 明显倒计时感
- 轻微震动

支持时可以调用：

```js
navigator.vibrate()
```

但必须做 feature detection。

不支持时正常运行。

---



## 测试次数

3～5 次。

---



## 记录

```ts
pressureReactionAverage
pressureFalseTap
pressureMissCount
```

---



# 7. 评分体系

最终不要直接平均所有原始数据。

所有指标需要先转换成：

```text
0 ～ 100
```

然后再计算能力维度。

---



# 8. 五大能力维度

最终展示：

## 反应

主要来源：

- 神经反射
- 极限闪现

---



## 判断

主要来源：

- 别急着点
- 残血反杀

---



## 时机

主要来源：

- 接棍挑战
- 完美格挡

---



## 预判

主要来源：

- 预判射击

---



## 专注

主要来源：

- 多目标警戒
- 极限闪现

---



# 9. 建议权重

```ts
reactionScore =
  reactionLevel * 0.65 +
  visualLevel * 0.35

decisionScore =
  decisionLevel * 0.65 +
  pressureLevel * 0.35

timingScore =
  catchLevel * 0.4 +
  timingLevel * 0.6

predictionScore =
  predictionLevel

attentionScore =
  attentionLevel * 0.7 +
  visualLevel * 0.3
```

---



# 10. 职业指数

综合计算：

```ts
careerScore =
  reactionScore * 0.25 +
  decisionScore * 0.20 +
  timingScore * 0.20 +
  predictionScore * 0.15 +
  attentionScore * 0.20
```

最终范围：

```text
0 ～ 100
```

四舍五入为整数。

---



# 11. 职业等级



## 0～39



### 建议当观众

文案：

> 职业选手也需要观众。

---



## 40～59



### 网吧战神

文案：

> 打朋友还是够用的。

---



## 60～74



### 排位高手

文案：

> 已经开始有点东西了。

---



## 75～84



### 青训候选人

文案：

> 教练开始看你的数据了。

---



## 85～94



### 半只脚进职业

文案：

> 反应已经不像普通玩家。

---



## 95～100



### 你是不是职业选手？

文案：

> 这个测试本来不是给你玩的。

---



# 12. 最终结果页面

结果页需要作为整个产品最重要的传播页面设计。

---



## 12.1 顶部

显示：

```text
职业指数

82
```

下面：

```text
青训候选人
```

---



## 12.2 五维能力

显示：

```text
反应      92
判断      81
时机      87
预判      73
专注      86
```

可以使用：

- 横向 Progress Bar

第一版不必做雷达图，优先保证手机端清晰。

---



## 12.3 关键数据

例如：

```text
最快反应        169ms
平均反应        183ms
Timing 误差     31ms
预判误差        42ms
误触次数        2
```

---



## 12.4 个性化评价

根据最低能力和最高能力生成一句话评价。

示例：

### 反应最高

> 手已经到了，脑子还在路上。

或者：

> 反应够职业，剩下交给队友。



### 判断最低

> 手速没有问题，主要问题是太喜欢交技能。



### 预判最低

> 看见了能反应，看不见就开始随缘。



### 专注最低

> 盯一个人可以，团战可能有点忙。



### 综合很高

> 教练，这个人建议查一下段位。

---



# 13. 分享能力

结果页面需要适合用户截图。

要求：

- 重要内容集中在一屏
- 页面不能太长
- 职业指数明显
- 五维能力明显
- 游戏名称明显

建议加入：

```text
能打职业吗你？
```

作为结果卡片固定品牌。

按钮：

```text
再测一次
```

后续可以增加：

```text
生成结果图
```

第一版可以暂不实现图片生成。

---



# 14. UI 风格

整体建议：

**电竞感 + 极简**

避免：

- 复杂游戏 UI
- 大量渐变
- 大量霓虹
- 赛博朋克元素堆叠

推荐：

```text
深色背景
大号数字
高对比文字
少量强调色
```

---



# 15. 手机适配

优先支持：

```text
375 × 667
390 × 844
393 × 852
430 × 932
```

同时最低支持：

```text
320px 宽度
```

---



# 16. 页面布局

游戏过程中尽量：

```text
顶部：当前关卡 / 进度

中部：游戏核心区域

底部：少量状态提示
```

禁止游戏核心目标过于靠近：

- 浏览器顶部
- Home Indicator
- 页面边缘

---



# 17. 浏览器行为

建议：

```css
touch-action: manipulation;
user-select: none;
-webkit-user-select: none;
-webkit-tap-highlight-color: transparent;
```

防止：

- 双击缩放
- 长按选中文字
- 点击高亮影响体验

---



# 18. 页面滚动

进入游戏后：

**禁止页面产生滚动。**

需要保证所有交互内容均在当前可视区域。

注意处理：

```text
100vh
```

在 Safari 地址栏变化时的问题。

推荐使用：

```text
100dvh
```

并设置兼容 fallback。

---



# 19. 游戏状态设计

推荐统一状态机：

```ts
type GameState =
  | "intro"
  | "ready"
  | "playing"
  | "result"
  | "finished"
```

每个关卡独立维护自己的子状态。

---



# 20. 数据结构

建议：

```ts
interface GameResult {
  reaction: {
    attempts: number[]
    average: number
    best: number
  }

  catch: {
    errors: number[]
    perfectCount: number
  }

  decision: {
    reactionTimes: number[]
    falseTaps: number
    accuracy: number
  }

  visual: {
    reactionTimes: number[]
    shortestDuration: number
    missCount: number
  }

  timing: {
    errors: number[]
    perfectCount: number
  }

  prediction: {
    errors: number[]
    averageError: number
  }

  attention: {
    reactionTimes: number[]
    missCount: number
  }

  pressure: {
    reactionTimes: number[]
    falseTaps: number
    missCount: number
  }
}
```

---



# 21. 最终评分数据结构

```ts
interface FinalScore {
  careerScore: number

  reaction: number
  decision: number
  timing: number
  prediction: number
  attention: number

  rank: string
  description: string
}
```

---



# 22. 技术要求

推荐技术栈：

```text
Next.js
TypeScript
Tailwind CSS
```

如果只是单页面小游戏，也可以直接：

```text
React + Vite
```

不需要后端即可完成 MVP。

---



# 23. 动画实现

涉及运动轨迹的关卡：

- 接棍
- 完美格挡
- 预判射击

必须使用：

```js
requestAnimationFrame()
```

基于真实时间计算位置：

```ts
elapsed = performance.now() - startTime
```

不要使用：

```ts
position += fixedSpeed
```

原因：

不同设备帧率可能是：

```text
60Hz
90Hz
120Hz
144Hz
```

如果按 Frame 移动，会导致不同设备游戏速度不同。

---



# 24. 反应时间公平性

浏览器小游戏无法严格实现医学或专业电竞设备级测试精度。

误差可能来自：

- 手机屏幕刷新率
- Touch Sampling Rate
- 浏览器事件延迟
- 系统性能
- JS 主线程负载

因此产品中不需要声称：

> 专业电竞测试结果

统一定位：

> 娱乐性电竞能力测试

---



# 25. 性能要求

游戏过程中：

- 禁止频繁 React 大范围重新渲染
- 高频动画尽量直接使用 requestAnimationFrame
- 不在 requestAnimationFrame 中 setState 60 次/秒
- 避免复杂 DOM
- 避免大型图片
- 避免重型动画库

目标：

```text
60 FPS+
```

高刷新率设备能够自然达到更高刷新率。

---



# 26. 音效

MVP 音效不是必须。

后续可以添加：

```text
开始提示
PERFECT
MISS
倒计时
最终成绩
```

用户首次点击之后才初始化 AudioContext，避免移动 Safari 自动播放限制。

---



# 27. 震动

可作为增强体验。

例如：

```js
if ("vibrate" in navigator) {
  navigator.vibrate(20)
}
```

应用场景：

- PERFECT
- MISS
- 最终关压力提示

禁止过度震动。

---



# 28. 数据存储

MVP：

仅本地状态即可。

刷新页面数据清空。

第二阶段可以增加：

```text
LocalStorage
```

用于：

- 历史最高分
- 最快反应
- 最佳职业指数

---



# 29. 后续版本能力

MVP 暂不实现，但代码结构应该方便后续增加：

### 排行榜

```text
今日排名
全站排名
```



### 好友 PK

分享：

```text
我职业指数 87，你能超过我吗？
```



### 每日挑战

每天所有人使用完全相同参数。

### 历史成绩

展示：

```text
第一次：72
第二次：79
第三次：84
```



### 分享结果卡

使用 Canvas / SVG 导出图片。

---



# 30. MVP 实现优先级



## P0

必须实现：

- 首页
- 8 个关卡
- 单关结果
- 最终评分
- 职业等级
- 手机适配
- 再测一次
- 基础动画
- 性能优化

---



## P1

第二阶段：

- 音效
- 震动
- LocalStorage
- 历史最高分
- 分享结果图

---



## P2

后续：

- 排行榜
- 好友 PK
- 用户账号
- 每日挑战
- 数据统计后台

---



# 31. 推荐项目结构

```text
src/
├── app/
│   └── page.tsx
│
├── components/
│   ├── game/
│   │   ├── GameContainer.tsx
│   │   ├── GameProgress.tsx
│   │   └── GameResult.tsx
│   │
│   ├── levels/
│   │   ├── ReactionLevel.tsx
│   │   ├── CatchLevel.tsx
│   │   ├── DecisionLevel.tsx
│   │   ├── VisualLevel.tsx
│   │   ├── TimingLevel.tsx
│   │   ├── PredictionLevel.tsx
│   │   ├── AttentionLevel.tsx
│   │   └── PressureLevel.tsx
│   │
│   └── result/
│       ├── FinalResult.tsx
│       └── ScoreBar.tsx
│
├── hooks/
│   ├── useGameTimer.ts
│   └── useAnimationFrame.ts
│
├── lib/
│   ├── score.ts
│   ├── random.ts
│   └── timing.ts
│
├── types/
│   └── game.ts
│
└── constants/
    └── game.ts
```

---



# 32. 关键开发要求

Codex 实现时需要特别遵守：

1. 所有关卡均只使用单击完成。
2. 所有计时使用 `performance.now()`。
3. 所有移动物体基于真实 elapsed time，而不是帧数。
4. 运动动画使用 `requestAnimationFrame()`。
5. 移动端优先监听 `pointerdown`。
6. 防止同一次点击重复处理。
7. 所有随机等待时间不能采用固定节奏。
8. 手机页面游戏过程中不能滚动。
9. 不因为 React re-render 导致动画掉帧。
10. 关卡配置和游戏逻辑尽量解耦。
11. 所有关卡结束后必须清理 timeout、interval 和 animationFrame。
12. 用户切换页面或组件卸载时必须正确清理监听。
13. 所有评分函数集中放到 `score.ts`，禁止散落在 UI 组件中。
14. 第一版不需要后端。
15. 第一版优先保证玩法流畅，不需要复杂视觉效果。

---



# 33. 验收标准

MVP 完成时应该满足：

- 手机打开即可直接游戏
- 不需要登录
- 8 个关卡全部可以正常完成
- 所有关卡只需要点击屏幕
- 单次完整测试控制在 2～3 分钟
- 不同关卡玩法有明显区别
- 结果可以正确计算
- 最终输出 0～100 职业指数
- 最终显示 5 个能力维度
- 结果页适合手机截图
- iPhone Safari 正常运行
- Android Chrome 正常运行
- 连续测试多次不会出现 timer 残留
- 游戏动画没有明显卡顿
- 不同刷新率设备游戏速度基本一致

---



# 34. 核心产品文案

首页：

> **能打职业吗你？**

> 用 2 分钟测测你的电竞天赋。

开始：

> **开始测试**

关卡结束：

> **下一项**

全部结束：

> **测试完成**

最终：

> **你的职业指数**

再玩：

> **再测一次**

免责声明：

> 娱乐测试，不代表真实职业选拔结果。
