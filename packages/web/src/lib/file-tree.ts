import type { PullRequestFile } from "./diff-types";

export const FILE_NODE_TYPE = {
	FILE: "file",
	FOLDER: "folder",
} as const;
export type FileNodeType = (typeof FILE_NODE_TYPE)[keyof typeof FILE_NODE_TYPE];

export interface FileNode {
	name: string;
	path: string;
	type: FileNodeType;
	file?: PullRequestFile;
	children: Map<string, FileNode>;
}

export function buildFileTree(files: PullRequestFile[]): FileNode {
	const root: FileNode = {
		name: "",
		path: "",
		type: FILE_NODE_TYPE.FOLDER,
		children: new Map(),
	};

	for (const file of files) {
		const parts = file.path.split("/");
		let current = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (part === undefined) continue;
			const isFile = i === parts.length - 1;
			const fullPath = parts.slice(0, i + 1).join("/");

			let next = current.children.get(part);
			if (!next) {
				next = {
					name: part,
					path: fullPath,
					type: isFile ? FILE_NODE_TYPE.FILE : FILE_NODE_TYPE.FOLDER,
					file: isFile ? file : undefined,
					children: new Map(),
				};
				current.children.set(part, next);
			}
			current = next;
		}
	}

	return root;
}

/**
 * Recursively orders each node's children: folders before files, alphabetical
 * within each group. Must run before `collapseEmptyFolders` so the sort key is
 * the raw single-segment `name` (e.g. "apps") rather than the post-collapse
 * merged name (e.g. "apps/web/src"), keeping sort and collapse independent.
 */
export function sortFileTree(node: FileNode): FileNode {
	const sorted = Array.from(node.children.values())
		.sort((a, b) => {
			if (a.type !== b.type) return a.type === FILE_NODE_TYPE.FOLDER ? -1 : 1;
			return a.name.localeCompare(b.name);
		})
		.map(sortFileTree);

	const children = new Map<string, FileNode>();
	for (const child of sorted) children.set(child.name, child);
	return { ...node, children };
}

/**
 * Collapses folder nodes that have exactly one child which is also a folder.
 * For example, `apps/` → `web/` → `src/` → `file.tsx` becomes `apps/web/src/` → `file.tsx`.
 * Purely presentational: preserves child iteration order, so collapsing a
 * sorted tree leaves its order intact.
 */
export function collapseEmptyFolders(node: FileNode): FileNode {
	const collapsedChildren = new Map<string, FileNode>();

	for (const [, child] of node.children) {
		let current = child;

		while (current.type === FILE_NODE_TYPE.FOLDER && current.children.size === 1) {
			const onlyChild = Array.from(current.children.values())[0];
			if (!onlyChild || onlyChild.type !== FILE_NODE_TYPE.FOLDER) break;
			current = {
				name: `${current.name}/${onlyChild.name}`,
				path: onlyChild.path,
				type: onlyChild.type,
				file: onlyChild.file,
				children: onlyChild.children,
			};
		}

		const collapsed = collapseEmptyFolders(current);
		collapsedChildren.set(collapsed.name, collapsed);
	}

	return { ...node, children: collapsedChildren };
}

/**
 * Returns the leaf files of a tree in iteration order. Pair with
 * `sortFileTree` to get files in the same order the picker renders them.
 */
export function flattenFileTree(node: FileNode): PullRequestFile[] {
	const result: PullRequestFile[] = [];
	function visit(n: FileNode): void {
		for (const child of n.children.values()) {
			if (child.type === FILE_NODE_TYPE.FILE && child.file) {
				result.push(child.file);
			} else {
				visit(child);
			}
		}
	}
	visit(node);
	return result;
}
