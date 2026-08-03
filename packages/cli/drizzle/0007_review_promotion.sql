DROP INDEX `comment_thread_scope_key_idx`;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `repoRoot` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `comment_thread`
SET `repoRoot` = COALESCE(
	(
		SELECT MIN(`chapter_run`.`repoRoot`)
		FROM `chapter_run`
		WHERE `comment_thread`.`scopeKey` = CASE
			WHEN `chapter_run`.`scopeKind` = 'committed'
				THEN 'committed:' || `chapter_run`.`baseSha` || ':' || `chapter_run`.`headSha` || ':' || `chapter_run`.`mergeBaseSha`
			ELSE 'workingTree:' || `chapter_run`.`workingTreeRef` || ':' || `chapter_run`.`baseSha` || ':' || `chapter_run`.`headSha` || ':' || `chapter_run`.`mergeBaseSha`
		END
		HAVING COUNT(DISTINCT `chapter_run`.`repoRoot`) = 1
	),
	`repoRoot`
);--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionPullRequestNodeId` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionThreadNodeId` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionRootCommentNodeId` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionViewerLogin` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionRootBaselineThreadNodeIds` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionRootPublished` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionReplyNodeIds` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `comment_thread_repo_scope_idx` ON `comment_thread` (`repoRoot`,`scopeKey`);