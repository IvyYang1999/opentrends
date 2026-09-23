// Geometry lifted from public/logo-mark.svg (1024×1024): the flame outline,
// reused as a poster motif.
export const FLAME_PATH =
	"M401.92 9.216A65.024 65.024 0 0 1 466.578286 8.045714c291.620571 135.460571 456.704 416.768 446.537143 651.995429-4.388571 98.816-39.716571 190.317714-108.251429 257.097143-68.608 66.852571-167.131429 105.910857-291.84 106.130285a379.318857 379.318857 0 0 1-402.432-363.300571v-0.585143a320.365714 320.365714 0 0 1 164.644571-288.182857 36.571429 36.571429 0 0 1 51.2 17.188571A366.08 366.08 0 0 0 400.091429 497.078857c36.132571-47.177143 52.809143-108.105143 52.297142-175.104-0.585143-79.725714-25.6-165.229714-67.584-238.006857A55.588571 55.588571 0 0 1 401.92 9.216z";

// Straight rays from a point just past the right edge, mid-height, fanning
// leftwards like the threads in the logo. Kept short so they read as a
// motif in the corner rather than a pattern over the whole poster.
export const RAY_LINES: { x1: number; y1: number; x2: number; y2: number }[] =
	Array.from({ length: 11 }, (_, index) => {
		const angle = ((150 + index * 6) * Math.PI) / 180;
		const length = 620;
		return {
			x1: 1080,
			y1: 512,
			x2: Math.round(1080 + Math.cos(angle) * length),
			y2: Math.round(512 - Math.sin(angle) * length),
		};
	});
