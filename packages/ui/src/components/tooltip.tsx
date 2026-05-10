"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@opentrends/ui/lib/utils";

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipPortal({ ...props }: TooltipPrimitive.Portal.Props) {
	return <TooltipPrimitive.Portal data-slot="tooltip-portal" {...props} />;
}

function TooltipPositioner({
	className,
	sideOffset = 6,
	...props
}: TooltipPrimitive.Positioner.Props) {
	return (
		<TooltipPrimitive.Positioner
			className={cn("z-50 outline-none", className)}
			data-slot="tooltip-positioner"
			sideOffset={sideOffset}
			{...props}
		/>
	);
}

function TooltipPopup({ className, ...props }: TooltipPrimitive.Popup.Props) {
	return (
		<TooltipPrimitive.Popup
			className={cn(
				"max-w-[min(320px,92vw)] rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)] shadow-xl outline-none",
				className
			)}
			data-slot="tooltip-popup"
			{...props}
		/>
	);
}

export {
	Tooltip,
	TooltipPopup,
	TooltipPortal,
	TooltipPositioner,
	TooltipTrigger,
};
