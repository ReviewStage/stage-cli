import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { USER_THEME, type UserTheme, useTheme } from "@/lib/theme";

interface Option {
	value: UserTheme;
	label: string;
	icon: React.ElementType;
}

const OPTIONS: Option[] = [
	{ value: USER_THEME.LIGHT, label: "Light", icon: Sun },
	{ value: USER_THEME.DARK, label: "Dark", icon: Moon },
	{ value: USER_THEME.SYSTEM, label: "System", icon: Monitor },
];

export function ThemeToggle() {
	const { userTheme, setTheme } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm">
					<Sun className="h-4 w-4 dark:hidden" />
					<Moon className="hidden h-4 w-4 dark:block" />
					<span className="sr-only">Toggle theme</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{OPTIONS.map(({ value, label, icon: Icon }) => (
					<DropdownMenuItem key={value} onClick={() => setTheme(value)} className="cursor-pointer">
						<Icon className="mr-2 h-4 w-4" />
						{label}
						{userTheme === value && <span className="ml-auto text-xs">✓</span>}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
