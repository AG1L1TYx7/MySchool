-- CreateTable
CREATE TABLE `XapiStatements` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `ActorUserId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NULL,
    `Verb` VARCHAR(40) NOT NULL,
    `ObjectType` VARCHAR(40) NOT NULL,
    `ObjectId` CHAR(36) NOT NULL,
    `ObjectName` VARCHAR(200) NOT NULL,
    `ResultScaled` DECIMAL(4, 3) NULL,
    `ResultRaw` DECIMAL(9, 2) NULL,
    `ResultMax` DECIMAL(9, 2) NULL,
    `ResultSuccess` BOOLEAN NULL,
    `ResultCompletion` BOOLEAN NULL,
    `DurationSeconds` INTEGER NULL,
    `ContextClassId` CHAR(36) NULL,
    `ContextParentId` CHAR(36) NULL,
    `Registration` CHAR(36) NULL,
    `Statement` TEXT NOT NULL,
    `Timestamp` DATETIME(6) NOT NULL,
    `StoredAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `VoidedAt` DATETIME(6) NULL,

    INDEX `XapiStatements_StudentId_Timestamp_idx`(`StudentId`, `Timestamp`),
    INDEX `XapiStatements_ObjectType_ObjectId_Timestamp_idx`(`ObjectType`, `ObjectId`, `Timestamp`),
    INDEX `XapiStatements_OrganizationId_Timestamp_idx`(`OrganizationId`, `Timestamp`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SrsCards` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `SourceType` VARCHAR(30) NOT NULL DEFAULT 'manual',
    `SourceId` CHAR(36) NULL,
    `Front` TEXT NOT NULL,
    `Back` TEXT NOT NULL,
    `Hint` TEXT NULL,
    `Easiness` DECIMAL(4, 2) NOT NULL DEFAULT 2.5,
    `IntervalDays` INTEGER NOT NULL DEFAULT 0,
    `Repetitions` INTEGER NOT NULL DEFAULT 0,
    `Lapses` INTEGER NOT NULL DEFAULT 0,
    `DueOn` DATE NOT NULL,
    `LastReviewedAt` DATETIME(6) NULL,
    `Suspended` BOOLEAN NOT NULL DEFAULT false,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `SrsCards_StudentId_Suspended_DueOn_idx`(`StudentId`, `Suspended`, `DueOn`),
    INDEX `SrsCards_StudentId_SourceType_SourceId_idx`(`StudentId`, `SourceType`, `SourceId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SrsReviews` (
    `Id` CHAR(36) NOT NULL,
    `CardId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Quality` INTEGER NOT NULL,
    `IntervalBefore` INTEGER NOT NULL,
    `IntervalAfter` INTEGER NOT NULL,
    `EasinessAfter` DECIMAL(4, 2) NOT NULL,
    `DurationMs` INTEGER NULL,
    `ReviewedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `SrsReviews_StudentId_ReviewedAt_idx`(`StudentId`, `ReviewedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MasteryLevels` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `StandardId` CHAR(36) NOT NULL,
    `Level` DECIMAL(4, 3) NOT NULL,
    `EvidenceCount` INTEGER NOT NULL DEFAULT 0,
    `Trend` VARCHAR(10) NOT NULL DEFAULT 'flat',
    `LastEvidenceAt` DATETIME(6) NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `MasteryLevels_StandardId_Level_idx`(`StandardId`, `Level`),
    UNIQUE INDEX `MasteryLevels_StudentId_StandardId_key`(`StudentId`, `StandardId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `XapiStatements` ADD CONSTRAINT `XapiStatements_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `XapiStatements` ADD CONSTRAINT `XapiStatements_ActorUserId_fkey` FOREIGN KEY (`ActorUserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `XapiStatements` ADD CONSTRAINT `XapiStatements_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SrsCards` ADD CONSTRAINT `SrsCards_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SrsCards` ADD CONSTRAINT `SrsCards_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SrsReviews` ADD CONSTRAINT `SrsReviews_CardId_fkey` FOREIGN KEY (`CardId`) REFERENCES `SrsCards`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SrsReviews` ADD CONSTRAINT `SrsReviews_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MasteryLevels` ADD CONSTRAINT `MasteryLevels_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MasteryLevels` ADD CONSTRAINT `MasteryLevels_StandardId_fkey` FOREIGN KEY (`StandardId`) REFERENCES `Standards`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

