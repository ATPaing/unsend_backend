-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `normalized_username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `public_key` LONGBLOB NOT NULL,
    `encrypted_private_key` LONGBLOB NOT NULL,
    `derived_key_salt` LONGBLOB NOT NULL,
    `private_key_nonce` LONGBLOB NOT NULL,
    `crypto_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_normalized_username_key`(`normalized_username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `encrypted_title` LONGBLOB NOT NULL,
    `title_nonce` LONGBLOB NOT NULL,
    `encrypted_content` LONGBLOB NOT NULL,
    `content_nonce` LONGBLOB NOT NULL,
    `owner_encrypted_aes_key` LONGBLOB NOT NULL,
    `created_by` INTEGER NOT NULL,
    `journal_type` ENUM('journal', 't_capsule') NOT NULL,
    `unlock_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `journals_created_by_idx`(`created_by`),
    INDEX `journals_journal_type_unlock_at_idx`(`journal_type`, `unlock_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `journal_id` INTEGER NOT NULL,
    `encrypted_mime` LONGBLOB NOT NULL,
    `mime_nonce` LONGBLOB NOT NULL,
    `storage_key` VARCHAR(512) NOT NULL,
    `encrypted_file_name` LONGBLOB NOT NULL,
    `file_name_nonce` LONGBLOB NOT NULL,
    `file_nonce` LONGBLOB NOT NULL,
    `size` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `media_storage_key_key`(`storage_key`),
    INDEX `media_journal_id_idx`(`journal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_access` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `journal_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `viewer_encrypted_aes_key` LONGBLOB NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `journal_access_user_id_idx`(`user_id`),
    UNIQUE INDEX `journal_access_journal_id_user_id_key`(`journal_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `friend_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_a_id` INTEGER NOT NULL,
    `user_b_id` INTEGER NOT NULL,
    `initiator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `friend_requests_user_b_id_idx`(`user_b_id`),
    INDEX `friend_requests_initiator_id_idx`(`initiator_id`),
    UNIQUE INDEX `friend_requests_user_a_id_user_b_id_key`(`user_a_id`, `user_b_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `friendships` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_a_id` INTEGER NOT NULL,
    `user_b_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `friendships_user_b_id_idx`(`user_b_id`),
    UNIQUE INDEX `friendships_user_a_id_user_b_id_key`(`user_a_id`, `user_b_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recipient_id` INTEGER NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `type` ENUM('fri_req', 'fri_accepted', 'journal_shared') NOT NULL,
    `journal_id` INTEGER NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_recipient_id_is_read_idx`(`recipient_id`, `is_read`),
    INDEX `notifications_recipient_id_created_at_idx`(`recipient_id`, `created_at`),
    INDEX `notifications_journal_id_idx`(`journal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hashed_token` VARCHAR(128) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sessions_hashed_token_key`(`hashed_token`),
    INDEX `sessions_user_id_idx`(`user_id`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `journals` ADD CONSTRAINT `journals_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media` ADD CONSTRAINT `media_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_access` ADD CONSTRAINT `journal_access_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_access` ADD CONSTRAINT `journal_access_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friend_requests` ADD CONSTRAINT `friend_requests_user_a_id_fkey` FOREIGN KEY (`user_a_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friend_requests` ADD CONSTRAINT `friend_requests_user_b_id_fkey` FOREIGN KEY (`user_b_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friend_requests` ADD CONSTRAINT `friend_requests_initiator_id_fkey` FOREIGN KEY (`initiator_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_user_a_id_fkey` FOREIGN KEY (`user_a_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `friendships` ADD CONSTRAINT `friendships_user_b_id_fkey` FOREIGN KEY (`user_b_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
