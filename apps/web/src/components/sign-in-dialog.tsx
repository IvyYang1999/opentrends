import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@opentrends/ui/components/dialog";

import { useT } from "@/lib/i18n";

import Logo from "./logo";
import { SocialSignIn } from "./social-sign-in";

interface SignInDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

// Signing in only unlocks cross-device sync of source preferences, so it is
// a small dialog over the page the reader is on, not a page of its own.
export function SignInDialog({ onOpenChange, open }: SignInDialogProps) {
	const t = useT();
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="w-[min(360px,92vw)]">
				<DialogHeader>
					<Logo showWordmark={false} />
					<DialogTitle>{t("sign.dialogTitle")}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<DialogDescription>{t("sign.dialogDescription")}</DialogDescription>
					<SocialSignIn />
					<p className="text-[11px] text-[var(--text-muted)]">
						{t("sign.dialogFootnote")}
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}
