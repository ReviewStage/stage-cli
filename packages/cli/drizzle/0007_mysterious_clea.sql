ALTER TABLE `chapter` ADD `riskLevel` text;--> statement-breakpoint
ALTER TABLE `chapter` ADD `riskReasons` text;--> statement-breakpoint
-- Releases before dense 0-based chapter indexing persisted the agent's 1-based
-- `order` directly as chapterIndex. Renormalize every run to a dense 0-based
-- rank ordered by the existing chapterIndex so old runs don't render as
-- "Chapter 2" first and old /chapters/:index links keep resolving.
--
-- Two passes because unique(runId, chapterIndex) is checked per row: first map
-- every index into negative space (collision-free for any legacy values, which
-- are always >= 0), then assign dense ranks ordered by the original value
-- (descending negatives = ascending originals).
UPDATE `chapter` SET `chapterIndex` = -`chapterIndex` - 1;--> statement-breakpoint
UPDATE `chapter`
SET `chapterIndex` = `ranked`.`newIndex`
FROM (
	SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `runId` ORDER BY `chapterIndex` DESC) - 1 AS `newIndex`
	FROM `chapter`
) AS `ranked`
WHERE `chapter`.`id` = `ranked`.`id`;
