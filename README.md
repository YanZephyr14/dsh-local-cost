# local-cost · 费用自配

自己的峰谷计价插件：输入框上方一行今日费用，点开看费用构成；价格和峰时段都由你自己填，不依赖 `dsh-cost-meter`。

## 安装

```sh
# 插件目录放到 dsh-go 的插件目录（引擎重置时保留），再装进手机本机引擎用的 web profile
cp -r local-cost "$DSH_HOME/dsh-go/plugins/local-cost"
dsh plugin --profile web add "$DSH_HOME/dsh-go/plugins/local-cost"
```

装完在 App 的「引擎」页**重启一次引擎**（宿主侧插件只在启动时加载）。装的是指向该目录的链接，所以目录不能删。

```sh
npm test        # 16 项单测
node "$DSH_HOME/skills/dsh-go-plugin/kit/bin/check.mjs" . --load   # 清单 / 视图 / 处理函数检查
```

## 目录

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 接线：状态条、两个面板、三个动作 |
| `lib/config.js` | `price.json` 读取、清洗、原子写入 |
| `lib/usage.js` | 扫会话日志取 token（按 mtime 缓存、截断容错） |
| `lib/pricing.js` | 峰谷判定、模型匹配、分项计价 |
| `lib/summary.js` | 今日 / 本会话 / 近 7 天聚合 |
| `lib/views.js` | 两个面板的 v2 视图 |
| `lib/editor.js` | 价格设置表单的数据与保存 |
| `price.example.json` | 配置示例；运行时用同目录下的 `price.json`（已 gitignore） |

## 在哪看

- **输入框上方状态条**：`今日 ¥0.28 · 峰时`，点一下打开「费用」面板。
- **对话详情页 → 插件 / 全部功能 → 费用**：今日、本会话、近 7 天金额；**费用构成**环图（未命中缓存输入 / 缓存命中输入 / 输出 各占几成、各多少钱）；峰时 vs 谷时；按模型（未定价的会标出来）。
- **价格设置**：同一入口，或在费用面板点「价格设置」。

### 价格设置怎么用（三段式，各存各的）

1. **峰谷时段**：峰时段写 `09:00-12:00,14:00-18:00`；周末三选一（谷时 / 峰时 / 按窗口）；节假日填日期列表，全天按谷时。改完点「保存时段」。
2. **模型单价**：每个模型一段，谷时和峰时各三个数（输入 / 缓存读 / 输出）。改完点「保存单价」。
3. **新增模型**：填 `provider:model` 或 `model` + 谷时三个价；峰时先与谷时相同，之后再改。

顶部会提示**今天还没定价的模型**，点「并入未定价」可以一次把它们加进配置（价格先抄 `default`，然后你填数）。

面板最多列 4 个模型（输入框上限），更多的在 `price.json` 里改，面板会提示还剩几个。

## 配置 `price.json`

文件在插件目录里：`$DSH_HOME/dsh-go/plugins/local-cost/price.json`，第一次运行自动生成。

```json
{
  "v": 1,
  "currency": { "code": "CNY", "symbol": "¥", "perTokens": 1000000, "decimals": 3 },
  "peak": {
    "enabled": true,
    "tz": "Asia/Shanghai",
    "windows": [{ "start": "09:00", "end": "12:00" }, { "start": "14:00", "end": "18:00" }],
    "weekend": "offPeak",
    "holidays": []
  },
  "models": {
    "custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017": {
      "offPeak": { "input": 1, "cacheRead": 0.1, "output": 4 },
      "peak": { "input": 2, "cacheRead": 0.2, "output": 8 }
    }
  }
}
```

- `currency.perTokens`：价格对应多少个 token，默认 100 万，也就是常见的「¥/百万 token」。
- `peak.windows`：任意多段，`HH:MM`，**支持跨午夜**（`22:00-02:00`）。面板里用 `09:00-12:00,14:00-18:00` 这种写法编辑。
- `peak.weekend`：`offPeak`（周末全天谷价）/ `peak`（周末全天峰价）/ `ignore`（周末照样按窗口算）。
- `peak.holidays`：`YYYY-MM-DD` 列表，这些日期全天按谷价。
- `peak.enabled: false`：不分峰谷，全天用 `offPeak` 价。
- `models` 的键可以写 `provider:model`、只写 `model`，或 `default` 兜底；匹配不区分大小写、空格、下划线与点。
- 峰时没填的字段回落到谷时。

## 口径

- 数据来自会话日志（`$DSH_HOME/sessions/*/session-*/session.v*.jsonl.zstd`）里 `assistant/message` 的 usage：
  `input = 未命中缓存输入`、`cacheRead = 命中缓存输入`、`output = 输出`，三者相加等于 `totalTokens`。
- 会话标题生成、记忆压缩这类不写进 `assistant/message` 的辅助调用不计入，所以比按 `llm/stream` 记账的插件略少。
- 子智能体是独立会话：计入今日/近 7 天，不计入「本会话」。
- 日志正在写入时可能暂时读不到（面板会提示），下一次刷新自动恢复；不会碰坏任何会话文件。

## 卸载

```sh
dsh plugin --profile web remove local-cost
rm -rf "$DSH_HOME/dsh-go/plugins/local-cost"
```

改了 `lib/` 里的代码需要在 App 的「引擎」页重启引擎；只改 `price.json` 保存后面板刷新即可。

首次装完后也必须**重启一次引擎**（插件是宿主侧条目，只在引擎启动时加载）。重启后输入框上方出现 `今日 ¥x · 峰时`。