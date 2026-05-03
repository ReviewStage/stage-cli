import { describe, expect, it } from "vitest";
import { FILE_STATUS, type PullRequestFile } from "../diff-types";
import {
	buildFileTree,
	collapseEmptyFolders,
	compareFilePaths,
	FILE_NODE_TYPE,
	type FileNode,
	sortFileNodes,
} from "../file-tree";

function file(path: string): PullRequestFile {
	return {
		path,
		filename: path.split("/").pop() ?? path,
		status: FILE_STATUS.MODIFIED,
		additions: 0,
		deletions: 0,
		hunks: [],
	};
}

function flattenTree(files: PullRequestFile[]): string[] {
	const tree = collapseEmptyFolders(buildFileTree(files));
	const paths: string[] = [];
	function visit(node: FileNode): void {
		for (const child of sortFileNodes(Array.from(node.children.values()))) {
			if (child.type === FILE_NODE_TYPE.FILE && child.file) {
				paths.push(child.file.path);
			} else {
				visit(child);
			}
		}
	}
	visit(tree);
	return paths;
}

describe("compareFilePaths", () => {
	it("places folders before sibling files at the same depth", () => {
		const paths = ["a.ts", "dir/b.ts", "e.ts"];
		expect([...paths].sort(compareFilePaths)).toEqual(["dir/b.ts", "a.ts", "e.ts"]);
	});

	it("sorts alphabetically within the same group", () => {
		const paths = ["b.ts", "a.ts", "c.ts"];
		expect([...paths].sort(compareFilePaths)).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	it("sorts sibling folders alphabetically", () => {
		const paths = ["apps/web/x.ts", "apps/mobile/y.ts"];
		expect([...paths].sort(compareFilePaths)).toEqual(["apps/mobile/y.ts", "apps/web/x.ts"]);
	});

	it("matches the FilePicker tree's depth-first traversal", () => {
		const files = [
			file("README.md"),
			file("packages/web/src/lib/file-tree.ts"),
			file("packages/web/src/components/files/file-picker.tsx"),
			file("packages/cli/src/index.ts"),
			file("package.json"),
			file("packages/web/src/components/files/file-diff-list.tsx"),
		];
		const treeOrder = flattenTree(files);
		const flatSorted = files.map((f) => f.path).sort(compareFilePaths);
		expect(flatSorted).toEqual(treeOrder);
	});
});
