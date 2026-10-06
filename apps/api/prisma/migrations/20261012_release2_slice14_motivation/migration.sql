-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `MotivationEnabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `Notifications` MODIFY `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI', 'DIGEST', 'MOTIVATION') NOT NULL;

-- AlterTable
ALTER TABLE `NotificationPreferences` MODIFY `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI', 'DIGEST', 'MOTIVATION') NOT NULL;

-- CreateTable
CREATE TABLE `StudentPoints` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Xp` INTEGER NOT NULL DEFAULT 0,
    `Level` INTEGER NOT NULL DEFAULT 1,
    `StreakDays` INTEGER NOT NULL DEFAULT 0,
    `LongestStreak` INTEGER NOT NULL DEFAULT 0,
    `LastActionOn` DATE NULL,
    `FreezeTokens` INTEGER NOT NULL DEFAULT 0,
    `FreezesUsed` INTEGER NOT NULL DEFAULT 0,
    `Title` VARCHAR(40) NOT NULL DEFAULT 'newcomer',
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `StudentPoints_StudentId_key`(`StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RewardTransactions` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Amount` INTEGER NOT NULL,
    `Reason` VARCHAR(40) NOT NULL,
    `EntityType` VARCHAR(40) NOT NULL DEFAULT '',
    `EntityId` CHAR(36) NOT NULL DEFAULT '',
    `Note` TEXT NULL,
    `AwardedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `RewardTransactions_StudentId_CreatedAt_idx`(`StudentId`, `CreatedAt`),
    UNIQUE INDEX `RewardTransactions_StudentId_Reason_EntityType_EntityId_key`(`StudentId`, `Reason`, `EntityType`, `EntityId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Badges` (
    `Id` CHAR(36) NOT NULL,
    `Code` VARCHAR(60) NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Description` TEXT NOT NULL,
    `Category` VARCHAR(20) NOT NULL,
    `Tier` INTEGER NOT NULL DEFAULT 1,
    `Icon` VARCHAR(16) NOT NULL,
    `TeacherAwarded` BOOLEAN NOT NULL DEFAULT false,
    `OrganizationId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `Badges_Code_key`(`Code`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentBadges` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `BadgeId` CHAR(36) NOT NULL,
    `AwardedById` CHAR(36) NULL,
    `Reason` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `StudentBadges_StudentId_BadgeId_key`(`StudentId`, `BadgeId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LessonCompletions` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `LessonId` CHAR(36) NOT NULL,
    `CompletedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `LessonCompletions_LessonId_idx`(`LessonId`),
    UNIQUE INDEX `LessonCompletions_StudentId_LessonId_key`(`StudentId`, `LessonId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Quests` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NULL,
    `StudentId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Metric` VARCHAR(30) NOT NULL,
    `Goal` INTEGER NOT NULL,
    `RewardXp` INTEGER NOT NULL DEFAULT 0,
    `StartsAt` DATETIME(6) NOT NULL,
    `EndsAt` DATETIME(6) NOT NULL,
    `Status` ENUM('ACTIVE', 'COMPLETED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `Auto` BOOLEAN NOT NULL DEFAULT false,
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `Quests_OrganizationId_Status_EndsAt_idx`(`OrganizationId`, `Status`, `EndsAt`),
    INDEX `Quests_ClassId_Status_idx`(`ClassId`, `Status`),
    INDEX `Quests_StudentId_Status_idx`(`StudentId`, `Status`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuestProgress` (
    `Id` CHAR(36) NOT NULL,
    `QuestId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Count` INTEGER NOT NULL DEFAULT 0,
    `CompletedAt` DATETIME(6) NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `QuestProgress_QuestId_StudentId_key`(`QuestId`, `StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StudentPoints` ADD CONSTRAINT `StudentPoints_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RewardTransactions` ADD CONSTRAINT `RewardTransactions_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RewardTransactions` ADD CONSTRAINT `RewardTransactions_AwardedById_fkey` FOREIGN KEY (`AwardedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Badges` ADD CONSTRAINT `Badges_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentBadges` ADD CONSTRAINT `StudentBadges_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentBadges` ADD CONSTRAINT `StudentBadges_BadgeId_fkey` FOREIGN KEY (`BadgeId`) REFERENCES `Badges`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentBadges` ADD CONSTRAINT `StudentBadges_AwardedById_fkey` FOREIGN KEY (`AwardedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonCompletions` ADD CONSTRAINT `LessonCompletions_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonCompletions` ADD CONSTRAINT `LessonCompletions_LessonId_fkey` FOREIGN KEY (`LessonId`) REFERENCES `Lessons`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quests` ADD CONSTRAINT `Quests_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quests` ADD CONSTRAINT `Quests_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quests` ADD CONSTRAINT `Quests_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quests` ADD CONSTRAINT `Quests_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuestProgress` ADD CONSTRAINT `QuestProgress_QuestId_fkey` FOREIGN KEY (`QuestId`) REFERENCES `Quests`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuestProgress` ADD CONSTRAINT `QuestProgress_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

