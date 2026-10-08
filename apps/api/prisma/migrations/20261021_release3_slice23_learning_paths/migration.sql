-- CreateTable
CREATE TABLE `LearningPaths` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Goal` TEXT NULL,
    `Source` VARCHAR(16) NOT NULL DEFAULT 'generated',
    `Status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `Rationale` TEXT NULL,
    `CompletedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `LearningPaths_StudentId_Status_idx`(`StudentId`, `Status`),
    INDEX `LearningPaths_OrganizationId_Status_UpdatedAt_idx`(`OrganizationId`, `Status`, `UpdatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningPathSteps` (
    `Id` CHAR(36) NOT NULL,
    `PathId` CHAR(36) NOT NULL,
    `SortOrder` INTEGER NOT NULL,
    `Kind` VARCHAR(16) NOT NULL,
    `RefId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Reason` VARCHAR(500) NULL,
    `StandardCode` VARCHAR(80) NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `Evidence` VARCHAR(500) NULL,
    `CompletedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `LearningPathSteps_PathId_SortOrder_idx`(`PathId`, `SortOrder`),
    INDEX `LearningPathSteps_Kind_RefId_idx`(`Kind`, `RefId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LearningPaths` ADD CONSTRAINT `LearningPaths_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningPaths` ADD CONSTRAINT `LearningPaths_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningPaths` ADD CONSTRAINT `LearningPaths_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningPathSteps` ADD CONSTRAINT `LearningPathSteps_PathId_fkey` FOREIGN KEY (`PathId`) REFERENCES `LearningPaths`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

