"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@opentrends/ui/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
	return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

function PopoverPositioner({
	className,
	sideOffset = 6,
	...props
}: PopoverPrimitive.Positioner.Props) {
	return (
		<PopoverPrimitive.Positioner
			className={cn("z-50 outline-none", className)}
			data-slot="popover-positioner"
			sideOffset={sideOffset}
			{...props}
		/>
	);
}

function PopoverPopup({ className, ...props }: PopoverPrimitive.Popup.Props) {
	return (
		<PopoverPrimitive.Popup
			className={cn(
				"max-w-[min(360px,92vw)] overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl outline-none",
				className
			)}
			data-slot="popover-popup"
			{...props}
		/>
	);
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
	return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export {
	Popover,
	PopoverClose,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
	PopoverTrigger,
};
