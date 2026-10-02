-- CreateTable
CREATE TABLE `Announcements` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NULL,
    `AuthorId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Content` TEXT NOT NULL,
    `Type` ENUM('GENERAL', 'ACADEMIC', 'EVENT', 'EMERGENCY', 'ADMINISTRATIVE', 'SOCIAL') NOT NULL DEFAULT 'GENERAL',
    `Priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `Status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `Pinned` BOOLEAN NOT NULL DEFAULT false,
    `PublishedAt` DATETIME(6) NULL,
    `ExpiresAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `Announcements_OrganizationId_Status_PublishedAt_idx`(`OrganizationId`, `Status`, `PublishedAt`),
    INDEX `Announcements_ClassId_Status_idx`(`ClassId`, `Status`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notifications` (
    `Id` CHAR(36) NOT NULL,
    `RecipientId` CHAR(36) NOT NULL,
    `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI') NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Body` TEXT NULL,
    `Link` VARCHAR(500) NULL,
    `EntityType` VARCHAR(60) NULL,
    `EntityId` CHAR(36) NULL,
    `IsRead` BOOLEAN NOT NULL DEFAULT false,
    `ReadAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `Notifications_RecipientId_IsRead_CreatedAt_idx`(`RecipientId`, `IsRead`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationPreferences` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI') NOT NULL,
    `InApp` BOOLEAN NOT NULL DEFAULT true,
    `Email` BOOLEAN NOT NULL DEFAULT false,
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `NotificationPreferences_UserId_Category_key`(`UserId`, `Category`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversations` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `Type` ENUM('DIRECT', 'GROUP', 'CLASS') NOT NULL DEFAULT 'DIRECT',
    `ClassId` CHAR(36) NULL,
    `Title` VARCHAR(200) NULL,
    `CreatedById` CHAR(36) NULL,
    `LastMessageAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `Conversations_OrganizationId_LastMessageAt_idx`(`OrganizationId`, `LastMessageAt`),
    INDEX `Conversations_ClassId_idx`(`ClassId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationParticipants` (
    `Id` CHAR(36) NOT NULL,
    `ConversationId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `JoinedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `LeftAt` DATETIME(6) NULL,
    `LastReadAt` DATETIME(6) NULL,
    `Muted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `ConversationParticipants_UserId_LeftAt_idx`(`UserId`, `LeftAt`),
    UNIQUE INDEX `ConversationParticipants_ConversationId_UserId_key`(`ConversationId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Messages` (
    `Id` CHAR(36) NOT NULL,
    `ConversationId` CHAR(36) NOT NULL,
    `SenderId` CHAR(36) NULL,
    `Content` TEXT NOT NULL,
    `ReplyToMessageId` CHAR(36) NULL,
    `EditedAt` DATETIME(6) NULL,
    `DeletedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `Messages_ConversationId_CreatedAt_idx`(`ConversationId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageFiles` (
    `Id` CHAR(36) NOT NULL,
    `MessageId` CHAR(36) NOT NULL,
    `FileId` CHAR(36) NOT NULL,

    UNIQUE INDEX `MessageFiles_MessageId_FileId_key`(`MessageId`, `FileId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Announcements` ADD CONSTRAINT `Announcements_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Announcements` ADD CONSTRAINT `Announcements_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Announcements` ADD CONSTRAINT `Announcements_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notifications` ADD CONSTRAINT `Notifications_RecipientId_fkey` FOREIGN KEY (`RecipientId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationPreferences` ADD CONSTRAINT `NotificationPreferences_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationParticipants` ADD CONSTRAINT `ConversationParticipants_ConversationId_fkey` FOREIGN KEY (`ConversationId`) REFERENCES `Conversations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationParticipants` ADD CONSTRAINT `ConversationParticipants_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Messages` ADD CONSTRAINT `Messages_ConversationId_fkey` FOREIGN KEY (`ConversationId`) REFERENCES `Conversations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Messages` ADD CONSTRAINT `Messages_SenderId_fkey` FOREIGN KEY (`SenderId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Messages` ADD CONSTRAINT `Messages_ReplyToMessageId_fkey` FOREIGN KEY (`ReplyToMessageId`) REFERENCES `Messages`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageFiles` ADD CONSTRAINT `MessageFiles_MessageId_fkey` FOREIGN KEY (`MessageId`) REFERENCES `Messages`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageFiles` ADD CONSTRAINT `MessageFiles_FileId_fkey` FOREIGN KEY (`FileId`) REFERENCES `FileUploads`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

