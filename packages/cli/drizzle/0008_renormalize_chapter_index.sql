-- Releases before dense 0-based chapter indexing persisted the agent's 1-based
-- `order` directly as chapterIndex. Renormalize every run to a dense 0-based
-- rank ordered by the existing chapterIndex so old runs don't render as
-- "Chapter 2" first and old /chapters/:index links keep resolving.
--
-- Two passes because unique(runId, chapterIndex) is checked per row: first move
-- every index far above any real value, then assign ranks (which can no longer
-- collide with the offset values).
UPDATE `chapter` SET `chapterIndex` = `chapterIndex` + 100000;--> statement-breakpoint
UPDATE `chapter`
SET `chapterIndex` = `ranked`.`newIndex`
FROM (
	SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `runId` ORDER BY `chapterIndex`) - 1 AS `newIndex`
	FROM `chapter`
) AS `ranked`
WHERE `chapter`.`id` = `ranked`.`id`;
