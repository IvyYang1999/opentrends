interface LogoProps {
	className?: string;
	showWordmark?: boolean;
}

export default function Logo({ className, showWordmark = true }: LogoProps) {
	return (
		<span
			className={`inline-flex h-5 select-none items-center gap-1.5 align-middle leading-none ${className ?? ""}`}
		>
			<img
				alt=""
				aria-hidden="true"
				className="h-[18px] w-[18px] shrink-0"
				height={18}
				src="/logo-mark.svg"
				width={18}
			/>
			{showWordmark ? (
				<span className="inline-flex h-[18px] -translate-y-px items-center font-semibold text-[14px] text-[var(--text-primary)] leading-none tracking-tight">
					Open<span className="text-[var(--accent-blue)]">Trends</span>
				</span>
			) : null}
		</span>
	);
}
