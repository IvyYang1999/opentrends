"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@opentrends/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			className={cn("fixed inset-0 z-50 bg-black/40", className)}
			data-slot="dialog-backdrop"
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: DialogPrimitive.Popup.Props & {
	showCloseButton?: boolean;
}) {
	return (
		<DialogPortal>
			<DialogBackdrop />
			<DialogPrimitive.Popup
				className={cn(
					"fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl outline-none max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92svh] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0",
					className
				)}
				data-slot="dialog-content"
				{...props}
			>
				{children}
				{showCloseButton ? (
					<DialogClose
						aria-label="Close"
						className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--state-hover-subtle)] hover:text-[var(--text-primary)]"
					>
						<XIcon className="size-3.5" />
					</DialogClose>
				) : null}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			className={cn(
				"truncate font-semibold text-[13px] text-[var(--text-heading)] tracking-tight",
				className
			)}
			data-slot="dialog-title"
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			className={cn("text-[12px] text-[var(--text-secondary)]", className)}
			data-slot="dialog-description"
			{...props}
		/>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 border-[var(--border-default)] border-b bg-[var(--surface-sidebar)] px-3 py-2 pr-9",
				className
			)}
			data-slot="dialog-header"
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogBackdrop,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
