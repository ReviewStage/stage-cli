import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getShortcutsByGroup, KEYBOARD_SHORTCUTS, SHORTCUT_KEY } from "@/lib/keyboard-shortcuts";
import { useIsMac } from "@/lib/use-is-mac";
import { ShortcutLabel } from "./shortcut-label";

export function KeyboardShortcutsDialog() {
	const [open, setOpen] = useState(false);
	const isMac = useIsMac();

	const shortcut = KEYBOARD_SHORTCUTS[SHORTCUT_KEY.SHOW_SHORTCUTS];

	useHotkeys(shortcut.hotkey, () => setOpen((prev) => !prev), {
		preventDefault: true,
		...shortcut.hotkeyOptions,
	});

	const groups = getShortcutsByGroup();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
				</DialogHeader>
				<div className="space-y-5">
					{[...groups.entries()].map(([group, shortcuts]) => (
						<div key={group}>
							<h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
								{group}
							</h3>
							<div className="space-y-1">
								{shortcuts.map(({ key, entry }) => {
									const platform = isMac ? entry.mac : entry.nonMac;
									return (
										<div
											key={key}
											className="flex items-center justify-between rounded-md px-2 py-1.5"
										>
											<span className="text-sm">{entry.description}</span>
											<ShortcutLabel label={platform.label} />
										</div>
									);
								})}
							</div>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
