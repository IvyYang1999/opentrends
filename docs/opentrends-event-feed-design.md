# OpenTrends 事件聚合信息流设计文档

## 1. 目标

OpenTrends 当前已经按 topic/source 拉取内容，并把 source item 展示成趋势页面。这个设计是在现有架构上增加一个更高层的“事件信息流”：把 200 个 source、数千条文章中描述同一件事的内容合并成一个 event，并在 event 下展示所有相关 source 的原文链接。

核心目标：

- 不把 3000 条文章全部喂给 LLM，避免 token 成本失控。
- 识别 title/description 不同但实际讲同一件事的文章。
- 每个 event 保留所有关联 source item，用户可以打开全部原文。
- 尽量复用现有 `apps/server` 的 source/cache/summary 结构。
- 任务系统沿用项目已有的 Void Queue 模式。
- 遵守 KISS、YAGNI、DRY：先做必要字段和必要流程，不提前设计复杂工作台。

非目标：

- 不做全文内容转载站。
- 不把每篇文章都做 LLM 摘要。
- 不在第一版引入复杂人工审核、个性化推荐、专用爬虫平台。

## 2. 关键结论

### 2.1 Token 会不会很贵

如果 3000 篇文章都送进 LLM，会很贵，也没有必要。

正确方式是：

```text
3000 articles
  -> 规则过滤 / URL 归一 / 内容指纹
  -> embedding 生成短文本向量
  -> 相似文章合并成 event cluster
  -> 只对 Top event cluster 调 LLM
```

LLM 只处理“已经合并后的少量 event cluster”，不是处理每篇文章。比如一天 3000 条 item，可以先合并成几十到一两百个 event，再只对前 20-50 个高价值 event 做标题、摘要、价值解释。

### 2.2 title/description 完全不一样怎么办

只靠 title/description 的确识别不了很多相似内容。所以合并逻辑不能只看标题，要用三层信号：

1. URL/canonical URL/content hash：识别完全重复或转载。
2. embedding：识别语义相似，即使标题不同也能靠正文片段、description、实体相似度合并。
3. 时间窗口 + 实体/关键词规则：避免把相似但不是同一事件的内容误合并。

### 2.3 去重应该叫合并

同意。这里不应该叫“去重”，因为产品上不是删除重复内容，而是把多个 source item 合并到同一个 event 下。

文档后续统一使用：

- `merge`：把多个 source item 合并为一个 event。
- `sourceItems`：event 下的所有原文来源。
- `primarySourceItem`：最适合作为主引用的一手来源或高可信来源。

### 2.4 raw_html / defuddle_content_html 是否要存

默认不存。

为了 KISS，默认只存后续真正会用到的内容：

- `contentText`：defuddle 提取出的纯文本或 Markdown，用于 embedding、合并和 LLM。
- `contentHash`：判断内容是否变化。
- `contentFetchedAt`：正文获取时间。
- `contentStatus`：成功、失败、受限、过短。

`raw_html` 和 `defuddle_content_html` 只有在调试抽取质量时有价值，但日常业务不直接用。可以不入库，最多在开发环境临时日志或对象存储短期保留。

## 3. 当前项目约束

当前项目中：

- `apps/server` 负责 source fetching、cache、summary 和 API。
- `packages/db/src/schema/trends.ts` 已有 `source`、`source_item`、`trends_summary`、`source_item_translation`。
- `source_item` 已有 `sourceId`、`itemId`、`url`、`title`、`description`、`contentHash`、`publishedAt`、`fetchedAt`、`lastSeenAt`、`generation`、`original`。
- `apps/server/queues/summary-prewarm.ts` 已经使用 `void` 的 `defineQueue`。
- `apps/server/src/trends/services/summary-prewarm-jobs.ts` 已经有“Void Queue 可用就入队，否则 inline fallback”的模式。
- LLM 目前通过 `@ai-sdk/openai-compatible` 和 `ai` 包接入。

所以事件聚合应放在 `apps/server/src/trends` 内，不应该把逻辑放到 web 端。

## 4. 简化后的总体流程

```text
Source refresh
  -> source_item 入库
  -> filter new or changed source_item
  -> content enrichment with defuddle
  -> embedding source item
  -> merge similar items into event
  -> score event
  -> optional LLM summary for top events
  -> event feed API
```

这里每一步都可以独立重试，且只有最后的摘要步骤需要 LLM。

## 5. 新增 item 筛选

不是每个 source 每天都有新内容，所以事件聚合不能每次 refresh 都处理该 source 的全部 item。第一步必须筛出“之前没出现过”或“内容发生变化”的 source item。

当前 `source_item` 的主键是 `(sourceId, itemId)`，并且已有 `contentHash`、`lastSeenAt`、`generation`。因此判断逻辑很直接：

```text
new item: 数据库里不存在相同 (sourceId, itemId)
changed item: 存在相同 (sourceId, itemId)，但 contentHash 变化
unchanged item: 存在相同 (sourceId, itemId)，且 contentHash 不变
```

只有 `new item` 和 `changed item` 进入后续的 defuddle、embedding、event merge 队列。`unchanged item` 只更新 `lastSeenAt` / `generation`，不重新抽正文、不重新 embedding、不重新跑 LLM。

建议在 source refresh 写入时产出一个轻量结果：

```ts
type SourceRefreshDelta = {
  sourceId: string;
  newItems: Array<{ sourceId: string; itemId: string }>;
  changedItems: Array<{ sourceId: string; itemId: string }>;
  unchangedCount: number;
};
```

后续任务只消费：

```ts
const itemsToProcess = [...delta.newItems, ...delta.changedItems];
```

这一步是成本控制的第一层，比 embedding 和 LLM 更靠前。

## 6. 正文获取设计

### 6.1 使用 defuddle

正文获取使用 `defuddle`。服务端流程：

```ts
import { JSDOM } from "jsdom";
import { Defuddle } from "defuddle/node";

async function extractContent(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const result = await Defuddle(dom.window.document, url, {
    markdown: true,
  });

  return {
    contentText: result.contentMarkdown ?? result.content,
    title: result.title,
    description: result.description,
    author: result.author,
    published: result.published,
    site: result.site,
    domain: result.domain,
    language: result.language,
    wordCount: result.wordCount,
  };
}
```

### 6.2 只存必要字段

建议给 `source_item` 增加少量字段：

```ts
contentText?: string;
contentFetchedAt?: Date;
contentStatus?: "pending" | "ok" | "too_short" | "failed" | "restricted";
contentError?: string;
```

不默认存：

- `raw_html`
- `defuddle_content_html`
- 完整 defuddle metadata blob

如果以后发现抽取质量难排查，再加短期 debug 存储。现在不需要。

### 6.3 正文太短时怎么办

如果 defuddle 结果过短，就保留原有 `title + description`，并把 `contentStatus` 标为 `too_short`。这类 item 仍然可以参与合并，但置信度更低。

## 7. Embedding 设计

### 7.1 是否需要外置模型

需要。第一版不建议在服务器本地跑 embedding 模型。

原因：

- 本地模型会增加部署复杂度、冷启动、CPU/内存压力。
- 当前项目已经有 OpenAI-compatible LLM 接入方式，可以沿用 provider 配置思路。
- 3000 条 item 的 embedding 调用成本通常远低于把 3000 条 item 都送进 LLM 总结。

### 7.2 服务器怎么跑

在 `apps/server` 中新增 embedding service：

```text
apps/server/src/trends/services/event-embedding.ts
```

输入不是全文，而是短的 canonical text：

```text
title
description
contentText 前 800-1200 字
source name
published date bucket
```

这样每条 item 的 embedding 输入很短，成本可控。

### 7.3 embedding 结果存哪里

简单起步可以存：

```ts
sourceItemEmbedding {
  sourceId
  itemId
  textHash
  embedding
  model
  createdAt
}
```

如果 Postgres 已启用 pgvector，就用 vector 类型；如果没有，先用 jsonb 存数组也可以，但检索性能会差。200 source / 3000 item 的规模下，先做批量内存相似度也可以接受，后面再换 pgvector。

### 7.4 embedding 限额是否够用

如果 embedding 限额是：

```text
RPM: 2,000 requests / minute
TPM: 1,000,000 tokens / minute
```

对当前设计是够用的，前提是只处理 `newItems + changedItems`，并且 embedding 输入使用短 canonical text。

估算：

- 如果极端情况下 3000 条 item 都需要 embedding，且每条 800 tokens，总量约 240 万 tokens，按 100 万 TPM 约 3 分钟可处理完。
- 如果每条 1200 tokens，总量约 360 万 tokens，约 4 分钟。
- RPM 不是主要瓶颈。3000 条 item 即使一条一个请求，也只是 3000 requests；按 2000 RPM 约 2 分钟。实际还可以批量发送多个 input，进一步降低 request 数。
- 真实日常不会每天 3000 条都重新处理，因为 unchanged item 不进入队列。假设每天只有 300-800 条新增或变化，通常 1 分钟内可以完成 embedding。

实现上需要加限流器：

```text
max requests <= 1,800 RPM
max input tokens <= 900,000 TPM
```

保留 10% 左右余量，避免 provider 统计窗口和本地估算不完全一致时触发 rate limit。

当触发限流时，不需要失败任务；直接把剩余 item 延迟重试或放回 Void Queue。

## 8. 事件合并设计

### 8.1 不是删除重复文章

合并的目标是创建 event：

```ts
type Event = {
  eventId: string;
  title: string;
  summary?: string;
  score: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceItems: EventSourceItem[];
};

type EventSourceItem = {
  eventId: string;
  sourceId: string;
  itemId: string;
  url: string;
  title: string;
  publishedAt?: Date;
  isPrimary: boolean;
  mergeConfidence: number;
};
```

前端展示 event 时，必须能展开看到所有 `sourceItems` 的原文链接。

### 8.2 合并逻辑

合并不是单一规则，而是轻量组合：

1. URL 归一：canonical URL 一样，直接合并。
2. 内容 hash：`contentText` 或 `title + description` hash 一样，直接合并。
3. embedding 相似度：超过阈值才进入候选。
4. 时间窗口：发布时间相差太远，不自动合并。
5. 实体/关键词重叠：相似度高但关键实体完全不同，不自动合并。

伪逻辑：

```ts
if (sameCanonicalUrl) merge();
else if (sameContentHash) merge();
else if (
  embeddingSimilarity > 0.86 &&
  sameTimeWindow &&
  hasEntityOrKeywordOverlap
) {
  merge();
}
```

这样可以处理“标题完全不同但讲同一件事”的情况，同时降低误合并。

### 8.3 LLM 是否参与合并

默认不参与。

只有当一个候选 event 很重要但合并置信度中等时，才让 LLM 判断“这些 source 是否在讲同一事件”。这属于少量兜底，不是主流程。

## 9. 事件评分

评分不靠 LLM，直接算：

```text
score =
  sourceCount * 来源数量权重
  + primarySourceBonus
  + velocityScore
  + sourceCredibilityScore
  + freshnessScore
```

第一版不需要复杂公式，只要能解释：

- 有多少 source 提到。
- 是否有一手来源。
- 传播速度是否快。
- source 是否可信。
- 是否足够新。

## 10. LLM 使用边界

LLM 只做两件事：

1. 给高分 event 生成标题和短摘要。
2. 在少数不确定但高价值的 event 上辅助判断是否应该合并。

LLM 输入只包含 event 下的代表 source：

- 最多 3-5 条 source item。
- 每条只传 title、description、contentText 前 800-1200 字、URL。
- 不传所有 3000 条文章。
- 不传 raw HTML。

这符合 KISS：用 LLM 做它擅长的归纳表达，不让它承担批量计算和排序。

## 11. 任务系统

任务系统使用项目已有的 Void Queue 模式。

现有项目已有：

```text
apps/server/queues/summary-prewarm.ts
apps/server/src/trends/services/summary-prewarm-jobs.ts
```

新功能可以新增类似队列：

```text
apps/server/queues/event-merge.ts
apps/server/src/trends/services/event-merge-jobs.ts
```

建议拆两个 job：

1. `event-content-enrichment`：对 source item 抓原文并跑 defuddle。
2. `event-merge`：生成 embedding、合并 event、更新 event score。

不建议拆太多队列。队列太多会增加理解和运维成本。

调度方式：

- source refresh 完成后，先计算 `SourceRefreshDelta`。
- 只把 `newItems + changedItems` 批量送进 Void Queue。
- 没有新增或变化时，不触发 defuddle、embedding、event merge。
- Void Queue 不可用时，沿用当前 summary prewarm 的模式 inline fallback。
- 每个 job 必须幂等：同一个 source item 重跑不会重复创建 event source link。

## 12. API 设计

### 12.1 获取事件信息流

```http
GET /api/trends/:topic/events
```

返回：

```ts
type EventFeedResponse = {
  events: Array<{
    eventId: string;
    title: string;
    summary?: string;
    score: number;
    sourceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    primarySource?: {
      sourceId: string;
      title: string;
      url: string;
    };
  }>;
};
```

### 12.2 获取事件详情

```http
GET /api/trends/:topic/events/:eventId
```

返回：

```ts
type EventDetailResponse = {
  eventId: string;
  title: string;
  summary?: string;
  score: number;
  sourceItems: Array<{
    sourceId: string;
    itemId: string;
    title: string;
    url: string;
    publishedAt?: string;
    isPrimary: boolean;
    mergeConfidence: number;
  }>;
};
```

## 13. 前端展示

事件卡片展示：

- event 标题。
- 简短摘要。
- source 数量。
- primary source。
- 更新时间。
- “展开来源”按钮。

展开后展示所有 source 原文链接。这里是产品核心：合并后不是丢掉文章，而是把所有相关文章挂到同一个 event 下。

## 14. KISS / YAGNI / DRY 校验

### KISS

保留必要流程：

- 只处理新增或内容变化的 source item。
- defuddle 获取正文。
- embedding 做相似合并。
- event 聚合。
- LLM 只做少量摘要。
- Void Queue 跑后台任务。

删除不必要复杂度：

- 不默认存 raw HTML。
- 不默认存清理后的 HTML。
- 不做复杂审核台。
- 不做多层 event candidate 抽象。
- 不做过度复杂评分公式。

### YAGNI

现在不需要：

- 本地 embedding 模型部署。
- 专门的爬虫管理平台。
- 所有 source 的专用 extractor。
- 全量历史回填。
- 复杂人工标注系统。

### DRY

复用现有：

- `source_item` 作为输入。
- `apps/server/src/trends` 作为业务层。
- Void Queue job 模式。
- OpenAI-compatible provider 配置思路。
- 现有 summary/cache 的写法。

## 15. 最终建议

当前设计应该收敛成一个更简单的版本：

```text
source_item
  -> filter new or changed items
  -> defuddle contentText
  -> embedding
  -> merge into event
  -> score
  -> optional LLM summary
  -> event feed with all source links
```

这比之前的文档更符合 KISS/YAGNI/DRY，也更贴合当前项目。它能解决 title/description 不同导致无法识别相似内容的问题，同时不会把 3000 条文章全部送进 LLM。
