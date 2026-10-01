-- CreateTable
CREATE TABLE `AiConversations` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `UserId` CHAR(36) NOT NULL,
    `Capability` VARCHAR(50) NOT NULL,
    `CourseId` CHAR(36) NULL,
    `LessonId` CHAR(36) NULL,
    `ClassId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Summary` TEXT NULL,
    `MessageCount` INTEGER NOT NULL DEFAULT 0,
    `LastMessageAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `AiConversations_UserId_LastMessageAt_idx`(`UserId`, `LastMessageAt`),
    INDEX `AiConversations_OrganizationId_CreatedAt_idx`(`OrganizationId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiMessages` (
    `Id` CHAR(36) NOT NULL,
    `ConversationId` CHAR(36) NOT NULL,
    `Role` ENUM('USER', 'ASSISTANT') NOT NULL,
    `Content` LONGTEXT NOT NULL,
    `Status` ENUM('OK', 'REFUSED', 'DEGRADED', 'UNAVAILABLE') NOT NULL DEFAULT 'OK',
    `PromptVersion` VARCHAR(60) NULL,
    `Model` VARCHAR(100) NULL,
    `Citations` TEXT NULL,
    `Safety` TEXT NULL,
    `Usage` TEXT NULL,
    `TraceId` CHAR(36) NULL,
    `Feedback` INTEGER NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `AiMessages_ConversationId_CreatedAt_idx`(`ConversationId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AiConversations` ADD CONSTRAINT `AiConversations_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiConversations` ADD CONSTRAINT `AiConversations_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiMessages` ADD CONSTRAINT `AiMessages_ConversationId_fkey` FOREIGN KEY (`ConversationId`) REFERENCES `AiConversations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

