import { describe, expect, it } from "vitest";
import {
	isProxiableGitHubImageUrl,
	proxyGitHubImageSrcset,
	proxyGitHubImageUrl,
} from "../github-image-proxy";

const FIRST_UUID = "11111111-1111-4111-8111-111111111111";
const SECOND_UUID = "22222222-2222-4222-8222-222222222222";
const USER_ATTACHMENT = `https://github.com/user-attachments/assets/${FIRST_UUID}`;
const REPO_ASSET = `https://github.com/stage/delhi/assets/${FIRST_UUID}`;

describe("isProxiableGitHubImageUrl", () => {
	it("allows user-attachment and repo asset URLs", () => {
		expect(isProxiableGitHubImageUrl(USER_ATTACHMENT)).toBe(true);
		expect(isProxiableGitHubImageUrl(REPO_ASSET)).toBe(true);
	});

	it("rejects non-allowlisted hosts, non-asset paths, and non-https URLs", () => {
		expect(isProxiableGitHubImageUrl("https://evil.test/user-attachments/assets/x")).toBe(false);
		expect(isProxiableGitHubImageUrl("https://github.com/stage/delhi")).toBe(false);
		expect(
			isProxiableGitHubImageUrl(`http://github.com/user-attachments/assets/${FIRST_UUID}`),
		).toBe(false);
		expect(isProxiableGitHubImageUrl("not a url")).toBe(false);
	});
});

describe("proxyGitHubImageUrl", () => {
	it("rewrites GitHub attachment URLs through the local proxy", () => {
		expect(proxyGitHubImageUrl(USER_ATTACHMENT)).toBe(
			`/api/image-proxy?url=${encodeURIComponent(USER_ATTACHMENT)}`,
		);
	});

	it("passes non-GitHub URLs through untouched", () => {
		expect(proxyGitHubImageUrl("https://stagereview.app/light.svg")).toBe(
			"https://stagereview.app/light.svg",
		);
	});

	it("leaves signed private-user-images URLs alone", () => {
		const signed = `https://private-user-images.githubusercontent.com/123/456-${FIRST_UUID}.png?jwt=x`;
		expect(proxyGitHubImageUrl(signed)).toBe(signed);
	});
});

describe("proxyGitHubImageSrcset", () => {
	it("proxies each candidate while preserving descriptors", () => {
		const first = `https://github.com/user-attachments/assets/${FIRST_UUID}`;
		const second = `https://github.com/user-attachments/assets/${SECOND_UUID}`;
		expect(proxyGitHubImageSrcset(`${first} 1x, ${second} 2x`)).toBe(
			`/api/image-proxy?url=${encodeURIComponent(first)} 1x, /api/image-proxy?url=${encodeURIComponent(second)} 2x`,
		);
	});

	it("leaves non-GitHub candidates untouched", () => {
		expect(proxyGitHubImageSrcset("https://stagereview.app/a.png 1x")).toBe(
			"https://stagereview.app/a.png 1x",
		);
	});

	it("rejects credential-bearing URLs the server could never fetch", () => {
		expect(isProxiableGitHubImageUrl("https://user:pass@github.com/o/r/assets/1")).toBe(false);
	});
});
