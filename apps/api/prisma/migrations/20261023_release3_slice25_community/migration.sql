-- AlterTable
ALTER TABLE `Notifications` MODIFY `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI', 'DIGEST', 'MOTIVATION', 'COMMUNITY') NOT NULL;

-- AlterTable
ALTER TABLE `NotificationPreferences` MODIFY `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI', 'DIGEST', 'MOTIVATION', 'COMMUNITY') NOT NULL;

-- CreateTable
CREATE TABLE `CommunityGroups` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NULL,
    `Name` VARCHAR(120) NOT NULL,
    `Description` TEXT NULL,
    `Kind` VARCHAR(16) NOT NULL DEFAULT 'club',
    `Visibility` VARCHAR(16) NOT NULL DEFAULT 'school',
    `JoinPolicy` VARCHAR(16) NOT NULL DEFAULT 'open',
    `StudentsCanPost` BOOLEAN NOT NULL DEFAULT true,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `CommunityGroups_ClassId_key`(`ClassId`),
    INDEX `CommunityGroups_OrganizationId_Status_Kind_idx`(`OrganizationId`, `Status`, `Kind`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityMembers` (
    `Id` CHAR(36) NOT NULL,
    `GroupId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Role` VARCHAR(16) NOT NULL DEFAULT 'member',
    `Status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `MutedUntil` DATETIME(6) NULL,
    `JoinedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `CommunityMembers_UserId_idx`(`UserId`),
    UNIQUE INDEX `CommunityMembers_GroupId_UserId_key`(`GroupId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityTopics` (
    `Id` CHAR(36) NOT NULL,
    `GroupId` CHAR(36) NOT NULL,
    `AuthorId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Body` TEXT NOT NULL,
    `Pinned` BOOLEAN NOT NULL DEFAULT false,
    `Locked` BOOLEAN NOT NULL DEFAULT false,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'visible',
    `HoldReason` VARCHAR(300) NULL,
    `PostCount` INTEGER NOT NULL DEFAULT 0,
    `LastPostAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `CommunityTopics_GroupId_Status_Pinned_LastPostAt_idx`(`GroupId`, `Status`, `Pinned`, `LastPostAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityPosts` (
    `Id` CHAR(36) NOT NULL,
    `TopicId` CHAR(36) NOT NULL,
    `AuthorId` CHAR(36) NULL,
    `Body` TEXT NOT NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'visible',
    `HoldReason` VARCHAR(300) NULL,
    `EditedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `CommunityPosts_TopicId_Status_CreatedAt_idx`(`TopicId`, `Status`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityReactions` (
    `Id` CHAR(36) NOT NULL,
    `PostId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Kind` VARCHAR(16) NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `CommunityReactions_PostId_UserId_key`(`PostId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicSubscriptions` (
    `Id` CHAR(36) NOT NULL,
    `TopicId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `TopicSubscriptions_TopicId_UserId_key`(`TopicId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityReports` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `TargetType` VARCHAR(16) NOT NULL,
    `TargetId` CHAR(36) NOT NULL,
    `ReporterId` CHAR(36) NOT NULL,
    `Reason` VARCHAR(40) NOT NULL,
    `Details` VARCHAR(1000) NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `Resolution` VARCHAR(40) NULL,
    `ResolvedById` CHAR(36) NULL,
    `ResolvedAt` DATETIME(6) NULL,
    `Note` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `CommunityReports_OrganizationId_Status_CreatedAt_idx`(`OrganizationId`, `Status`, `CreatedAt`),
    INDEX `CommunityReports_TargetType_TargetId_idx`(`TargetType`, `TargetId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CommunityGroups` ADD CONSTRAINT `CommunityGroups_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityGroups` ADD CONSTRAINT `CommunityGroups_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityMembers` ADD CONSTRAINT `CommunityMembers_GroupId_fkey` FOREIGN KEY (`GroupId`) REFERENCES `CommunityGroups`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityMembers` ADD CONSTRAINT `CommunityMembers_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityTopics` ADD CONSTRAINT `CommunityTopics_GroupId_fkey` FOREIGN KEY (`GroupId`) REFERENCES `CommunityGroups`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityTopics` ADD CONSTRAINT `CommunityTopics_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityPosts` ADD CONSTRAINT `CommunityPosts_TopicId_fkey` FOREIGN KEY (`TopicId`) REFERENCES `CommunityTopics`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityPosts` ADD CONSTRAINT `CommunityPosts_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityReactions` ADD CONSTRAINT `CommunityReactions_PostId_fkey` FOREIGN KEY (`PostId`) REFERENCES `CommunityPosts`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityReactions` ADD CONSTRAINT `CommunityReactions_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicSubscriptions` ADD CONSTRAINT `TopicSubscriptions_TopicId_fkey` FOREIGN KEY (`TopicId`) REFERENCES `CommunityTopics`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicSubscriptions` ADD CONSTRAINT `TopicSubscriptions_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityReports` ADD CONSTRAINT `CommunityReports_ReporterId_fkey` FOREIGN KEY (`ReporterId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

