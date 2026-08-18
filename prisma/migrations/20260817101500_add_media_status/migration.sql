-- Add media upload lifecycle status (PENDING -> READY after R2 confirmation).
ALTER TABLE `media` ADD COLUMN `status` ENUM('pending', 'ready') NOT NULL DEFAULT 'pending';

-- Existing rows are treated as already-uploaded media.
UPDATE `media` SET `status` = 'ready';

-- One image per journal: unique journal_id replaces the non-unique index.
-- MySQL requires dropping the FK before dropping the supporting index.
ALTER TABLE `media` DROP FOREIGN KEY `media_journal_id_fkey`;
DROP INDEX `media_journal_id_idx` ON `media`;
CREATE UNIQUE INDEX `media_journal_id_key` ON `media`(`journal_id`);
ALTER TABLE `media` ADD CONSTRAINT `media_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
