import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { load } from "cheerio";

import type { FetchContext, NewsItem, SourceAdapter } from "../../types";
import { createRssAdapter } from "../rss";
import {
	clampItems,
	cleanDescription,
	isValidUrl,
	normalizeText,
} from "../shared";

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const BAIDU_DATA_RE = /<!--s-data:(.*?)-->/s;
const BRACKETED_TITLE_RE = /^【([^】]*)】(.*)$/;
const IFENG_ALL_DATA_RE = /var\s+allData\s*=\s*(\{[\s\S]*?\});/;
const JIN10_VAR_RE = /^var\s+newest\s*=\s*/;
const KUAISHOU_STATE_RE = /window\.__APOLLO_STATE__\s*=\s*(\{.+?\});/;
const RELATIVE_DATE_RE = /(\d+)\s*(秒|分钟|分|小时|时|天|日)前/;
const TRAILING_SEMICOLONS_RE = /;*$/;

interface RawNewsItem {
	description?: string;
	hotValue?: false | number | string;
	id?: number | string;
	imageUrl?: string;
	publishedAt?: number | string;
	title?: string;
	url?: string;
}

type NewsnowFetcher = (ctx: FetchContext) => Promise<RawNewsItem[]>;

interface BaiduResponse {
	data?: {
		cards?: {
			content?: {
				desc?: string;
				isTop?: boolean;
				rawUrl?: string;
				word?: string;
			}[];
		}[];
	};
}

interface BilibiliHotSearchResponse {
	list?: {
		icon?: string;
		keyword?: string;
		show_name?: string;
	}[];
}

interface BilibiliVideoResponse {
	data?: {
		list?: {
			bvid?: string;
			desc?: string;
			owner?: { name?: string };
			pic?: string;
			pubdate?: number;
			stat?: {
				like?: number;
				view?: number;
			};
			title?: string;
		}[];
	};
}

interface CankaoxiaoxiResponse {
	list?: {
		data?: {
			id?: string;
			publishTime?: string;
			title?: string;
			url?: string;
		};
	}[];
}

interface ClsItem {
	brief?: string;
	ctime?: number;
	id?: number;
	is_ad?: number;
	shareurl?: string;
	title?: string;
}

interface ClsTelegraphResponse {
	data?: {
		roll_data?: ClsItem[];
	};
}

interface ClsDepthResponse {
	data?: {
		depth_list?: ClsItem[];
	};
}

interface ClsHotResponse {
	data?: ClsItem[];
}

interface CoolapkResponse {
	data?: {
		editor_title?: string;
		id?: string;
		message?: string;
		targetRow?: {
			subTitle?: string;
		};
		url?: string;
	}[];
}

interface DoubanResponse {
	items?: {
		card_subtitle?: string;
		id?: string;
		title?: string;
	}[];
}

interface DouyinResponse {
	data?: {
		word_list?: {
			hot_value?: string;
			sentence_id?: string;
			word?: string;
		}[];
	};
}

interface IqiyiResponse {
	items?: {
		video?: {
			data?: {
				desc?: string;
				description?: string;
				entity_id?: number;
				page_url?: string;
				showDate?: string;
				tag?: string;
				title?: string;
			}[];
		}[];
	}[];
}

interface Jin10Item {
	channel?: number[];
	data?: {
		content?: string;
		title?: string;
	};
	id?: string;
	important?: number;
	time?: string;
}

interface MktNewsResponse {
	data?: {
		data?: {
			content?: string;
			title?: string;
		};
		id?: string;
		important?: number;
		time?: string;
	}[];
}

interface NowcoderResponse {
	data?: {
		result?: {
			id?: string;
			title?: string;
			type?: number;
			uuid?: string;
		}[];
	};
}

interface QqVideoResponse {
	data?: {
		card?: {
			children_list?: {
				list?: {
					cards?: {
						id?: string;
						params?: {
							publish_date?: string;
							sub_title?: string;
							title?: string;
						};
					}[];
				};
			};
		};
	};
}

interface TencentResponse {
	data?: {
		tabs?: {
			articleList?: {
				desc?: string;
				id?: string;
				link_info?: { url?: string };
				title?: string;
			}[];
		}[];
	};
}

interface ThePaperResponse {
	data?: {
		hotNews?: {
			contId?: string;
			name?: string;
		}[];
	};
}

interface TiebaResponse {
	data?: {
		bang_topic?: {
			topic_list?: {
				topic_id?: string;
				topic_name?: string;
				topic_url?: string;
			}[];
		};
	};
}

interface ToutiaoResponse {
	data?: {
		ClusterIdStr?: string;
		Image?: { url?: string };
		LabelUri?: { url?: string };
		Title?: string;
	}[];
}

interface WallstreetcnItem {
	content_short?: string;
	content_text?: string;
	display_time?: number;
	id?: number;
	title?: string;
	type?: string;
	uri?: string;
}

interface WallstreetcnLiveResponse {
	data?: {
		items?: WallstreetcnItem[];
	};
}

interface WallstreetcnNewsResponse {
	data?: {
		items?: {
			resource?: WallstreetcnItem;
			resource_type?: string;
		}[];
	};
}

interface WallstreetcnHotResponse {
	data?: {
		day_items?: WallstreetcnItem[];
	};
}

interface XueqiuResponse {
	data?: {
		items?: {
			ad?: number;
			code?: string;
			exchange?: string;
			name?: string;
			percent?: number;
		}[];
	};
}

function md5(value: string): string {
	return createHash("md5").update(value).digest("hex");
}

function sha1(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}

function encodeBase64(value: string): string {
	return Buffer.from(value).toString("base64");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function resolveUrl(
	baseUrl: string,
	url: string | undefined
): string | undefined {
	if (!url) {
		return;
	}
	try {
		return new URL(url, baseUrl).toString();
	} catch {
		return;
	}
}

async function request(
	url: string,
	ctx: FetchContext,
	init: RequestInit = {}
): Promise<Response> {
	const headers = new Headers(
		init.headers as ConstructorParameters<typeof Headers>[0]
	);
	if (!headers.has("User-Agent")) {
		headers.set("User-Agent", BROWSER_USER_AGENT);
	}
	const response = await fetch(url, {
		...init,
		headers,
		signal: ctx.signal,
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	return response;
}

async function requestJson<T>(
	url: string,
	ctx: FetchContext,
	init: RequestInit = {}
): Promise<T> {
	const response = await request(url, ctx, {
		...init,
		headers: {
			Accept: "application/json, text/plain, */*",
			...init.headers,
		},
	});
	return (await response.json()) as T;
}

async function requestJsonPost<T>(
	url: string,
	ctx: FetchContext,
	body: Record<string, unknown>,
	init: RequestInit = {}
): Promise<T> {
	return await requestJson<T>(url, ctx, {
		...init,
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
}

async function requestText(
	url: string,
	ctx: FetchContext,
	init: RequestInit = {}
): Promise<string> {
	const response = await request(url, ctx, init);
	return await response.text();
}

function splitSetCookie(value: string | null): string[] {
	if (!value) {
		return [];
	}
	return value.split(/,(?=[^;]+?=)/g);
}

async function getCookieHeader(
	url: string,
	ctx: FetchContext
): Promise<string> {
	const response = await request(url, ctx);
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[];
	};
	const cookies =
		headers.getSetCookie?.() ?? splitSetCookie(headers.get("set-cookie"));
	return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function parsePublishedAt(
	value: number | string | undefined
): number | undefined {
	if (value === undefined || value === "") {
		return;
	}
	if (typeof value === "number") {
		return value > 1_000_000_000_000 ? value : value * 1000;
	}
	const text = normalizeText(value);
	if (!text) {
		return;
	}
	const numeric = Number(text);
	if (Number.isFinite(numeric)) {
		return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
	}
	const relative = RELATIVE_DATE_RE.exec(text);
	if (relative) {
		const amount = Number(relative[1]);
		const unit = relative[2];
		if (!unit) {
			return;
		}
		const multipliers: Record<string, number> = {
			秒: 1000,
			分: 60_000,
			分钟: 60_000,
			小时: 3_600_000,
			时: 3_600_000,
			天: 86_400_000,
			日: 86_400_000,
		};
		return Date.now() - amount * (multipliers[unit] ?? 0);
	}
	const normalized = text
		.replace(/[年月]/g, "-")
		.replace(/[日]/g, " ")
		.replace(/[时点]/g, ":")
		.replace(/[分]/g, "");
	const parsed = Date.parse(normalized);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function toNewsItems(
	rawItems: RawNewsItem[],
	sourceId: string,
	fetchedAt: number
): NewsItem[] {
	const items: NewsItem[] = [];
	for (let i = 0; i < rawItems.length; i++) {
		const raw = rawItems[i];
		if (!raw) {
			continue;
		}
		const title = normalizeText(raw.title);
		const url = raw.url;
		if (!(title && isValidUrl(url))) {
			continue;
		}
		const id = raw.id === undefined ? url : String(raw.id);
		const hotValue = raw.hotValue === false ? undefined : raw.hotValue;
		items.push({
			id,
			sourceId,
			title,
			url,
			rank: i + 1,
			hotValue,
			publishedAt: parsePublishedAt(raw.publishedAt),
			fetchedAt,
			description: cleanDescription(raw.description),
			imageUrl: isValidUrl(raw.imageUrl) ? raw.imageUrl : undefined,
		});
	}
	return clampItems(items);
}

async function fetchRssRaw(
	ctx: FetchContext,
	name: string,
	feedUrl: string
): Promise<RawNewsItem[]> {
	const adapter = createRssAdapter({
		feedUrl,
		name,
		provider: "rss",
		refresh: "rss",
	});
	const items = await adapter.fetch(ctx);
	return items.map((item) => ({
		description: item.description,
		id: item.id,
		imageUrl: item.imageUrl,
		publishedAt: item.publishedAt,
		title: item.title,
		url: item.url,
	}));
}

async function fetchBaidu(ctx: FetchContext): Promise<RawNewsItem[]> {
	const html = await requestText(
		"https://top.baidu.com/board?tab=realtime",
		ctx
	);
	const match = BAIDU_DATA_RE.exec(html);
	if (!match?.[1]) {
		return [];
	}
	const data = JSON.parse(match[1]) as BaiduResponse;
	const entries = data.data?.cards?.[0]?.content ?? [];
	return entries
		.filter((entry) => !entry.isTop)
		.map((entry) => ({
			description: entry.desc,
			id: entry.rawUrl,
			title: entry.word,
			url: entry.rawUrl,
		}));
}

async function fetchBilibiliHotSearch(
	ctx: FetchContext
): Promise<RawNewsItem[]> {
	const data = await requestJson<BilibiliHotSearchResponse>(
		"https://s.search.bilibili.com/main/hotword?limit=30",
		ctx
	);
	return (data.list ?? []).map((entry) => ({
		id: entry.keyword,
		imageUrl: entry.icon,
		title: entry.show_name,
		url: entry.keyword
			? `https://search.bilibili.com/all?keyword=${encodeURIComponent(entry.keyword)}`
			: undefined,
	}));
}

function formatWan(value: number | undefined): string | undefined {
	if (value === undefined) {
		return;
	}
	if (value >= 10_000) {
		return `${Math.floor(value / 10_000)}w+`;
	}
	return String(value);
}

async function fetchBilibiliVideos(
	ctx: FetchContext,
	url: string
): Promise<RawNewsItem[]> {
	const data = await requestJson<BilibiliVideoResponse>(url, ctx);
	return (data.data?.list ?? []).map((video) => {
		const views = formatWan(video.stat?.view);
		const likes = formatWan(video.stat?.like);
		const bits = [video.owner?.name];
		if (views) {
			bits.push(`${views}观看`);
		}
		if (likes) {
			bits.push(`${likes}点赞`);
		}
		return {
			description: video.desc,
			hotValue: bits.filter(Boolean).join(" · "),
			id: video.bvid,
			imageUrl: video.pic,
			publishedAt: video.pubdate ? video.pubdate * 1000 : undefined,
			title: video.title,
			url: video.bvid
				? `https://www.bilibili.com/video/${video.bvid}`
				: undefined,
		};
	});
}

async function fetchCankaoxiaoxi(ctx: FetchContext): Promise<RawNewsItem[]> {
	const channels = ["zhongguo", "guandian", "gj"];
	const responses = await Promise.all(
		channels.map((channel) =>
			requestJson<CankaoxiaoxiResponse>(
				`https://china.cankaoxiaoxi.com/json/channel/${channel}/list.json`,
				ctx
			)
		)
	);
	const items: RawNewsItem[] = [];
	for (const response of responses) {
		for (const item of response.list ?? []) {
			const data = item.data;
			items.push({
				id: data?.id,
				publishedAt: data?.publishTime,
				title: data?.title,
				url: data?.url,
			});
		}
	}
	return items.sort(
		(a, b) =>
			(parsePublishedAt(b.publishedAt) ?? 0) -
			(parsePublishedAt(a.publishedAt) ?? 0)
	);
}

async function fetchChongbuluoHot(ctx: FetchContext): Promise<RawNewsItem[]> {
	const baseUrl = "https://www.chongbuluo.com/";
	const html = await requestText(`${baseUrl}forum.php?mod=guide&view=hot`, ctx);
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const element of $(".bmw table tr").toArray()) {
		const title = normalizeText($(element).find(".common .xst").text());
		const url = resolveUrl(baseUrl, $(element).find(".common a").attr("href"));
		items.push({ description: title, id: url, title, url });
	}
	return items;
}

function clsSearchParams(): URLSearchParams {
	const params = new URLSearchParams({
		appName: "CailianpressWeb",
		os: "web",
		sv: "7.7.5",
	});
	params.sort();
	params.append("sign", md5(sha1(params.toString())));
	return params;
}

async function fetchClsTelegraph(ctx: FetchContext): Promise<RawNewsItem[]> {
	const url = `https://www.cls.cn/nodeapi/updateTelegraphList?${clsSearchParams()}`;
	const data = await requestJson<ClsTelegraphResponse>(url, ctx);
	return (data.data?.roll_data ?? [])
		.filter((item) => !item.is_ad)
		.map((item) => ({
			id: item.id,
			publishedAt: item.ctime ? item.ctime * 1000 : undefined,
			title: item.title ?? item.brief,
			url: item.id ? `https://www.cls.cn/detail/${item.id}` : item.shareurl,
		}));
}

async function fetchClsDepth(ctx: FetchContext): Promise<RawNewsItem[]> {
	const url = `https://www.cls.cn/v3/depth/home/assembled/1000?${clsSearchParams()}`;
	const data = await requestJson<ClsDepthResponse>(url, ctx);
	return (data.data?.depth_list ?? [])
		.sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0))
		.map((item) => ({
			id: item.id,
			publishedAt: item.ctime ? item.ctime * 1000 : undefined,
			title: item.title ?? item.brief,
			url: item.id ? `https://www.cls.cn/detail/${item.id}` : item.shareurl,
		}));
}

async function fetchClsHot(ctx: FetchContext): Promise<RawNewsItem[]> {
	const url = `https://www.cls.cn/v2/article/hot/list?${clsSearchParams()}`;
	const data = await requestJson<ClsHotResponse>(url, ctx);
	return (data.data ?? []).map((item) => ({
		id: item.id,
		title: item.title ?? item.brief,
		url: item.id ? `https://www.cls.cn/detail/${item.id}` : item.shareurl,
	}));
}

function coolapkDeviceId(): string {
	const lengths = [10, 6, 6, 6, 14];
	return lengths
		.map((length) => Math.random().toString(36).slice(2, length))
		.join("-");
}

function coolapkHeaders(): HeadersInit {
	const deviceId = coolapkDeviceId();
	const now = Math.round(Date.now() / 1000);
	const md5Now = md5(String(now));
	const source = `token://com.coolapk.market/c67ef5943784d09750dcfbb31020f0ab?${md5Now}$${deviceId}&com.coolapk.market`;
	const token = `${md5(encodeBase64(source))}${deviceId}0x${now.toString(16)}`;
	return {
		"User-Agent":
			"Dalvik/2.1.0 (Linux; U; Android 10; Redmi K30 5G MIUI/V12.0.3.0.QGICMXM) (#Build; Redmi; Redmi K30 5G; QKQ1.191222.002 test-keys; 10) +CoolMarket/11.0-2101202",
		"X-Api-Version": "11",
		"X-App-Code": "2101202",
		"X-App-Id": "com.coolapk.market",
		"X-App-Token": token,
		"X-App-Version": "11.0",
		"X-Requested-With": "XMLHttpRequest",
		"X-Sdk-Int": "29",
		"X-Sdk-Locale": "zh-CN",
	};
}

async function fetchCoolapk(ctx: FetchContext): Promise<RawNewsItem[]> {
	const url =
		"https://api.coolapk.com/v6/page/dataList?url=%2Ffeed%2FstatList%3FcacheExpires%3D300%26statType%3Dday%26sortField%3Ddetailnum%26title%3D%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&title=%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&subTitle=&page=1";
	const data = await requestJson<CoolapkResponse>(url, ctx, {
		headers: coolapkHeaders(),
	});
	return (data.data ?? []).map((item) => ({
		hotValue: item.targetRow?.subTitle,
		id: item.id,
		title:
			item.editor_title ||
			load(item.message ?? "")
				.text()
				.split("\n")[0],
		url: resolveUrl("https://www.coolapk.com", item.url),
	}));
}

async function fetchDouban(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<DoubanResponse>(
		"https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie",
		ctx,
		{
			headers: {
				Referer: "https://movie.douban.com/",
			},
		}
	);
	return (data.items ?? []).map((movie) => ({
		description: movie.card_subtitle,
		hotValue: movie.card_subtitle?.split(" / ").slice(0, 3).join(" / "),
		id: movie.id,
		title: movie.title,
		url: movie.id ? `https://movie.douban.com/subject/${movie.id}` : undefined,
	}));
}

async function fetchDouyin(ctx: FetchContext): Promise<RawNewsItem[]> {
	const cookie = await getCookieHeader("https://login.douyin.com/", ctx);
	const data = await requestJson<DouyinResponse>(
		"https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1",
		ctx,
		{
			headers: cookie ? { Cookie: cookie } : undefined,
		}
	);
	return (data.data?.word_list ?? []).map((item) => ({
		hotValue: item.hot_value,
		id: item.sentence_id,
		title: item.word,
		url: item.sentence_id
			? `https://www.douyin.com/hot/${item.sentence_id}`
			: undefined,
	}));
}

function parseFastbullItems(html: string, baseUrl: string): RawNewsItem[] {
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const element of $(".news-list, .trending_type").toArray()) {
		const $element = $(element);
		const link = $element.find(".title_name, .title").first();
		const href = link.attr("href") ?? $element.attr("href");
		const titleText = normalizeText(link.text());
		const bracketTitle = BRACKETED_TITLE_RE.exec(titleText)?.[1];
		const date =
			$element.attr("data-date") ??
			$element.find("[data-date]").attr("data-date");
		items.push({
			id: href,
			publishedAt: date,
			title: bracketTitle ?? titleText,
			url: resolveUrl(baseUrl, href),
		});
	}
	return items;
}

async function fetchFastbullExpress(ctx: FetchContext): Promise<RawNewsItem[]> {
	const baseUrl = "https://www.fastbull.com";
	const html = await requestText(`${baseUrl}/cn/express-news`, ctx);
	return parseFastbullItems(html, baseUrl);
}

async function fetchFastbullNews(ctx: FetchContext): Promise<RawNewsItem[]> {
	const baseUrl = "https://www.fastbull.com";
	const html = await requestText(`${baseUrl}/cn/news`, ctx);
	return parseFastbullItems(html, baseUrl);
}

async function fetchFreebuf(ctx: FetchContext): Promise<RawNewsItem[]> {
	const baseUrl = "https://www.freebuf.com";
	const html = await requestText(baseUrl, ctx, {
		headers: {
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
			Referer: `${baseUrl}/`,
		},
	});
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const element of $(".article-item").toArray()) {
		const article = $(element);
		const titleLink = article.find(".title-left .title").parent();
		const title = normalizeText(titleLink.find(".title").text());
		const url = resolveUrl(baseUrl, titleLink.attr("href"));
		const description = normalizeText(
			article.find(".item-right .text-line-2").text()
		);
		const imageUrl = article.find(".img-view img").attr("src");
		const id = url?.slice(url.lastIndexOf("/") + 1).replace(/\D/g, "");
		items.push({ description, id, imageUrl, title, url });
	}
	return items;
}

async function fetchGelonghui(ctx: FetchContext): Promise<RawNewsItem[]> {
	const baseUrl = "https://www.gelonghui.com";
	const html = await requestText(`${baseUrl}/news/`, ctx);
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const element of $(".article-content").toArray()) {
		const article = $(element);
		const link = article.find(".detail-right>a");
		const href = link.attr("href");
		const title = normalizeText(link.find("h2").text());
		const info = normalizeText(
			article.find(".time > span:nth-child(1)").text()
		);
		const publishedAt = normalizeText(
			article.find(".time > span:nth-child(3)").text()
		);
		items.push({
			hotValue: info,
			id: href,
			publishedAt,
			title,
			url: resolveUrl(baseUrl, href),
		});
	}
	return items;
}

async function fetchHupu(ctx: FetchContext): Promise<RawNewsItem[]> {
	const html = await requestText("https://bbs.hupu.com/topic-daily-hot", ctx);
	const regex =
		/<li class="bbs-sl-web-post-body">[\s\S]*?<a href="(\/[^"]+?\.html)"[^>]*?class="p-title"[^>]*>([^<]+)<\/a>/g;
	const items: RawNewsItem[] = [];
	for (const match of html.matchAll(regex)) {
		const path = match[1];
		const title = normalizeText(match[2]);
		items.push({
			id: path,
			title,
			url: resolveUrl("https://bbs.hupu.com", path),
		});
	}
	return items;
}

async function fetchIfeng(ctx: FetchContext): Promise<RawNewsItem[]> {
	const html = await requestText("https://www.ifeng.com/", ctx);
	const match = IFENG_ALL_DATA_RE.exec(html);
	if (!match?.[1]) {
		return [];
	}
	const data = JSON.parse(match[1]) as {
		hotNews1?: {
			newsTime?: string;
			title?: string;
			url?: string;
		}[];
	};
	return (data.hotNews1 ?? []).map((item) => ({
		id: item.url,
		publishedAt: item.newsTime,
		title: item.title,
		url: item.url,
	}));
}

async function fetchIqiyi(ctx: FetchContext): Promise<RawNewsItem[]> {
	const url =
		"https://mesh.if.iqiyi.com/portal/lw/v7/channel/card/videoTab?channelName=recommend&data_source=v7_rec_sec_hot_rank_list&tempId=85&count=30&block_id=hot_ranklist&device=14a4b5ba98e790dce6dc07482447cf48&from=webapp";
	const data = await requestJson<IqiyiResponse>(url, ctx, {
		headers: { Referer: "https://www.iqiyi.com" },
	});
	const list = data.items?.[0]?.video?.[0]?.data ?? [];
	return list.map((item) => ({
		description: item.description,
		hotValue: item.desc ?? item.tag,
		id: item.entity_id,
		publishedAt: item.showDate,
		title: item.title,
		url: item.page_url,
	}));
}

async function fetchJin10(ctx: FetchContext): Promise<RawNewsItem[]> {
	const raw = await requestText(
		`https://www.jin10.com/flash_newest.js?t=${Date.now()}`,
		ctx
	);
	const json = raw
		.replace(JIN10_VAR_RE, "")
		.replace(TRAILING_SEMICOLONS_RE, "")
		.trim();
	const data = JSON.parse(json) as Jin10Item[];
	return data
		.filter(
			(item) =>
				(item.data?.title || item.data?.content) && !item.channel?.includes(5)
		)
		.map((item) => {
			const text = (item.data?.title || item.data?.content || "").replace(
				/<\/?b>/g,
				""
			);
			const match = BRACKETED_TITLE_RE.exec(text);
			return {
				description: match?.[2],
				hotValue: item.important ? "✰" : undefined,
				id: item.id,
				publishedAt: item.time,
				title: match?.[1] ?? text,
				url: item.id ? `https://flash.jin10.com/detail/${item.id}` : undefined,
			};
		});
}

async function fetchKaopu(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<
		{
			description?: string;
			link?: string;
			pub_date?: string;
			publisher?: string;
			title?: string;
		}[]
	>(
		"https://kaopustorage.blob.core.windows.net/news-prod/news_list_hans_0.json",
		ctx
	);
	return data
		.filter((item) => !["财新", "公视"].includes(item.publisher ?? ""))
		.map((item) => ({
			description: item.description,
			hotValue: item.publisher,
			id: item.link,
			publishedAt: item.pub_date,
			title: item.title,
			url: item.link,
		}));
}

async function fetchKuaishou(ctx: FetchContext): Promise<RawNewsItem[]> {
	const html = await requestText("https://www.kuaishou.com/?isHome=1", ctx);
	const match = KUAISHOU_STATE_RE.exec(html);
	if (!match?.[1]) {
		return [];
	}
	const data = JSON.parse(match[1]) as {
		defaultClient?: Record<string, Record<string, unknown>>;
	};
	const client = data.defaultClient;
	const root = asRecord(client?.ROOT_QUERY);
	const hotRankRef = asRecord(root?.['visionHotRank({"page":"home"})']);
	const hotRankId =
		typeof hotRankRef?.id === "string" ? hotRankRef.id : undefined;
	if (!(client && hotRankId)) {
		return [];
	}
	const hotRank = asRecord(client[hotRankId]);
	const entries = Array.isArray(hotRank?.items) ? hotRank.items : [];
	const items: RawNewsItem[] = [];
	for (const entry of entries) {
		const entryRecord = asRecord(entry);
		if (typeof entryRecord?.id !== "string") {
			continue;
		}
		const id = entryRecord.id;
		const hotItem = asRecord(client[id]);
		if (hotItem?.tagType === "置顶") {
			continue;
		}
		const name = typeof hotItem?.name === "string" ? hotItem.name : "";
		items.push({
			id: id.replace("VisionHotRankItem:", ""),
			imageUrl:
				typeof hotItem?.iconUrl === "string" ? hotItem.iconUrl : undefined,
			title: name,
			url: `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(name)}`,
		});
	}
	return items;
}

async function fetchMktNews(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<MktNewsResponse>(
		"https://api.mktnews.net/api/flash?type=0&limit=50",
		ctx
	);
	return (data.data ?? [])
		.sort(
			(a, b) =>
				(parsePublishedAt(b.time) ?? 0) - (parsePublishedAt(a.time) ?? 0)
		)
		.map((item) => {
			const content = item.data?.content ?? "";
			const match = BRACKETED_TITLE_RE.exec(content);
			return {
				description: content,
				hotValue: item.important === 1 ? "Important" : undefined,
				id: item.id,
				publishedAt: item.time,
				title: item.data?.title || match?.[1] || content,
				url: item.id
					? `https://mktnews.net/flashDetail.html?id=${item.id}`
					: undefined,
			};
		});
}

async function fetchNowcoder(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<NowcoderResponse>(
		`https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc?size=20&_=${Date.now()}&t=`,
		ctx
	);
	const items: RawNewsItem[] = [];
	for (const item of data.data?.result ?? []) {
		if (item.type === 74 && item.uuid) {
			items.push({
				id: item.uuid,
				title: item.title,
				url: `https://www.nowcoder.com/feed/main/detail/${item.uuid}`,
			});
			continue;
		}
		if (item.type === 0 && item.id) {
			items.push({
				id: item.id,
				title: item.title,
				url: `https://www.nowcoder.com/discuss/${item.id}`,
			});
		}
	}
	return items;
}

async function fetchQqVideo(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJsonPost<QqVideoResponse>(
		"https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getCard?video_appid=3000010&vversion_platform=2",
		ctx,
		{
			flip_info: {
				flip_params: {
					folding_screen_show_num: "",
					hit_tab_info: null,
					is_mvl: "1",
					mvl_sub_mod_id: "20251106065177",
					page_id: "scms_shake",
					page_num: "0",
					page_type: "scms_shake",
					pad_post_show_num: "",
					pad_pro_post_show_num: "",
					pad_pro_small_hor_pic_display_num: "",
					pad_small_hor_pic_display_num: "",
					post_show_num: "",
					shake_size: "",
					source_key: "100113",
					un_policy_id: "06755800b45b49238582a6fa1ad0f5c5",
					un_strategy_id: "06755800b45b49238582a6fa1ad0f5c5",
				},
				module_strategy_id: {},
				page_module_id: "792ac_19e77",
				page_strategy_id: "",
				relace_children_key: [],
				sub_module_id: "20251106065177",
			},
			page_context: {
				page_index: "1",
			},
			page_params: {
				block_id: "hot_ranklist",
				data_source: "v7_rec_sec_hot_rank_list",
				from: "webapp",
				new_mark_label_enabled: "1",
				page_id: "scms_shake",
				page_type: "scms_shake",
				rank_channel_id: "100113",
				rank_name: "HotSearch",
				rank_page_size: "30",
				source_key: "",
				tab_mvl_sub_mod_id: "792ac_19e77Sub_1b2",
				tab_name: "热搜榜",
				tab_type: "hot_rank",
				tab_vl_data_src: "f5200deb4596bbf3",
				tag_id: "",
				tag_type: "",
			},
		},
		{
			headers: { Referer: "https://v.qq.com/" },
		}
	);
	const cards = data.data?.card?.children_list?.list?.cards ?? [];
	return cards.map((card) => ({
		description: card.params?.sub_title,
		id: card.id,
		publishedAt: card.params?.publish_date,
		title: card.params?.title,
		url: card.id ? `https://v.qq.com/x/cover/${card.id}.html` : undefined,
	}));
}

async function fetchSputnik(ctx: FetchContext): Promise<RawNewsItem[]> {
	const html = await requestText(
		"https://sputniknews.cn/services/widget/lenta/",
		ctx
	);
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const element of $(".lenta__item").toArray()) {
		const link = $(element).find("a");
		const href = link.attr("href");
		const title = normalizeText(link.find(".lenta__item-text").text());
		const publishedAt = link.find(".lenta__item-date").attr("data-unixtime");
		items.push({
			id: href,
			publishedAt: publishedAt ? Number(`${publishedAt}000`) : undefined,
			title,
			url: resolveUrl("https://sputniknews.cn", href),
		});
	}
	return items;
}

async function fetchTencent(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<TencentResponse>(
		"https://i.news.qq.com/web_backend/v2/getTagInfo?tagId=aEWqxLtdgmQ%3D",
		ctx,
		{
			headers: { Referer: "https://news.qq.com/" },
		}
	);
	return (data.data?.tabs?.[0]?.articleList ?? []).map((item) => ({
		description: item.desc,
		id: item.id,
		title: item.title,
		url: item.link_info?.url,
	}));
}

async function fetchThePaper(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<ThePaperResponse>(
		"https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar",
		ctx
	);
	return (data.data?.hotNews ?? []).map((item) => ({
		id: item.contId,
		title: item.name,
		url: item.contId
			? `https://www.thepaper.cn/newsDetail_forward_${item.contId}`
			: undefined,
	}));
}

async function fetchTieba(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<TiebaResponse>(
		"https://tieba.baidu.com/hottopic/browse/topicList",
		ctx
	);
	return (data.data?.bang_topic?.topic_list ?? []).map((item) => ({
		id: item.topic_id,
		title: item.topic_name,
		url: item.topic_url,
	}));
}

async function fetchToutiao(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<ToutiaoResponse>(
		"https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
		ctx
	);
	return (data.data ?? []).map((item) => ({
		id: item.ClusterIdStr,
		imageUrl: item.LabelUri?.url ?? item.Image?.url,
		title: item.Title,
		url: item.ClusterIdStr
			? `https://www.toutiao.com/trending/${item.ClusterIdStr}/`
			: undefined,
	}));
}

async function fetchWallstreetcnQuick(
	ctx: FetchContext
): Promise<RawNewsItem[]> {
	const data = await requestJson<WallstreetcnLiveResponse>(
		"https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=30",
		ctx
	);
	return (data.data?.items ?? []).map((item) => ({
		id: item.id,
		publishedAt: item.display_time ? item.display_time * 1000 : undefined,
		title: item.title || item.content_text,
		url: item.uri,
	}));
}

async function fetchWallstreetcnNews(
	ctx: FetchContext
): Promise<RawNewsItem[]> {
	const data = await requestJson<WallstreetcnNewsResponse>(
		"https://api-one.wallstcn.com/apiv1/content/information-flow?channel=global-channel&accept=article&limit=30",
		ctx
	);
	return (data.data?.items ?? [])
		.filter(
			(item) =>
				item.resource_type !== "theme" &&
				item.resource_type !== "ad" &&
				item.resource?.type !== "live" &&
				Boolean(item.resource?.uri)
		)
		.map(({ resource }) => ({
			id: resource?.id,
			publishedAt: resource?.display_time
				? resource.display_time * 1000
				: undefined,
			title: resource?.title || resource?.content_short,
			url: resource?.uri,
		}));
}

async function fetchWallstreetcnHot(ctx: FetchContext): Promise<RawNewsItem[]> {
	const data = await requestJson<WallstreetcnHotResponse>(
		"https://api-one.wallstcn.com/apiv1/content/articles/hot?period=all",
		ctx
	);
	return (data.data?.day_items ?? []).map((item) => ({
		id: item.id,
		title: item.title,
		url: item.uri,
	}));
}

async function fetchWeibo(ctx: FetchContext): Promise<RawNewsItem[]> {
	const url = "https://s.weibo.com/top/summary?cate=realtimehot";
	const html = await requestText(url, ctx, {
		headers: {
			Cookie:
				"SUB=_2AkMWIuNSf8NxqwJRmP8dy2rhaoV2ygrEieKgfhKJJRMxHRl-yT9jqk86tRB6PaLNvQZR6zYUcYVT1zSjoSreQHidcUq7",
			Referer: url,
		},
	});
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const row of $("#pl_top_realtimehot table tbody tr")
		.slice(1)
		.toArray()) {
		const link = $(row)
			.find("td.td-02 a")
			.filter((_, element) => {
				const href = $(element).attr("href");
				return Boolean(href && !href.includes("javascript:void(0);"));
			})
			.first();
		const title = normalizeText(link.text());
		const href = link.attr("href");
		const flag = normalizeText($(row).find("td.td-03").text());
		const flagUrls: Record<string, string> = {
			新: "https://simg.s.weibo.com/moter/flags/1_0.png",
			热: "https://simg.s.weibo.com/moter/flags/2_0.png",
			爆: "https://simg.s.weibo.com/moter/flags/4_0.png",
		};
		items.push({
			hotValue: flag || undefined,
			id: title,
			imageUrl: flagUrls[flag],
			title,
			url: resolveUrl("https://s.weibo.com", href),
		});
	}
	return items;
}

async function fetchXueqiu(ctx: FetchContext): Promise<RawNewsItem[]> {
	const cookie = await getCookieHeader("https://xueqiu.com/hq", ctx);
	const data = await requestJson<XueqiuResponse>(
		"https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=30&_type=10&type=10",
		ctx,
		{
			headers: cookie ? { Cookie: cookie } : undefined,
		}
	);
	return (data.data?.items ?? [])
		.filter((item) => !item.ad)
		.map((item) => ({
			hotValue:
				item.percent === undefined
					? item.exchange
					: `${item.percent}% ${item.exchange ?? ""}`.trim(),
			id: item.code,
			title: item.name,
			url: item.code ? `https://xueqiu.com/s/${item.code}` : undefined,
		}));
}

async function fetchZaobao(ctx: FetchContext): Promise<RawNewsItem[]> {
	const html = await requestText("https://www.zaobao.com/realtime/china", ctx);
	const $ = load(html);
	const items: RawNewsItem[] = [];
	for (const element of $("a[href]").toArray()) {
		const link = $(element);
		const title = normalizeText(link.text());
		const href = link.attr("href");
		if (title.length < 6 || !href?.includes("/realtime/")) {
			continue;
		}
		items.push({
			id: href,
			title,
			url: resolveUrl("https://www.zaobao.com", href),
		});
	}
	return items;
}

const fetchers = {
	baidu: fetchBaidu,
	"bilibili-hot-search": fetchBilibiliHotSearch,
	"bilibili-hot-video": (ctx) =>
		fetchBilibiliVideos(
			ctx,
			"https://api.bilibili.com/x/web-interface/popular"
		),
	"bilibili-ranking": (ctx) =>
		fetchBilibiliVideos(
			ctx,
			"https://api.bilibili.com/x/web-interface/ranking/v2"
		),
	cankaoxiaoxi: fetchCankaoxiaoxi,
	"chongbuluo-hot": fetchChongbuluoHot,
	"chongbuluo-latest": (ctx) =>
		fetchRssRaw(
			ctx,
			"虫部落 · 最新",
			"https://www.chongbuluo.com/forum.php?mod=rss&view=newthread"
		),
	"cls-depth": fetchClsDepth,
	"cls-hot": fetchClsHot,
	"cls-telegraph": fetchClsTelegraph,
	coolapk: fetchCoolapk,
	douban: fetchDouban,
	douyin: fetchDouyin,
	"fastbull-express": fetchFastbullExpress,
	"fastbull-news": fetchFastbullNews,
	freebuf: fetchFreebuf,
	gelonghui: fetchGelonghui,
	hupu: fetchHupu,
	ifeng: fetchIfeng,
	"iqiyi-hot-ranklist": fetchIqiyi,
	jin10: fetchJin10,
	kaopu: fetchKaopu,
	kuaishou: fetchKuaishou,
	"mktnews-flash": fetchMktNews,
	nowcoder: fetchNowcoder,
	"pcbeta-windows11": (ctx) =>
		fetchRssRaw(
			ctx,
			"远景论坛 · Win11",
			"https://bbs.pcbeta.com/forum.php?mod=rss&fid=563&auth=0"
		),
	"qqvideo-tv-hotsearch": fetchQqVideo,
	solidot: (ctx) =>
		fetchRssRaw(ctx, "Solidot", "https://www.solidot.org/index.rss"),
	sputniknewscn: fetchSputnik,
	"tencent-hot": fetchTencent,
	thepaper: fetchThePaper,
	tieba: fetchTieba,
	toutiao: fetchToutiao,
	"wallstreetcn-hot": fetchWallstreetcnHot,
	"wallstreetcn-news": fetchWallstreetcnNews,
	"wallstreetcn-quick": fetchWallstreetcnQuick,
	weibo: fetchWeibo,
	"xueqiu-hotstock": fetchXueqiu,
	zaobao: fetchZaobao,
} satisfies Record<string, NewsnowFetcher>;

export const newsnowCnAdapter: SourceAdapter = {
	async fetch(ctx: FetchContext): Promise<NewsItem[]> {
		const fetcher = fetchers[ctx.sourceId as keyof typeof fetchers];
		if (!fetcher) {
			throw new Error(`Unknown NewsNow CN source: ${ctx.sourceId}`);
		}
		const fetchedAt = Date.now();
		return toNewsItems(await fetcher(ctx), ctx.sourceId, fetchedAt);
	},
};
