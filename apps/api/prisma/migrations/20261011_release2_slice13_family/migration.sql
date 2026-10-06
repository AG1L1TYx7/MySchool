-- AlterTable
ALTER TABLE `Notifications` MODIFY `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI', 'DIGEST') NOT NULL;

-- AlterTable
ALTER TABLE `NotificationPreferences` MODIFY `Category` ENUM('ANNOUNCEMENT', 'ASSIGNMENT', 'GRADE', 'MESSAGE', 'ATTENDANCE', 'SYSTEM', 'AI', 'DIGEST') NOT NULL;

-- CreateTable
CREATE TABLE `LessonSummaries` (
    `Id` CHAR(36) NOT NULL,
    `LessonId` CHAR(36) NOT NULL,
    `Language` VARCHAR(16) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Summary` TEXT NOT NULL,
    `KeyIdeas` TEXT NOT NULL,
    `Questions` TEXT NOT NULL,
    `TryAtHome` TEXT NOT NULL,
    `Status` ENUM('DRAFT', 'RELEASED') NOT NULL DEFAULT 'DRAFT',
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `ReviewedById` CHAR(36) NULL,
    `ReleasedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `LessonSummaries_LessonId_Language_key`(`LessonId`, `Language`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConferenceNotes` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `AuthorId` CHAR(36) NOT NULL,
    `Language` VARCHAR(16) NOT NULL,
    `Content` TEXT NOT NULL,
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `ConferenceNotes_StudentId_CreatedAt_idx`(`StudentId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LessonSummaries` ADD CONSTRAINT `LessonSummaries_LessonId_fkey` FOREIGN KEY (`LessonId`) REFERENCES `Lessons`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonSummaries` ADD CONSTRAINT `LessonSummaries_ReviewedById_fkey` FOREIGN KEY (`ReviewedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConferenceNotes` ADD CONSTRAINT `ConferenceNotes_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConferenceNotes` ADD CONSTRAINT `ConferenceNotes_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

