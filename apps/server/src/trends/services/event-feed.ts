import { db, schema } from "@opentrends/db";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import {
	getEventEligibleSourceIds,
	getSourcePreset,
	isEventEligibleSource,
} from "../config/sources";
import { getTopicPreset, topicPresets } from "../config/topics";
import type { TopicId } from "../types";
import {
	assertEventEmbeddingConfigured,
	buildCanonicalEmbeddingText,
	embedTexts,
	getEventEmbeddingModel,
	hashText,
} from "./event-embedding";
import {
	refreshExpiredTopicSourcesInBackground,
	TopicNotFoundError,
	TrendsSnapshotsUnavailableError,
} from "./get-trends-page";
import {
	type TranslationLanguage,
	type TranslationMode,
	translateNewsItems,
} from "./translate-news-items";

const {
	source,
	sourceItem,
	sourceItemEmbedding,
	trendEvent,
	trendEventSourceItem,
	trendEventTopic,
} = schema;
const EVENT_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const EVENT_ITEM_LIMIT = 1400;
const EVENT_FEED_DEFAULT_LIMIT = 30;
const EVENT_FEED_MAX_LIMIT = 80;
const EVENT_DETAIL_SOURCE_LIMIT = 160;
const EVENT_SIMILARITY_THRESHOLD = 0.72;
const EVENT_RELATED_SIMILARITY_THRESHOLD = 0.68;
const EVENT_STRONG_SIMILARITY_THRESHOLD = 0.84;
const EVENT_TIME_WINDOW_MS = 72 * 60 * 60_000;
const LEADING_WWW_RE = /^www\./;
const TRAILING_SLASH_RE = /\/$/;
const HAN_TEXT_RE = /\p{Script=Han}{2,}/gu;
const HOT_NUMBER_RE = /(\d+(?:\.\d+)?)/;
const VERSION_TITLE_RE = /^v?\d+(?:\.\d+){1,3}(?:\b|$)/i;
const TECHNICAL_RESEARCH_TITLE_RE =
	/\b(?:arxiv|benchmark|benchmarks|dataset|datasets|paper|papers|quantization|calibration|uncertainty|reinforcement learning|rlhf|finetun(?:e|ing)|fine-tun(?:e|ing)|training|inference|token|tokens|embedding|embeddings|transformer|attention|diffusion|distillation|sft|lora|rag|eval|evaluation|reasoning model|vllm|cuda|kernel|agentic workflow|3d detection|object detection|segmentation|sampler|latency|throughput)\b/i;
const LOW_VALUE_PROMO_RE =
	/\b(?:promo code|coupon code|discount code|voucher code|coupon|coupons|promo codes?|discount codes?|voucher codes?|limited-time offer|limited time offer|today only|deal alert|daily deals?|best deals?|early access sale|flash sale|clearance sale|price drop|price drops|lowest price|record low|save (?:up to )?(?:\$|£|€|\d)|\d{1,2}%\s*off|amazon deals?)\b|(?:优惠码|促销码|折扣码|折扣券|优惠券|领券|用码|限时优惠|限时折扣|限时特价|特价|好价|降价|史低|包邮|满减|立减|省钱)/i;
const LOW_VALUE_SINGLE_SOURCE_RE =
	/\b(?:buying guide|gift guide|deals?|discount|sale|streaming|trailer|review roundup)\b|(?:导购|好价|优惠|折扣|开箱|种草|平替|穿搭|餐吧|钓鱼服)/i;
const DEAL_TITLE_RE = /\bdeals?\b/i;
const CONSUMER_TECH_NEWS_RE =
	/\b(?:launch(?:es|ed)?|release(?:s|d)?|roll(?:s|ed)? out|announce(?:s|d)?|unveil(?:s|ed)?|introduce(?:s|d)?|ship(?:s|ped)?|preview(?:s|ed)?|upgrade(?:s|d)?|funding|raises?|acquir(?:es|ed|ing)|merger|ipo|lawsuit|sues?|regulat(?:e|es|ed|ion|ory)|ban(?:s|ned)?|deal|partnership|partners?|customer|users?|consumer|app|apps|phone|browser|device|robot|startup|company|market|pricing|subscription|api|assistant|chatbot|search|voice|video|image generator|agent|agents)\b/i;
const EXPERT_EVENT_FAMILIES = new Set([
	"anthropic-engineering",
	"anthropic-research",
	"apple-ml-research",
	"arxiv-cs-ai",
	"arxiv-cs-cl",
	"arxiv-cs-cv",
	"arxiv-cs-lg",
	"arxiv-cs-ne",
	"arxiv-eess-sy",
	"arxiv-q-bio-nc",
	"arxiv-robotics",
	"bair-blog",
	"berkeley-rdi",
	"cmu-ml-blog",
	"claude-blog",
	"claude-code-releases",
	"cloudflare-blog",
	"cursor-blog",
	"deepmind-blog",
	"eleutherai-blog",
	"google-developers-blog",
	"google-research-blog",
	"huggingface-blog",
	"huggingface-papers",
	"karpathy-blog",
	"latent-space",
	"lilian-weng",
	"lmsys-blog",
	"meta-engineering",
	"mozilla",
	"nvidia-ai-blog",
	"openai-alignment",
	"openai-research",
	"qwen-research",
	"reddit-localllama",
	"reddit-machinelearning",
	"reddit-reinforcementlearning",
	"sebastian-raschka",
	"simon-willison",
	"the-gradient",
	"transformer-circuits",
]);
const CONSUMER_TECH_NEWS_FAMILIES = new Set([
	"apnews-technology",
	"ars-technica",
	"axios",
	"bbc-news",
	"bloomberg",
	"business-insider",
	"engadget",
	"mit-tech-review",
	"nytimes",
	"reuters",
	"techcrunch",
	"the-decoder",
	"the-register",
	"the-verge",
	"venturebeat",
	"wired",
	"wsj",
]);
const SINGLE_SOURCE_NEWS_EVENT_FAMILIES = new Set([
	...CONSUMER_TECH_NEWS_FAMILIES,
	"anthropic-news",
	"apple-newsroom",
	"google-ai-blog",
	"meta-ai-blog",
	"openai-news",
	"runway-news",
	"xai-news",
]);
const DEAL_HEAVY_SOURCE_FAMILIES = new Set([
	"9to5mac",
	"appleinsider",
	"cult-of-mac",
	"macrumors",
]);
const T1_FIRST_PARTY_FAMILIES = new Set([
	"anthropic-engineering",
	"anthropic-news",
	"anthropic-research",
	"apple-ml-research",
	"apple-newsroom",
	"claude-blog",
	"claude-code-releases",
	"cloudflare-blog",
	"deepmind-blog",
	"github-blog",
	"google-ai-blog",
	"google-developers-blog",
	"google-research-blog",
	"huggingface-blog",
	"meta-ai-blog",
	"meta-engineering",
	"nvidia-ai-blog",
	"openai-alignment",
	"openai-news",
	"openai-research",
	"qwen-research",
	"runway-news",
	"xai-news",
]);
type EventSourceTier = "t1" | "t15" | "t2" | "unknown";
type EventSelectionReason =
	| "high_score"
	| "multiple_sources"
	| "official_source"
	| "selected"
	| "strong_source";
interface CurrentItemRow {
	contentHash: string;
	contentText: string | null;
	description: string | null;
	embedding: number[] | null;
	fetchedAt: Date;
	hotValue: string | number | null;
	itemId: string;
	publishedAt: Date | null;
	rank: number;
	sourceId: string;
	textHash: string | null;
	title: string;
	url: string;
}

interface EventCluster {
	contentHashes: Set<string>;
	eventId: string;
	firstSeenAt: Date;
	items: Array<CurrentItemRow & { confidence: number }>;
	keywords: Set<string>;
	lastSeenAt: Date;
	primary: CurrentItemRow;
	urls: Set<string>;
	vector: number[] | null;
}

interface EventSourceItemInsert {
	createdAt: Date;
	eventId: string;
	isPrimary: number;
	itemId: string;
	mergeConfidence: number;
	sourceId: string;
}

export interface EventFeedItem {
	eventId: string;
	firstSeenAt: string;
	imageUrl?: string;
	lastSeenAt: string;
	original?: {
		summary?: string;
		title: string;
	};
	primarySource?: {
		imageUrl?: string;
		sourceId: string;
		title: string;
		url: string;
	};
	score: number;
	selectionReason?: EventSelectionReason;
	sourceCount: number;
	sources: Array<{
		homeUrl?: string;
		sourceId: string;
		title: string;
	}>;
	summary?: string;
	title: string;
	topicId: string;
	topicIds?: string[];
}

export interface EventFeedResponse {
	events: EventFeedItem[];
	nextOffset?: number;
}

export interface EventDetailResponse {
	eventId: string;
	firstSeenAt: string;
	lastSeenAt: string;
	original?: {
		summary?: string;
		title: string;
	};
	processing: {
		embeddedItemCount: number;
		embeddingModel: string;
		enrichedItemCount: number;
		inputItemCount: number;
		itemLimit: number;
		lookbackHours: number;
		mergeRules: {
			similarityThreshold: number;
			timeWindowHours: number;
		};
		scoreInputs: {
			itemScore: number;
			sourceScore: number;
			uniqueSourceCount: number;
		};
		steps: Array<{
			detail: string;
			label: string;
			status: "done" | "pending" | "skipped";
		}>;
	};
	score: number;
	sourceItems: Array<{
		contentFetchedAt?: string;
		contentStatus: string;
		description?: string;
		embeddingModel?: string;
		hasEmbedding: boolean;
		itemId: string;
		imageUrl?: string;
		isPrimary: boolean;
		mergeConfidence: number;
		original?: {
			description?: string;
			title: string;
		};
		publishedAt?: string;
		sourceId: string;
		textHash?: string;
		title: string;
		url: string;
	}>;
	summary?: string;
	title: string;
	topicId: string;
}

function getAllTopicIds(): TopicId[] {
	return Object.keys(topicPresets) as TopicId[];
}

function sourceName(sourceId: string): string {
	return getSourcePreset(sourceId)?.name ?? sourceId;
}

function sourceFamilyId(sourceId: string): string {
	if (sourceId.startsWith("github-trending")) {
		return "github-trending";
	}
	if (sourceId.startsWith("hackernews")) {
		return "hackernews";
	}
	if (sourceId.startsWith("bilibili-")) {
		return "bilibili";
	}
	for (const suffix of ["-weekly", "-daily", "-ai"]) {
		if (sourceId.endsWith(suffix)) {
			return sourceId.slice(0, -suffix.length);
		}
	}
	return sourceId;
}

function itemAudienceText(item: CurrentItemRow): string {
	return `${item.title}\n${item.description ?? ""}`;
}

function isLowValuePromotionText(
	text: string,
	sourceId?: string | null
): boolean {
	if (LOW_VALUE_PROMO_RE.test(text)) {
		return true;
	}
	return Boolean(
		sourceId &&
			DEAL_HEAVY_SOURCE_FAMILIES.has(sourceFamilyId(sourceId)) &&
			DEAL_TITLE_RE.test(text)
	);
}

function isLowValuePromotionItem(item: CurrentItemRow): boolean {
	return isLowValuePromotionText(itemAudienceText(item), item.sourceId);
}

function isLowValuePromotionCluster(cluster: EventCluster): boolean {
	if (isLowValuePromotionItem(cluster.primary)) {
		return true;
	}
	const promoItemCount = cluster.items.filter(isLowValuePromotionItem).length;
	return promoItemCount > 0 && promoItemCount >= cluster.items.length / 2;
}

function isExpertEventSource(sourceId: string): boolean {
	return EXPERT_EVENT_FAMILIES.has(sourceFamilyId(sourceId));
}

function isConsumerTechNewsSource(sourceId: string): boolean {
	return (
		isEventEligibleSource(sourceId) ||
		CONSUMER_TECH_NEWS_FAMILIES.has(sourceFamilyId(sourceId))
	);
}

function sourceSignalTier(
	sourceId: string | null | undefined
): EventSourceTier {
	if (!sourceId) {
		return "unknown";
	}
	const familyId = sourceFamilyId(sourceId);
	if (T1_FIRST_PARTY_FAMILIES.has(familyId)) {
		return "t1";
	}
	if (isExpertEventSource(sourceId)) {
		return "t15";
	}
	if (isEventEligibleSource(sourceId) || isConsumerTechNewsSource(sourceId)) {
		return "t2";
	}
	return "unknown";
}

function hasConsumerTechNewsSource(cluster: EventCluster): boolean {
	return cluster.items.some((item) => isConsumerTechNewsSource(item.sourceId));
}

function hasConsumerTechNewsSignal(cluster: EventCluster): boolean {
	return cluster.items.some(
		(item) =>
			isConsumerTechNewsSource(item.sourceId) ||
			CONSUMER_TECH_NEWS_RE.test(itemAudienceText(item))
	);
}

function hasTitleNewsSignal(item: CurrentItemRow): boolean {
	return (
		isConsumerTechNewsSource(item.sourceId) ||
		CONSUMER_TECH_NEWS_RE.test(item.title)
	);
}

function isTechnicalResearchItem(item: CurrentItemRow): boolean {
	return (
		isExpertEventSource(item.sourceId) ||
		TECHNICAL_RESEARCH_TITLE_RE.test(itemAudienceText(item))
	);
}

function isExpertOnlyCluster(cluster: EventCluster): boolean {
	return cluster.items.every(isTechnicalResearchItem);
}

function isSingleSourceEventSource(sourceId: string): boolean {
	return (
		isEventEligibleSource(sourceId) ||
		SINGLE_SOURCE_NEWS_EVENT_FAMILIES.has(sourceFamilyId(sourceId))
	);
}

function independentSourceCount(
	items: Pick<CurrentItemRow, "sourceId">[]
): number {
	return new Set(items.map((item) => sourceFamilyId(item.sourceId))).size;
}

function normalizeUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			if (
				key.startsWith("utm_") ||
				key === "fbclid" ||
				key === "gclid" ||
				key === "ref"
			) {
				url.searchParams.delete(key);
			}
		}
		return `${url.hostname.replace(LEADING_WWW_RE, "")}${url.pathname}`.replace(
			TRAILING_SLASH_RE,
			""
		);
	} catch {
		return value.trim().toLowerCase();
	}
}

function keywordsForText(text: string): Set<string> {
	const words =
		text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? [];
	const stop = new Set([
		"the",
		"and",
		"for",
		"with",
		"from",
		"that",
		"this",
		"into",
		"over",
		"after",
		"about",
		"will",
		"new",
		"news",
		"how",
		"are",
		"what",
		"why",
	]);
	const keywords = new Set(
		words.filter((word) => !stop.has(word)).slice(0, 28)
	);
	const hanChunks = text.match(HAN_TEXT_RE) ?? [];
	for (const chunk of hanChunks) {
		for (let index = 0; index < chunk.length - 1; index += 1) {
			keywords.add(chunk.slice(index, index + 2));
			if (keywords.size >= 80) {
				return keywords;
			}
		}
	}
	return keywords;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	const length = Math.min(a.length, b.length);
	let dot = 0;
	let aNorm = 0;
	let bNorm = 0;
	for (let i = 0; i < length; i += 1) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		aNorm += av * av;
		bNorm += bv * bv;
	}
	return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm) || 1);
}

function hasKeywordOverlap(a: Set<string>, b: Set<string>): boolean {
	for (const word of a) {
		if (b.has(word)) {
			return true;
		}
	}
	return false;
}

function keywordOverlapCount(a: Set<string>, b: Set<string>): number {
	let count = 0;
	for (const word of a) {
		if (b.has(word)) {
			count += 1;
		}
	}
	return count;
}

function keywordOverlapRatio(a: Set<string>, b: Set<string>): number {
	const base = Math.min(a.size, b.size);
	return base > 0 ? keywordOverlapCount(a, b) / base : 0;
}

function itemTime(item: CurrentItemRow): Date {
	return item.publishedAt ?? item.fetchedAt;
}

function isSameTimeWindow(
	item: CurrentItemRow,
	cluster: EventCluster
): boolean {
	const time = itemTime(item).getTime();
	return (
		time >= cluster.firstSeenAt.getTime() - EVENT_TIME_WINDOW_MS &&
		time <= cluster.lastSeenAt.getTime() + EVENT_TIME_WINDOW_MS
	);
}

function choosePrimary(a: CurrentItemRow, b: CurrentItemRow): CurrentItemRow {
	const aTime = itemTime(a).getTime();
	const bTime = itemTime(b).getTime();
	const aRankScore = itemRankScore(a);
	const bRankScore = itemRankScore(b);
	if (aRankScore !== bRankScore) {
		return aRankScore > bRankScore ? a : b;
	}
	const aHotScore = itemHotScore(a);
	const bHotScore = itemHotScore(b);
	if (aHotScore !== bHotScore) {
		return aHotScore > bHotScore ? a : b;
	}
	if (aTime !== bTime) {
		return aTime > bTime ? a : b;
	}
	return a.title.length >= b.title.length ? a : b;
}

function sourceQualityScore(sourceId: string): number {
	const preset = getSourcePreset(sourceId);
	if (!preset) {
		return 0;
	}
	let refreshScore = 4;
	if (preset.refresh === "hot") {
		refreshScore = 12;
	} else if (preset.refresh === "community") {
		refreshScore = 10;
	} else if (preset.refresh === "daily") {
		refreshScore = 8;
	} else if (preset.refresh === "rss") {
		refreshScore = 6;
	}
	let providerScore = 4;
	if (preset.provider === "native") {
		providerScore = 6;
	} else if (preset.provider === "rsshub") {
		providerScore = 5;
	}
	let audienceScore = 0;
	if (isConsumerTechNewsSource(sourceId)) {
		audienceScore = 10;
	} else if (isExpertEventSource(sourceId)) {
		audienceScore = -8;
	}
	return Math.max(0, refreshScore + providerScore + audienceScore);
}

function itemRankScore(item: Pick<CurrentItemRow, "rank">): number {
	if (item.rank <= 0) {
		return 0;
	}
	if (item.rank <= 3) {
		return 40 - item.rank * 3;
	}
	if (item.rank <= 10) {
		return 26 - item.rank;
	}
	if (item.rank <= 30) {
		return Math.max(0, 12 - Math.floor((item.rank - 10) / 2));
	}
	return 0;
}

function parseHotNumber(value: string | number | null): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.abs(value);
	}
	if (typeof value !== "string") {
		return 0;
	}
	const normalized = value.replaceAll(",", "").trim().toLowerCase();
	const match = normalized.match(HOT_NUMBER_RE);
	if (!match) {
		return normalized.includes("important") || normalized.includes("✰")
			? 100
			: 0;
	}
	let unit = 1;
	if (normalized.includes("亿") || normalized.includes("b")) {
		unit = 100_000_000;
	} else if (normalized.includes("万") || normalized.includes("m")) {
		unit = 10_000;
	} else if (normalized.includes("k")) {
		unit = 1000;
	}
	return Number.parseFloat(match[1] ?? "0") * unit;
}

function itemHotScore(item: Pick<CurrentItemRow, "hotValue">): number {
	const hot = parseHotNumber(item.hotValue);
	return hot > 0 ? Math.min(42, Math.round(Math.log10(hot + 1) * 8)) : 0;
}

function bestItemSignalScore(cluster: EventCluster): number {
	return Math.max(
		...cluster.items.map(
			(item) =>
				itemRankScore(item) +
				itemHotScore(item) +
				sourceQualityScore(item.sourceId)
		)
	);
}

function clusterPropagationScore(cluster: EventCluster): number {
	const uniqueSources = independentSourceCount(cluster.items);
	if (uniqueSources <= 1) {
		return 0;
	}
	const sourceScore = 52 + (uniqueSources - 2) * 24;
	const itemScore = Math.min(cluster.items.length - uniqueSources, 6) * 5;
	return sourceScore + itemScore;
}

function scoreCluster(cluster: EventCluster): number {
	const uniqueSources = independentSourceCount(cluster.items);
	const freshnessHours = Math.max(
		0,
		(Date.now() - cluster.lastSeenAt.getTime()) / 3_600_000
	);
	const freshnessScore = Math.max(0, 24 - freshnessHours / 2);
	const qualityScore =
		cluster.items.reduce(
			(total, item) =>
				total +
				itemRankScore(item) +
				itemHotScore(item) +
				sourceQualityScore(item.sourceId),
			0
		) / Math.max(1, cluster.items.length);
	const audiencePenalty =
		isExpertOnlyCluster(cluster) && !hasConsumerTechNewsSignal(cluster)
			? 36
			: 0;
	const audienceBoost = hasConsumerTechNewsSignal(cluster) ? 16 : 0;
	return Math.round(
		clusterPropagationScore(cluster) +
			Math.min(90, bestItemSignalScore(cluster)) +
			Math.min(45, qualityScore) +
			Math.min(24, freshnessScore) +
			(uniqueSources >= 2 ? 18 : 0) +
			audienceBoost -
			audiencePenalty
	);
}

function isFeedWorthyCluster(cluster: EventCluster): boolean {
	const uniqueSources = independentSourceCount(cluster.items);
	const score = scoreCluster(cluster);
	const bestRank = Math.min(...cluster.items.map((item) => item.rank));
	const hasNewsSignal = hasConsumerTechNewsSignal(cluster);
	const expertOnly = isExpertOnlyCluster(cluster);
	if (isLowValuePromotionCluster(cluster)) {
		return false;
	}
	if (expertOnly && !hasNewsSignal) {
		return false;
	}
	if (uniqueSources >= 2) {
		if (expertOnly && !hasConsumerTechNewsSource(cluster)) {
			return false;
		}
		return score >= (expertOnly ? 145 : 118);
	}
	if (!isSingleSourceEventSource(cluster.primary.sourceId)) {
		return false;
	}
	if (isExpertEventSource(cluster.primary.sourceId)) {
		return false;
	}
	if (!hasNewsSignal) {
		return false;
	}
	if (
		isExpertEventSource(cluster.primary.sourceId) &&
		(!hasTitleNewsSignal(cluster.primary) ||
			TECHNICAL_RESEARCH_TITLE_RE.test(cluster.primary.title))
	) {
		return false;
	}
	return (
		score >= (isExpertEventSource(cluster.primary.sourceId) ? 112 : 86) &&
		bestRank <= 15 &&
		cluster.primary.title.trim().length >= 18 &&
		!VERSION_TITLE_RE.test(cluster.primary.title.trim())
	);
}

function summarizeCluster(cluster: EventCluster): string | null {
	const descriptions = cluster.items
		.map((item) => item.description?.trim())
		.filter((value): value is string => Boolean(value));
	return descriptions[0]?.slice(0, 280) ?? null;
}

function makeEventId(seed: CurrentItemRow): string {
	return `event-${hashText(`${normalizeUrl(seed.url)}:${seed.contentHash}:${seed.title}`)}`;
}

function uniqueEventSourceItemRows(
	clusters: EventCluster[],
	createdAt: Date
): EventSourceItemInsert[] {
	const rows = new Map<string, EventSourceItemInsert>();
	for (const cluster of clusters) {
		for (const item of cluster.items) {
			const key = `${cluster.eventId}\u0000${item.sourceId}\u0000${item.itemId}`;
			const isPrimary =
				item.sourceId === cluster.primary.sourceId &&
				item.itemId === cluster.primary.itemId
					? 1
					: 0;
			const previous = rows.get(key);
			if (previous) {
				previous.isPrimary = Math.max(previous.isPrimary, isPrimary);
				previous.mergeConfidence = Math.max(
					previous.mergeConfidence,
					item.confidence
				);
				continue;
			}
			rows.set(key, {
				eventId: cluster.eventId,
				sourceId: item.sourceId,
				itemId: item.itemId,
				isPrimary,
				mergeConfidence: item.confidence,
				createdAt,
			});
		}
	}
	return [...rows.values()];
}

function findCluster(
	item: CurrentItemRow,
	keywords: Set<string>,
	clusters: EventCluster[]
): { cluster: EventCluster; confidence: number } | null {
	const url = normalizeUrl(item.url);
	for (const cluster of clusters) {
		if (
			cluster.items.some(
				(clusterItem) => clusterItem.sourceId === item.sourceId
			)
		) {
			continue;
		}
		if (cluster.urls.has(url)) {
			return { cluster, confidence: 100 };
		}
		if (cluster.contentHashes.has(item.contentHash)) {
			return { cluster, confidence: 100 };
		}
		if (
			!(item.embedding && cluster.vector && isSameTimeWindow(item, cluster))
		) {
			continue;
		}
		const similarity = cosineSimilarity(item.embedding, cluster.vector);
		const keywordMatches = keywordOverlapCount(keywords, cluster.keywords);
		const keywordRatio = keywordOverlapRatio(keywords, cluster.keywords);
		if (
			(similarity >= EVENT_SIMILARITY_THRESHOLD && keywordMatches >= 3) ||
			(similarity >= EVENT_STRONG_SIMILARITY_THRESHOLD &&
				hasKeywordOverlap(keywords, cluster.keywords)) ||
			(similarity >= EVENT_RELATED_SIMILARITY_THRESHOLD &&
				keywordMatches >= 8 &&
				keywordRatio >= 0.45)
		) {
			return {
				cluster,
				confidence: Math.round(Math.min(99, similarity * 100)),
			};
		}
	}
	return null;
}

function addToCluster(
	cluster: EventCluster,
	item: CurrentItemRow,
	keywords: Set<string>,
	confidence: number
): void {
	cluster.items.push({ ...item, confidence });
	cluster.urls.add(normalizeUrl(item.url));
	cluster.contentHashes.add(item.contentHash);
	for (const keyword of keywords) {
		cluster.keywords.add(keyword);
	}
	if (item.embedding) {
		cluster.vector =
			cluster.vector?.map(
				(value, index) => (value + (item.embedding?.[index] ?? 0)) / 2
			) ?? item.embedding;
	}
	if (itemTime(item).getTime() > cluster.lastSeenAt.getTime()) {
		cluster.lastSeenAt = itemTime(item);
	}
	if (itemTime(item).getTime() < cluster.firstSeenAt.getTime()) {
		cluster.firstSeenAt = itemTime(item);
	}
	cluster.primary = choosePrimary(cluster.primary, item);
}

async function readCurrentTopicItems(
	topicId: string
): Promise<CurrentItemRow[]> {
	const topic = getTopicPreset(topicId);
	if (!topic) {
		throw new TopicNotFoundError(topicId);
	}
	const sourceIds = [
		...new Set(topic.sections.flatMap((section) => section.sourceIds)),
	].filter(isEventEligibleSource);
	if (sourceIds.length === 0) {
		return [];
	}
	const sourceRows = await db
		.select({
			sourceId: source.sourceId,
			generation: source.generation,
		})
		.from(source)
		.where(inArray(source.sourceId, sourceIds));
	const predicates = sourceRows
		.filter((row) => row.generation > 0)
		.map((row) =>
			and(
				eq(sourceItem.sourceId, row.sourceId),
				eq(sourceItem.generation, row.generation)
			)
		);
	if (predicates.length === 0) {
		return [];
	}
	const cutoff = new Date(Date.now() - EVENT_LOOKBACK_MS);
	return db
		.select({
			sourceId: sourceItem.sourceId,
			itemId: sourceItem.itemId,
			url: sourceItem.url,
			title: sourceItem.title,
			description: sourceItem.description,
			contentHash: sourceItem.contentHash,
			contentText: sourceItem.contentText,
			hotValue: sourceItem.hotValue,
			rank: sourceItem.rank,
			publishedAt: sourceItem.publishedAt,
			fetchedAt: sourceItem.fetchedAt,
			embedding: sourceItemEmbedding.embedding,
			textHash: sourceItemEmbedding.textHash,
		})
		.from(sourceItem)
		.leftJoin(
			sourceItemEmbedding,
			and(
				eq(sourceItem.sourceId, sourceItemEmbedding.sourceId),
				eq(sourceItem.itemId, sourceItemEmbedding.itemId)
			)
		)
		.where(
			and(
				or(...predicates),
				sql`COALESCE(${sourceItem.publishedAt}, ${sourceItem.fetchedAt}) >= ${cutoff}`
			)
		)
		.orderBy(desc(sourceItem.publishedAt), desc(sourceItem.fetchedAt))
		.limit(EVENT_ITEM_LIMIT);
}

async function ensureEmbeddings(
	items: CurrentItemRow[]
): Promise<CurrentItemRow[]> {
	const model = getEventEmbeddingModel();
	const pending: Array<{ index: number; text: string; textHash: string }> = [];
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!item) {
			continue;
		}
		const text = buildCanonicalEmbeddingText({
			title: item.title,
			description: item.description,
			contentText: item.contentText,
			publishedAt: item.publishedAt,
			sourceName: sourceName(item.sourceId),
		});
		const textHash = hashText(text);
		if (item.embedding && item.textHash === textHash) {
			continue;
		}
		pending.push({ index, text, textHash });
	}
	if (pending.length === 0) {
		return items;
	}

	const embeddings = await embedTexts(pending.map((item) => item.text));
	const createdAt = new Date();
	for (let index = 0; index < pending.length; index += 1) {
		const pendingItem = pending[index];
		const embedding = embeddings[index];
		if (!(pendingItem && embedding)) {
			continue;
		}
		const item = items[pendingItem.index];
		if (!item) {
			continue;
		}
		item.embedding = embedding;
		item.textHash = pendingItem.textHash;
		await db
			.insert(sourceItemEmbedding)
			.values({
				sourceId: item.sourceId,
				itemId: item.itemId,
				textHash: pendingItem.textHash,
				embedding,
				model,
				createdAt,
			})
			.onConflictDoUpdate({
				target: [sourceItemEmbedding.sourceId, sourceItemEmbedding.itemId],
				set: {
					textHash: pendingItem.textHash,
					embedding,
					model,
					createdAt,
				},
			});
	}
	return items;
}

function clusterItems(items: CurrentItemRow[]): EventCluster[] {
	const clusters: EventCluster[] = [];
	const orderedItems = [...items].sort(
		(a, b) => itemTime(b).getTime() - itemTime(a).getTime()
	);
	for (const item of orderedItems) {
		const keywords = keywordsForText(
			`${item.title}\n${item.description ?? ""}\n${item.contentText ?? ""}`
		);
		const found = findCluster(item, keywords, clusters);
		if (found) {
			addToCluster(found.cluster, item, keywords, found.confidence);
			continue;
		}
		clusters.push({
			eventId: makeEventId(item),
			items: [{ ...item, confidence: 100 }],
			urls: new Set([normalizeUrl(item.url)]),
			contentHashes: new Set([item.contentHash]),
			keywords,
			vector: item.embedding,
			firstSeenAt: itemTime(item),
			lastSeenAt: itemTime(item),
			primary: item,
		});
	}
	return clusters
		.filter(isFeedWorthyCluster)
		.sort((a, b) => scoreCluster(b) - scoreCluster(a));
}

export async function rebuildTopicEvents(
	topicId: TopicId | string
): Promise<void> {
	let items: CurrentItemRow[];
	try {
		items = await readCurrentTopicItems(topicId);
	} catch (error) {
		if (error instanceof TopicNotFoundError) {
			throw error;
		}
		throw new TrendsSnapshotsUnavailableError(error);
	}
	const itemsWithEmbeddings = await ensureEmbeddings(items);
	const clusters = clusterItems(itemsWithEmbeddings);
	const now = new Date();
	const previousTopicEvents = await db
		.select({ eventId: trendEventTopic.eventId })
		.from(trendEventTopic)
		.where(eq(trendEventTopic.topicId, topicId));
	const previousEventIds = previousTopicEvents.map((event) => event.eventId);
	await db.transaction(async (tx) => {
		await tx
			.delete(trendEventTopic)
			.where(eq(trendEventTopic.topicId, topicId));
		await tx
			.delete(trendEventSourceItem)
			.where(sql`${trendEventSourceItem.eventId} IN (
			SELECT ${trendEvent.eventId}
			FROM ${trendEvent}
			WHERE ${trendEvent.topicId} = ${topicId}
				AND ${trendEvent.eventId} LIKE ${`${topicId}-%`}
		)`);
		await tx
			.delete(trendEvent)
			.where(
				and(
					eq(trendEvent.topicId, topicId),
					sql`${trendEvent.eventId} LIKE ${`${topicId}-%`}`
				)
			);
		for (const cluster of clusters) {
			const score = scoreCluster(cluster);
			await tx
				.insert(trendEvent)
				.values({
					eventId: cluster.eventId,
					topicId,
					title: cluster.primary.title,
					summary: summarizeCluster(cluster),
					score,
					sourceCount: independentSourceCount(cluster.items),
					firstSeenAt: cluster.firstSeenAt,
					lastSeenAt: cluster.lastSeenAt,
					primarySourceId: cluster.primary.sourceId,
					primaryItemId: cluster.primary.itemId,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: trendEvent.eventId,
					set: {
						topicId,
						title: cluster.primary.title,
						summary: summarizeCluster(cluster),
						score: sql`GREATEST(${trendEvent.score}, ${score})`,
						sourceCount: sql`GREATEST(${trendEvent.sourceCount}, ${independentSourceCount(cluster.items)})`,
						firstSeenAt: sql`LEAST(${trendEvent.firstSeenAt}, ${cluster.firstSeenAt})`,
						lastSeenAt: sql`GREATEST(${trendEvent.lastSeenAt}, ${cluster.lastSeenAt})`,
						primarySourceId: cluster.primary.sourceId,
						primaryItemId: cluster.primary.itemId,
						updatedAt: now,
					},
				});
		}
		if (clusters.length > 0) {
			await tx
				.insert(trendEventTopic)
				.values(
					clusters.map((cluster) => ({
						eventId: cluster.eventId,
						topicId,
						createdAt: now,
					}))
				)
				.onConflictDoNothing();
		}
		const eventSourceItemRows = uniqueEventSourceItemRows(clusters, now);
		if (eventSourceItemRows.length > 0) {
			await tx
				.insert(trendEventSourceItem)
				.values(eventSourceItemRows)
				.onConflictDoNothing();
		}
		if (previousEventIds.length > 0) {
			const linkedEvents = await tx
				.select({ eventId: trendEventTopic.eventId })
				.from(trendEventTopic)
				.where(inArray(trendEventTopic.eventId, previousEventIds));
			const linkedEventIds = new Set(
				linkedEvents.map((event) => event.eventId)
			);
			const orphanEventIds = previousEventIds.filter(
				(eventId) => !linkedEventIds.has(eventId)
			);
			if (orphanEventIds.length > 0) {
				await tx
					.delete(trendEventSourceItem)
					.where(inArray(trendEventSourceItem.eventId, orphanEventIds));
				await tx
					.delete(trendEvent)
					.where(inArray(trendEvent.eventId, orphanEventIds));
			}
		}
	});
}

interface EventFeedRow {
	eventId: string;
	firstSeenAt: Date;
	imageUrl: string | null;
	lastSeenAt: Date;
	primaryDescription: string | null;
	primaryItemId: string | null;
	primarySourceId: string | null;
	score: number;
	sourceCount: number;
	summary: string | null;
	title: string;
	topicId: string;
	topicIds?: string[];
	url: string | null;
}

function isLowValuePromotionFeedRow(row: EventFeedRow): boolean {
	return isLowValuePromotionText(
		`${row.title}\n${row.summary ?? ""}\n${row.primaryDescription ?? ""}`,
		row.primarySourceId
	);
}

function isLowValueSingleSourceFeedRow(row: EventFeedRow): boolean {
	if (row.sourceCount > 1) {
		return false;
	}
	const text = `${row.title}\n${row.summary ?? ""}\n${row.primaryDescription ?? ""}`;
	if (LOW_VALUE_SINGLE_SOURCE_RE.test(text) && row.score < 150) {
		return true;
	}
	if (row.score >= 135 || sourceSignalTier(row.primarySourceId) !== "t2") {
		return false;
	}
	return !CONSUMER_TECH_NEWS_RE.test(text);
}

function isLowValueEventFeedRow(row: EventFeedRow): boolean {
	return isLowValuePromotionFeedRow(row) || isLowValueSingleSourceFeedRow(row);
}

function getSelectionReason(
	row: EventFeedRow,
	sourceDiversity: number
): EventSelectionReason {
	const sourceTier = sourceSignalTier(row.primarySourceId);
	if (sourceTier === "t1") {
		return "official_source";
	}
	if (sourceDiversity > 1 || row.sourceCount > 1) {
		return "multiple_sources";
	}
	if (row.score >= 140) {
		return "high_score";
	}
	if (sourceTier === "t15") {
		return "strong_source";
	}
	return "selected";
}

function toFeedItem(
	row: EventFeedRow,
	sources: EventFeedItem["sources"],
	coverImageUrl?: string
): EventFeedItem {
	const imageUrl = row.imageUrl ?? coverImageUrl;
	const topicIds = row.topicIds ?? [row.topicId];
	return {
		eventId: row.eventId,
		topicId: row.topicId,
		topicIds,
		title: row.title,
		summary: row.summary ?? undefined,
		imageUrl: imageUrl ?? undefined,
		score: row.score,
		sources,
		sourceCount: row.sourceCount,
		firstSeenAt: row.firstSeenAt.toISOString(),
		lastSeenAt: row.lastSeenAt.toISOString(),
		primarySource:
			row.primarySourceId && row.url
				? {
						sourceId: row.primarySourceId,
						title: sourceName(row.primarySourceId),
						url: row.url,
						imageUrl: imageUrl ?? undefined,
					}
				: undefined,
		selectionReason: getSelectionReason(row, sources.length),
	};
}

function readEventFeedRows(
	topicId?: string,
	limit = EVENT_FEED_DEFAULT_LIMIT,
	offset = 0
): Promise<EventFeedRow[]> {
	const eventSourceIds = getEventEligibleSourceIds();
	const query = db
		.select({
			eventId: trendEvent.eventId,
			topicId: trendEvent.topicId,
			title: trendEvent.title,
			summary: trendEvent.summary,
			score: trendEvent.score,
			sourceCount: trendEvent.sourceCount,
			firstSeenAt: trendEvent.firstSeenAt,
			lastSeenAt: trendEvent.lastSeenAt,
			primarySourceId: trendEvent.primarySourceId,
			primaryItemId: trendEvent.primaryItemId,
			primaryDescription: sourceItem.description,
			url: sourceItem.url,
			imageUrl: sourceItem.imageUrl,
		})
		.from(trendEvent)
		.leftJoin(
			sourceItem,
			and(
				eq(trendEvent.primarySourceId, sourceItem.sourceId),
				eq(trendEvent.primaryItemId, sourceItem.itemId)
			)
		)
		.$dynamic();
	const eventSourcePredicate = inArray(
		trendEvent.primarySourceId,
		eventSourceIds
	);
	const filteredQuery = topicId
		? query
				.innerJoin(
					trendEventTopic,
					eq(trendEvent.eventId, trendEventTopic.eventId)
				)
				.where(and(eq(trendEventTopic.topicId, topicId), eventSourcePredicate))
		: query.where(
				and(
					eventSourcePredicate,
					sql`EXISTS (
						SELECT 1
						FROM ${trendEventTopic}
						WHERE ${trendEventTopic.eventId} = ${trendEvent.eventId}
					)`
				)
			);
	return filteredQuery
		.orderBy(
			desc(trendEvent.firstSeenAt),
			desc(trendEvent.lastSeenAt),
			desc(trendEvent.eventId)
		)
		.limit(limit)
		.offset(offset);
}

async function readEventTopicIds(
	eventIds: string[]
): Promise<Map<string, string[]>> {
	if (eventIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({
			eventId: trendEventTopic.eventId,
			topicId: trendEventTopic.topicId,
		})
		.from(trendEventTopic)
		.where(inArray(trendEventTopic.eventId, eventIds));
	const topics = new Map<string, string[]>();
	for (const row of rows) {
		const topicIds = topics.get(row.eventId) ?? [];
		topicIds.push(row.topicId);
		topics.set(row.eventId, topicIds);
	}
	for (const topicIds of topics.values()) {
		topicIds.sort();
	}
	return topics;
}

async function prepareEventFeedTopicSources(
	topicId: string | undefined,
	waitUntil: ((promise: Promise<unknown>) => void) | undefined
): Promise<void> {
	if (!topicId) {
		return;
	}
	if (!getTopicPreset(topicId)) {
		throw new TopicNotFoundError(topicId);
	}
	await refreshExpiredTopicSourcesInBackground(topicId, waitUntil);
}

async function readEventCoverImages(
	eventIds: string[]
): Promise<Map<string, string>> {
	if (eventIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({
			eventId: trendEventSourceItem.eventId,
			imageUrl: sourceItem.imageUrl,
		})
		.from(trendEventSourceItem)
		.innerJoin(
			sourceItem,
			and(
				eq(trendEventSourceItem.sourceId, sourceItem.sourceId),
				eq(trendEventSourceItem.itemId, sourceItem.itemId)
			)
		)
		.where(
			and(
				inArray(trendEventSourceItem.eventId, eventIds),
				isNotNull(sourceItem.imageUrl)
			)
		)
		.orderBy(
			desc(trendEventSourceItem.isPrimary),
			desc(sourceItem.publishedAt)
		);
	const images = new Map<string, string>();
	for (const row of rows) {
		if (row.imageUrl && !images.has(row.eventId)) {
			images.set(row.eventId, row.imageUrl);
		}
	}
	return images;
}

async function readEventFeedSources(
	eventIds: string[]
): Promise<Map<string, EventFeedItem["sources"]>> {
	if (eventIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({
			eventId: trendEventSourceItem.eventId,
			sourceId: trendEventSourceItem.sourceId,
			isPrimary: trendEventSourceItem.isPrimary,
		})
		.from(trendEventSourceItem)
		.where(inArray(trendEventSourceItem.eventId, eventIds))
		.orderBy(
			desc(trendEventSourceItem.isPrimary),
			desc(trendEventSourceItem.mergeConfidence)
		);
	const sourcesByEvent = new Map<string, EventFeedItem["sources"]>();
	const seenByEvent = new Map<string, Set<string>>();
	for (const row of rows) {
		const seen = seenByEvent.get(row.eventId) ?? new Set<string>();
		if (seen.has(row.sourceId)) {
			continue;
		}
		seen.add(row.sourceId);
		seenByEvent.set(row.eventId, seen);
		const preset = getSourcePreset(row.sourceId);
		const eventSources = sourcesByEvent.get(row.eventId) ?? [];
		eventSources.push({
			sourceId: row.sourceId,
			title: preset?.name ?? row.sourceId,
			homeUrl: preset && "homeUrl" in preset ? preset.homeUrl : undefined,
		});
		sourcesByEvent.set(row.eventId, eventSources);
	}
	return sourcesByEvent;
}

function getEventFeedNextOffset({
	limit,
	offset,
	readLimit,
	rowsLength,
	visibleRows,
}: {
	limit: number;
	offset: number;
	readLimit: number;
	rowsLength: number;
	visibleRows: Array<{ index: number; row: EventFeedRow }>;
}): number | undefined {
	if (visibleRows.length > limit) {
		return offset + (visibleRows[limit]?.index ?? limit);
	}
	if (rowsLength === readLimit) {
		return offset + rowsLength;
	}
	return;
}

export async function getEventFeed(
	topicId?: string,
	options: {
		lang?: TranslationLanguage;
		limit?: number;
		offset?: number;
		translationMode?: TranslationMode;
		waitUntil?: (promise: Promise<unknown>) => void;
	} = {}
): Promise<EventFeedResponse> {
	assertEventEmbeddingConfigured();
	await prepareEventFeedTopicSources(topicId, options.waitUntil);
	const limit = Math.min(
		Math.max(options.limit ?? EVENT_FEED_DEFAULT_LIMIT, 1),
		EVENT_FEED_MAX_LIMIT
	);
	const offset = Math.max(options.offset ?? 0, 0);
	const readLimit = limit + 25;
	let rows = await readEventFeedRows(topicId, readLimit, offset);
	if (rows.length === 0 && offset === 0) {
		if (topicId) {
			await rebuildTopicEvents(topicId);
		} else {
			for (const id of getAllTopicIds()) {
				await rebuildTopicEvents(id);
			}
		}
		rows = await readEventFeedRows(topicId, readLimit, offset);
	}
	const visibleRows = rows
		.map((row, index) => ({ index, row }))
		.filter(({ row }) => !isLowValueEventFeedRow(row));
	const pageEntries = visibleRows.slice(0, limit);
	const pageRows = pageEntries.map(({ row }) => row);
	const nextOffset = getEventFeedNextOffset({
		limit,
		offset,
		readLimit,
		rowsLength: rows.length,
		visibleRows,
	});
	const topicIdsByEvent = await readEventTopicIds(
		pageRows.map((row) => row.eventId)
	);
	for (const row of pageRows) {
		row.topicIds = topicIdsByEvent.get(row.eventId) ?? [row.topicId];
	}
	const coverImages = await readEventCoverImages(
		pageRows.map((row) => row.eventId)
	);
	const sourcesByEvent = await readEventFeedSources(
		pageRows.map((row) => row.eventId)
	);
	const events = pageRows.map((row) =>
		toFeedItem(
			row,
			sourcesByEvent.get(row.eventId) ?? [],
			coverImages.get(row.eventId)
		)
	);
	if (options.lang) {
		const translationItems = await translateNewsItems(
			events.map((event, index) => {
				const row = pageRows[index];
				return {
					description: event.summary,
					fetchedAt: Date.now(),
					id: row?.primaryItemId ?? event.eventId,
					sourceId: row?.primarySourceId ?? `event:${event.topicId}`,
					title: event.title,
					url: event.primarySource?.url ?? "",
				};
			}),
			options.lang,
			options.translationMode
		);
		for (let index = 0; index < events.length; index += 1) {
			const event = events[index];
			const translated = translationItems[index];
			if (event && translated?.original) {
				event.title = translated.title;
				event.summary = translated.description;
				event.original = {
					title: translated.original.title,
					summary: translated.original.description,
				};
			}
		}
	}
	return {
		events,
		nextOffset,
	};
}

export async function getEventDetail(
	eventId: string,
	topicId?: string,
	options: {
		lang?: TranslationLanguage;
		translationMode?: TranslationMode;
	} = {}
): Promise<EventDetailResponse | null> {
	assertEventEmbeddingConfigured();
	if (topicId && !getTopicPreset(topicId)) {
		throw new TopicNotFoundError(topicId);
	}
	const eventSelection = {
		eventId: trendEvent.eventId,
		topicId: trendEvent.topicId,
		title: trendEvent.title,
		summary: trendEvent.summary,
		score: trendEvent.score,
		firstSeenAt: trendEvent.firstSeenAt,
		lastSeenAt: trendEvent.lastSeenAt,
	};
	const eventRows = topicId
		? await db
				.select(eventSelection)
				.from(trendEvent)
				.innerJoin(
					trendEventTopic,
					eq(trendEvent.eventId, trendEventTopic.eventId)
				)
				.where(
					and(
						eq(trendEventTopic.topicId, topicId),
						eq(trendEvent.eventId, eventId)
					)
				)
				.limit(1)
		: await db
				.select(eventSelection)
				.from(trendEvent)
				.where(eq(trendEvent.eventId, eventId))
				.limit(1);
	const event = eventRows[0];
	if (!event) {
		return null;
	}
	const items = await db
		.select({
			sourceId: trendEventSourceItem.sourceId,
			itemId: trendEventSourceItem.itemId,
			isPrimary: trendEventSourceItem.isPrimary,
			mergeConfidence: trendEventSourceItem.mergeConfidence,
			title: sourceItem.title,
			description: sourceItem.description,
			url: sourceItem.url,
			imageUrl: sourceItem.imageUrl,
			hotValue: sourceItem.hotValue,
			rank: sourceItem.rank,
			publishedAt: sourceItem.publishedAt,
			fetchedAt: sourceItem.fetchedAt,
			contentFetchedAt: sourceItem.contentFetchedAt,
			contentStatus: sourceItem.contentStatus,
			embedding: sourceItemEmbedding.embedding,
			embeddingModel: sourceItemEmbedding.model,
			textHash: sourceItemEmbedding.textHash,
		})
		.from(trendEventSourceItem)
		.innerJoin(
			sourceItem,
			and(
				eq(trendEventSourceItem.sourceId, sourceItem.sourceId),
				eq(trendEventSourceItem.itemId, sourceItem.itemId)
			)
		)
		.leftJoin(
			sourceItemEmbedding,
			and(
				eq(trendEventSourceItem.sourceId, sourceItemEmbedding.sourceId),
				eq(trendEventSourceItem.itemId, sourceItemEmbedding.itemId)
			)
		)
		.where(eq(trendEventSourceItem.eventId, eventId))
		.orderBy(desc(trendEventSourceItem.isPrimary), desc(sourceItem.publishedAt))
		.limit(EVENT_DETAIL_SOURCE_LIMIT);
	const uniqueSourceCount = new Set(
		items.map((item) => sourceFamilyId(item.sourceId))
	).size;
	const embeddedCount = items.filter((item) => item.embedding).length;
	const enrichedCount = items.filter(
		(item) => item.contentStatus === "ok" || item.contentFetchedAt
	).length;
	const sourceScore =
		uniqueSourceCount > 1 ? 52 + (uniqueSourceCount - 2) * 24 : 0;
	const itemScore = Math.max(
		0,
		...items.map(
			(item) =>
				itemRankScore(item) +
				itemHotScore(item) +
				sourceQualityScore(item.sourceId)
		)
	);
	const translatedItems = options.lang
		? await translateNewsItems(
				items.map((item) => ({
					description: item.description ?? undefined,
					fetchedAt: item.fetchedAt.getTime(),
					id: item.itemId,
					imageUrl: item.imageUrl ?? undefined,
					publishedAt: item.publishedAt?.getTime(),
					sourceId: item.sourceId,
					title: item.title,
					url: item.url,
				})),
				options.lang,
				options.translationMode
			)
		: [];
	const primaryIndex = items.findIndex((item) => item.isPrimary === 1);
	const primaryTranslation =
		primaryIndex >= 0 ? translatedItems[primaryIndex] : undefined;
	return {
		eventId: event.eventId,
		topicId: topicId ?? event.topicId,
		title: primaryTranslation?.original
			? primaryTranslation.title
			: event.title,
		summary: primaryTranslation?.original
			? primaryTranslation.description
			: (event.summary ?? undefined),
		original: primaryTranslation?.original
			? {
					title: primaryTranslation.original.title,
					summary: primaryTranslation.original.description,
				}
			: undefined,
		score: event.score,
		firstSeenAt: event.firstSeenAt.toISOString(),
		lastSeenAt: event.lastSeenAt.toISOString(),
		processing: {
			embeddedItemCount: embeddedCount,
			embeddingModel: getEventEmbeddingModel(),
			enrichedItemCount: enrichedCount,
			inputItemCount: items.length,
			itemLimit: EVENT_ITEM_LIMIT,
			lookbackHours: EVENT_LOOKBACK_MS / 3_600_000,
			mergeRules: {
				similarityThreshold: EVENT_SIMILARITY_THRESHOLD,
				timeWindowHours: EVENT_TIME_WINDOW_MS / 3_600_000,
			},
			scoreInputs: {
				itemScore,
				sourceScore,
				uniqueSourceCount,
			},
			steps: [
				{
					label: "Read current source snapshots",
					status: "done",
					detail: `${items.length} linked source items from ${uniqueSourceCount} sources are attached to this event.`,
				},
				{
					label: "Extract article content",
					status: enrichedCount > 0 ? "done" : "pending",
					detail: `${enrichedCount}/${items.length} items have extracted content or a completed content fetch.`,
				},
				{
					label: "Create embeddings",
					status: embeddedCount > 0 ? "done" : "pending",
					detail: `${embeddedCount}/${items.length} items have ${getEventEmbeddingModel()} vectors.`,
				},
				{
					label: "Merge into event cluster",
					status: "done",
					detail: `Items merge by exact URL/content hash, or vector similarity >= ${EVENT_SIMILARITY_THRESHOLD} inside ${EVENT_TIME_WINDOW_MS / 3_600_000}h with keyword overlap.`,
				},
				{
					label: "Choose primary item and score",
					status: "done",
					detail: `Primary item drives the title/source. Score ${event.score} includes ${sourceScore} source points and ${itemScore} item points plus freshness.`,
				},
			],
		},
		sourceItems: items.map((item, index) => ({
			sourceId: item.sourceId,
			itemId: item.itemId,
			title: translatedItems[index]?.original
				? (translatedItems[index]?.title ?? item.title)
				: item.title,
			description: translatedItems[index]?.original
				? translatedItems[index]?.description
				: (item.description ?? undefined),
			url: item.url,
			imageUrl: item.imageUrl ?? undefined,
			contentFetchedAt: item.contentFetchedAt?.toISOString(),
			contentStatus: item.contentStatus,
			embeddingModel: item.embeddingModel ?? undefined,
			hasEmbedding: Boolean(item.embedding),
			publishedAt: item.publishedAt?.toISOString(),
			isPrimary: item.isPrimary === 1,
			mergeConfidence: item.mergeConfidence,
			original: translatedItems[index]?.original
				? {
						title: translatedItems[index].original.title,
						description: translatedItems[index].original.description,
					}
				: undefined,
			textHash: item.textHash ?? undefined,
		})),
	};
}
