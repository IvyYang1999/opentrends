# OpenTrends Event Feed 设计文档

最后更新：2026-05-12

本文档描述当前已经落地的 event feed 实现。早期方案里有一些设计已经调整，例如 events 不再挂在 topic 页面下、跨 topic 合并不再在读取阶段做、source 需要明确标记后才进入 events。以后实现以本文档为准。

## 1. 产品目标

OpenTrends 已经按 topic/source 抓取内容，并展示每个 topic 的信息流。Event feed 在此之上提供一个更高层的信息流：把多个 source item 聚合成一个 event，让用户看到“正在发生的科技事件”，而不是看到散落的重复文章。

核心目标：

- events 是独立页面，不属于某个 topic。
- topic 是 event 的可筛选 tag，一个 event 可以关联多个 topic。
- 只让标记为 `eventEligible` 的 source 进入 events，避免 GitHub Trending、HN、Reddit、论文/工程博客等内容淹没普通科技新闻。
- event 以科技新闻为主，面向普通科技用户，而不是技术论文、教程、repo 榜单或工程细节。
- 同一篇文章或同一事件必须在入库前合并，不能靠前端或读取阶段临时去重。
- 每个 event 保留所有 source item 原文链接和处理过程，用户可以打开详情看来源和 merge 状态。
- 支持内容 i18n：event 标题、摘要、source item 内容需要随页面语言翻译。
- UI 使用瀑布流、虚拟滚动、滚动加载。

非目标：

- 不做全文转载站。
- 不把所有文章交给 LLM 摘要。
- 不在第一版做复杂人工审核、个性化推荐或专用爬虫平台。

## 2. 页面与信息架构

### 2.1 独立 events 页面

events 页面是独立路由：

```text
/{locale}/events
```

topic 只作为 query filter：

```text
/{locale}/events?topic=ai
```

旧的 topic 子页面形式不再作为主入口：

```text
/trends/:topic/events
```

### 2.2 Topic 标签

一个 event 可以同时属于多个 topic，例如一篇 AI 公司融资新闻可以属于：

```text
["ai", "home"]
```

全局 feed 展示这一个 event，并在卡片上展示多个 topic tag。topic 筛选只过滤关联关系，不复制 event。

## 3. Source 入选机制

### 3.1 `eventEligible` 标记

source 配置里有 `eventEligible` 标记，用来判断 source 是否可以进入 events。

规则：

- `eventEligible: true`：可参与 event 生成和展示。
- 未标记或 false：不进入 event feed。

sources 页面和 `/api/sources` 会展示这个标记，方便检查某个 source 是否会进入 events。

### 3.2 第一批 source 策略

events 优先使用大众科技媒体和行业媒体，例如：

- The Verge
- TechCrunch
- MIT Technology Review
- Wired
- Ars Technica
- Engadget
- The Decoder
- VentureBeat
- AP Technology
- The Register
- 36Kr、ifanr、sspai、Solidot、Freebuf 等中文科技媒体
- robotics、biotech、hardware 等垂直方向的大众/行业媒体

默认不进入 events 的来源：

- GitHub Trending
- Hacker News
- Reddit
- Product Hunt
- 论文源和研究博客
- 开发者教程、工程博客、release notes
- 过于技术型、普通科技用户难理解的内容

### 3.3 为什么不靠 source 数判断价值

当前收集的很多 source 都是一手源或垂直媒体。单 source 不一定无价值，多 source 也不一定适合普通用户。因此入选逻辑以 source 标记和新闻信号为基础，而不是简单要求多 source 才能进入 events。

## 4. 数据模型

### 4.1 `source_item`

`source_item` 是 event 的输入。现有字段包括：

- `sourceId`
- `itemId`
- `url`
- `title`
- `description`
- `imageUrl`
- `contentHash`
- `publishedAt`
- `fetchedAt`
- `lastSeenAt`
- `generation`
- `original`

event 功能新增正文抽取字段：

- `contentText`
- `contentFetchedAt`
- `contentStatus`
- `contentError`

默认不存 raw HTML，也不存 defuddle HTML。业务只需要提取后的文本、状态和 hash。

### 4.2 `source_item_embedding`

embedding 单独存储：

```text
source_item_embedding
  source_id
  item_id
  text_hash
  embedding
  model
  created_at
```

当前使用 jsonb 存向量，规模较小时在内存里做相似度计算即可。以后如果需要更大规模检索，可以迁到 pgvector。

### 4.3 `trend_event`

`trend_event` 存全局唯一 event：

```text
trend_event
  event_id
  topic_id              -- 代表/兼容字段，不表示唯一归属
  title
  summary
  score
  source_count
  first_seen_at
  last_seen_at
  primary_source_id
  primary_item_id
  updated_at
```

`event_id` 是全局 canonical id，不再包含 topic 前缀。格式类似：

```text
event-9f8aec87
```

### 4.4 `trend_event_topic`

event 与 topic 是多对多关系：

```text
trend_event_topic
  event_id
  topic_id
  created_at
```

全局 feed 只读取存在 `trend_event_topic` 关联的 event，避免旧数据或孤儿数据混入。

### 4.5 `trend_event_source_item`

event 与 source item 的关联：

```text
trend_event_source_item
  event_id
  source_id
  item_id
  is_primary
  merge_confidence
  created_at
```

同一个 event 可以关联多个 source item。详情页展示这些 source item 的处理状态和原文链接。

## 5. Embedding 与配置

### 5.1 SiliconFlow 是必需配置

event feed 需要 SiliconFlow embedding。没有 `SILICONFLOW_API_KEY` 时不能生成或展示假结果。

默认模型：

```text
Qwen/Qwen3-VL-Embedding-8B
```

接口：

```http
POST https://api.siliconflow.cn/v1/embeddings
```

### 5.2 没有本地 fallback

之前本地 hash vector fallback 会导致“没接 embedding 也有结果”，这是错误行为。当前设计要求：

- 未配置 embedding key 时，event API 返回 `503 embedding_not_configured`。
- 前端展示需要配置 embedding 的状态。
- 不生成 deterministic/local fake embedding。

### 5.3 Embedding 输入

embedding 输入使用 canonical text，不直接传整篇 HTML：

```text
title
description
contentText 前段
source name
published date
```

当 `textHash` 没变时，不重新生成 embedding。

## 6. Event 生成流程

### 6.1 Source refresh

source refresh 仍然负责更新 source snapshot 和 `source_item`。

本地和线上都需要跑 refresh scheduler。Worker 环境没有传统长驻 interval，因此生产环境使用 request-driven scheduler tick，通过后台任务刷新 due sources。

### 6.2 当前 topic 输入

event 重建以 topic 为入口读取当前 generation 的 source items：

1. 读取 topic 下所有 source。
2. 只保留 `eventEligible` source。
3. 只读取当前 generation。
4. 只读取近期窗口内的 item。
5. 对缺失或过期 embedding 的 item 补 embedding。

### 6.3 Cluster 合并

event cluster 合并使用多层信号：

1. 标准化 URL 相同，直接合并。
2. content hash 相同，直接合并。
3. embedding 相似度足够高，并且在时间窗口内。
4. keyword overlap 足够，避免语义相似但不是同一事件的内容误合并。
5. 同一个 source 的多个 item 不互相合并为同一个 event，避免单源刷屏误聚合。

主要阈值当前在 `event-feed.ts` 中维护：

- `EVENT_SIMILARITY_THRESHOLD`
- `EVENT_RELATED_SIMILARITY_THRESHOLD`
- `EVENT_STRONG_SIMILARITY_THRESHOLD`
- `EVENT_TIME_WINDOW_MS`

### 6.4 入库前合并

跨 topic 合并发生在入库前，不在读取阶段临时去重。

`eventId` 基于 canonical article key 生成：

```text
normalizeUrl(url) + contentHash + title
```

同一篇文章在多个 topic 下会生成同一个 `eventId`，然后写入多条 `trend_event_topic` 关联。

重建 topic 时：

1. 删除该 topic 旧的 `trend_event_topic` 关联。
2. 清理历史遗留的 `${topic}-...` 前缀旧 event。
3. upsert 全局 `trend_event`。
4. insert `trend_event_topic`。
5. insert `trend_event_source_item`，冲突时忽略。
6. 清理没有任何 topic 关联的孤儿 event/source link。

## 7. Event 入选与评分

### 7.1 Feed worthy

不是所有 cluster 都进入 events。入选会考虑：

- source 是否 `eventEligible`
- 是否大众科技新闻/行业新闻
- 是否过于论文、工程、教程或 release note
- source 质量
- rank/hot signal
- freshness
- source 数量和独立 source family 数量

技术型内容默认不作为普通 event 主体，除非有大众科技媒体覆盖并且新闻信号足够强。

### 7.2 Score

score 不是 LLM 生成，主要由规则计算：

- source propagation
- independent source count
- item rank
- hot value
- source quality
- freshness
- consumer tech news signal
- expert/technical penalty

详情页会展示 score 的输入，方便理解为什么某个 event 被展示。

### 7.3 时间定义

event 的 `firstSeenAt` 使用 cluster 中最早 source item 的 `publishedAt`，没有 `publishedAt` 时回退到 `fetchedAt`。

feed 按时间倒序展示：

```text
first_seen_at desc
last_seen_at desc
event_id desc
```

`event_id desc` 是稳定排序的 tie-breaker，避免 offset 分页时因为同时间 event 顺序抖动导致滚动加载重复。

## 8. API 设计

### 8.1 全局 event feed

```http
GET /api/events?offset=0&limit=30&lang=zh&translations=sync
```

可选 topic filter：

```http
GET /api/events?topic=ai&offset=0&limit=30
```

返回：

```ts
type EventFeedResponse = {
  events: Array<{
    eventId: string;
    topicId: string;
    topicIds?: string[];
    title: string;
    summary?: string;
    imageUrl?: string;
    score: number;
    sourceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    original?: {
      title: string;
      summary?: string;
    };
    primarySource?: {
      sourceId: string;
      title: string;
      url: string;
      imageUrl?: string;
    };
  }>;
  nextOffset?: number;
};
```

### 8.2 Event detail

```http
GET /api/events/:eventId?topic=ai&lang=zh&translations=sync
```

返回：

```ts
type EventDetailResponse = {
  eventId: string;
  topicId: string;
  title: string;
  summary?: string;
  score: number;
  firstSeenAt: string;
  lastSeenAt: string;
  processing: {
    inputItemCount: number;
    enrichedItemCount: number;
    embeddedItemCount: number;
    embeddingModel: string;
    lookbackHours: number;
    itemLimit: number;
    mergeRules: {
      similarityThreshold: number;
      timeWindowHours: number;
    };
    scoreInputs: {
      uniqueSourceCount: number;
      sourceScore: number;
      itemScore: number;
    };
    steps: Array<{
      label: string;
      status: "done" | "pending" | "skipped";
      detail: string;
    }>;
  };
  sourceItems: Array<{
    sourceId: string;
    itemId: string;
    title: string;
    description?: string;
    url: string;
    imageUrl?: string;
    publishedAt?: string;
    contentStatus: string;
    contentFetchedAt?: string;
    hasEmbedding: boolean;
    embeddingModel?: string;
    textHash?: string;
    isPrimary: boolean;
    mergeConfidence: number;
  }>;
};
```

### 8.3 Legacy topic API

旧接口仍保留兼容：

```http
GET /api/trends/:topic/events
GET /api/trends/:topic/events/:eventId
```

新页面优先使用 `/api/events`。

## 9. 前端实现

### 9.1 UI

events 页面使用：

- 独立 `/events` 页面。
- 顶部 topic filter。
- event 卡片展示封面、标题、摘要、topic tags、source count、时间、score、primary source。
- 点击卡片打开详情 Dialog。
- 详情展示 processing panel 和所有 source items。

### 9.2 瀑布流与滚动加载

瀑布流使用开源库实现：

```text
@tanstack/react-virtual
```

实现要点：

- 多 lane virtualizer 实现 masonry-like layout。
- 根据 viewport 宽度选择 lane count。
- 滚动到底部时调用 `fetchNextPage`。
- 后端用 `offset + limit` 返回 `nextOffset`。
- 前端对已加载 pages 按 `eventId` 做兜底去重，避免并发/refetch 或后端分页抖动导致重复卡片。

### 9.3 i18n

页面文案走 web messages。

event 内容本身也支持 i18n：

- feed API 传 `lang` 和 `translations`。
- 返回 `title`、`summary` 的翻译结果。
- `original` 保留原文标题/摘要。
- detail source item 同样支持翻译。

## 10. 迁移与历史数据

### 10.1 迁移

event feed 相关迁移：

- `0009_event_feed.sql`：source item content 字段、embedding 表、event 表、event source item 表、event topic 表。
- `0010_event_topic_links.sql`：为已经应用过旧版 `0009` 的环境补 `trend_event_topic` 表。

### 10.2 历史旧 event

早期实现曾生成过带 topic 前缀的 event id：

```text
ai-...
home-...
tech-...
```

当前实现要求：

- 新 event id 使用 `event-...`。
- 全局 feed 只读取存在 `trend_event_topic` 关联的 event。
- 重建 topic 时清理该 topic 下的旧前缀 event。

## 11. 可观测性

event 详情页需要能解释“为什么这个 event 是这样来的”：

- input source item 数量
- enriched item 数量
- embedded item 数量
- embedding model
- merge rules
- score inputs
- 每个 source item 的 content status
- 每个 source item 是否有 embedding
- merge confidence
- primary item 标记

这避免用户只能看到结果、看不到处理过程。

## 12. KISS / YAGNI / DRY

### KISS

当前实现保留必要流程：

- source 标记决定是否进入 events。
- 只处理当前 topic/source generation 的近期 item。
- defuddle 提取正文。
- SiliconFlow embedding。
- 规则 + embedding 聚类。
- 入库前 canonical event merge。
- 独立 `/events` 信息流。

### YAGNI

当前不做：

- 本地 embedding fallback。
- 复杂人工审核台。
- 专用爬虫平台。
- 所有 source 的定制 extractor。
- 全量历史回填。
- 所有 cluster 都跑 LLM 判断。

### DRY

复用现有：

- `source_item` 输入。
- `source` / `source_item` cache 和 refresh scheduler。
- `source_item_translation` 翻译缓存。
- Void Queue job 模式。
- TanStack Router / Query / Virtual。

## 13. 后续改进方向

可以后续做，但不是当前必需：

- 使用 pgvector 优化大规模相似检索。
- 给 event 增加人工反馈标记，用于调权。
- 增加 event quality dashboard，展示被过滤的 cluster。
- 对高价值 multi-source event 生成更稳定的 LLM 摘要。
- 支持 cursor pagination，进一步避免 offset 在高并发写入时的边界问题。
- 对 `eventEligible` source 做后台质量报表，定期调整 source 白名单。
