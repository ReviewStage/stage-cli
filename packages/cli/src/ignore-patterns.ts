export const DEFAULT_IGNORE_PATTERNS = [
	// Lock files
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lockb",
	"bun.lock",
	"composer.lock",
	"Gemfile.lock",
	"Cargo.lock",
	"poetry.lock",
	"Pipfile.lock",
	"go.sum",
	"uv.lock",
	"deno.lock",
	"pubspec.lock",
	"Podfile.lock",
	"mix.lock",
	"npm-shrinkwrap.json",
	"gradle.lockfile",
	"flake.lock",

	// OS metadata
	".DS_Store",
	"Thumbs.db",

	// Minified / generated
	"*.min.js",
	"*.min.css",
	"*.map",
	"*.snap",

	// Images
	"*.svg",
	"*.png",
	"*.jpg",
	"*.jpeg",
	"*.gif",
	"*.ico",

	// Fonts
	"*.woff",
	"*.woff2",
	"*.ttf",
	"*.eot",

	// Media
	"*.mp4",
	"*.webm",

	// Documents
	"*.pdf",
] as const;

export const DEFAULT_IGNORE_PATTERNS_TEXT = DEFAULT_IGNORE_PATTERNS.join("\n");
