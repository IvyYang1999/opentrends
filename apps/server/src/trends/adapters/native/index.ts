import type { NativeAdapterId, SourceAdapter } from "../../types";
import { crowdSupplyAdapter } from "./crowd-supply";
import { githubTrendingAdapter } from "./github-trending";
import { hackerNewsAdapter } from "./hacker-news";
import { juejinHotAdapter } from "./juejin-hot";
import { kickstarterAdapter } from "./kickstarter";
import { newsnowCnAdapter } from "./newsnow-cn";
import { productHuntAdapter } from "./producthunt";
import { qwenResearchAdapter } from "./qwen-research";
import { redditAdapter } from "./reddit";
import { zhihuHotAdapter } from "./zhihu-hot";

export const nativeAdapters: Record<NativeAdapterId, SourceAdapter> = {
	hackerNews: hackerNewsAdapter,
	githubTrending: githubTrendingAdapter,
	zhihuHot: zhihuHotAdapter,
	productHunt: productHuntAdapter,
	juejinHot: juejinHotAdapter,
	reddit: redditAdapter,
	qwenResearch: qwenResearchAdapter,
	crowdSupply: crowdSupplyAdapter,
	kickstarter: kickstarterAdapter,
	newsnowCn: newsnowCnAdapter,
};
