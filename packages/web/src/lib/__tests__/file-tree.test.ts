import { describe, expect, it } from "vitest";
import { FILE_STATUS, type PullRequestFile } from "../diff-types";
import {
	buildFileTree,
	collapseEmptyFolders,
	type FileNode,
	flattenFileTree,
	sortFileTree,
} from "../file-tree";

function makeFile(path: string): PullRequestFile {
	const filename = path.split("/").pop();
	if (!filename) throw new Error("Expected file path to include a filename");
	return {
		path,
		filename,
		status: FILE_STATUS.MODIFIED,
		additions: 1,
		deletions: 0,
		hunks: [],
	};
}

function getChildNames(node: FileNode): string[] {
	return Array.from(sortFileTree(node).children.values()).map((c) => c.name);
}

function firstChild(node: FileNode): FileNode {
	const first = Array.from(node.children.values())[0];
	if (!first) throw new Error("Expected at least one child");
	return first;
}

describe("collapseEmptyFolders", () => {
	it("collapses single-child folder chains", () => {
		const tree = buildFileTree([makeFile("apps/web/src/app/page.tsx")]);
		const collapsed = collapseEmptyFolders(tree);

		expect(collapsed.children.size).toBe(1);
		const folder = firstChild(collapsed);
		expect(folder.name).toBe("apps/web/src/app");
		expect(folder.children.size).toBe(1);
		const file = firstChild(folder);
		expect(file.name).toBe("page.tsx");
	});

	it("does not collapse folders with multiple children", () => {
		const tree = buildFileTree([makeFile("src/a.ts"), makeFile("src/b.ts")]);
		const collapsed = collapseEmptyFolders(tree);

		expect(collapsed.children.size).toBe(1);
		const srcFolder = firstChild(collapsed);
		expect(srcFolder.name).toBe("src");
		expect(srcFolder.children.size).toBe(2);
	});

	it("partially collapses when branches diverge", () => {
		const tree = buildFileTree([
			makeFile("packages/api/src/router.ts"),
			makeFile("packages/api/src/client.ts"),
			makeFile("packages/db/src/schema.ts"),
		]);
		const collapsed = collapseEmptyFolders(tree);

		expect(collapsed.children.size).toBe(1);
		const packages = firstChild(collapsed);
		expect(packages.name).toBe("packages");
		expect(packages.children.size).toBe(2);

		const names = getChildNames(packages);
		expect(names).toEqual(["api/src", "db/src"]);
	});

	it("handles files at the root level", () => {
		const tree = buildFileTree([makeFile("README.md"), makeFile("package.json")]);
		const collapsed = collapseEmptyFolders(tree);

		expect(collapsed.children.size).toBe(2);
		const names = getChildNames(collapsed);
		expect(names).toEqual(["package.json", "README.md"]);
	});

	it("does not collapse a folder whose only child is a file", () => {
		const tree = buildFileTree([makeFile("src/index.ts")]);
		const collapsed = collapseEmptyFolders(tree);

		expect(collapsed.children.size).toBe(1);
		const src = firstChild(collapsed);
		expect(src.name).toBe("src");
		expect(src.type).toBe("folder");
		expect(src.children.size).toBe(1);
	});

	it("preserves the path on collapsed nodes", () => {
		const tree = buildFileTree([makeFile("a/b/c/file.ts")]);
		const collapsed = collapseEmptyFolders(tree);

		const folder = firstChild(collapsed);
		expect(folder.name).toBe("a/b/c");
		expect(folder.path).toBe("a/b/c");
	});

	it("handles an empty tree", () => {
		const tree = buildFileTree([]);
		const collapsed = collapseEmptyFolders(tree);
		expect(collapsed.children.size).toBe(0);
	});
});

describe("sortFileTree", () => {
	it("places folders before sibling files at each level", () => {
		const tree = sortFileTree(
			buildFileTree([makeFile("README.md"), makeFile("src/index.ts"), makeFile("package.json")]),
		);
		expect(Array.from(tree.children.keys())).toEqual(["src", "package.json", "README.md"]);
	});

	it("sorts alphabetically within each group", () => {
		const tree = sortFileTree(
			buildFileTree([makeFile("src/c.ts"), makeFile("src/a.ts"), makeFile("src/b.ts")]),
		);
		const src = firstChild(tree);
		expect(Array.from(src.children.keys())).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	it("recurses into nested folders", () => {
		const tree = sortFileTree(
			buildFileTree([
				makeFile("packages/db/src/schema.ts"),
				makeFile("packages/api/src/router.ts"),
				makeFile("packages/api/src/client.ts"),
			]),
		);
		const packages = firstChild(tree);
		expect(Array.from(packages.children.keys())).toEqual(["api", "db"]);
		const api = firstChild(packages);
		const apiSrc = firstChild(api);
		expect(Array.from(apiSrc.children.keys())).toEqual(["client.ts", "router.ts"]);
	});
});

describe("flattenFileTree", () => {
	it("returns leaf files in iteration order", () => {
		const tree = sortFileTree(
			buildFileTree([
				makeFile("README.md"),
				makeFile("src/b.ts"),
				makeFile("src/a.ts"),
				makeFile("package.json"),
			]),
		);
		expect(flattenFileTree(tree).map((f) => f.path)).toEqual([
			"src/a.ts",
			"src/b.ts",
			"package.json",
			"README.md",
		]);
	});

	it("returns the same order before and after collapseEmptyFolders", () => {
		const files = [
			makeFile("apps/web/src/page.tsx"),
			makeFile("apps-mobile/index.ts"),
			makeFile("packages/api/src/router.ts"),
			makeFile("README.md"),
		];
		const sorted = sortFileTree(buildFileTree(files));
		const collapsed = collapseEmptyFolders(sorted);
		expect(flattenFileTree(sorted).map((f) => f.path)).toEqual(
			flattenFileTree(collapsed).map((f) => f.path),
		);
	});

	it("returns an empty array for an empty tree", () => {
		expect(flattenFileTree(buildFileTree([]))).toEqual([]);
	});
});
