ALTER TABLE `comment_thread` ADD `promotionThreadNodeId` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionRootCommentNodeId` text;--> statement-breakpoint
ALTER TABLE `comment_thread` ADD `promotionReplyCount` integer DEFAULT 0 NOT NULL;