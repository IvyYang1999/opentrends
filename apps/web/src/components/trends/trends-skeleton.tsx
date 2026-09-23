// Placeholders in the shape of what is coming, so a page that is still
// loading looks like the page and not like an empty screen with a spinner.
// Heights vary a little so the masonry does not read as a table.

const FEED_HEIGHTS = [
	"h-56",
	"h-72",
	"h-48",
	"h-64",
	"h-80",
	"h-52",
	"h-60",
	"h-72",
	"h-48",
	"h-64",
	"h-56",
	"h-80",
] as const;

function Block({ className }: { className: string }) {
	return (
		<div
			aria-hidden
			className={`animate-pulse rounded-sm bg-[var(--state-hover-subtle)] ${className}`}
		/>
	);
}

export function FeedSkeleton() {
	return (
		<div
			aria-busy
			className="grid grid-cols-2 gap-3 p-3 sm:p-4 md:grid-cols-4 xl:grid-cols-6"
		>
			{FEED_HEIGHTS.map((height, index) => (
				<div
					className="overflow-hidden border border-[var(--border-default)] bg-[var(--surface-card)]"
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					key={index}
				>
					<Block className={`${height} w-full rounded-none`} />
					<div className="flex items-center gap-2 px-3 py-2">
						<Block className="size-3.5 rounded-full" />
						<Block className="h-3 w-20" />
						<Block className="ml-auto h-3 w-10" />
					</div>
				</div>
			))}
		</div>
	);
}

const SOURCE_ROWS = [0, 1, 2, 3, 4, 5, 6] as const;
const SOURCE_CARDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function SourceGridSkeleton() {
	return (
		<div aria-busy className="min-w-0 bg-[var(--surface-app)]">
			<div className="h-10 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)]" />
			<div className="grid grid-cols-1 items-stretch sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
				{SOURCE_CARDS.map((card) => (
					<div
						className="h-[480px] border-[var(--border-default)] border-r border-b bg-[var(--surface-card)]"
						key={card}
					>
						<div className="flex items-center gap-2 border-[var(--border-default)] border-b px-3 py-2.5">
							<Block className="size-4 rounded-full" />
							<Block className="h-3.5 w-24" />
							<Block className="ml-auto h-3 w-12" />
						</div>
						{SOURCE_ROWS.map((row) => (
							<div className="flex gap-3 px-3 py-3" key={row}>
								<Block className="h-3 w-4" />
								<div className="flex-1 space-y-1.5">
									<Block className="h-3 w-full" />
									<Block className={row % 2 ? "h-3 w-2/3" : "h-3 w-1/2"} />
								</div>
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
