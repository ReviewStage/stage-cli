import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

export const USER_THEME = {
	LIGHT: "light",
	DARK: "dark",
	SYSTEM: "system",
} as const;
export type UserTheme = (typeof USER_THEME)[keyof typeof USER_THEME];

export const APP_THEME = {
	LIGHT: "light",
	DARK: "dark",
} as const;
export type AppTheme = (typeof APP_THEME)[keyof typeof APP_THEME];

const STORAGE_KEY = "ui-theme";
const DEFAULT_USER_THEME: UserTheme = USER_THEME.DARK;

const VALID_THEMES: ReadonlySet<string> = new Set<string>(Object.values(USER_THEME));

function isValidUserTheme(value: string): value is UserTheme {
	return VALID_THEMES.has(value);
}

export function resolveStoredUserTheme(stored: string | null): UserTheme {
	if (stored && isValidUserTheme(stored)) return stored;
	return DEFAULT_USER_THEME;
}

function getStoredUserTheme(): UserTheme {
	try {
		return resolveStoredUserTheme(localStorage.getItem(STORAGE_KEY));
	} catch {
		// localStorage unavailable
	}
	return DEFAULT_USER_THEME;
}

function getSystemTheme(): AppTheme {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? APP_THEME.DARK
		: APP_THEME.LIGHT;
}

function applyThemeToDOM(userTheme: UserTheme): void {
	const root = document.documentElement;
	root.classList.remove(APP_THEME.LIGHT, APP_THEME.DARK);
	const resolved = userTheme === USER_THEME.SYSTEM ? getSystemTheme() : userTheme;
	root.classList.add(resolved);
}

interface ThemeContextValue {
	userTheme: UserTheme;
	appTheme: AppTheme;
	setTheme: (theme: UserTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [userTheme, setUserTheme] = useState<UserTheme>(getStoredUserTheme);
	const [systemTheme, setSystemTheme] = useState<AppTheme>(getSystemTheme);

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => {
			const next = mq.matches ? APP_THEME.DARK : APP_THEME.LIGHT;
			setSystemTheme(next);
			if (userTheme === USER_THEME.SYSTEM) {
				applyThemeToDOM(USER_THEME.SYSTEM);
			}
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [userTheme]);

	const appTheme: AppTheme = userTheme === USER_THEME.SYSTEM ? systemTheme : userTheme;

	const setTheme = useCallback((next: UserTheme) => {
		setUserTheme(next);
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// localStorage unavailable
		}
		applyThemeToDOM(next);
	}, []);

	const contextValue = useMemo(
		() => ({ userTheme, appTheme, setTheme }),
		[userTheme, appTheme, setTheme],
	);

	return <ThemeContext value={contextValue}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
	const ctx = use(ThemeContext);
	if (!ctx) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return ctx;
}
